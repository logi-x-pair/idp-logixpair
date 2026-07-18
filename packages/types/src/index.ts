/**
 * Public integration contract for this IdP.
 *
 * Zero-dependency types plus small runtime shape guards for relying parties
 * and resource servers. The guards validate SHAPE ONLY — apply them AFTER
 * cryptographic verification (JWT signature via discovered JWKS, `iss`,
 * `aud`, `exp`), never instead of it. See INTEGRATION.md.
 */

/** Scopes this IdP serves (`packages/auth/src/index.ts` oauthProvider config). */
export const OAUTH_SCOPES = [
	"openid",
	"profile",
	"email",
	"offline_access",
] as const;

export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/**
 * Resource-server authorization modes (`OAUTH_ACCESS_TOKEN_MODE`).
 *
 * - `short-lived`: local JWT verification only; 10-minute token TTL.
 * - `hybrid`: local verification plus live revocation status on high-risk routes.
 * - `immediate`: live revocation status on every protected resource request.
 */
export const ACCESS_TOKEN_MODES = [
	"short-lived",
	"hybrid",
	"immediate",
] as const;

export type AccessTokenMode = (typeof ACCESS_TOKEN_MODES)[number];

export function isAccessTokenMode(value: unknown): value is AccessTokenMode {
	return (ACCESS_TOKEN_MODES as readonly unknown[]).includes(value);
}

/** Claims present on every JWT access token this IdP issues. */
interface AccessTokenClaimsBase {
	iss: string;
	/** OAuth client the token was issued to. */
	azp: string;
	/** Space-delimited granted scopes (wire format per RFC 8693 / RFC 9068). */
	scope: string;
	iat: number;
	exp: number;
	/**
	 * Unique token id, signed into every access token by this deployment for
	 * RFC 7009 revocation and denylist checks.
	 */
	jti: string;
	/** Resource audience; absent when no resource indicator was requested. */
	aud?: string | string[];
	/** Custom or future claims (RFC 9068 permits additional members). */
	[claim: string]: unknown;
}

/** Access token issued to a user via authorization_code / refresh_token. */
export interface UserAccessTokenClaims extends AccessTokenClaimsBase {
	/** Internal user id (public subject strategy). */
	sub: string;
	/**
	 * IdP session id. Present on session-issued tokens; MAY be absent on
	 * refresh-issued tokens. Hybrid/immediate revocation checks REQUIRE it —
	 * fail closed when missing (see {@link revocationIdentity}).
	 */
	sid?: string;
}

/** Machine-to-machine token from the client_credentials grant: no user. */
export interface MachineAccessTokenClaims extends AccessTokenClaimsBase {
	sub?: never;
	sid?: never;
}

export type AccessTokenClaims =
	| UserAccessTokenClaims
	| MachineAccessTokenClaims;

export function isUserAccessToken(
	claims: AccessTokenClaims,
): claims is UserAccessTokenClaims {
	return typeof claims.sub === "string";
}

/**
 * OIDC ID token claims. `name`/`picture`/`given_name`/`family_name` require
 * the `profile` scope; `email`/`email_verified` require the `email` scope.
 */
export interface IdTokenClaims {
	iss: string;
	/** Subject; the internal user id (public subject strategy). */
	sub: string;
	/** Always the requesting client_id (single audience). */
	aud: string;
	iat: number;
	exp: number;
	/** Authentication context class reference set by the provider. */
	acr?: string;
	/** Original authentication time; preserved across refresh rotation. */
	auth_time?: number;
	/** Echoed when the RP sent a nonce (always send one). */
	nonce?: string;
	/** IdP session id; present only for clients with end-session enabled. */
	sid?: string;
	name?: string;
	picture?: string;
	given_name?: string;
	family_name?: string;
	email?: string;
	email_verified?: boolean;
	[claim: string]: unknown;
}

/** UserInfo endpoint response; claims are scope-gated like the ID token. */
export interface UserInfoResponse {
	sub: string;
	name?: string;
	picture?: string;
	given_name?: string;
	family_name?: string;
	email?: string;
	email_verified?: boolean;
	[claim: string]: unknown;
}

/**
 * Request body for the private `POST /token-revocation-status` endpoint
 * (Bearer-authenticated with `OAUTH_REVOCATION_CHECK_SECRET`). Send `sid`+`sub`
 * from a verified user token, or `azp` from a verified machine token. `jti`
 * enables token-specific denylist enforcement and should always be sent.
 */
export type TokenRevocationStatusRequest =
	| { sid: string; sub: string; jti?: string }
	| { azp: string; jti?: string };

/** Response of `POST /token-revocation-status`. Fail closed unless `true`. */
export interface TokenRevocationStatusResponse {
	active: boolean;
}

