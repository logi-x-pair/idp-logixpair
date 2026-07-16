import { createAuthEndpoint } from "better-auth/api";
import { constantTimeEqual } from "better-auth/crypto";
import { z } from "zod";

const statusBody = z.object({
	sid: z.string().min(1),
	sub: z.string().min(1),
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

					const { sid, sub } = ctx.body;
					const session = (await ctx.context.adapter.findOne({
						model: "session",
						where: [
							{ field: "id", value: sid },
							{ field: "userId", value: sub },
						],
					})) as { expiresAt: Date | string } | null;
					const active =
						!!session && new Date(session.expiresAt).getTime() > Date.now();
					return ctx.json({ active });
				},
			),
		},
		options,
	};
}
