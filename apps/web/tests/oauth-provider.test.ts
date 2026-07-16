import { beforeAll, describe, expect, test } from "bun:test";
import { auth } from "@krazil-idp/auth";
import { LOCKOUT } from "@krazil-idp/auth/token-config";
import { db } from "@krazil-idp/db";
import { user, verification } from "@krazil-idp/db/schema/auth";
import { loginAttempt } from "@krazil-idp/db/schema/lockout";
import { eq } from "drizzle-orm";

const issuer = "http://localhost:3000/api/auth";
const adminEmail = process.env.IDP_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.IDP_ADMIN_PASSWORD ?? "";
const callback = "http://localhost:4001/callback";

let adminHeaders: Headers;
let clientId: string;
let clientSecret: string;
let userId: string;

async function api(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers);
	if (adminHeaders && !headers.has("cookie")) {
		headers.set("cookie", adminHeaders.get("cookie") ?? "");
	}
	return auth.handler(
		new Request(`${issuer}${path}`, {
			...init,
			headers,
		}),
	);
}

function formBody(values: Record<string, string>): string {
	return new URLSearchParams(values).toString();
}

function basicAuth(id: string, secret: string): string {
	return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function authorizationCode(
	state: string,
	verifier: string,
): Promise<string> {
	const challenge = Buffer.from(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
	).toString("base64url");
	const response = await api(
		`/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callback)}&response_type=code&scope=openid%20profile%20email%20offline_access&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`,
	);
	expect(response.status).toBe(302);
	const location = response.headers.get("location");
	expect(location).toBeTruthy();
	const code = new URL(location as string).searchParams.get("code");
	expect(code).toBeTruthy();
	return code as string;
}

async function token(
	values: Record<string, string>,
	secret = clientSecret,
): Promise<Response> {
	return auth.handler(
		new Request(`${issuer}/oauth2/token`, {
			method: "POST",
			headers: {
				authorization: basicAuth(clientId, secret),
				"content-type": "application/x-www-form-urlencoded",
			},
			body: formBody({ client_id: clientId, ...values }),
		}),
	);
}

beforeAll(async () => {
	if (!adminPassword)
		throw new Error(
			"IDP_ADMIN_PASSWORD is required for isolated protocol tests",
		);

	const signedUp = await auth.api
		.signUpEmail({
			body: {
				name: "Protocol Test User",
				email: adminEmail,
				password: adminPassword,
			},
		})
		.catch(() => null);
	void signedUp;
	const account = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, adminEmail));
	expect(account.length).toBe(1);
	userId = account[0].id;
	await db.update(user).set({ role: "admin" }).where(eq(user.id, userId));

	const signedIn = await auth.api.signInEmail({
		body: { email: adminEmail, password: adminPassword },
		returnHeaders: true,
	});
	adminHeaders = new Headers({
		cookie: signedIn.headers
			.getSetCookie()
			.map((v) => v.split(";")[0])
			.join("; "),
	});

	const client = await auth.api.adminCreateOAuthClient({
		headers: adminHeaders,
		body: {
			client_name: `Protocol Test ${Date.now()}`,
			redirect_uris: [callback],
			scope: "openid profile email offline_access",
			skip_consent: true,
			token_endpoint_auth_method: "client_secret_basic",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		},
	});
	clientId = client.client_id;
	clientSecret = client.client_secret;
});

