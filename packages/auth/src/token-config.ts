/**
 * Token lifetime configuration (seconds). These are the plugin defaults made
 * explicit — change them here, not inline in the plugin config.
 */
export const TOKEN_LIFETIMES = {
	/** JWT/opaque access tokens from the authorization_code grant. */
	accessTokenSeconds: 60 * 60, // 1h (plugin default)
	/** Access-token TTL for the default short-lived authorization mode. */
	shortLivedAccessTokenSeconds: 10 * 60, // 10m
	/** Machine-to-machine access tokens (client_credentials grant). */
	m2mAccessTokenSeconds: 60 * 60, // 1h (plugin default)
	/** OIDC id_tokens. */
	idTokenSeconds: 60 * 60, // 1h — point-in-time authentication assertion
	/** Refresh tokens (rotated on every use). */
	refreshTokenSeconds: 30 * 24 * 60 * 60, // 30d (plugin default)
	/** Authorization codes. */
	codeSeconds: 60, // 60s — codes are one-shot; short window per OAuth 2.1 guidance
} as const;

/**
 * Short lifetimes for high-privilege scopes (earliest expiration wins).
 * This deployment's default scopes are all low-privilege; add entries here
 * when introducing sensitive scopes, e.g.:
 *
 *   export const SCOPE_EXPIRATIONS = { "write:payments": "5m" } as const;
 */
export const SCOPE_EXPIRATIONS: Record<string, string> = {};

/** Failed-login lockout policy. */
export const LOCKOUT = {
	maxFailedAttempts: 5,
	/** First lockout duration; doubles per additional failure. */
	baseLockSeconds: 60,
	/** Upper bound for the backoff. */
	maxLockSeconds: 60 * 60,
} as const;
