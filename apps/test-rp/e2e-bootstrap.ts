import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

import {
	formatDatabaseSummary,
	validateE2EEnvironment,
	validatePlaywrightEnvironment,
} from "../../scripts/test-environment";

type Environment = Record<string, string | undefined>;

export interface HarnessCommand {
	label: string;
	command: string[];
	cwd: string;
	captureStdout?: boolean;
}

export type HarnessCommandRunner = (
	command: HarnessCommand,
	environment: Environment,
) => Promise<string>;

interface ClientSeedResult {
	name: string;
	clientId: string;
	clientSecret?: string;
	created: boolean;
}

const rpDirectory = import.meta.dir;
const webDirectory = resolve(rpDirectory, "../web");

function loadEnvironmentFile(path: string, environment: Environment): void {
	const result = loadDotenv({
		path,
		processEnv: environment,
		override: false,
		quiet: true,
	});
	const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
	if (result.error && errorCode !== "ENOENT") {
		throw new Error("Unable to load a local E2E environment file");
	}
}

export function loadE2EEnvironment(): Environment {
	const environment = { ...process.env };
	loadEnvironmentFile(resolve(webDirectory, ".env"), environment);
	loadEnvironmentFile(resolve(rpDirectory, ".env"), environment);
	return environment;
}

async function runCommand(
	specification: HarnessCommand,
	environment: Environment,
): Promise<string> {
	const child = Bun.spawn(specification.command, {
		cwd: specification.cwd,
		env: environment,
		stdin: "ignore",
		stdout: specification.captureStdout ? "pipe" : "inherit",
		stderr: "inherit",
	});
	const stdout = specification.captureStdout
		? await new Response(child.stdout).text()
		: "";
	const exitCode = await child.exited;
	if (exitCode !== 0) {
		throw new Error(`${specification.label} failed with exit code ${exitCode}`);
	}
	return stdout;
}

function ephemeralClientCredentials(
	seedOutput: string,
	clientName: string,
): { id: string; secret: string } {
	let results: ClientSeedResult[];
	try {
		results = JSON.parse(seedOutput) as ClientSeedResult[];
	} catch {
		throw new Error("OAuth client seeding returned invalid JSON");
	}
	const client = results.find((result) => result.name === clientName);
	if (!client?.created || !client.clientId || !client.clientSecret) {
		throw new Error(`Fresh disposable client ${clientName} was not created`);
	}
	return { id: client.clientId, secret: client.clientSecret };
}

export async function runE2E(
	environment: Environment,
	runner: HarnessCommandRunner = runCommand,
): Promise<void> {
	const validated = validateE2EEnvironment(environment);
	const childEnvironment = {
		...environment,
		TEST_DATABASE_ADMIN_URL: validated.database.adminUrl.toString(),
		TEST_DATABASE_URL: validated.database.testUrl.toString(),
		DATABASE_URL: validated.database.testUrl.toString(),
	};
	console.log(
		`E2E database safety verified: ${formatDatabaseSummary(validated.database)}`,
	);

	await runner(
		{
			label: "Disposable database setup",
			command: [process.execPath, "run", "scripts/setup-test-db.ts"],
			cwd: webDirectory,
		},
		childEnvironment,
	);
	await runner(
		{
			label: "Disposable admin seed",
			command: [process.execPath, "run", "seed:admin"],
			cwd: webDirectory,
			captureStdout: true,
		},
		childEnvironment,
	);
	const seedOutput = await runner(
		{
			label: "Disposable OAuth client seed",
			command: [process.execPath, "run", "scripts/seed-clients.ts", "--json"],
			cwd: webDirectory,
			captureStdout: true,
		},
		childEnvironment,
	);
	const rpOne = ephemeralClientCredentials(seedOutput, "Test RP One");
	const rpTwo = ephemeralClientCredentials(seedOutput, "Test RP Two");
	const playwrightEnvironment = {
		...childEnvironment,
		E2E_RP1_CLIENT_ID: rpOne.id,
		E2E_RP1_CLIENT_SECRET: rpOne.secret,
		E2E_RP2_CLIENT_ID: rpTwo.id,
		E2E_RP2_CLIENT_SECRET: rpTwo.secret,
	};
	validatePlaywrightEnvironment(playwrightEnvironment);
	await runner(
		{
			label: "Playwright E2E",
			command: [process.execPath, "x", "playwright", "test"],
			cwd: rpDirectory,
		},
		playwrightEnvironment,
	);
}

if (import.meta.main) {
	try {
		await runE2E(loadE2EEnvironment());
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "E2E bootstrap failed",
		);
		process.exit(1);
	}
}
