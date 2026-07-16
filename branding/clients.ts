import type { ClientSeed } from "@krazil-idp/auth/seed-types";

/**
 * First-party relying parties for THIS brand deployment.
 *
 * Edit this list when deploying for a new brand (see NEW_BRAND.md), then run
 * `bun run seed:clients` from apps/web. The template ships with two demo apps
 * that double as the end-to-end verification RPs.
 */
export const clientSeeds: ClientSeed[] = [
	{
		name: "Demo App One",
		redirectUris: ["http://localhost:4001/callback"],
		postLogoutRedirectUris: ["http://localhost:4001/"],
		uri: "http://localhost:4001",
		icon: "http://localhost:4001/icon.svg",
		scope: "openid profile email offline_access",
		type: "confidential",
		skipConsent: true,
		enableEndSession: true,
	},
	{
		name: "Demo App Two",
		redirectUris: ["http://localhost:4002/callback"],
		postLogoutRedirectUris: ["http://localhost:4002/"],
		uri: "http://localhost:4002",
		icon: "http://localhost:4002/icon.svg",
		scope: "openid profile email offline_access",
		type: "confidential",
		skipConsent: true,
		enableEndSession: true,
	},
	{
		// Demonstrates the consent screen: NOT a trusted client, so users are
		// asked to approve requested scopes on first authorization.
		name: "Consent Demo App",
		redirectUris: ["http://localhost:4003/callback"],
		uri: "http://localhost:4003",
		icon: "http://localhost:4003/icon.svg",
		scope: "openid profile email offline_access",
		type: "confidential",
		skipConsent: false,
		enableEndSession: false,
	},
];
