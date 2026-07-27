import "dotenv/config";
import path from "node:path";
import { Client } from "pg";

import {
	formatDatabaseSummary,
	TEST_DATABASE_NAME,
	validateDatabaseEnvironment,
} from "../../../scripts/test-environment";

const validated = validateDatabaseEnvironment(process.env);
console.log(
	`Verified disposable database target: ${formatDatabaseSummary(validated)}`,
);

try {
	const client = new Client({
		connectionString: validated.adminUrl.toString(),
	});
	try {
		await client.connect();
		// This constant is validated before use; no external database name enters the statement.
		await client.query(
			`DROP DATABASE IF EXISTS "${TEST_DATABASE_NAME}" WITH (FORCE)`,
		);
		await client.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
	} finally {
		await client.end();
	}
} catch {
	console.error(
		`Disposable database setup failed for ${formatDatabaseSummary(validated)}; connection details were not logged.`,
	);
	process.exit(1);
}

const repoRoot = path.resolve(import.meta.dir, "../../..");
const push = Bun.spawn(["bunx", "drizzle-kit", "push", "--force"], {
	cwd: path.join(repoRoot, "packages/db"),
	env: { ...process.env, DATABASE_URL: validated.testUrl.toString() },
	stdout: "inherit",
	stderr: "inherit",
});
const exitCode = await push.exited;
if (exitCode !== 0) process.exit(exitCode);
console.log(`Prepared isolated disposable database: ${TEST_DATABASE_NAME}`);
