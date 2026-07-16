import type { FullConfig } from "@playwright/test";

function requiredEnv(key: string): string {
	const value = process.env[key];
	if (!value) throw new Error(`${key} is required in apps/test-rp/.env`);
	return value;
}

function localIssuer(value: string): URL {
	const url = new URL(value);
	if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
		throw new Error(`E2E refuses non-local OIDC_ISSUER: ${value}`);
	}
	return url;
}

/**
 * Idempotently provisions the browser-test account through Better Auth before
 * Playwright starts. Existing accounts must authenticate with the configured
 * password; the setup never changes an existing user's password.
 */
export default async function globalSetup(_config: FullConfig) {
	const issuer = localIssuer(requiredEnv("OIDC_ISSUER"));
	const name = process.env.TEST_RP_USER_NAME ?? "E2E Test User";
	const email = requiredEnv("TEST_RP_USER_EMAIL");
	const password = requiredEnv("TEST_RP_USER_PASSWORD");
	const endpoint = (path: string) =>
		new URL(
			`${issuer.pathname.replace(/\/$/, "")}/${path.replace(/^\/+/, "")}`,
			issuer.origin,
		).toString();
	const headers = {
		"Content-Type": "application/json",
		Origin: issuer.origin,
	};

	const signup = await fetch(endpoint("/sign-up/email"), {
		method: "POST",
		headers,
		body: JSON.stringify({ name, email, password }),
	});
	if (signup.ok) return;

	const signupBody = (await signup.json().catch(() => ({}))) as {
		code?: string;
		message?: string;
	};
	if (!signupBody.code?.startsWith("USER_ALREADY_EXISTS")) {
		throw new Error(
			`E2E test-user provisioning failed (${signup.status}): ${signupBody.message ?? signupBody.code ?? "unknown error"}`,
		);
	}

	// Prove the existing account belongs to this test configuration. Never
	// reset or promote an existing user's credentials from test setup.
	const signin = await fetch(endpoint("/sign-in/email"), {
		method: "POST",
		headers,
		body: JSON.stringify({ email, password }),
	});
	if (!signin.ok) {
		throw new Error(
			`E2E test user ${email} already exists but configured credentials do not authenticate; refusing to modify it.`,
		);
	}
}
