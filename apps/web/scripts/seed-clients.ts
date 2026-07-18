/**
 * Registers this brand's first-party OAuth clients (declared in
 * branding/clients.ts). Idempotent: clients are matched by name and never
 * duplicated on re-run.
 *
 * Each client_secret is printed ONCE at creation — store it in the consuming
 * app's secret manager immediately; the database only keeps a hash.
 *
 * Run from apps/web:  bun run seed:clients [--json]
 */
import { auth } from "@krazil-idp/auth";
import { clientSeeds } from "@krazil-idp/branding/clients";
import { db } from "@krazil-idp/db";
import { oauthClient } from "@krazil-idp/db/schema/auth";
import type { ClientSeed } from "@krazil-idp/types";
import { eq } from "drizzle-orm";

import { adminHeaders } from "./admin-session";

interface SeedResult {
	name: string;
	clientId: string;
	clientSecret?: string;
	created: boolean;
}

async function seedClient(
	headers: Headers,
	seed: ClientSeed,
): Promise<SeedResult> {
	const existing = await db
		.select({ clientId: oauthClient.clientId })
		.from(oauthClient)
		.where(eq(oauthClient.name, seed.name));
	if (existing.length > 0) {
		return { name: seed.name, clientId: existing[0].clientId, created: false };
	}

	const created = await auth.api.adminCreateOAuthClient({
		headers,
		body: {
			client_name: seed.name,
			redirect_uris: seed.redirectUris,
			...(seed.postLogoutRedirectUris
				? { post_logout_redirect_uris: seed.postLogoutRedirectUris }
				: {}),
			...(seed.uri ? { client_uri: seed.uri } : {}),
			...(seed.icon ? { logo_uri: seed.icon } : {}),
			...(seed.scope ? { scope: seed.scope } : {}),
			token_endpoint_auth_method:
				seed.type === "public" ? "none" : "client_secret_basic",
			grant_types: ["authorization_code", "refresh_token"],
			skip_consent: seed.skipConsent,
			enable_end_session: seed.enableEndSession,
		},
	});
	return {
		name: seed.name,
		clientId: created.client_id,
		clientSecret: created.client_secret ?? undefined,
		created: true,
	};
}

const asJson = process.argv.includes("--json");
const headers = await adminHeaders();
const results: SeedResult[] = [];
for (const seed of clientSeeds) {
	results.push(await seedClient(headers, seed));
}

if (asJson) {
	console.log(JSON.stringify(results, null, 2));
} else {
	for (const r of results) {
		if (r.created) {
			console.log(`\nCreated "${r.name}"`);
			console.log(`  client_id:     ${r.clientId}`);
			console.log(
				`  client_secret: ${r.clientSecret ?? "(public client — none)"}`,
			);
			console.log(
				"  ⚠ The client_secret is shown ONCE. Store it securely now; only a hash is kept.",
			);
		} else {
			console.log(
				`\n"${r.name}" already registered (client_id: ${r.clientId}) — skipped.`,
			);
		}
	}
	const ids = results.map((r) => r.clientId).join(",");
	console.log(
		`\nTo cache + lock these as trusted clients, set in .env:\n  OAUTH_TRUSTED_CLIENT_IDS=${ids}\nand restart the IdP.`,
	);
}
process.exit(0);
