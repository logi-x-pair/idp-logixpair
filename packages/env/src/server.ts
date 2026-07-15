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
		/** Comma-separated audiences (resource servers) for JWT access tokens. */
		OAUTH_VALID_AUDIENCES: z.string().optional(),
		/** Token prefixes for secret scanners. Immutable after first production deploy. */
		OAUTH_ACCESS_TOKEN_PREFIX: z.string().optional(),
		OAUTH_REFRESH_TOKEN_PREFIX: z.string().optional(),
		OAUTH_CLIENT_SECRET_PREFIX: z.string().optional(),
		/** Enables pairwise subject identifiers when set. >=32 chars, permanent. */
		OAUTH_PAIRWISE_SECRET: z.string().min(32).optional(),
	},
	runtimeEnv: process.env,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
