import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { loginAttempt } from "@krazil-idp/db/schema/lockout";
import { env } from "@krazil-idp/env/server";
import { APIError } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { eq, sql } from "drizzle-orm";

import { audit } from "./audit";
import {
	denylistVerifiedAccessToken,
	isAccessTokenDenylisted,
	isExpectedRevocationValidationError,
	type VerifiedRevocableToken,
	verifyRevocableAccessToken,
} from "./jwt-revocation";
import { LOCKOUT } from "./token-config";

function clientIp(headers: Headers | undefined): string | undefined {
	return headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}

function authenticatedClientId(
	headers: Headers | undefined,
	body: Record<string, unknown> | undefined,
): string | undefined {
	const authorization = headers?.get("authorization");
	if (authorization?.startsWith("Basic ")) {
		try {
			const decoded = Buffer.from(
				authorization.slice("Basic ".length),
				"base64",
			).toString("utf8");
			const separator = decoded.indexOf(":");
			return separator > 0 ? decoded.slice(0, separator) : undefined;
		} catch {
			return undefined;
		}
	}
	return typeof body?.client_id === "string" ? body.client_id : undefined;
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
		case "/oauth2/introspect": {
			if (failed) return;
			const introspection = returned as
				| { active?: unknown; jti?: unknown }
				| undefined;
			if (
				introspection?.active !== true ||
				typeof introspection.jti !== "string" ||
				!(await isAccessTokenDenylisted(introspection.jti))
			) {
				return;
			}
			return { active: false };
		}

		case "/oauth2/revoke": {
			if (failed) return;
			const token =
				typeof ctx.body?.token === "string" ? ctx.body.token : undefined;
			const clientId = authenticatedClientId(
				ctx.headers,
				ctx.body as Record<string, unknown> | undefined,
			);
			let claims: VerifiedRevocableToken | undefined;
			if (token && clientId) {
				try {
					// The plugin can convert invalid-JWT BAD_REQUEST into null, so
					// independently verify signature/iss/aud and require azp ownership.
					claims = await verifyRevocableAccessToken({
						token,
						issuer: ctx.context.baseURL,
						audience: env.OAUTH_VALID_AUDIENCES
							? env.OAUTH_VALID_AUDIENCES.split(",")
									.map((audience) => audience.trim())
									.filter(Boolean)
							: ctx.context.baseURL,
						expectedClientId: clientId,
					});
				} catch (error) {
					if (!isExpectedRevocationValidationError(error)) throw error;
					// RFC 7009 does not reveal invalid/foreign token details.
				}
			}
			if (!claims) {
				audit("token.revoke_ignored", { clientId, ip });
				return;
			}
			// Persistence failures must surface; reporting success here would leave
			// a stolen token active while claiming it was revoked.
			await denylistVerifiedAccessToken(claims);
			audit("token.revoked", { clientId, ip, jti: claims.jti });
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
