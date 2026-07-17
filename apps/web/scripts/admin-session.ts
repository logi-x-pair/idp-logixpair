/**
 * Shared helper for provisioning scripts: signs in the operator admin
 * (IDP_ADMIN_EMAIL / IDP_ADMIN_PASSWORD) and returns session headers for
 * `auth.api` calls that require an authenticated operator.
 *
 * Does NOT create accounts. Run `bun run seed:admin` once per deployment to
 * provision the operator (which also verifies account ownership).
 */
import { auth } from "@krazil-idp/auth";
import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { env } from "@krazil-idp/env/server";
import { eq } from "drizzle-orm";

export async function adminHeaders(): Promise<Headers> {
	const email = env.IDP_ADMIN_EMAIL;
	const password = env.IDP_ADMIN_PASSWORD;
	if (!email || !password) {
		console.error(
			"This command requires IDP_ADMIN_EMAIL and IDP_ADMIN_PASSWORD in the environment (see .env.example).",
		);
		process.exit(1);
	}

	const admins = (env.OAUTH_ADMIN_EMAILS ?? "")
		.split(",")
		.map((e) => e.trim().toLowerCase());
	if (!admins.includes(email.toLowerCase())) {
		console.error(
			`${email} is not listed in OAUTH_ADMIN_EMAILS — client management would be rejected. Add it and retry.`,
		);
		process.exit(1);
	}

	const rows = await db
		.select({ role: user.role })
		.from(user)
		.where(eq(user.email, email));
	if (rows.length === 0 || rows[0].role !== "admin") {
		console.error(
			`${email} is not a provisioned operator. Run \`bun run seed:admin\` first.`,
		);
		process.exit(1);
	}

	const signedIn = await auth.api
		.signInEmail({
			body: { email, password },
			returnHeaders: true,
		})
		.catch(() => null);
	if (!signedIn) {
		console.error(`Sign-in as ${email} failed — wrong IDP_ADMIN_PASSWORD?`);
		process.exit(1);
	}
	if (
		signedIn.response &&
		"twoFactorRedirect" in signedIn.response &&
		signedIn.response.twoFactorRedirect
	) {
		console.error(
			`Sign-in as ${email} requires two-factor verification. Operator CLI commands are noninteractive; use a dedicated non-2FA bootstrap operator or disable 2FA from that account's web settings first.`,
		);
		process.exit(1);
	}
	const { headers } = signedIn;
	const cookies = headers.getSetCookie().map((c) => c.split(";")[0]);
	if (cookies.length === 0) {
		console.error(`Sign-in as ${email} produced no session cookie.`);
		process.exit(1);
	}
	return new Headers({ cookie: cookies.join("; ") });
}
