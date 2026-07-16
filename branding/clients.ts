/**
 * Shape of a first-party client definition for this deployment. This type is
 * local so the branding package remains dependency-free and can be merged
 * independently of the auth implementation.
 */
export interface ClientSeed {
	name: string;
	redirectUris: string[];
	postLogoutRedirectUris?: string[];
	uri?: string;
	icon?: string;
	scope?: string;
	type: "confidential" | "public";
	skipConsent: boolean;
	enableEndSession: boolean;
}

/**
 * First-party relying parties for THIS brand deployment.
 *
 * Edit this list when deploying for a new brand (see NEW_BRAND.md), then run
 * `bun run seed:clients` from apps/web. The template ships with two demo apps
 * and one consent demo.
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
		// Demonstrates the consent screen: NOT a trusted client.
		name: "Consent Demo App",
		redirectUris: ["http://localhost:4003/callback"],
		uri: "http://localhost:4003",
		icon: "http://localhost:4003/icon.svg",
		scope: "openid profile email offline_access",
		type: "confidential",
		skipConsent: false,
		enableEndSession: false,
	},
	{
		name: "Test RP One",
		redirectUris: ["http://localhost:4101/callback"],
		postLogoutRedirectUris: ["http://localhost:4101/"],
		uri: "http://localhost:4101",
		icon: "http://localhost:4101/icon.svg",
		scope: "openid profile email offline_access",
		type: "confidential",
		skipConsent: true,
		enableEndSession: true,
	},
	{
		name: "Test RP Two",
		redirectUris: ["http://localhost:4102/callback"],
		postLogoutRedirectUris: ["http://localhost:4102/"],
		uri: "http://localhost:4102",
		icon: "http://localhost:4102/icon.svg",
		scope: "openid profile email offline_access",
		type: "confidential",
		skipConsent: true,
		enableEndSession: true,
	},
];
