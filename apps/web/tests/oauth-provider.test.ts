import { beforeAll, describe, expect, test } from "bun:test";
import { auth } from "@krazil-idp/auth";
import { type MailMessage, mailer } from "@krazil-idp/auth/email";
import { LOCKOUT } from "@krazil-idp/auth/token-config";
import { branding } from "@krazil-idp/branding/config";
import { db } from "@krazil-idp/db";
import {
	oauthClient,
	session,
	user,
	verification,
} from "@krazil-idp/db/schema/auth";
import { loginAttempt } from "@krazil-idp/db/schema/lockout";
import { revokedToken } from "@krazil-idp/db/schema/revocation";
import { env } from "@krazil-idp/env/server";
import { eq } from "drizzle-orm";

const issuer = "http://localhost:3000/api/auth";
const adminEmail = process.env.IDP_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.IDP_ADMIN_PASSWORD ?? "";
const callback = "http://localhost:4001/callback";

let adminHeaders: Headers;
let clientId: string;

const accessTokenMode = process.env.OAUTH_ACCESS_TOKEN_MODE ?? "short-lived";
const testRevocationStatus =
	accessTokenMode === "short-lived" ? test.skip : test;
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

async function issueJwt(
	state: string,
	verifier: string,
): Promise<{ accessToken: string; claims: Record<string, unknown> }> {
	const code = await authorizationCode(state, verifier);
	const response = await token({
		grant_type: "authorization_code",
		code,
		redirect_uri: callback,
		code_verifier: verifier,
		resource: issuer,
	});
	expect(response.status).toBe(200);
	const body = (await response.json()) as { access_token: string };
	const encodedPayload = body.access_token.split(".")[1];
	if (!encodedPayload) throw new Error("Access token is not a JWT");
	const claims = JSON.parse(
		Buffer.from(encodedPayload, "base64url").toString("utf8"),
	) as Record<string, unknown>;
	return { accessToken: body.access_token, claims };
}

async function revokeAccessToken(
	id: string,
	secret: string,
	accessToken: string,
	tokenTypeHint: "access_token" | undefined = "access_token",
): Promise<Response> {
	return auth.handler(
		new Request(`${issuer}/oauth2/revoke`, {
			method: "POST",
			headers: {
				authorization: basicAuth(id, secret),
				"content-type": "application/x-www-form-urlencoded",
			},
			body: formBody({
				token: accessToken,
				...(tokenTypeHint ? { token_type_hint: tokenTypeHint } : {}),
				client_id: id,
			}),
		}),
	);
}

async function introspectAccessToken(accessToken: string): Promise<Response> {
	return auth.handler(
		new Request(`${issuer}/oauth2/introspect`, {
			method: "POST",
			headers: {
				authorization: basicAuth(clientId, clientSecret),
				"content-type": "application/x-www-form-urlencoded",
			},
			body: formBody({ token: accessToken, client_id: clientId }),
		}),
	);
}

async function revokedRows(jti: string) {
	return db
		.select({ expiresAt: revokedToken.expiresAt })
		.from(revokedToken)
		.where(eq(revokedToken.jti, jti));
}

function headersFromSetCookie(headers: Headers): Headers {
	return new Headers({
		cookie: headers
			.getSetCookie()
			.map((cookie) => cookie.split(";")[0])
			.join("; "),
	});
}

async function captureAudit<T>(operation: () => Promise<T>) {
	const lines: string[] = [];
	const originalLog = console.log;
	console.log = (...args: unknown[]) => {
		lines.push(args.map(String).join(" "));
	};
	try {
		return { result: await operation(), lines };
	} finally {
		console.log = originalLog;
	}
}

async function captureMail<T>(operation: () => Promise<T>) {
	const messages: MailMessage[] = [];
	const originalSend = mailer.send;
	mailer.send = async (message) => {
		messages.push(message);
	};
	try {
		return { result: await operation(), messages };
	} finally {
		mailer.send = originalSend;
	}
}

