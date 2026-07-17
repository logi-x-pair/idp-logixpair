import { db } from "@krazil-idp/db";
import { loginAttempt } from "@krazil-idp/db/schema/lockout";
import { env } from "@krazil-idp/env/server";
import { APIError, type BetterAuthPlugin } from "better-auth";
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

/**
 * Single source of truth for the trusted client-IP header. index.ts feeds the
 * same list to better-auth's advanced.ipAddress config so audit records and
 * rate limiting can never drift apart.
 */
export const IP_ADDRESS_HEADERS = ["x-forwarded-for"] as const;

function clientIp(headers: Headers | undefined): string | undefined {
	return (
		headers?.get(IP_ADDRESS_HEADERS[0])?.split(",")[0]?.trim() ?? undefined
	);
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
		const retryAfter = Math.max(
			1,
			Math.ceil((row.lockedUntil.getTime() - Date.now()) / 1000),
		);
		// Byte-identical to better-auth's built-in rate-limit response so a
		// locked account is indistinguishable from ordinary throttling.
		throw new APIError(
			"TOO_MANY_REQUESTS",
			{ message: "Too many requests. Please try again later." },
			{ "X-Retry-After": String(retryAfter) },
		);
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
	// Track unknown emails identically to real accounts: skipping them would
	// let an attacker distinguish registered addresses by lockout behavior.
	// Length/format guard keeps garbage keys out of the table.
	if (email.length > 254 || !email.includes("@")) return;
	// Opportunistic pruning bounds unknown-email rows (max lock is 1h; 24h
	// idle retention preserves backoff history for active attacks).
	await db.delete(loginAttempt).where(
		sql`${loginAttempt.updatedAt} < now() - interval '24 hours'
				AND (${loginAttempt.lockedUntil} IS NULL OR ${loginAttempt.lockedUntil} < now())`,
	);
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
			await recordLoginOutcome(email, failed);
			const twoFactorPending =
				!failed &&
				typeof returned === "object" &&
				returned !== null &&
				"twoFactorRedirect" in returned &&
				returned.twoFactorRedirect === true;
			if (twoFactorPending) return;
			audit(failed ? "login.failure" : "login.success", { email, ip });
			return;
		}
		case "/two-factor/verify-totp":
		case "/two-factor/verify-backup-code": {
			if (failed) {
				// Never log the submitted code; ip + factor is enough to spot
				// brute-force attempts against a challenged account.
				audit("login.two_factor_failure", {
					ip,
					factor:
						ctx.path === "/two-factor/verify-totp" ? "totp" : "backup-code",
				});
				return;
			}
			const incomingSession = await ctx.getSignedCookie(
				ctx.context.authCookies.sessionToken.name,
				ctx.context.secret,
			);
			// A request with an existing session is enrollment/settings verification,
			// not completion of a challenged login.
			if (incomingSession) return;
			const email = ctx.context.newSession?.user.email?.toLowerCase();
			if (!email) return;
			audit("login.success", {
				email,
				ip,
				factor: ctx.path === "/two-factor/verify-totp" ? "totp" : "backup-code",
			});
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
		case "/admin/oauth2/create-client":
		case "/oauth2/create-client": {
			if (failed) return;
			const created = returned as { client_id?: string } | undefined;
			audit("client.created", {
				clientId: created?.client_id,
				userId: ctx.context.session?.user.id,
				ip,
			});
			return;
		}
		case "/admin/oauth2/update-client":
		case "/oauth2/update-client": {
			if (failed) return;
			audit("client.updated", {
				clientId: ctx.body?.client_id,
				userId: ctx.context.session?.user.id,
				ip,
			});
			return;
		}
		case "/oauth2/delete-client": {
			if (failed) return;
			audit("client.deleted", {
				clientId: ctx.body?.client_id,
				userId: ctx.context.session?.user.id,
				ip,
			});
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

/** Runs after built-in plugin hooks so audit records reflect the final result. */
export function securityAuditPlugin(): BetterAuthPlugin {
	return {
		id: "security-audit",
		hooks: {
			after: [
				{
					matcher: () => true,
					handler: auditHook,
				},
			],
		},
	};
}
