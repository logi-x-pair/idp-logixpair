import { describe, expect, test } from "bun:test";

import {
	formatDatabaseSummary,
	validateDatabaseEnvironment,
	validateE2EEnvironment,
	validateOidcIssuer,
	validatePlaywrightEnvironment,
} from "./test-environment";

const DATABASE_PASSWORD = "sentinel-db-password";

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
		TEST_DATABASE_ADMIN_URL: `postgresql://postgres:${DATABASE_PASSWORD}@localhost:5432/postgres`,
		TEST_DATABASE_URL: `postgresql://postgres:${DATABASE_PASSWORD}@localhost:5432/krazil_idp_test`,
		...overrides,
	};
}

describe("localhost issuer validation", () => {
	test.each([
		"http://localhost:3000/api/auth",
		"http://127.0.0.1:3000/api/auth",
		"http://[::1]:3000/api/auth",
	])("accepts the allowlisted loopback issuer %s", (issuer) => {
		expect(validateOidcIssuer(issuer).hostname).toBeTruthy();
	});

	test.each([
		"https://localhost:3000/api/auth",
		"http://db.internal:3000/api/auth",
		"http://10.0.0.4:3000/api/auth",
		"http://user:password@localhost:3000/api/auth",
		"http://localhost:3001/api/auth",
		"http://localhost:3000/",
		"http://localhost:3000/api/auth/",
		"http://localhost:3000/api/auth?redirect=http://evil.test",
		"not a URL",
	])("rejects unsafe issuer %s", (issuer) => {
		expect(() => validateOidcIssuer(issuer)).toThrow(
			"Test safety validation failed",
		);
	});
});

describe("disposable PostgreSQL validation", () => {
	test("accepts a matching loopback admin/test pair", () => {
		const validated = validateDatabaseEnvironment(validEnvironment());
		expect(validated.summary).toEqual({
			host: "localhost",
			port: "5432",
			adminDatabase: "postgres",
			testDatabase: "krazil_idp_test",
			loopback: true,
		});
	});

	test("normalizes IPv6 loopback and the PostgreSQL default port", () => {
		const validated = validateDatabaseEnvironment(
			validEnvironment({
				TEST_DATABASE_ADMIN_URL: `postgres://postgres:${DATABASE_PASSWORD}@[::1]/postgres`,
				TEST_DATABASE_URL: `postgres://postgres:${DATABASE_PASSWORD}@[::1]/krazil_idp_test`,
			}),
		);
		expect(validated.summary.host).toBe("::1");
		expect(validated.summary.port).toBe("5432");
	});

	test.each([
		{
			name: "remote admin host",
			overrides: {
				TEST_DATABASE_ADMIN_URL: `postgres://postgres:${DATABASE_PASSWORD}@db.internal:5432/postgres`,
			},
		},
		{
			name: "remote test host",
			overrides: {
				TEST_DATABASE_URL: `postgres://postgres:${DATABASE_PASSWORD}@db.internal:5432/krazil_idp_test`,
			},
		},
		{
			name: "private-network test host",
			overrides: {
				TEST_DATABASE_URL: `postgres://postgres:${DATABASE_PASSWORD}@192.168.1.20:5432/krazil_idp_test`,
			},
		},
		{
			name: "non-PostgreSQL URL",
			overrides: {
				TEST_DATABASE_URL: `mysql://postgres:${DATABASE_PASSWORD}@localhost:5432/krazil_idp_test`,
			},
		},
		{
			name: "wrong admin database",
			overrides: {
				TEST_DATABASE_ADMIN_URL: `postgres://postgres:${DATABASE_PASSWORD}@localhost:5432/development`,
			},
		},
		{
			name: "wrong test database",
			overrides: {
				TEST_DATABASE_URL: `postgres://postgres:${DATABASE_PASSWORD}@localhost:5432/krazil_idp_dev`,
			},
		},
		{
			name: "host mismatch",
			overrides: {
				TEST_DATABASE_URL: `postgres://postgres:${DATABASE_PASSWORD}@127.0.0.1:5432/krazil_idp_test`,
			},
		},
		{
			name: "port mismatch",
			overrides: {
				TEST_DATABASE_URL: `postgres://postgres:${DATABASE_PASSWORD}@localhost:5433/krazil_idp_test`,
			},
		},
		{
			name: "user mismatch",
			overrides: {
				TEST_DATABASE_URL: `postgres://another:${DATABASE_PASSWORD}@localhost:5432/krazil_idp_test`,
			},
		},
		{
			name: "connection query options",
			overrides: {
				TEST_DATABASE_URL: `postgres://postgres:${DATABASE_PASSWORD}@localhost:5432/krazil_idp_test?host=db.internal`,
			},
		},
		{
			name: "missing admin URL",
			overrides: { TEST_DATABASE_ADMIN_URL: undefined },
		},
		{
			name: "missing test URL",
			overrides: { TEST_DATABASE_URL: undefined },
		},
		{
			name: "malformed test URL",
			overrides: { TEST_DATABASE_URL: "not a database URL" },
		},
	])("rejects $name", ({ overrides }) => {
		expect(() =>
			validateDatabaseEnvironment(validEnvironment(overrides)),
		).toThrow("Test safety validation failed");
	});

	test("formats only sanitized database target evidence", () => {
		const summary = formatDatabaseSummary(
			validateDatabaseEnvironment(validEnvironment()),
		);
		expect(summary).toContain("host=localhost port=5432");
		expect(summary).toContain("test_database=krazil_idp_test loopback=true");
		expect(summary).not.toContain(DATABASE_PASSWORD);
		expect(summary).not.toContain("postgresql://");
		expect(summary).not.toContain("postgres@");
	});
});

