/**
 * Provisions the operator admin account (deliberate, explicit step — nothing
 * else auto-creates operators). Idempotent.
 *
 *   bun run seed:admin
 *
 * Reads IDP_ADMIN_EMAIL / IDP_ADMIN_PASSWORD from the environment.
 *
 * Security model: the `role` field cannot be set through public sign-up
 * (`input: false`). This script promotes to role=admin ONLY after proving
 * ownership of the account by signing in with the configured password. If the
 * email is already registered with a different password (squatting), it
 * aborts loudly and promotes nothing.
 */
import { auth } from "@krazil-idp/auth";
import { env } from "@krazil-idp/env/server";
import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth";

const email = env.IDP_ADMIN_EMAIL;
const password = env.IDP_ADMIN_PASSWORD;
if (!email || !password) {
	console.error(
		"seed:admin requires IDP_ADMIN_EMAIL and IDP_ADMIN_PASSWORD (see .env.example).",
	);
	process.exit(1);
}

try {
	await auth.api.signUpEmail({
		body: { name: "IdP Operator", email, password },
	});
	console.log(`Created operator account ${email}`);
} catch (error) {
	const exists =
		error instanceof APIError &&
		error.body?.code?.startsWith("USER_ALREADY_EXISTS");
	if (!exists) throw error;
	console.log(
		`Operator account ${email} already exists — verifying ownership before promotion.`,
	);
}

// Prove ownership: the configured password must actually sign in.
try {
	await auth.api.signInEmail({ body: { email, password } });
} catch {
	console.error(
		`REFUSING TO PROMOTE: ${email} exists but IDP_ADMIN_PASSWORD does not match.\n` +
			"The address may have been registered by someone else (account squatting). Investigate before retrying.",
	);
	process.exit(1);
}

await db.update(user).set({ role: "admin" }).where(eq(user.email, email));
console.log(
	`${email} has the operator role. Ensure it is listed in OAUTH_ADMIN_EMAILS.`,
);
process.exit(0);
