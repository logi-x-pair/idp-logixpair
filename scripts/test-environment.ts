export const TEST_DATABASE_NAME = "krazil_idp_test";
export const TEST_ADMIN_DATABASE_NAME = "postgres";

export const E2E_SERVER_URLS = {
	idpHealth: "http://localhost:3000/api/health",
	rpOne: "http://localhost:4101/",
	rpTwo: "http://localhost:4102/",
} as const;

const LOOPBACK_HOSTS: Readonly<Record<string, true>> = {
	localhost: true,
	"127.0.0.1": true,
	"::1": true,
};

type Environment = Readonly<Record<string, string | undefined>>;

export interface ValidatedDatabaseEnvironment {
	adminUrl: URL;
	testUrl: URL;
	summary: {
		host: string;
		port: string;
		adminDatabase: typeof TEST_ADMIN_DATABASE_NAME;
		testDatabase: typeof TEST_DATABASE_NAME;
		loopback: true;
	};
}

export interface ValidatedE2EEnvironment {
	issuer: URL;
	database: ValidatedDatabaseEnvironment;
}

function fail(reason: string): never {
	throw new Error(`Test safety validation failed: ${reason}`);
}

function required(environment: Environment, key: string): string {
	const value = environment[key]?.trim();
	if (!value) fail(`${key} is required`);
	return value;
}

function parseUrl(value: string, label: string): URL {
	try {
		return new URL(value);
	} catch {
		return fail(`${label} must be a valid URL`);
	}
}

function normalizedHostname(url: URL): string {
	return url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function assertLoopback(url: URL, label: string): void {
	const hostname = normalizedHostname(url);
	if (!LOOPBACK_HOSTS[hostname]) {
		fail(`${label} must use an allowlisted loopback host`);
	}
}

function assertNoUrlOptions(url: URL, label: string): void {
	if (url.search || url.hash) {
		fail(`${label} must not contain query options or a fragment`);
	}
}

function effectivePort(url: URL, fallback: string): string {
	return url.port || fallback;
}

function databaseUsername(url: URL, label: string): string {
	if (!url.username) fail(`${label} must include a database username`);
	try {
		return decodeURIComponent(url.username);
	} catch {
		return fail(`${label} contains an invalid database username`);
	}
}

function validatePostgresUrl(
	value: string,
	label: string,
	databaseName: string,
): URL {
	const url = parseUrl(value, label);
	if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
		fail(`${label} must use PostgreSQL`);
	}
	assertLoopback(url, label);
	assertNoUrlOptions(url, label);
	if (url.pathname !== `/${databaseName}`) {
		fail(`${label} must target the dedicated ${databaseName} database`);
	}
	databaseUsername(url, label);
	return url;
}

export function validateOidcIssuer(value: string): URL {
	const issuer = parseUrl(value, "OIDC_ISSUER");
	if (issuer.protocol !== "http:") {
		fail("OIDC_ISSUER must use HTTP for the localhost harness");
	}
	assertLoopback(issuer, "OIDC_ISSUER");
	assertNoUrlOptions(issuer, "OIDC_ISSUER");
	if (issuer.username || issuer.password) {
		fail("OIDC_ISSUER must not contain URL credentials");
	}
	if (effectivePort(issuer, "80") !== "3000") {
		fail("OIDC_ISSUER must use the localhost IdP port 3000");
	}
	if (issuer.pathname !== "/api/auth") {
		fail("OIDC_ISSUER must use the exact /api/auth path");
	}
	return issuer;
}

function validateLocalServerUrl(
	value: string,
	label: string,
	port: string,
	pathname: string,
): URL {
	const url = parseUrl(value, label);
	if (url.protocol !== "http:") {
		fail(`${label} must use HTTP for the localhost harness`);
	}
	assertLoopback(url, label);
	assertNoUrlOptions(url, label);
	if (url.username || url.password)
		fail(`${label} must not contain credentials`);
	if (effectivePort(url, "80") !== port || url.pathname !== pathname) {
		fail(`${label} does not match its fixed localhost endpoint`);
	}
	return url;
}

export function validateE2EServerUrls(): void {
	validateLocalServerUrl(
		E2E_SERVER_URLS.idpHealth,
		"IdP health URL",
		"3000",
		"/api/health",
	);
	validateLocalServerUrl(E2E_SERVER_URLS.rpOne, "RP One URL", "4101", "/");
	validateLocalServerUrl(E2E_SERVER_URLS.rpTwo, "RP Two URL", "4102", "/");
}

