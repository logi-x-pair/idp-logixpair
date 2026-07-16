const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const testUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !testUrl) {
	throw new Error(
		"TEST_DATABASE_ADMIN_URL and TEST_DATABASE_URL are required (see .env.example); refusing to run database tests without an isolated target.",
	);
}

const env = {
	...process.env,
	TEST_DATABASE_ADMIN_URL: adminUrl,
	TEST_DATABASE_URL: testUrl,
	DATABASE_URL: testUrl,
};

const setup = Bun.spawn([process.execPath, "run", "scripts/setup-test-db.ts"], {
	cwd: import.meta.dir.replace(/\/scripts\/?$/, ""),
	env,
	stdout: "inherit",
	stderr: "inherit",
});
if ((await setup.exited) !== 0) process.exit(1);

const tests = Bun.spawn([process.execPath, "test", "tests/"], {
	cwd: import.meta.dir.replace(/\/scripts\/?$/, ""),
	env,
	stdout: "inherit",
	stderr: "inherit",
});
process.exit(await tests.exited);
