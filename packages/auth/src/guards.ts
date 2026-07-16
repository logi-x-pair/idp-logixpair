import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { loginAttempt } from "@krazil-idp/db/schema/lockout";
import { APIError } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { eq, sql } from "drizzle-orm";

import { audit } from "./audit";
import { LOCKOUT } from "./token-config";

function clientIp(headers: Headers | undefined): string | undefined {
	return headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}

const maxLockExponent = Math.ceil(
	Math.log2(LOCKOUT.maxLockSeconds / LOCKOUT.baseLockSeconds),
);

/**
 * Pre-request guard: rejects sign-in attempts for accounts under temporary
 * lockout (failed-login backoff).
 */
export const lockoutGuard = createAuthMiddleware(async (ctx) => {
	if (ctx.path !== "/sign-in/email") return;
	const email = (ctx.body?.email as string | undefined)?.toLowerCase();
	if (!email) return;

	const rows = await db
		.select()
		.from(loginAttempt)
		.where(eq(loginAttempt.email, email));
	const row = rows[0];
	if (row?.lockedUntil && row.lockedUntil > new Date()) {
		audit("login.locked_out", { email, ip: clientIp(ctx.headers) });
		throw new APIError("TOO_MANY_REQUESTS", {
			message: "Too many failed attempts. Try again later.",
		});
	}
});

async function recordLoginOutcome(
	email: string,
	failed: boolean,
): Promise<void> {
	if (!failed) {
		await db.delete(loginAttempt).where(eq(loginAttempt.email, email));
		return;
	}
	const existingUser = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email));
	if (existingUser.length === 0) return;
	await db
		.insert(loginAttempt)
		.values({
			email,
			failedCount: 1,
			lockedUntil: null,
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: loginAttempt.email,
			set: {
				// The increment and backoff calculation run in one PostgreSQL
				// upsert, so concurrent failures cannot overwrite each other.
				failedCount: sql`${loginAttempt.failedCount} + 1`,
				lockedUntil: sql`CASE
					WHEN ${loginAttempt.failedCount} + 1 >= ${LOCKOUT.maxFailedAttempts}
					THEN now() + make_interval(secs => LEAST(
						POWER(
							2,
							LEAST(
								${loginAttempt.failedCount} + 1 - ${LOCKOUT.maxFailedAttempts},
								${maxLockExponent}
							)
						) * ${LOCKOUT.baseLockSeconds},
						${LOCKOUT.maxLockSeconds}
					))
					ELSE NULL
				END`,
				updatedAt: sql`now()`,
			},
		});
}

/**
 * Post-request hook: audit logging for security-relevant endpoints and
 * failed-login accounting.
 */
export const auditHook = createAuthMiddleware(async (ctx) => {
	const returned = ctx.context.returned;
	const failed = returned instanceof APIError;
	const ip = clientIp(ctx.headers);

	switch (ctx.path) {
		case "/sign-in/email": {
			const email = (ctx.body?.email as string | undefined)?.toLowerCase();
			if (!email) return;
			audit(failed ? "login.failure" : "login.success", { email, ip });
			await recordLoginOutcome(email, failed);
			return;
		}
		case "/oauth2/token": {
			if (failed) return;
			audit("token.issued", {
				clientId: ctx.body?.client_id,
				grantType: ctx.body?.grant_type,
				ip,
			});
			return;
		}
		case "/oauth2/revoke": {
			if (failed) return;
			audit("token.revoked", { clientId: ctx.body?.client_id, ip });
			return;
		}
		case "/oauth2/client/rotate-secret": {
			if (failed) return;
			audit("client.secret_rotated", { clientId: ctx.body?.client_id, ip });
			return;
		}
		case "/oauth2/consent": {
			if (failed) return;
			audit(ctx.body?.accept === true ? "consent.granted" : "consent.denied", {
				userId: ctx.context.session?.user.id,
				scope: ctx.body?.scope,
				ip,
			});
			return;
		}
		case "/oauth2/delete-consent": {
			if (failed) return;
			audit("consent.revoked", {
				consentId: ctx.body?.id,
				userId: ctx.context.session?.user.id,
				ip,
			});
			return;
		}
		default:
			return;
	}
});
