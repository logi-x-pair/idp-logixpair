/**
 * Operator CLI for OAuth client management. Run from apps/web:
 *
 *   bun run clients list
 *   bun run clients rotate <client_id>   — rotate secret (old secret dies immediately)
 *   bun run clients disable <client_id>  — refuse all flows for this client
 *   bun run clients enable <client_id>
 *
 * Clients listed in OAUTH_TRUSTED_CLIENT_IDS are served from an in-memory
 * cache and locked against endpoint changes: rotation is rejected by the
 * plugin, and disable/enable only take effect after a process restart.
 * Procedure for trusted clients: remove the id from OAUTH_TRUSTED_CLIENT_IDS,
 * restart, mutate, re-add, restart (see RUNBOOK.md).
 */
import { auth } from "@krazil-idp/auth";
import { db } from "@krazil-idp/db";
import { oauthClient } from "@krazil-idp/db/schema/auth";
import { env } from "@krazil-idp/env/server";
import { APIError } from "better-auth";
import { eq } from "drizzle-orm";

import { adminHeaders } from "./admin-session";

const [command, clientId] = process.argv.slice(2);

function isTrustedCached(id: string): boolean {
	return (env.OAUTH_TRUSTED_CLIENT_IDS ?? "")
		.split(",")
		.map((v) => v.trim())
		.includes(id);
}

async function requireClient(id: string | undefined) {
	if (!id) {
		console.error(
			"Usage: bun run clients <list|rotate|disable|enable> [client_id]",
		);
		process.exit(1);
	}
	const rows = await db
		.select()
		.from(oauthClient)
		.where(eq(oauthClient.clientId, id));
	if (rows.length === 0) {
		console.error(`No client with client_id ${id}`);
		process.exit(1);
	}
	return rows[0];
}

switch (command) {
	case "list": {
		const rows = await db
			.select({
				clientId: oauthClient.clientId,
				name: oauthClient.name,
				disabled: oauthClient.disabled,
				redirectUris: oauthClient.redirectUris,
				public: oauthClient.public,
			})
			.from(oauthClient);
		for (const row of rows) {
			const flags = [
				row.public ? "public" : "confidential",
				row.disabled ? "DISABLED" : "active",
				isTrustedCached(row.clientId) ? "trusted-cached" : null,
			]
				.filter(Boolean)
				.join(", ");
			console.log(`${row.clientId}  ${row.name ?? "(unnamed)"}  [${flags}]`);
			console.log(`  redirect_uris: ${(row.redirectUris ?? []).join(", ")}`);
		}
		if (rows.length === 0) console.log("No clients registered.");
		break;
	}

	case "rotate": {
		const client = await requireClient(clientId);
		const headers = await adminHeaders();
		try {
			const rotated = await auth.api.rotateClientSecret({
				headers,
				body: { client_id: client.clientId },
			});
			console.log(`Rotated secret for ${client.clientId} ("${client.name}").`);
			console.log(`  new client_secret: ${rotated.client_secret}`);
			console.log(
				"  ⚠ Shown ONCE — update the consuming app now. The previous secret is already invalid.",
			);
		} catch (error) {
			if (
				error instanceof APIError &&
				error.body?.error_description?.includes("manually")
			) {
				console.error(
					`${client.clientId} is in OAUTH_TRUSTED_CLIENT_IDS and locked. Remove it from the set, restart the IdP, rotate, then re-add (RUNBOOK.md).`,
				);
				process.exit(1);
			}
			throw error;
		}
		break;
	}

	case "disable":
	case "enable": {
		const client = await requireClient(clientId);
		const disabled = command === "disable";
		await db
			.update(oauthClient)
			.set({ disabled, updatedAt: new Date() })
			.where(eq(oauthClient.clientId, client.clientId));
		console.log(
			`${disabled ? "Disabled" : "Enabled"} ${client.clientId} ("${client.name}").`,
		);
		if (isTrustedCached(client.clientId)) {
			console.warn(
				"  ⚠ This client is cached as trusted: the change takes effect only after an IdP restart. Also remove it from OAUTH_TRUSTED_CLIENT_IDS if disabling permanently.",
			);
		}
		break;
	}

	default:
		console.error(
			"Usage: bun run clients <list|rotate|disable|enable> [client_id]",
		);
		process.exit(1);
}
process.exit(0);
