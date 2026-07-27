import "dotenv/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

import {
	E2E_SERVER_URLS,
	validatePlaywrightEnvironment,
} from "../../scripts/test-environment";

const validated = validatePlaywrightEnvironment(process.env);
const rpDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(rpDirectory, "../web");
const issuer = validated.issuer.toString();
const rp1ClientId = process.env.E2E_RP1_CLIENT_ID as string;
const rp1ClientSecret = process.env.E2E_RP1_CLIENT_SECRET as string;
const rp2ClientId = process.env.E2E_RP2_CLIENT_ID as string;
const rp2ClientSecret = process.env.E2E_RP2_CLIENT_SECRET as string;
const databaseEnvironment = {
	TEST_DATABASE_ADMIN_URL: validated.database.adminUrl.toString(),
	TEST_DATABASE_URL: validated.database.testUrl.toString(),
	DATABASE_URL: validated.database.testUrl.toString(),
};

export default defineConfig({
	testDir: "./tests",
	globalSetup: "./global-setup.ts",
	workers: 1,
	retries: 0,
	timeout: 45_000,
	use: {
		// E2E MUST remain localhost-only. Never point this at staging/production.
		baseURL: E2E_SERVER_URLS.rpOne,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: [
		{
			command: "bun run dev",
			cwd: webDirectory,
			url: E2E_SERVER_URLS.idpHealth,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				...process.env,
				...databaseEnvironment,
			},
		},
		{
			command: "bun run server.ts",
			cwd: rpDirectory,
			url: E2E_SERVER_URLS.rpOne,
			reuseExistingServer: false,
			timeout: 60_000,
			env: {
				...process.env,
				RP_PORT: "4101",
				RP_NAME: "Test RP One",
				RP_CLIENT_ID: rp1ClientId,
				RP_CLIENT_SECRET: rp1ClientSecret,
				RP_REDIRECT_URI: "http://localhost:4101/callback",
				RP_POST_LOGOUT_URI: "http://localhost:4101/",
				OIDC_ISSUER: issuer,
				RP_PEER_LOGOUT_URL: "http://localhost:4102/logout-local",
			},
		},
		{
			command: "bun run server.ts",
			cwd: rpDirectory,
			url: E2E_SERVER_URLS.rpTwo,
			reuseExistingServer: false,
			timeout: 60_000,
			env: {
				...process.env,
				RP_PORT: "4102",
				RP_NAME: "Test RP Two",
				RP_CLIENT_ID: rp2ClientId,
				RP_CLIENT_SECRET: rp2ClientSecret,
				RP_REDIRECT_URI: "http://localhost:4102/callback",
				RP_POST_LOGOUT_URI: "http://localhost:4102/",
				OIDC_ISSUER: issuer,
				RP_PEER_LOGOUT_URL: "",
			},
		},
	],
});
