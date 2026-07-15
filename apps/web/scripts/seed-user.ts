/**
 * Seeds one test user for local development. Idempotent: re-running is a no-op
 * when the user already exists.
 *
 * Credentials come from the environment (see .env.example):
 *   SEED_USER_NAME, SEED_USER_EMAIL, SEED_USER_PASSWORD
 *
 * Run from apps/web (so .env is picked up):  bun run seed:user
 */
import { auth } from "@krazil-idp/auth";
import { APIError } from "better-auth";

const name = process.env.SEED_USER_NAME ?? "Test User";
const email = process.env.SEED_USER_EMAIL;
const password = process.env.SEED_USER_PASSWORD;

if (!email || !password) {
	console.error(
		"seed:user requires SEED_USER_EMAIL and SEED_USER_PASSWORD in the environment (see .env.example).",
	);
	process.exit(1);
}

try {
	await auth.api.signUpEmail({
		body: { name, email, password },
	});
	console.log(`Created test user ${email}`);
} catch (error) {
	if (
		error instanceof APIError &&
		error.body?.code?.startsWith("USER_ALREADY_EXISTS")
	) {
		console.log(`Test user ${email} already exists — nothing to do.`);
	} else {
		throw error;
	}
}
process.exit(0);
