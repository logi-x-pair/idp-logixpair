/**
 * Seeds one test user for local development. Idempotent: re-running is a no-op
 * when the user already exists.
 *
 * Run from apps/web (so .env is picked up):  bun run seed:user
 */
import { auth } from "@krazil-idp/auth";
import { APIError } from "better-auth";

export const TEST_USER = {
	name: "Test User",
	email: "test.user@example.com",
	password: "test-password-123",
} as const;

async function main() {
	try {
		await auth.api.signUpEmail({
			body: {
				name: TEST_USER.name,
				email: TEST_USER.email,
				password: TEST_USER.password,
			},
		});
		console.log(
			`Created test user ${TEST_USER.email} (password: ${TEST_USER.password})`,
		);
	} catch (error) {
		if (
			error instanceof APIError &&
			error.body?.code?.startsWith("USER_ALREADY_EXISTS")
		) {
			console.log(
				`Test user ${TEST_USER.email} already exists — nothing to do.`,
			);
			return;
		}
		throw error;
	}
}

await main();
process.exit(0);
