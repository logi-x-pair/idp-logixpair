import path from "node:path";

import {
	formatDatabaseSummary,
	validateDatabaseEnvironment,
} from "../../../scripts/test-environment";
const requestedTargets = process.argv.slice(2).filter((argument) => argument !== "--");
if (requestedTargets.length > 1) {
	throw new Error("Web test runner accepts at most one focused test file");
}
const testTarget = requestedTargets[0]?.replaceAll("\\", "/") ?? "tests/";
if (
	testTarget !== "tests/" &&
	!/^tests\/[a-z0-9][a-z0-9.-]*\.test\.ts$/i.test(testTarget)
) {
	throw new Error("Focused web tests must be a direct tests/*.test.ts file");
}

const validated = validateDatabaseEnvironment(process.env);
console.log(
	`Protocol test database safety verified: ${formatDatabaseSummary(validated)}`,
);

const env = {
	...process.env,
	TEST_DATABASE_ADMIN_URL: validated.adminUrl.toString(),
	TEST_DATABASE_URL: validated.testUrl.toString(),
	DATABASE_URL: validated.testUrl.toString(),
};
const webDirectory = path.resolve(import.meta.dir, "..");

const setup = Bun.spawn([process.execPath, "run", "scripts/setup-test-db.ts"], {
	cwd: webDirectory,
	env,
	stdout: "inherit",
	stderr: "inherit",
});
if ((await setup.exited) !== 0) process.exit(1);

const tests = Bun.spawn([process.execPath, "test", testTarget], {
	cwd: webDirectory,
	env,
	stdout: "inherit",
	stderr: "inherit",
});
process.exit(await tests.exited);