describe("complete E2E environment validation", () => {
	test("accepts matching local IdP and disposable database settings", () => {
		expect(
			validateE2EEnvironment(validEnvironment()).database.summary.loopback,
		).toBe(true);
	});

	test.each([
		{ OIDC_ISSUER: undefined },
		{ OIDC_ISSUER: "http://remote.example:3000/api/auth" },
		{ BETTER_AUTH_URL: "http://127.0.0.1:3000/" },
		{ CORS_ORIGIN: "http://127.0.0.1:3000/" },
		{ IDP_ADMIN_EMAIL: "missing-from-allowlist@example.test" },
		{ TEST_RP_USER_PASSWORD: "too-short" },
	])("rejects invalid startup environment %#", (overrides) => {
		expect(() => validateE2EEnvironment(validEnvironment(overrides))).toThrow(
			"Test safety validation failed",
		);
	});

	test("requires ephemeral RP credentials before Playwright loads", () => {
		expect(() => validatePlaywrightEnvironment(validEnvironment())).toThrow(
			"E2E_RP1_CLIENT_ID is required",
		);
		expect(
			validatePlaywrightEnvironment(
				validEnvironment({
					E2E_RP1_CLIENT_ID: "rp-one",
					E2E_RP1_CLIENT_SECRET: "rp-one-secret",
					E2E_RP2_CLIENT_ID: "rp-two",
					E2E_RP2_CLIENT_SECRET: "rp-two-secret",
				}),
			).issuer.pathname,
		).toBe("/api/auth");
	});

	test("never includes raw URL or credential material in validation errors", () => {
		const unsafeUrl = `postgres://postgres:${DATABASE_PASSWORD}@db.internal:5432/krazil_idp_test`;
		try {
			validateDatabaseEnvironment(
				validEnvironment({ TEST_DATABASE_URL: unsafeUrl }),
			);
			throw new Error("expected validation to fail");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			expect(message).not.toContain(unsafeUrl);
			expect(message).not.toContain(DATABASE_PASSWORD);
			expect(message).not.toContain("db.internal");
		}
	});
});
