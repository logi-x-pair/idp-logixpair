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

interface Phase2MatrixResult {
	password: string;
	orgId: string;
	secondOrgId: string;
	orgAdminEmail: string;
	orgModEmail: string;
	orgMemberEmail: string;
	invitedEmail: string;
	invitationId: string;
	platformModEmail: string;
	platformHrEmail: string;
	banTargetEmail: string;
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

function phase2MatrixSeed(seedOutput: string): Phase2MatrixResult {
	let result: Phase2MatrixResult;
	try {
		result = JSON.parse(seedOutput) as Phase2MatrixResult;
	} catch {
		throw new Error("Phase 2 matrix seeding returned invalid JSON");
	}
	for (const key of [
		"password",
		"orgId",
		"secondOrgId",
		"orgAdminEmail",
		"orgModEmail",
		"orgMemberEmail",
		"invitedEmail",
		"invitationId",
		"platformModEmail",
		"platformHrEmail",
		"banTargetEmail",
	] as const) {
		if (!result[key]) {
			throw new Error("Phase 2 matrix seeding returned incomplete JSON");
		}
	}
	return result;
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
	const matrixSeedOutput = await runner(
		{
			label: "Disposable Phase 2 matrix seed",
			command: [
				process.execPath,
				"run",
				"scripts/seed-phase2-matrix.ts",
				"--json",
			],
			cwd: webDirectory,
			captureStdout: true,
		},
		childEnvironment,
	);
	const phase2 = phase2MatrixSeed(matrixSeedOutput);
	const playwrightEnvironment = {
		...childEnvironment,
		E2E_RP1_CLIENT_ID: rpOne.id,
		E2E_RP1_CLIENT_SECRET: rpOne.secret,
		E2E_RP2_CLIENT_ID: rpTwo.id,
		E2E_RP2_CLIENT_SECRET: rpTwo.secret,
		E2E_PHASE2_PASSWORD: phase2.password,
		E2E_PHASE2_ORG_ID: phase2.orgId,
		E2E_PHASE2_SECOND_ORG_ID: phase2.secondOrgId,
		E2E_PHASE2_ORG_ADMIN_EMAIL: phase2.orgAdminEmail,
		E2E_PHASE2_ORG_MOD_EMAIL: phase2.orgModEmail,
		E2E_PHASE2_ORG_MEMBER_EMAIL: phase2.orgMemberEmail,
		E2E_PHASE2_INVITED_EMAIL: phase2.invitedEmail,
		E2E_PHASE2_INVITATION_ID: phase2.invitationId,
		E2E_PHASE2_PLATFORM_MOD_EMAIL: phase2.platformModEmail,
		E2E_PHASE2_PLATFORM_HR_EMAIL: phase2.platformHrEmail,
		E2E_PHASE2_BAN_TARGET_EMAIL: phase2.banTargetEmail,
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