/**
 * Shape of a first-party client definition consumed by the client seed script
 * (`apps/web/scripts/seed-clients.ts`). Brand deployments declare their apps
 * in `branding/clients.ts`.
 */
export interface ClientSeed {
	/** Stable human-readable name; the seed script's idempotency key. */
	name: string;
	/** Exact-match redirect URIs. No wildcards — ever. */
	redirectUris: string[];
	/** Exact-match post-logout redirect URIs for RP-initiated logout. */
	postLogoutRedirectUris?: string[];
	/** Client homepage, shown on consent screens. */
	uri?: string;
	/** Client icon URL, shown on consent screens. */
	icon?: string;
	/** Space-separated scopes this client may request. */
	scope?: string;
	/**
	 * `confidential` clients receive a client_secret (server-side apps);
	 * `public` clients don't (SPAs, mobile) — PKCE is enforced automatically.
	 */
	type: "confidential" | "public";
	/** First-party clients skip the consent screen. */
	skipConsent: boolean;
	/** Allow RP-initiated logout via the end-session endpoint. */
	enableEndSession: boolean;
}

// ---------------------------------------------------------------------------
// Runtime shape guards. Apply AFTER cryptographic verification.
// ---------------------------------------------------------------------------

function asClaimRecord(
	payload: unknown,
	token: string,
): Record<string, unknown> {
	if (
		typeof payload !== "object" ||
		payload === null ||
		Array.isArray(payload)
	) {
		throw new TypeError(`${token} payload must be a claims object`);
	}
	return payload as Record<string, unknown>;
}

function requireString(
	claims: Record<string, unknown>,
	claim: string,
	token: string,
): string {
	const value = claims[claim];
	if (typeof value !== "string" || value.length === 0) {
		throw new TypeError(`${token} claim "${claim}" must be a non-empty string`);
	}
	return value;
}

function requireNumber(
	claims: Record<string, unknown>,
	claim: string,
	token: string,
): number {
	const value = claims[claim];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new TypeError(`${token} claim "${claim}" must be a finite number`);
	}
	return value;
}

function optionalString(
	claims: Record<string, unknown>,
	claim: string,
	token: string,
): string | undefined {
	if (claims[claim] === undefined) return undefined;
	return requireString(claims, claim, token);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Validates the shape of a VERIFIED access-token payload and narrows it to
 * the user/machine union. Throws `TypeError` naming the offending claim.
 */
export function parseAccessTokenClaims(payload: unknown): AccessTokenClaims {
	const claims = asClaimRecord(payload, "Access token");
	requireString(claims, "iss", "Access token");
	requireString(claims, "azp", "Access token");
	requireString(claims, "scope", "Access token");
	requireString(claims, "jti", "Access token");
	requireNumber(claims, "iat", "Access token");
	requireNumber(claims, "exp", "Access token");
	const aud = claims.aud;
	if (aud !== undefined && typeof aud !== "string" && !isStringArray(aud)) {
		throw new TypeError(
			'Access token claim "aud" must be a string or string array',
		);
	}
	const sub = optionalString(claims, "sub", "Access token");
	const sid = optionalString(claims, "sid", "Access token");
	if (sub === undefined && sid !== undefined) {
		throw new TypeError('Access token carries "sid" without "sub"');
	}
	return claims as unknown as AccessTokenClaims;
}

/**
 * Validates the shape of a VERIFIED ID-token payload (openid-client or an
 * equivalent library must already have checked signature/iss/aud/exp/nonce).
 */
export function parseIdTokenClaims(payload: unknown): IdTokenClaims {
	const claims = asClaimRecord(payload, "ID token");
	requireString(claims, "iss", "ID token");
	requireString(claims, "sub", "ID token");
	requireString(claims, "aud", "ID token");
	requireNumber(claims, "iat", "ID token");
	requireNumber(claims, "exp", "ID token");
	return claims as unknown as IdTokenClaims;
}

/** Validates the shape of a UserInfo response body. */
export function parseUserInfo(payload: unknown): UserInfoResponse {
	const claims = asClaimRecord(payload, "UserInfo");
	requireString(claims, "sub", "UserInfo");
	return claims as unknown as UserInfoResponse;
}

/**
 * Derives the `token-revocation-status` request body from verified access
 * token claims. Fails closed: a user token without `sid` cannot be checked
 * against a live session and is rejected rather than silently skipped.
 */
export function revocationIdentity(
	claims: AccessTokenClaims,
): TokenRevocationStatusRequest {
	if (isUserAccessToken(claims)) {
		if (!claims.sid) {
			throw new Error(
				"User access token has no sid; refusing revocation-status check",
			);
		}
		return { sid: claims.sid, sub: claims.sub, jti: claims.jti };
	}
	return { azp: claims.azp, jti: claims.jti };
}
