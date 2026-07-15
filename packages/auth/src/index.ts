import { oauthProvider } from "@better-auth/oauth-provider";
import { createDb } from "@krazil-idp/db";
import * as schema from "@krazil-idp/db/schema/auth";
import { env } from "@krazil-idp/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";

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

export function createAuth() {
	const db = createDb();

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",

			schema: schema,
		}),
		trustedOrigins: [env.CORS_ORIGIN],
		emailAndPassword: {
			enabled: true,
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
		plugins: [
			jwt(),
			oauthProvider({
				loginPage: "/sign-in",
				consentPage: "/consent",
				signUp: {
					page: "/sign-up",
				},
				scopes: ["openid", "profile", "email", "offline_access"],
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
