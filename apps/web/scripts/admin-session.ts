/**
 * Shared helper for provisioning scripts: signs in the operator admin
 * (IDP_ADMIN_EMAIL / IDP_ADMIN_PASSWORD, created on first use) and returns
 * session headers for `auth.api` calls that require an authenticated admin.
 *
 * The admin email must also be listed in OAUTH_ADMIN_EMAILS so that
 * `clientPrivileges` grants client-management actions.
 */
import { auth } from "@krazil-idp/auth";
import { env } from "@krazil-idp/env/server";
import { APIError } from "better-auth";

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

	try {
		await auth.api.signUpEmail({
			body: { name: "IdP Operator", email, password },
		});
		console.log(`Created operator admin account ${email}`);
	} catch (error) {
		const exists =
			error instanceof APIError &&
			error.body?.code?.startsWith("USER_ALREADY_EXISTS");
		if (!exists) throw error;
	}

	const { headers } = await auth.api.signInEmail({
		body: { email, password },
		returnHeaders: true,
	});
	const cookies = headers.getSetCookie().map((c) => c.split(";")[0]);
	if (cookies.length === 0) {
		console.error(
			`Sign-in as ${email} produced no session cookie — wrong password?`,
		);
		process.exit(1);
	}
	return new Headers({ cookie: cookies.join("; ") });
}
