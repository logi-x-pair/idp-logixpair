import { db } from "@krazil-idp/db";
import { oauthAccessToken, user } from "@krazil-idp/db/schema/auth";
import { loginAttempt } from "@krazil-idp/db/schema/lockout";
import { env } from "@krazil-idp/env/server";
import { APIError, type BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
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
import { revokeUserTokens } from "./user-revocation";

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

const GUARDED_ADMIN_PATHS: Record<string, true> = {
	"/admin/create-user": true,
	"/admin/ban-user": true,
	"/admin/unban-user": true,
	"/admin/update-user": true,
	"/admin/remove-user": true,
};
const ORGANIZATION_MUTATION_PATHS: Record<string, true> = {
	"/organization/create": true,
	"/organization/set-active": true,
	"/organization/update": true,
	"/organization/delete": true,
	"/organization/add-member": true,
	"/organization/remove-member": true,
	"/organization/update-member-role": true,
	"/organization/invite-member": true,
	"/organization/cancel-invitation": true,
	"/organization/accept-invitation": true,
	"/organization/reject-invitation": true,
	"/organization/leave": true,
	"/organization/create-role": true,
	"/organization/update-role": true,
	"/organization/delete-role": true,
};
const PLATFORM_MUTATION_PATHS: Record<string, true> = {
	"/admin/set-role": true,
	"/admin/create-user": true,
	"/admin/update-user": true,
	"/admin/unban-user": true,
	"/admin/ban-user": true,
	"/admin/impersonate-user": true,
	"/admin/stop-impersonating": true,
	"/admin/revoke-user-session": true,
	"/admin/revoke-user-sessions": true,
	"/admin/remove-user": true,
	"/admin/set-user-password": true,
};

/** Public admin mutations must use the transaction-owning account service. */
export function platformMutationGuardPlugin(): BetterAuthPlugin {
	return {
		id: "platform-mutation-guard",
		hooks: {
			before: [
				{
					matcher: (ctx) => PLATFORM_MUTATION_PATHS[ctx.path ?? ""] === true,
					handler: createAuthMiddleware(async (ctx) => {
						if (!ctx.request) return;
						throw new APIError("FORBIDDEN", {
							message:
								"Platform mutations require the server-side account service",
						});
					}),
				},
			],
		},
	};
}

/**
 * Better Auth organization hooks are not a transaction boundary. Every
 * Better Auth organization mutation path is therefore denied here, including
 * no-Request server-only calls. Non-test server code must use the explicit
 * transaction-owning policy services so writes and audit/outbox rows commit
 * atomically.
 */
export function organizationMutationGuardPlugin(): BetterAuthPlugin {
	return {
		id: "organization-mutation-guard",
		hooks: {
			before: [
				{
					matcher: (ctx) => ORGANIZATION_MUTATION_PATHS[ctx.path ?? ""] === true,
					handler: createAuthMiddleware(async () => {
						throw new APIError("FORBIDDEN", {
							message:
								"Organization mutations require the server-side policy service",
						});
					}),
				},
			],
		},
	};
}

/**
 * Fields a non-admin operator (moderator) may pass to /admin/update-user.
 * The plugin itself only special-cases password/role/ban/email — everything
 * else (e.g. twoFactorEnabled, timestamps) would flow straight to the
 * database under the generic `update` permission. Ban fields are listed here
 * but additionally require the `ban` permission and a non-admin target.
 * Extend deliberately per deployment; every addition widens what HR-style
 * operators can mutate.
 */
const MODERATOR_UPDATABLE_FIELDS: Record<string, true> = {
	name: true,
	image: true,
	banned: true,
	banReason: true,
	banExpires: true,
};

/**
 * Hardens admin-plugin routes for non-admin operators. The plugin's access
 * control decides WHAT a role may do (e.g. moderators may ban), but not WHOM
 * it may target or WHICH raw fields `update` may touch. Invariants:
 *
 * 1. Only admins may ban, ban-edit, or remove an account holding the admin
 *    role — otherwise a moderator could lock out an operator.
 * 2. Non-admin update-user requests are restricted to an explicit field
 *    allowlist, and non-admin create-user requests may not carry a `data`
 *    payload at all — otherwise the generic permissions could disable an
 *    employee's 2FA, pre-verify emails, or write arbitrary columns.
 *
 * Moderators MAY set the initial password at creation (it is a required
 * create-user field and part of onboarding); changing an EXISTING account's
 * password stays admin-only (`set-password`). Prefer a throwaway initial
 * password plus the email reset flow.
 */
export function adminTargetGuardPlugin(): BetterAuthPlugin {
	return {
		id: "admin-target-guard",
		hooks: {
			before: [
				{
					matcher: (ctx) => GUARDED_ADMIN_PATHS[ctx.path ?? ""] === true,
					handler: createAuthMiddleware(async (ctx) => {
						const body = ctx.body as
							| { userId?: string; data?: Record<string, unknown> }
							| undefined;
						const session = await getSessionFromCtx(ctx);
						const actor = session?.user as
							| { email?: string; role?: string }
							| undefined;
						if (actor?.role?.split(",").includes("admin")) return;

						if (ctx.path === "/admin/create-user") {
							const extraFields = Object.keys(body?.data ?? {});
							if (extraFields.length === 0) return;
							audit("admin.update_fields_rejected", {
								email: actor?.email,
								path: ctx.path,
								fields: extraFields,
							});
							throw new APIError("FORBIDDEN", {
								message:
									"Non-admin operators may not set additional fields at creation",
							});
						}

						if (ctx.path === "/admin/update-user") {
							const data = body?.data ?? {};
							const rejected = Object.keys(data).filter(
								(key) => MODERATOR_UPDATABLE_FIELDS[key] !== true,
							);
							if (rejected.length > 0) {
								audit("admin.update_fields_rejected", {
									email: actor?.email,
									fields: rejected,
								});
								throw new APIError("FORBIDDEN", {
									message: `Non-admin operators may not update: ${rejected.join(", ")}`,
								});
							}
							const touchesBan =
								"banned" in data || "banReason" in data || "banExpires" in data;
							if (!touchesBan) return;
						}

						const targetId = body?.userId;
						if (!targetId) return; // plugin body validation rejects this
						const target = (await ctx.context.internalAdapter.findUserById(
							targetId,
						)) as { role?: string } | null;
						if (!target?.role?.split(",").includes("admin")) return;
						audit("admin.protected_target_rejected", {
							email: actor?.email,
							path: ctx.path,
						});
						throw new APIError("FORBIDDEN", {
							message: "Only admins may modify admin accounts",
						});
					}),
				},
			],
		},
	};
}

const BAN_MUTATION_PATHS: Record<string, true> = {
	"/admin/ban-user": true,
	"/admin/update-user": true,
};

function jwtSubject(token: string): string | undefined {
	const payload = token.split(".")[1];
	if (!payload) return undefined;
	try {
		const claims = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		) as { sub?: unknown };
		return typeof claims.sub === "string" ? claims.sub : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Resolves the user an issued access token belongs to. JWT access tokens
 * (issued when the grant carried a resource/audience) carry `sub`; opaque
 * tokens (no audience requested) are looked up by their database row after
 * stripping the configured secret-scanner prefix. Rows are stored under the
 * provider's default `storeTokens: "hashed"` transform (SHA-256, unpadded
 * base64url) — keep this in sync if `storeTokens` is ever customized.
 */
async function issuedTokenUserId(
	accessToken: string,
): Promise<string | undefined> {
	const sub = jwtSubject(accessToken);
	if (sub) return sub;
	const prefix = env.OAUTH_ACCESS_TOKEN_PREFIX ?? "";
	const raw =
		prefix && accessToken.startsWith(prefix)
			? accessToken.slice(prefix.length)
			: accessToken;
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(raw),
	);
	const hashed = Buffer.from(digest).toString("base64url");
	const rows = await db
		.select({ userId: oauthAccessToken.userId })
		.from(oauthAccessToken)
		.where(eq(oauthAccessToken.token, hashed));
	return rows[0]?.userId ?? undefined;
}

