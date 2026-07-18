import type {
	TokenRevocationStatusRequest,
	TokenRevocationStatusResponse,
} from "@krazil-idp/types";
import { createAuthEndpoint } from "better-auth/api";
import { constantTimeEqual } from "better-auth/crypto";
import { z } from "zod";

import { isAccessTokenDenylisted } from "./jwt-revocation";

// The declared output type binds this schema to the public wire contract in
// @krazil-idp/types; acceptance semantics are unchanged from the original
// refine (sid+sub without azp, or azp alone).
const statusBody = z
	.object({
		sid: z.string().min(1).optional(),
		sub: z.string().min(1).optional(),
		azp: z.string().min(1).optional(),
		jti: z.string().min(1).optional(),
	})
	.transform((value, ctx): TokenRevocationStatusRequest => {
		if (value.sid && value.sub && !value.azp) {
			return { sid: value.sid, sub: value.sub, jti: value.jti };
		}
		if (value.azp && !value.sid && !value.sub) {
			return { azp: value.azp, jti: value.jti };
		}
		ctx.addIssue({
			code: "custom",
			message:
				"Provide either sid+sub for a user token or azp for a machine token",
		});
		return z.NEVER;
	});

export function revocationStatus(options: { secret: string }) {
	return {
		id: "revocation-status",
		endpoints: {
			check: createAuthEndpoint(
				"/token-revocation-status",
				{
					method: "POST",
					body: statusBody,
				},
				async (ctx) => {
					const authorization = ctx.request?.headers.get("authorization");
					const suppliedSecret = authorization?.startsWith("Bearer ")
						? authorization.slice("Bearer ".length)
						: undefined;
					if (
						!suppliedSecret ||
						!constantTimeEqual(suppliedSecret, options.secret)
					) {
						throw ctx.error("UNAUTHORIZED", {
							message: "Invalid revocation-status credentials",
						});
					}

					const identity = ctx.body;
					if (identity.jti && (await isAccessTokenDenylisted(identity.jti))) {
						return ctx.json({
							active: false,
						} satisfies TokenRevocationStatusResponse);
					}
					let active = false;
					if ("sid" in identity) {
						const session = (await ctx.context.adapter.findOne({
							model: "session",
							where: [
								{ field: "id", value: identity.sid },
								{ field: "userId", value: identity.sub },
							],
						})) as { expiresAt: Date | string } | null;
						active =
							!!session && new Date(session.expiresAt).getTime() > Date.now();
					} else {
						const client = (await ctx.context.adapter.findOne({
							model: "oauthClient",
							where: [{ field: "clientId", value: identity.azp }],
						})) as { disabled?: boolean } | null;
						active = !!client && client.disabled !== true;
					}
					return ctx.json({ active } satisfies TokenRevocationStatusResponse);
				},
			),
		},
		options,
	};
}
