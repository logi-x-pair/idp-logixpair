/**
 * Shape of a first-party client definition consumed by the client seed script
 * (`apps/web/scripts/seed-clients.ts`). Brand deployments declare their apps
 * in `branding/clients.ts`.
 *
 * Type-only module: safe to import from brand data files.
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