function decodeBase32Secret(encoded: string): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let buffer = 0;
	let bitCount = 0;
	const bytes: number[] = [];
	for (const character of encoded.replace(/=+$/, "").toUpperCase()) {
		const value = alphabet.indexOf(character);
		if (value < 0) throw new Error("Invalid Base32 TOTP secret");
		buffer = (buffer << 5) | value;
		bitCount += 5;
		while (bitCount >= 8) {
			bitCount -= 8;
			bytes.push((buffer >> bitCount) & 0xff);
			buffer &= bitCount === 0 ? 0 : (1 << bitCount) - 1;
		}
	}
	return new TextDecoder().decode(Uint8Array.from(bytes));
}

async function currentTotpCode(secret: string): Promise<string> {
	const generated = await auth.api.generateTOTP({ body: { secret } });
	return generated.code;
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
	await db
		.update(user)
		.set({ role: "admin", emailVerified: true })
		.where(eq(user.id, userId));

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
	test("signup sends branded verification mail and optional enforcement works", async () => {
		const email = `verify-${Date.now()}@example.com`;
		const password = `${adminPassword} verify-test`;
		const captured = await captureMail(() =>
			auth.api.signUpEmail({
				body: { name: "Verification Test", email, password },
			}),
		);
		const [created] = await db
			.select({ emailVerified: user.emailVerified })
			.from(user)
			.where(eq(user.email, email));
		expect(created.emailVerified).toBe(false);
		expect(captured.messages).toHaveLength(1);
		expect(captured.messages[0]).toMatchObject({
			to: email,
			subject: `Verify your ${branding.brandName} email address`,
		});
		expect(captured.messages[0].text).toContain("http");

		if (env.REQUIRE_EMAIL_VERIFICATION === "true") {
			const enforced = await captureMail(async () => {
				try {
					await auth.api.signInEmail({ body: { email, password } });
					return false;
				} catch {
					return true;
				}
			});
			expect(enforced.result).toBe(true);
			expect(enforced.messages).toHaveLength(1);
		} else {
			await auth.api.signInEmail({ body: { email, password } });
		}
	});

	test("password reset revokes sessions and emits an audit event", async () => {
		const email = `reset-${Date.now()}@example.com`;
		const password = `${adminPassword} reset-test`;
		await auth.api.signUpEmail({
			body: { name: "Reset Test", email, password },
		});
		await db
			.update(user)
			.set({ emailVerified: true })
			.where(eq(user.email, email));
		await auth.api.signInEmail({ body: { email, password } });
		await auth.api.signInEmail({ body: { email, password } });
		const requested = await captureMail(() =>
			auth.api.requestPasswordReset({
				body: { email, redirectTo: "http://localhost:3000/reset-password" },
			}),
		);
		expect(requested.messages).toHaveLength(1);
		const url = requested.messages[0].text.slice(
			requested.messages[0].text.indexOf("http"),
		);
		const token = new URL(url).pathname.split("/").at(-1);
		expect(token).toBeString();
		const reset = await captureAudit(() =>
			auth.api.resetPassword({
				body: { newPassword: `${password} changed` },
				query: { token: token as string },
			}),
		);
		expect(
			reset.lines.some((line) => line.includes('"event":"password.reset"')),
		).toBe(true);
		const resetUser = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, email));
		expect(resetUser).toHaveLength(1);
		expect(
			await db
				.select()
				.from(session)
				.where(eq(session.userId, resetUser[0].id)),
		).toHaveLength(0);
		await auth.api.signInEmail({
			body: { email, password: `${password} changed` },
		});
	});
	testRevocationStatus(
		"authoritative status rejects a terminated session",
		async () => {
			const existing = await db
				.select({ id: session.id })
				.from(session)
				.where(eq(session.userId, userId));
			await auth.api.signInEmail({
				body: { email: adminEmail, password: adminPassword },
			});
			const sessions = await db
				.select({ id: session.id })
				.from(session)
				.where(eq(session.userId, userId));
			const created = sessions.find(
				(candidate) =>
					!existing.some((previous) => previous.id === candidate.id),
			);
			if (!created) throw new Error("Test sign-in did not create a session");
			const secret = process.env.OAUTH_REVOCATION_CHECK_SECRET;
			if (!secret) throw new Error("Revocation test secret is missing");
			const status = (statusSub = userId, bearer: string | null = secret) =>
				auth.handler(
					new Request(`${issuer}/token-revocation-status`, {
						method: "POST",
						headers: {
							...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
							"content-type": "application/json",
						},
						body: JSON.stringify({ sid: created.id, sub: statusSub }),
					}),
				);
			const wrongSecret = await status(userId, `${secret}-wrong`);
			expect(wrongSecret.status).toBe(401);
			const missingSecret = await status(userId, null);
			expect(missingSecret.status).toBe(401);
			const malformedIdentity = await auth.handler(
				new Request(`${issuer}/token-revocation-status`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${secret}`,
						"content-type": "application/json",
					},
					body: JSON.stringify({ sid: created.id, azp: clientId }),
				}),
			);
			expect(malformedIdentity.status).toBe(400);
			const wrongSubject = await status(`wrong-${userId}`);
			expect(wrongSubject.status).toBe(200);
			expect((await wrongSubject.json()).active).toBe(false);
			try {
				const active = await status();
				expect(active.status).toBe(200);
				expect((await active.json()).active).toBe(true);
				await db.delete(session).where(eq(session.id, created.id));
				const revoked = await status();
				expect(revoked.status).toBe(200);
				expect((await revoked.json()).active).toBe(false);
			} finally {
				await db.delete(session).where(eq(session.id, created.id));
			}
		},
	);

	testRevocationStatus(
		"machine-token status follows OAuth client disablement",
		async () => {
			const secret = process.env.OAUTH_REVOCATION_CHECK_SECRET;
			if (!secret) throw new Error("Revocation test secret is missing");
			const status = () =>
				auth.handler(
					new Request(`${issuer}/token-revocation-status`, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${secret}`,
							"content-type": "application/json",
						},
						body: JSON.stringify({ azp: clientId }),
					}),
				);
			const active = await status();
			expect(active.status).toBe(200);
			expect((await active.json()).active).toBe(true);
			try {
				await db
					.update(oauthClient)
					.set({ disabled: true })
					.where(eq(oauthClient.clientId, clientId));
				const disabled = await status();
				expect(disabled.status).toBe(200);
				expect((await disabled.json()).active).toBe(false);
			} finally {
				await db
					.update(oauthClient)
					.set({ disabled: false })
					.where(eq(oauthClient.clientId, clientId));
			}
		},
	);

	test("unknown-email lockout is indistinguishable from a real account", async () => {
		const missingEmail = `missing-${Date.now()}@example.com`;
		const failedSignIn = (email: string) =>
			auth.handler(
				new Request(`${issuer}/sign-in/email`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: "http://localhost:3000",
					},
					body: JSON.stringify({ email, password: "wrong-password" }),
				}),
			);
		try {
			for (let i = 0; i < LOCKOUT.maxFailedAttempts; i++) {
				const response = await failedSignIn(missingEmail);
				expect([400, 401]).toContain(response.status);
			}
			const lockedUnknown = await failedSignIn(missingEmail);
			expect(lockedUnknown.status).toBe(429);
			expect(lockedUnknown.headers.get("x-retry-after")).toBeTruthy();
			const unknownBody = (await lockedUnknown.json()) as {
				message?: string;
			};
			expect(unknownBody.message).toBe(
				"Too many requests. Please try again later.",
			);

			await db.delete(loginAttempt).where(eq(loginAttempt.email, adminEmail));
			for (let i = 0; i < LOCKOUT.maxFailedAttempts; i++) {
				const response = await failedSignIn(adminEmail);
				expect([400, 401]).toContain(response.status);
			}
			const lockedKnown = await failedSignIn(adminEmail);
			expect(lockedKnown.status).toBe(429);
			expect(lockedKnown.headers.get("x-retry-after")).toBeTruthy();
			// The parity assertion: byte-identical bodies for both cases.
			expect(await lockedKnown.json()).toEqual(unknownBody);
		} finally {
			await db.delete(loginAttempt).where(eq(loginAttempt.email, missingEmail));
			await db.delete(loginAttempt).where(eq(loginAttempt.email, adminEmail));
		}
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

	test("JWT revocation requires a valid owned token", async () => {
		const { accessToken, claims } = await issueJwt(
			"jwt-ownership",
			"j".repeat(43),
		);
		expect(claims.jti).toBeString();
		expect(claims.azp).toBe(clientId);
		expect(claims.exp).toBeNumber();
		const jti = claims.jti as string;
		const otherClient = await auth.api.adminCreateOAuthClient({
			headers: adminHeaders,
			body: {
				client_name: `Revocation Ownership ${Date.now()}`,
				redirect_uris: [callback],
				scope: "openid",
				skip_consent: true,
				token_endpoint_auth_method: "client_secret_basic",
				grant_types: ["authorization_code"],
				response_types: ["code"],
			},
		});
		const foreignRevoke = await revokeAccessToken(
			otherClient.client_id,
			otherClient.client_secret,
			accessToken,
		);
		expect(foreignRevoke.status).toBe(200);
		const afterForeign = await introspectAccessToken(accessToken);
		expect(afterForeign.status).toBe(200);
		expect((await afterForeign.json()).active).toBe(true);
		expect(await revokedRows(jti)).toHaveLength(0);
	});

	test("wrong-signature JWT revocation preserves RFC client authentication", async () => {
		const { accessToken, claims } = await issueJwt(
			"jwt-wrong-signature",
			"l".repeat(43),
		);
		const [encodedHeader, encodedPayload] = accessToken.split(".");
		if (!encodedHeader || !encodedPayload) {
			throw new Error("Access token is not a JWT");
		}
		const wrongSignature = Buffer.alloc(64, 0x5a).toString("base64url");
		const forgedToken = `${encodedHeader}.${encodedPayload}.${wrongSignature}`;
		const unauthenticated = await revokeAccessToken(
			clientId,
			`${clientSecret}-wrong`,
			forgedToken,
		);
		expect(unauthenticated.status).toBe(401);

		const revoked = await revokeAccessToken(
			clientId,
			clientSecret,
			forgedToken,
		);
		expect(revoked.status).toBe(200);
		expect(await revokedRows(claims.jti as string)).toHaveLength(0);
		const originalToken = await introspectAccessToken(accessToken);
		expect(originalToken.status).toBe(200);
		expect((await originalToken.json()).active).toBe(true);
	});

	test("owned JWT revocation disables introspection and status", async () => {
		const { accessToken, claims } = await issueJwt(
			"jwt-own-revoke",
			"k".repeat(43),
		);
		const jti = claims.jti as string;
		try {
			const response = await revokeAccessToken(
				clientId,
				clientSecret,
				accessToken,
			);
			expect(response.status).toBe(200);
			const rows = await revokedRows(jti);
			expect(rows).toHaveLength(1);
			expect(rows[0].expiresAt.getTime()).toBeLessThanOrEqual(
				(claims.exp as number) * 1000,
			);
			const introspection = await introspectAccessToken(accessToken);
			expect(introspection.status).toBe(200);
			expect(await introspection.json()).toEqual({ active: false });

			if (accessTokenMode !== "short-lived") {
				const secret = process.env.OAUTH_REVOCATION_CHECK_SECRET;
				if (!secret) throw new Error("Revocation test secret is missing");
				const status = await auth.handler(
					new Request(`${issuer}/token-revocation-status`, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${secret}`,
							"content-type": "application/json",
						},
						body: JSON.stringify({
							sid: claims.sid,
							sub: claims.sub,
							jti,
						}),
					}),
				);
				expect(status.status).toBe(200);
				expect(await status.json()).toEqual({ active: false });
			}
		} finally {
			await db.delete(revokedToken).where(eq(revokedToken.jti, jti));
		}
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
	test("2FA preserves audit truth and remains enforced when enrollment is hidden", async () => {
		const email = `two-factor-${Date.now()}@example.com`;
		const password = `${adminPassword} 2fa-test`;
		await auth.api.signUpEmail({
			body: { name: "Two Factor Test", email, password },
		});
		await db
			.update(user)
			.set({ emailVerified: true })
			.where(eq(user.email, email));
		const account = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, email));
		expect(account).toHaveLength(1);
		const userId = account[0].id;
		const signedIn = await auth.api.signInEmail({
			body: { email, password },
			returnHeaders: true,
		});
		const sessionHeaders = headersFromSetCookie(signedIn.headers);
		const setup = await auth.api.enableTwoFactor({
			headers: sessionHeaders,
			body: { password },
		});
		const encodedSecret = new URL(setup.totpURI).searchParams.get("secret");
		expect(encodedSecret).toBeString();
		const secret = decodeBase32Secret(encodedSecret as string);
		await auth.api.verifyTOTP({
			headers: sessionHeaders,
			body: { code: await currentTotpCode(secret as string) },
		});
		const [enrolledUser] = await db
			.select({ twoFactorEnabled: user.twoFactorEnabled })
			.from(user)
			.where(eq(user.id, userId));
		expect(enrolledUser.twoFactorEnabled).toBe(true);
		await db.delete(session).where(eq(session.userId, userId));

		const challenge = await captureAudit(() =>
			auth.api.signInEmail({ body: { email, password }, returnHeaders: true }),
		);
		expect(challenge.result.response?.twoFactorRedirect).toBe(true);
		expect(
			challenge.lines.some((line) => line.includes('"event":"login.success"')),
		).toBe(false);
		expect(
			await db.select().from(loginAttempt).where(eq(loginAttempt.email, email)),
		).toHaveLength(0);

		const challengeHeaders = headersFromSetCookie(challenge.result.headers);
		const wrongCode = String(
			(Number(await currentTotpCode(secret as string)) + 1) % 1_000_000,
		).padStart(6, "0");
		const failedVerification = await captureAudit(async () =>
			auth.api
				.verifyTOTP({ headers: challengeHeaders, body: { code: wrongCode } })
				.catch(() => null),
		);
		expect(
			failedVerification.lines.filter((line) =>
				line.includes('"event":"login.two_factor_failure"'),
			),
		).toHaveLength(1);
		const completed = await captureAudit(async () =>
			auth.api.verifyTOTP({
				headers: challengeHeaders,
				body: { code: await currentTotpCode(secret as string) },
				returnHeaders: true,
			}),
		);
		expect(completed.result.response?.user.email).toBe(email);
		expect(
			completed.lines.filter((line) =>
				line.includes('"event":"login.success"'),
			),
		).toHaveLength(1);

		const authenticatedHeaders = headersFromSetCookie(completed.result.headers);
		const backup = await auth.api.generateBackupCodes({
			headers: authenticatedHeaders,
			body: { password },
		});
		const backupCode = backup.backupCodes[0];
		const authenticatedVerification = await captureAudit(() =>
			auth.api.verifyBackupCode({
				headers: authenticatedHeaders,
				body: { code: backupCode },
			}),
		);
		expect(
			authenticatedVerification.lines.some((line) =>
				line.includes('"event":"login.success"'),
			),
		).toBe(false);
		await expect(
			auth.api.verifyBackupCode({
				headers: authenticatedHeaders,
				body: { code: backupCode },
			}),
		).rejects.toThrow();
		await auth.api.disableTwoFactor({
			headers: authenticatedHeaders,
			body: { password },
		});
		const [updated] = await db
			.select({ twoFactorEnabled: user.twoFactorEnabled })
			.from(user)
			.where(eq(user.id, userId));
		expect(updated.twoFactorEnabled).toBe(false);
	});
	test("admin client creation is audited", async () => {
		const created = await captureAudit(() =>
			auth.api.adminCreateOAuthClient({
				headers: adminHeaders,
				body: {
					client_name: `Audit Client ${Date.now()}`,
					redirect_uris: [callback],
				},
			}),
		);
		expect(created.result.client_id).toBeString();
		expect(
			created.lines.filter(
				(line) =>
					line.includes('"event":"client.created"') &&
					line.includes(created.result.client_id),
			),
		).toHaveLength(1);
	});
});