/**
 * Makes bans effective across the OAuth surface, not just IdP sessions.
 * The admin plugin only deletes sessions on ban, and the OAuth provider's
 * refresh grant never consults `banned` — without this plugin a banned
 * user's RP would keep minting tokens from its refresh token.
 *
 * 1. After a successful ban (ban-user, or update-user setting banned), all
 *    of the user's OAuth refresh tokens are revoked and opaque access
 *    tokens deleted (same transaction as the revoke-user incident CLI).
 * 2. After any successful /oauth2/token response for a user subject, the
 *    issuance is rejected when that user is under an active ban — closing
 *    the window for pre-ban authorization codes and any grant path the
 *    revocation sweep might miss.
 *
 * Already-issued JWT access tokens remain valid until `exp` for RPs doing
 * local-only verification; hybrid/immediate status checks reject them
 * immediately because the ban deleted the session.
 */
export function banEnforcementPlugin(): BetterAuthPlugin {
	return {
		id: "ban-enforcement",
		hooks: {
			after: [
				{
					matcher: (ctx) => BAN_MUTATION_PATHS[ctx.path ?? ""] === true,
					handler: createAuthMiddleware(async (ctx) => {
						if (ctx.context.returned instanceof APIError) return;
						const body = ctx.body as
							| { userId?: string; data?: Record<string, unknown> }
							| undefined;
						if (
							ctx.path === "/admin/update-user" &&
							body?.data?.banned !== true
						) {
							return;
						}
						const targetId = body?.userId;
						if (!targetId) return;
						const revocation = await revokeUserTokens(targetId);
						audit("user.tokens_revoked", {
							userId: targetId,
							trigger: ctx.path,
							...revocation,
						});
					}),
				},
				{
					matcher: (ctx) => ctx.path === "/oauth2/token",
					handler: createAuthMiddleware(async (ctx) => {
						// Token responses arrive as a fetch Response; unwrap it the way
						// better-auth's own plugin-helper does (not publicly exported).
						const returned = ctx.context.returned;
						let tokenResponse: { access_token?: unknown } | undefined;
						if (returned instanceof Response) {
							if (returned.status !== 200) return;
							tokenResponse = (await returned
								.clone()
								.json()
								.catch(() => undefined)) as
								| { access_token?: unknown }
								| undefined;
						} else if (
							returned &&
							!(returned instanceof APIError) &&
							typeof returned === "object"
						) {
							tokenResponse = returned as { access_token?: unknown };
						}
						const accessToken = tokenResponse?.access_token;
						if (typeof accessToken !== "string") return;
						const sub = await issuedTokenUserId(accessToken);
						if (!sub) return; // machine tokens carry no user subject
						const rows = await db
							.select({ banned: user.banned, banExpires: user.banExpires })
							.from(user)
							.where(eq(user.id, sub));
						const target = rows[0];
						const activelyBanned =
							target?.banned === true &&
							(!target.banExpires || target.banExpires.getTime() > Date.now());
						if (!activelyBanned) return;
						audit("token.banned_user_rejected", {
							userId: sub,
							clientId: (ctx.body as { client_id?: string } | undefined)
								?.client_id,
						});
						throw new APIError("BAD_REQUEST", {
							error: "invalid_grant",
							error_description: "user access is disabled",
						});
					}),
				},
			],
		},
	};
}
