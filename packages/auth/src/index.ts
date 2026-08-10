import { oauthProvider } from "@better-auth/oauth-provider";
import { branding } from "@krazil-idp/branding/config";
import { createDb } from "@krazil-idp/db";
import * as schema from "@krazil-idp/db/schema";
import { env } from "@krazil-idp/env/server";
import { and, eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { organization } from "better-auth/plugins/organization";
import { jwt } from "better-auth/plugins/jwt";
import { twoFactor } from "better-auth/plugins/two-factor";
import { audit } from "./audit";
import { mailer, resetPasswordEmail, verificationEmail } from "./email";
import {
	adminTargetGuardPlugin,
	banEnforcementPlugin,
	IP_ADDRESS_HEADERS,
	lockoutGuard,
	organizationMutationGuardPlugin,
	platformMutationGuardPlugin,
	securityAuditPlugin,
} from "./guards";
import { organizationHooks } from "./organization-policy";
import { ac, organizationAc, organizationRoles, roles } from "./permissions";
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
		// Trust this header only when the deployment proxy strips all inbound
		// client values and writes its own canonical forwarding chain.
		advanced: {
			ipAddress: {
				ipAddressHeaders: [...IP_ADDRESS_HEADERS],
				// Validate the forwarded chain against known proxy hops when set;
				// otherwise the first x-forwarded-for value is trusted blindly.
				...(env.TRUSTED_PROXIES
					? {
							trustedProxies: env.TRUSTED_PROXIES.split(",")
								.map((p) => p.trim())
								.filter(Boolean),
						}
					: {}),
			},
		},
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION === "true",
			revokeSessionsOnPasswordReset: true,
			minPasswordLength: 12,
			onPasswordReset: async ({ user }) => {
				audit("password.reset", { email: user.email });
			},
			sendResetPassword: async ({ user, url }) => {
				await mailer.send(resetPasswordEmail(user.email, url));
			},
		},
		emailVerification: {
			sendOnSignUp: true,
			sendOnSignIn: true,
			autoSignInAfterVerification: true,
			sendVerificationEmail: async ({ user, url }) => {
				await mailer.send(verificationEmail(user.email, url));
			},
		},
		// The user `role` field is owned by the admin plugin below (string,
		// `input: false` — NEVER settable through public sign-up; assigned only
		// by server-side provisioning: seed:admin and the set-role CLI).
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		// The JWT plugin exposes a session-token endpoint at /token; the OAuth
		// token endpoint (/oauth2/token) is the only token issuer this IdP serves.
		disabledPaths: ["/token"],
		// Global rate limiting: enabled automatically in production (per-IP).
		// The OAuth provider plugin layers stricter per-endpoint limits on top
		// (documented in README.md). Counter storage follows RATE_LIMIT_STORAGE:
		// "memory" (default, single-instance) or "database" (multi-instance).
		rateLimit: {
			window: 60,
			max: 100,
			storage: env.RATE_LIMIT_STORAGE,
		},
		hooks: {
			// Temporary lockout with exponential backoff after repeated failures.
			before: lockoutGuard,
		},
		plugins: [
			...(revocationSecret
				? [revocationStatus({ secret: revocationSecret })]
				: []),
			jwt(),
			admin({
				ac,
				roles,
				defaultRole: "user",
				adminRoles: ["admin"],
			}),
			organization({
				ac: organizationAc,
				roles: organizationRoles,
				allowUserToCreateOrganization: false,
				creatorRole: "admin",
				disableOrganizationDeletion: true,
				organizationHooks,
			}),
			// Public organization mutations require the transaction-owning policy service.
			organizationMutationGuardPlugin(),
			platformMutationGuardPlugin(),
			// Non-admin operators: admin-target protection + update field allowlist.
			adminTargetGuardPlugin(),
			// Bans must kill OAuth tokens too, not just sessions (see guards.ts).
			banEnforcementPlugin(),
			twoFactor({
				issuer: branding.brandName,
				twoFactorCookieMaxAge: 10 * 60,
				trustDeviceMaxAge: 30 * 24 * 60 * 60,
				accountLockout: {
					enabled: true,
					maxFailedAttempts: 5,
					durationSeconds: 15 * 60,
				},
				backupCodeOptions: {
					amount: 10,
					length: 10,
					storeBackupCodes: "encrypted",
				},
			}),
			oauthProvider({
				loginPage: "/sign-in",
				consentPage: "/consent",
				postLogin: {
					page: "/organizations",
					shouldRedirect: async ({ user, session }) => {
						const activeOrganizationId = session.activeOrganizationId;
						const activeMemberships = await db
							.select({ organizationId: schema.member.organizationId })
							.from(schema.member)
							.innerJoin(
								schema.organization,
								eq(schema.organization.id, schema.member.organizationId),
							)
							.where(
								and(
									eq(schema.member.userId, user.id),
									eq(schema.organization.status, "active"),
								),
							)
							.limit(101);
						if (
							typeof activeOrganizationId === "string" &&
							activeMemberships.some(
								(row) => row.organizationId === activeOrganizationId,
							)
						) {
							return false;
						}
						return activeMemberships.length > 0;
					},
					consentReferenceId: async () => undefined,
				},
				signUp: {
					page: "/sign-up",
				},
				scopes: ["openid", "profile", "email", "offline_access"],
				silenceWarnings: { oauthAuthServerConfig: true },
				// JWTs remain enabled in every runtime mode so existing client
				// secrets, JWKS discovery, and ID-token validation stay compatible.
				// Short-lived mode uses a 10-minute JWT; hybrid/immediate retain
				// the one-hour default because live status checks provide the
				// authorization boundary.
				accessTokenExpiresIn:
					env.OAUTH_ACCESS_TOKEN_MODE === "short-lived"
						? TOKEN_LIFETIMES.shortLivedAccessTokenSeconds
						: TOKEN_LIFETIMES.accessTokenSeconds,
				m2mAccessTokenExpiresIn: TOKEN_LIFETIMES.m2mAccessTokenSeconds,
				idTokenExpiresIn: TOKEN_LIFETIMES.idTokenSeconds,
				refreshTokenExpiresIn: TOKEN_LIFETIMES.refreshTokenSeconds,
				codeExpiresIn: TOKEN_LIFETIMES.codeSeconds,
				scopeExpirations: SCOPE_EXPIRATIONS,
				// Unique token id for individual RFC 7009 revocation. JWTs keep
				// this signed claim for their lifetime; opaque-token introspection
				// may surface a fresh informational id that is never denylisted.
				customAccessTokenClaims: () => ({ jti: crypto.randomUUID() }),
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
			// Runs after protocol/2FA hooks so audit events reflect final outcomes.
			securityAuditPlugin(),
			// nextCookies must stay LAST so it can set cookies from prior plugins' responses.
			nextCookies(),
		],
	});
}

export const auth = createAuth();