export function validateDatabaseEnvironment(
	environment: Environment,
): ValidatedDatabaseEnvironment {
	const adminUrl = validatePostgresUrl(
		required(environment, "TEST_DATABASE_ADMIN_URL"),
		"TEST_DATABASE_ADMIN_URL",
		TEST_ADMIN_DATABASE_NAME,
	);
	const testUrl = validatePostgresUrl(
		required(environment, "TEST_DATABASE_URL"),
		"TEST_DATABASE_URL",
		TEST_DATABASE_NAME,
	);
	if (normalizedHostname(adminUrl) !== normalizedHostname(testUrl)) {
		fail("database admin and test hosts must match");
	}
	if (effectivePort(adminUrl, "5432") !== effectivePort(testUrl, "5432")) {
		fail("database admin and test ports must match");
	}
	if (
		databaseUsername(adminUrl, "TEST_DATABASE_ADMIN_URL") !==
		databaseUsername(testUrl, "TEST_DATABASE_URL")
	) {
		fail("database admin and test users must match");
	}
	return {
		adminUrl,
		testUrl,
		summary: {
			host: normalizedHostname(testUrl),
			port: effectivePort(testUrl, "5432"),
			adminDatabase: TEST_ADMIN_DATABASE_NAME,
			testDatabase: TEST_DATABASE_NAME,
			loopback: true,
		},
	};
}

function validateHarnessCredentials(environment: Environment): void {
	const adminEmail = required(environment, "IDP_ADMIN_EMAIL").toLowerCase();
	if (required(environment, "IDP_ADMIN_PASSWORD").length < 12) {
		fail("IDP_ADMIN_PASSWORD must be at least 12 characters");
	}
	if (required(environment, "TEST_RP_USER_PASSWORD").length < 12) {
		fail("TEST_RP_USER_PASSWORD must be at least 12 characters");
	}
	required(environment, "TEST_RP_USER_EMAIL");
	if (required(environment, "BETTER_AUTH_SECRET").length < 32) {
		fail("BETTER_AUTH_SECRET must be at least 32 characters");
	}
	const oauthAdmins = required(environment, "OAUTH_ADMIN_EMAILS")
		.split(",")
		.map((email) => email.trim().toLowerCase());
	if (!oauthAdmins.includes(adminEmail)) {
		fail("IDP_ADMIN_EMAIL must be listed in OAUTH_ADMIN_EMAILS");
	}
}

/**
 * Fail-closed guard for scripts that provision fixture accounts with known
 * passwords: refuses to run unless the DATABASE_URL actually consumed by
 * @krazil-idp/db targets the dedicated loopback disposable database.
 */
export function assertDisposableDatabaseTarget(environment: Environment): URL {
	return validatePostgresUrl(
		required(environment, "DATABASE_URL"),
		"DATABASE_URL",
		TEST_DATABASE_NAME,
	);
}

export function validateE2EEnvironment(
	environment: Environment,
): ValidatedE2EEnvironment {
	validateE2EServerUrls();
	const issuer = validateOidcIssuer(required(environment, "OIDC_ISSUER"));
	const betterAuthUrl = validateLocalServerUrl(
		required(environment, "BETTER_AUTH_URL"),
		"BETTER_AUTH_URL",
		"3000",
		"/",
	);
	const corsOrigin = validateLocalServerUrl(
		required(environment, "CORS_ORIGIN"),
		"CORS_ORIGIN",
		"3000",
		"/",
	);
	if (
		issuer.origin !== betterAuthUrl.origin ||
		corsOrigin.origin !== betterAuthUrl.origin
	) {
		fail("OIDC_ISSUER, BETTER_AUTH_URL, and CORS_ORIGIN origins must match");
	}
	validateHarnessCredentials(environment);
	return { issuer, database: validateDatabaseEnvironment(environment) };
}

export function validatePlaywrightEnvironment(
	environment: Environment,
): ValidatedE2EEnvironment {
	const validated = validateE2EEnvironment(environment);
	for (const key of [
		"E2E_RP1_CLIENT_ID",
		"E2E_RP1_CLIENT_SECRET",
		"E2E_RP2_CLIENT_ID",
		"E2E_RP2_CLIENT_SECRET",
	]) {
		required(environment, key);
	}
	return validated;
}

export function formatDatabaseSummary(
	validated: ValidatedDatabaseEnvironment,
): string {
	const { host, port, adminDatabase, testDatabase, loopback } =
		validated.summary;
	return `host=${host} port=${port} admin_database=${adminDatabase} test_database=${testDatabase} loopback=${loopback}`;
}
