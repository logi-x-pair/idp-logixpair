import type { FullConfig } from "@playwright/test";

import { decodeBase32Secret, generateTotpCode } from "./totp";

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

function sessionCookies(response: Response): string {
	return response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
}

async function postToIssuer(
	issuer: URL,
	path: string,
	body: Record<string, unknown>,
	cookie?: string,
): Promise<Response> {
	const endpoint = new URL(
		`${issuer.pathname.replace(/\/$/, "")}/${path.replace(/^\/+/, "")}`,
		issuer.origin,
	);
	return fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: issuer.origin,
			...(cookie ? { Cookie: cookie } : {}),
		},
		body: JSON.stringify(body),
	});
}

async function provisionTwoFactorUser(issuer: URL): Promise<void> {
	const password = requiredEnv("TEST_RP_USER_PASSWORD");
	const email = `e2e-two-factor-${Date.now()}@example.com`;
	const signup = await postToIssuer(issuer, "/sign-up/email", {
		name: "E2E Two Factor User",
		email,
		password,
	});
	if (!signup.ok) {
		throw new Error(`2FA fixture signup failed (${signup.status})`);
	}
	const cookie = sessionCookies(signup);
	if (!cookie) throw new Error("2FA fixture signup returned no session cookie");

	const enabled = await postToIssuer(
		issuer,
		"/two-factor/enable",
		{ password },
		cookie,
	);
	if (!enabled.ok) {
		throw new Error(`2FA fixture enrollment failed (${enabled.status})`);
	}
	const setup = (await enabled.json()) as { totpURI?: string };
	if (!setup.totpURI) throw new Error("2FA fixture enrollment returned no URI");
	const encodedSecret = new URL(setup.totpURI).searchParams.get("secret");
	if (!encodedSecret) throw new Error("2FA fixture URI contains no secret");
	const secret = decodeBase32Secret(encodedSecret);
	const verified = await postToIssuer(
		issuer,
		"/two-factor/verify-totp",
		{ code: await generateTotpCode(secret) },
		cookie,
	);
	if (!verified.ok) {
		throw new Error(`2FA fixture verification failed (${verified.status})`);
	}
	process.env.E2E_2FA_USER_EMAIL = email;
	process.env.E2E_2FA_USER_PASSWORD = password;
	process.env.E2E_2FA_TOTP_SECRET = secret;
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
	if (password.length < 12) {
		throw new Error(
			"TEST_RP_USER_PASSWORD must be at least 12 characters (IdP minPasswordLength).",
		);
	}
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
	if (!signup.ok) {
		const signupBody = (await signup.json().catch(() => ({}))) as {
			code?: string;
			message?: string;
		};
		if (!signupBody.code?.startsWith("USER_ALREADY_EXISTS")) {
			throw new Error(
				`E2E test-user provisioning failed (${signup.status}): ${signupBody.message ?? signupBody.code ?? "unknown error"}`,
			);
		}

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

	if (process.env.TWO_FACTOR_ENABLED === "true") {
		await provisionTwoFactorUser(issuer);
	}
}
