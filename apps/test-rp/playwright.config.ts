import "dotenv/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

function requiredEnv(key: string): string {
	const value = process.env[key];
	if (!value) throw new Error(`${key} is required in apps/test-rp/.env`);
	return value;
}

const rpDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(rpDirectory, "../web");
const issuer = requiredEnv("OIDC_ISSUER");
const rp1ClientId = requiredEnv("E2E_RP1_CLIENT_ID");
const rp1ClientSecret = requiredEnv("E2E_RP1_CLIENT_SECRET");
const rp2ClientId = requiredEnv("E2E_RP2_CLIENT_ID");
const rp2ClientSecret = requiredEnv("E2E_RP2_CLIENT_SECRET");

export default defineConfig({
	testDir: "./tests",
	globalSetup: "./global-setup.ts",
	workers: 1,
	retries: 0,
	timeout: 45_000,
	use: {
		// E2E MUST remain localhost-only. Never point this at staging/production.
		baseURL: "http://localhost:4101",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: [
		{
			command: "bun run dev",
			cwd: webDirectory,
			url: "http://localhost:3000/api/health",
			reuseExistingServer: false,
			timeout: 120_000,
		},
		{
			command: "bun run server.ts",
			cwd: rpDirectory,
			url: "http://localhost:4101/",
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
			url: "http://localhost:4102/",
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
