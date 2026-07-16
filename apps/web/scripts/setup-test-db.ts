import "dotenv/config";
import path from "node:path";
import { Client } from "pg";

const TEST_DATABASE = "krazil_idp_test";
const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL;
const configuredTestUrl = process.env.TEST_DATABASE_URL;
if (!adminDatabaseUrl || !configuredTestUrl) {
	throw new Error(
		"TEST_DATABASE_ADMIN_URL and TEST_DATABASE_URL are required (see .env.example); no database fallback is allowed.",
	);
}
const adminUrl = new URL(adminDatabaseUrl);
const testUrl = new URL(configuredTestUrl);

if (
	testUrl.pathname.slice(1) !== TEST_DATABASE ||
	!TEST_DATABASE.endsWith("_test")
) {
	throw new Error(
		"Refusing destructive database setup: target is not the dedicated *_test database",
	);
}

const client = new Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
	// Disposable test-only database. Never point this script at dev/staging/prod.
	await client.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE}" WITH (FORCE)`);
	await client.query(`CREATE DATABASE "${TEST_DATABASE}"`);
} finally {
	await client.end();
}

const repoRoot = path.resolve(import.meta.dir, "../../..");
const push = Bun.spawn(["bunx", "drizzle-kit", "push", "--force"], {
	cwd: path.join(repoRoot, "packages/db"),
	env: { ...process.env, DATABASE_URL: testUrl.toString() },
	stdout: "inherit",
	stderr: "inherit",
});
const exitCode = await push.exited;
if (exitCode !== 0) process.exit(exitCode);
console.log(`Prepared isolated disposable database: ${TEST_DATABASE}`);
