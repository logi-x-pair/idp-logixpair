import { oauthProvider } from "@better-auth/oauth-provider";
import { createDb } from "@krazil-idp/db";
import * as schema from "@krazil-idp/db/schema/auth";
import { env } from "@krazil-idp/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";

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
