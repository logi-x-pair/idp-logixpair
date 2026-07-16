import { createAuthEndpoint } from "better-auth/api";
import { constantTimeEqual } from "better-auth/crypto";
import { z } from "zod";

import { isAccessTokenDenylisted } from "./jwt-revocation";

const statusBody = z
	.object({
		sid: z.string().min(1).optional(),
		sub: z.string().min(1).optional(),
		azp: z.string().min(1).optional(),
		jti: z.string().min(1).optional(),
	})
	.refine(
		(value) =>
			(Boolean(value.sid) && Boolean(value.sub) && !value.azp) ||
			(Boolean(value.azp) && !value.sid && !value.sub),
		"Provide either sid+sub for a user token or azp for a machine token",
	);

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

					const { sid, sub, azp, jti } = ctx.body;
					if (jti && (await isAccessTokenDenylisted(jti))) {
						return ctx.json({ active: false });
					}
					let active = false;
					if (sid && sub) {
						const session = (await ctx.context.adapter.findOne({
							model: "session",
							where: [
								{ field: "id", value: sid },
								{ field: "userId", value: sub },
							],
						})) as { expiresAt: Date | string } | null;
						active =
							!!session && new Date(session.expiresAt).getTime() > Date.now();
					} else if (azp) {
						const client = (await ctx.context.adapter.findOne({
							model: "oauthClient",
							where: [{ field: "clientId", value: azp }],
						})) as { disabled?: boolean } | null;
						active = !!client && client.disabled !== true;
					}
					return ctx.json({ active });
				},
			),
		},
		options,
	};
}
