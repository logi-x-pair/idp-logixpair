import { describe, expect, test } from "bun:test";

import {
	type HarnessCommand,
	type HarnessCommandRunner,
	runE2E,
} from "./e2e-bootstrap";

const TEST_PASSWORD = "test-only-password";

function validEnvironment(
	overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
	return {
		OIDC_ISSUER: "http://localhost:3000/api/auth",
		BETTER_AUTH_URL: "http://localhost:3000/",
		CORS_ORIGIN: "http://localhost:3000/",
		BETTER_AUTH_SECRET: "test-only-better-auth-secret-0123456789",
		IDP_ADMIN_EMAIL: "admin@example.test",
		IDP_ADMIN_PASSWORD: "test-admin-password",
		OAUTH_ADMIN_EMAILS: "admin@example.test",
		TEST_RP_USER_EMAIL: "user@example.test",
		TEST_RP_USER_PASSWORD: "test-user-password",
		TEST_DATABASE_ADMIN_URL: `postgres://postgres:${TEST_PASSWORD}@localhost:5432/postgres`,
		TEST_DATABASE_URL: `postgres://postgres:${TEST_PASSWORD}@localhost:5432/krazil_idp_test`,
		...overrides,
	};
}

const SEEDED_CLIENTS = JSON.stringify([
	{
		name: "Test RP One",
		clientId: "rp-one-id",
		clientSecret: "rp-one-secret",
		created: true,
	},
	{
		name: "Test RP Two",
		clientId: "rp-two-id",
		clientSecret: "rp-two-secret",
		created: true,
	},
]);

describe("guarded E2E bootstrap", () => {
	test.each([
		{
			name: "remote issuer",
			overrides: { OIDC_ISSUER: "http://issuer.example:3000/api/auth" },
		},
		{
			name: "remote admin database",
			overrides: {
				TEST_DATABASE_ADMIN_URL: `postgres://postgres:${TEST_PASSWORD}@db.example:5432/postgres`,
			},
		},
		{
			name: "remote test database",
			overrides: {
				TEST_DATABASE_URL: `postgres://postgres:${TEST_PASSWORD}@db.example:5432/krazil_idp_test`,
			},
		},
		{
			name: "host mismatch",
			overrides: {
				TEST_DATABASE_URL: `postgres://postgres:${TEST_PASSWORD}@127.0.0.1:5432/krazil_idp_test`,
			},
		},
		{
			name: "port mismatch",
			overrides: {
				TEST_DATABASE_URL: `postgres://postgres:${TEST_PASSWORD}@localhost:5433/krazil_idp_test`,
			},
		},
		{
			name: "user mismatch",
			overrides: {
				TEST_DATABASE_URL: `postgres://different:${TEST_PASSWORD}@localhost:5432/krazil_idp_test`,
			},
		},
		{
			name: "wrong database name",
			overrides: {
				TEST_DATABASE_URL: `postgres://postgres:${TEST_PASSWORD}@localhost:5432/development`,
			},
		},
		{
			name: "missing URL",
			overrides: { TEST_DATABASE_URL: undefined },
		},
		{
			name: "malformed URL",
			overrides: { TEST_DATABASE_URL: "not-a-url" },
		},
	])("starts no child process for $name", async ({ overrides }) => {
		let childStarts = 0;
		const runner: HarnessCommandRunner = async () => {
			childStarts += 1;
			return "";
		};
		await expect(runE2E(validEnvironment(overrides), runner)).rejects.toThrow(
			"Test safety validation failed",
		);
		expect(childStarts).toBe(0);
	});

	test("sets up, seeds, then starts Playwright with only the test database", async () => {
		const commands: HarnessCommand[] = [];
		const environments: Record<string, string | undefined>[] = [];
		const runner: HarnessCommandRunner = async (command, environment) => {
			commands.push(command);
			environments.push(environment);
			return command.label === "Disposable OAuth client seed"
				? SEEDED_CLIENTS
				: "";
		};

		await runE2E(validEnvironment(), runner);

		expect(commands.map((command) => command.label)).toEqual([
			"Disposable database setup",
			"Disposable admin seed",
			"Disposable OAuth client seed",
			"Playwright E2E",
		]);
		for (const environment of environments) {
			if (!environment.DATABASE_URL)
				throw new Error("DATABASE_URL was not passed to child");
			expect(new URL(environment.DATABASE_URL).pathname).toBe(
				"/krazil_idp_test",
			);
		}
		const firstEnvironment = environments[0];
		const playwrightEnvironment = environments[3];
		const adminSeedCommand = commands[1];
		const clientSeedCommand = commands[2];
		if (
			!firstEnvironment ||
			!playwrightEnvironment ||
			!adminSeedCommand ||
			!clientSeedCommand
		) {
			throw new Error("E2E bootstrap did not run the expected child commands");
		}
		expect(firstEnvironment.E2E_RP1_CLIENT_SECRET).toBeUndefined();
		expect(playwrightEnvironment.E2E_RP1_CLIENT_ID).toBe("rp-one-id");
		expect(playwrightEnvironment.E2E_RP1_CLIENT_SECRET).toBe("rp-one-secret");
		expect(playwrightEnvironment.E2E_RP2_CLIENT_ID).toBe("rp-two-id");
		expect(playwrightEnvironment.E2E_RP2_CLIENT_SECRET).toBe("rp-two-secret");
		expect(adminSeedCommand.captureStdout).toBe(true);
		expect(clientSeedCommand.captureStdout).toBe(true);
	});

	test("rejects unframed warnings instead of guessing at embedded JSON", async () => {
		const commands: string[] = [];
		const runner: HarnessCommandRunner = async (command) => {
			commands.push(command.label);
			return command.label === "Disposable OAuth client seed"
				? `[env] warning\n${SEEDED_CLIENTS}`
				: "";
		};

		await expect(runE2E(validEnvironment(), runner)).rejects.toThrow(
			"OAuth client seeding returned invalid JSON",
		);
		expect(commands).not.toContain("Playwright E2E");
	});

	test("does not start Playwright when fresh client credentials are unavailable", async () => {
		const commands: string[] = [];
		const runner: HarnessCommandRunner = async (command) => {
			commands.push(command.label);
			return command.label === "Disposable OAuth client seed" ? "[]" : "";
		};

		await expect(runE2E(validEnvironment(), runner)).rejects.toThrow(
			"Fresh disposable client Test RP One was not created",
		);
		expect(commands).toEqual([
			"Disposable database setup",
			"Disposable admin seed",
			"Disposable OAuth client seed",
		]);
	});
});
