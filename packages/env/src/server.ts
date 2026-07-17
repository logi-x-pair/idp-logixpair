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
		/** Provider-neutral transactional email webhook (required in production). */
		MAILER_WEBHOOK_URL: z.url().optional(),
		MAILER_WEBHOOK_TOKEN: z.string().optional(),
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
	if (!env.MAILER_WEBHOOK_URL) {
		throw new Error(
			"MAILER_WEBHOOK_URL is required in production; refusing to start without transactional email delivery.",
		);
	}
	if (!env.BETTER_AUTH_URL.startsWith("https://")) {
		throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
	}
}
