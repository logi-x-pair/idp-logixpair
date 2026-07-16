import { oauthProvider } from "@better-auth/oauth-provider";
import { createDb } from "@krazil-idp/db";
import * as schema from "@krazil-idp/db/schema/auth";
import { env } from "@krazil-idp/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";

import { mailer, resetPasswordEmail, verificationEmail } from "./email";
import { auditHook, lockoutGuard } from "./guards";
import { revocationStatus } from "./revocation-status";
import { SCOPE_EXPIRATIONS, TOKEN_LIFETIMES } from "./token-config";

/** Emails allowed to manage OAuth clients (create/read/update/delete/rotate). */
const adminEmails = new Set(
	(env.OAUTH_ADMIN_EMAILS ?? "")
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter((e) => e.length > 0),
);

/**
 * Client IDs served from the plugin's in-memory trusted cache. Cached clients
 * are locked against CRUD endpoints ("trusted clients must be updated
 * manually") and any DB change to them requires a process restart. See
 * RUNBOOK.md for the rotate/disable procedure.
 */
const trustedClientIds = (env.OAUTH_TRUSTED_CLIENT_IDS ?? "")
	.split(",")
	.map((id) => id.trim())
	.filter((id) => id.length > 0);

function revocationStatusSecret(): string | undefined {
	if (env.OAUTH_ACCESS_TOKEN_MODE === "short-lived") return undefined;
	if (!env.OAUTH_REVOCATION_CHECK_SECRET) {
		throw new Error(
			"OAUTH_REVOCATION_CHECK_SECRET is required when OAUTH_ACCESS_TOKEN_MODE is hybrid or immediate",
		);
	}
	return env.OAUTH_REVOCATION_CHECK_SECRET;
}

export function createAuth() {
	const db = createDb();
	const revocationSecret = revocationStatusSecret();

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",

			schema: schema,
		}),
		trustedOrigins: [env.CORS_ORIGIN],
		emailAndPassword: {
			enabled: true,
			sendResetPassword: async ({ user, url }) => {
				await mailer.send(resetPasswordEmail(user.email, url));
			},
		},
		emailVerification: {
			sendVerificationEmail: async ({ user, url }) => {
				await mailer.send(verificationEmail(user.email, url));
			},
		},
		user: {
			additionalFields: {
				// Operator role. `input: false` = NEVER settable through public
				// sign-up; only server-side provisioning (seed:admin) assigns it.
				role: {
					type: "string",
					defaultValue: "user",
					input: false,
				},
			},
		},
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		// The JWT plugin exposes a session-token endpoint at /token; the OAuth
		// token endpoint (/oauth2/token) is the only token issuer this IdP serves.
		disabledPaths: ["/token"],
		// Global rate limiting: enabled automatically in production (per-IP).
		// The OAuth provider plugin layers stricter per-endpoint limits on top
		// (documented in README.md). Memory storage assumes one instance per
		// deployment; switch to database storage for horizontal scaling.
		rateLimit: {
			window: 60,
			max: 100,
		},
		hooks: {
			// Temporary lockout with exponential backoff after repeated failures.
			before: lockoutGuard,
			// Audit log: login success/failure, token issuance, secret rotation,
			// consent grant/deny/revoke, token revocation.
			after: auditHook,
		},
		plugins: [
			...(revocationSecret
				? [revocationStatus({ secret: revocationSecret })]
				: []),
			jwt(),
			oauthProvider({
				loginPage: "/sign-in",
				consentPage: "/consent",
				signUp: {
					page: "/sign-up",
				},
				scopes: ["openid", "profile", "email", "offline_access"],
				silenceWarnings: { oauthAuthServerConfig: true },
				// JWTs remain enabled in every runtime mode so existing client
				// secrets, JWKS discovery, and ID-token validation stay compatible.
				// Token lifetimes: plugin defaults, made explicit (token-config.ts).
				accessTokenExpiresIn: TOKEN_LIFETIMES.accessTokenSeconds,
				m2mAccessTokenExpiresIn: TOKEN_LIFETIMES.m2mAccessTokenSeconds,
				idTokenExpiresIn: TOKEN_LIFETIMES.idTokenSeconds,
				refreshTokenExpiresIn: TOKEN_LIFETIMES.refreshTokenSeconds,
				codeExpiresIn: TOKEN_LIFETIMES.codeSeconds,
				scopeExpirations: SCOPE_EXPIRATIONS,
				// Token prefixes for secret scanners. Set BEFORE the first
				// production deploy; IMMUTABLE afterwards (RUNBOOK.md).
				prefix: {
					opaqueAccessToken: env.OAUTH_ACCESS_TOKEN_PREFIX,
					refreshToken: env.OAUTH_REFRESH_TOKEN_PREFIX,
					clientSecret: env.OAUTH_CLIENT_SECRET_PREFIX,
				},
				cachedTrustedClients: new Set(trustedClientIds),
				// All client management is operator-only on this IdP: clients are
				// first-party and provisioned by the seed script / admin CLI.
				// Requires BOTH the server-assigned admin role (not settable via
				// public sign-up) AND membership in the OAUTH_ADMIN_EMAILS list.
				clientPrivileges: ({ user }) => {
					const email = user?.email;
					return (
						user?.role === "admin" &&
						typeof email === "string" &&
						adminEmails.has(email.toLowerCase())
					);
				},
				// SUBJECT STRATEGY (decided: public). `sub` is the internal user id
				// across all clients. To enable pairwise subject identifiers later,
				// set OAUTH_PAIRWISE_SECRET (>=32 chars) and uncomment:
				//
				//   pairwiseSecret: env.OAUTH_PAIRWISE_SECRET,
				//
				// Enabling pairwise changes nothing for existing public clients
				// (clients opt in with subject_type: "pairwise" at registration),
				// but the secret is PERMANENT once set — rotating it breaks every
				// pairwise RP session (see RUNBOOK.md).
				...(env.OAUTH_VALID_AUDIENCES
					? {
							validAudiences: env.OAUTH_VALID_AUDIENCES.split(",").map((a) =>
								a.trim(),
							),
						}
					: {}),
			}),
			// nextCookies must stay LAST so it can set cookies from prior plugins' responses.
			nextCookies(),
		],
	});
}

export const auth = createAuth();
