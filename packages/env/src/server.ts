import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		CORS_ORIGIN: z.url(),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		/** Sends verification on signup; optionally blocks unverified sign-in. */
		REQUIRE_EMAIL_VERIFICATION: z.enum(["true", "false"]).default("false"),
		/** Exposes opt-in 2FA enrollment UI; enrolled accounts remain enforced. */
		TWO_FACTOR_ENABLED: z.enum(["true", "false"]).default("false"),
		/** Access-token authorization policy; see README and INTEGRATION.md. */
		OAUTH_ACCESS_TOKEN_MODE: z
			.enum(["short-lived", "hybrid", "immediate"])
			.default("short-lived"),
		/** Server-to-server secret required by hybrid revocation checks. */
		OAUTH_REVOCATION_CHECK_SECRET: z.string().min(32).optional(),
		/** Comma-separated audiences (resource servers) for JWT access tokens. */
		OAUTH_VALID_AUDIENCES: z.string().optional(),
		/** Token prefixes for secret scanners. Immutable after first production deploy. */
		OAUTH_ACCESS_TOKEN_PREFIX: z.string().optional(),
		OAUTH_REFRESH_TOKEN_PREFIX: z.string().optional(),
		OAUTH_CLIENT_SECRET_PREFIX: z.string().optional(),
		/** Enables pairwise subject identifiers when set. >=32 chars, permanent. */
		OAUTH_PAIRWISE_SECRET: z.string().min(32).optional(),
		/** Comma-separated client_ids cached as locked trusted clients. */
		OAUTH_TRUSTED_CLIENT_IDS: z.string().optional(),
		/** Comma-separated emails allowed to manage OAuth clients (CRUD/rotate). */
		OAUTH_ADMIN_EMAILS: z.string().optional(),
		/** Provisioning admin used by seed/CLI scripts (dev/ops only). */
		IDP_ADMIN_EMAIL: z.string().optional(),
		IDP_ADMIN_PASSWORD: z.string().optional(),
		/** SMTP transactional email delivery (required in production). Works with any provider. */
		MAILER_SMTP_HOST: z.string().optional(),
		MAILER_SMTP_PORT: z.coerce.number().int().positive().default(587),
		MAILER_SMTP_USER: z.string().optional(),
		MAILER_SMTP_PASS: z.string().optional(),
		/** From address for outbound mail, e.g. "Acme ID <noreply@acme.example>". */
		MAILER_FROM: z.string().optional(),
		/** Rate-limit counter storage. Use "database" for multi-instance deployments. */
		RATE_LIMIT_STORAGE: z.enum(["memory", "database"]).default("memory"),
		/** Comma-separated proxy IPs/CIDRs allowed to set forwarded-IP headers. */
		TRUSTED_PROXIES: z.string().optional(),
	},
	runtimeEnv: process.env,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});

const isProductionBuildPhase =
	process.env.NEXT_PHASE === "phase-production-build" ||
	process.env.npm_lifecycle_event === "build";

if (
	env.NODE_ENV === "production" &&
	!process.env.SKIP_ENV_VALIDATION &&
	!isProductionBuildPhase
) {
	if (!env.MAILER_SMTP_HOST || !env.MAILER_FROM) {
		throw new Error(
			"MAILER_SMTP_HOST and MAILER_FROM are required in production; refusing to start without transactional email delivery.",
		);
	}
	if (env.MAILER_SMTP_USER && !env.MAILER_SMTP_PASS) {
		throw new Error(
			"MAILER_SMTP_PASS is required when MAILER_SMTP_USER is set.",
		);
	}
	if (!env.BETTER_AUTH_URL.startsWith("https://")) {
		throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
	}
	if (env.RATE_LIMIT_STORAGE !== "database") {
		console.warn(
			"[env] RATE_LIMIT_STORAGE=memory: rate-limit counters reset on restart and are per-instance. Set RATE_LIMIT_STORAGE=database before scaling beyond one instance.",
		);
	}
}

// Runtime misconfiguration warning: SKIP_ENV_VALIDATION disables the schema AND
// the production guards above, so it must never be left set at production runtime.
if (
	process.env.SKIP_ENV_VALIDATION &&
	process.env.NODE_ENV === "production" &&
	!isProductionBuildPhase
) {
	console.warn(
		"[env] SKIP_ENV_VALIDATION is set at production runtime: schema validation AND production safety guards are disabled. Unset it — it is intended for builds only.",
	);
}