describe("OAuth 2.1 provider contract", () => {
	test("unknown-email failures do not create lockout rows", async () => {
		const email = `missing-${Date.now()}@example.com`;
		const response = await auth.handler(
			new Request(`${issuer}/sign-in/email`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "http://localhost:3000",
				},
				body: JSON.stringify({ email, password: "wrong-password" }),
			}),
		);
		expect([400, 401]).toContain(response.status);
		const rows = await db
			.select({ email: loginAttempt.email })
			.from(loginAttempt)
			.where(eq(loginAttempt.email, email));
		expect(rows).toHaveLength(0);
	});

	test("concurrent failures atomically reach the lockout threshold", async () => {
		await db.delete(loginAttempt).where(eq(loginAttempt.email, adminEmail));
		try {
			const beforeAttempts = new Date();
			const attempts = Array.from({ length: LOCKOUT.maxFailedAttempts }, () =>
				auth.handler(
					new Request(`${issuer}/sign-in/email`, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							origin: "http://localhost:3000",
						},
						body: JSON.stringify({
							email: adminEmail,
							password: "wrong-password",
						}),
					}),
				),
			);
			const responses = await Promise.all(attempts);
			for (const response of responses) {
				expect([400, 401]).toContain(response.status);
			}
			const rows = await db
				.select({
					failedCount: loginAttempt.failedCount,
					lockedUntil: loginAttempt.lockedUntil,
				})
				.from(loginAttempt)
				.where(eq(loginAttempt.email, adminEmail));
			expect(rows).toHaveLength(1);
			expect(rows[0].failedCount).toBe(LOCKOUT.maxFailedAttempts);
			expect(rows[0].lockedUntil?.getTime()).toBeGreaterThan(
				beforeAttempts.getTime(),
			);
		} finally {
			await db.delete(loginAttempt).where(eq(loginAttempt.email, adminEmail));
		}
	});

	test("lockout backoff remains capped after a large failure count", async () => {
		const initialFailedCount = 1_000_000;
		await db.insert(loginAttempt).values({
			email: adminEmail,
			failedCount: initialFailedCount,
			lockedUntil: null,
			updatedAt: new Date(),
		});
		try {
			const beforeAttempt = Date.now();
			const response = await auth.handler(
				new Request(`${issuer}/sign-in/email`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: "http://localhost:3000",
					},
					body: JSON.stringify({
						email: adminEmail,
						password: "wrong-password",
					}),
				}),
			);
			expect([400, 401]).toContain(response.status);
			const rows = await db
				.select({
					failedCount: loginAttempt.failedCount,
					lockedUntil: loginAttempt.lockedUntil,
				})
				.from(loginAttempt)
				.where(eq(loginAttempt.email, adminEmail));
			expect(rows).toHaveLength(1);
			expect(rows[0].failedCount).toBe(initialFailedCount + 1);
			const lockDuration =
				(rows[0].lockedUntil?.getTime() ?? 0) - beforeAttempt;
			expect(lockDuration).toBeGreaterThan((LOCKOUT.maxLockSeconds - 5) * 1000);
			expect(lockDuration).toBeLessThanOrEqual(
				(LOCKOUT.maxLockSeconds + 5) * 1000,
			);
		} finally {
			await db.delete(loginAttempt).where(eq(loginAttempt.email, adminEmail));
		}
	});

	test("authorize -> token happy path issues access, id, and refresh tokens", async () => {
		const verifier = "a".repeat(43);
		const code = await authorizationCode("happy", verifier);
		const response = await token({
			grant_type: "authorization_code",
			code,
			redirect_uri: callback,
			code_verifier: verifier,
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.access_token).toBeString();
		expect(body.id_token).toBeString();
		expect(body.refresh_token).toBeString();
		expect(body.token_type).toBe("Bearer");
	});

	test("wrong PKCE verifier is rejected", async () => {
		const verifier = "b".repeat(43);
		const code = await authorizationCode("pkce-fail", verifier);
		const response = await token({
			grant_type: "authorization_code",
			code,
			redirect_uri: callback,
			code_verifier: "c".repeat(43),
		});
		expect([400, 401]).toContain(response.status);
		expect(["invalid_grant", "invalid_request"]).toContain(
			(await response.json()).error,
		);
	});

	test("bad redirect_uri is rejected without redirecting to it", async () => {
		const response = await api(
			`/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent("http://localhost:4001/evil")}&response_type=code&scope=openid&state=bad`,
		);
		expect(response.status).toBe(302);
		const location = response.headers.get("location") ?? "";
		expect(location).toContain("/api/auth/error");
		expect(location).not.toContain("/evil");
	});

	test("expired authorization code is rejected", async () => {
		const verifier = "d".repeat(43);
		const code = await authorizationCode("expired", verifier);
		const rows = await db
			.select({ identifier: verification.identifier })
			.from(verification);
		expect(rows.length).toBeGreaterThan(0);
		await db
			.update(verification)
			.set({ expiresAt: new Date(Date.now() - 1000) });
		const response = await token({
			grant_type: "authorization_code",
			code,
			redirect_uri: callback,
			code_verifier: verifier,
		});
		expect([400, 401]).toContain(response.status);
		expect((await response.json()).error).toBe("invalid_grant");
	});

	test("refresh rotation invalidates the old refresh token", async () => {
		const verifier = "e".repeat(43);
		const code = await authorizationCode("refresh", verifier);
		const first = await token({
			grant_type: "authorization_code",
			code,
			redirect_uri: callback,
			code_verifier: verifier,
		});
		const firstBody = await first.json();
		const rotated = await token({
			grant_type: "refresh_token",
			refresh_token: firstBody.refresh_token,
		});
		expect(rotated.status).toBe(200);
		const rotatedBody = await rotated.json();
		expect(rotatedBody.refresh_token).toBeString();
		const reused = await token({
			grant_type: "refresh_token",
			refresh_token: firstBody.refresh_token,
		});
		expect(reused.status).toBe(400);
	});

	test("revocation and introspection invalidate a refresh token", async () => {
		const verifier = "f".repeat(43);
		const code = await authorizationCode("revoke", verifier);
		const issued = await token({
			grant_type: "authorization_code",
			code,
			redirect_uri: callback,
			code_verifier: verifier,
		});
		const issuedBody = await issued.json();
		const revoke = await auth.handler(
			new Request(`${issuer}/oauth2/revoke`, {
				method: "POST",
				headers: {
					authorization: basicAuth(clientId, clientSecret),
					"content-type": "application/x-www-form-urlencoded",
				},
				body: formBody({
					token: issuedBody.refresh_token,
					token_type_hint: "refresh_token",
					client_id: clientId,
				}),
			}),
		);
		expect(revoke.status).toBe(200);
		const introspect = await auth.handler(
			new Request(`${issuer}/oauth2/introspect`, {
				method: "POST",
				headers: {
					authorization: basicAuth(clientId, clientSecret),
					"content-type": "application/x-www-form-urlencoded",
				},
				body: formBody({
					token: issuedBody.refresh_token,
					token_type_hint: "refresh_token",
					client_id: clientId,
				}),
			}),
		);
		expect(introspect.status).toBe(200);
		expect((await introspect.json()).active).toBe(false);
	});
});
