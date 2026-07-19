import { beforeAll, describe, expect, test } from "bun:test";
import { auth } from "@krazil-idp/auth";
import { db } from "@krazil-idp/db";
import { oauthRefreshToken, session, user } from "@krazil-idp/db/schema/auth";
import { and, eq, isNull } from "drizzle-orm";

const issuer = "http://localhost:3000/api/auth";
const runId = Date.now();
const password = "operator-suite-password-1234";
const callback = "http://localhost:4009/callback";
const envAdminEmail = process.env.IDP_ADMIN_EMAIL ?? "admin@example.com";
const envAdminPassword = process.env.IDP_ADMIN_PASSWORD ?? "";

let adminHeaders: Headers;
let moderatorHeaders: Headers;
let plainHeaders: Headers;
let adminId: string;
let employeeId: string;
let clientId: string;
let clientSecret: string;
const employeeEmail = `employee-${runId}@example.com`;

function cookieHeaders(headers: Headers): Headers {
	return new Headers({
		cookie: headers
			.getSetCookie()
			.map((v) => v.split(";")[0])
			.join("; "),
	});
}

async function provision(
	name: string,
	email: string,
	role: "admin" | "moderator" | "user",
): Promise<{ id: string; headers: Headers }> {
	await auth.api.signUpEmail({ body: { name, email, password } });
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email));
	const id = rows[0]?.id;
	if (!id) throw new Error(`Provisioning failed for ${email}`);
	await db
		.update(user)
		.set({ role, emailVerified: true })
		.where(eq(user.id, id));
	const signedIn = await auth.api.signInEmail({
		body: { email, password },
		returnHeaders: true,
	});
	return { id, headers: cookieHeaders(signedIn.headers) };
}

function adminRequest(
	path: string,
	headers: Headers,
	body?: Record<string, unknown>,
): Promise<Response> {
	return auth.handler(
		new Request(`${issuer}${path}`, {
			method: body ? "POST" : "GET",
			headers: new Headers({
				cookie: headers.get("cookie") ?? "",
				...(body ? { "content-type": "application/json" } : {}),
			}),
			...(body ? { body: JSON.stringify(body) } : {}),
		}),
	);
}

async function signInStatus(email: string): Promise<number> {
	const response = await auth.handler(
		new Request(`${issuer}/sign-in/email`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password }),
		}),
	);
	return response.status;
}

async function authorizeCode(
	sessionHeaders: Headers,
	verifier: string,
): Promise<string> {
	const challenge = Buffer.from(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
	).toString("base64url");
	const response = await auth.handler(
		new Request(
			`${issuer}/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callback)}&response_type=code&scope=openid%20profile%20email%20offline_access&state=st-${crypto.randomUUID()}&code_challenge=${challenge}&code_challenge_method=S256`,
			{ headers: new Headers({ cookie: sessionHeaders.get("cookie") ?? "" }) },
		),
	);
	expect(response.status).toBe(302);
	const code = new URL(
		response.headers.get("location") as string,
	).searchParams.get("code");
	expect(code).toBeTruthy();
	return code as string;
}

function tokenRequest(values: Record<string, string>): Promise<Response> {
	return auth.handler(
		new Request(`${issuer}/oauth2/token`, {
			method: "POST",
			headers: {
				authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
				"content-type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({ client_id: clientId, ...values }).toString(),
		}),
	);
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
	const admin = await provision(
		"Role Suite Admin",
		`role-admin-${runId}@example.com`,
		"admin",
	);
	adminHeaders = admin.headers;
	adminId = admin.id;
	const moderator = await provision(
		"Role Suite Moderator",
		`role-moderator-${runId}@example.com`,
		"moderator",
	);
	moderatorHeaders = moderator.headers;
	const plain = await provision(
		"Role Suite User",
		`role-user-${runId}@example.com`,
		"user",
	);
	plainHeaders = plain.headers;
	const employee = await provision("Employee", employeeEmail, "user");
	employeeId = employee.id;

	// OAuth client creation requires the env-provisioned admin: client CRUD is
	// gated on OAUTH_ADMIN_EMAILS membership, not the admin role alone.
	if (!envAdminPassword)
		throw new Error("IDP_ADMIN_PASSWORD is required for role suite");
	await auth.api
		.signUpEmail({
			body: {
				name: "Protocol Test User",
				email: envAdminEmail,
				password: envAdminPassword,
			},
		})
		.catch(() => null);
	await db
		.update(user)
		.set({ role: "admin", emailVerified: true })
		.where(eq(user.email, envAdminEmail));
	const envAdmin = await auth.api.signInEmail({
		body: { email: envAdminEmail, password: envAdminPassword },
		returnHeaders: true,
	});
	const client = await auth.api.adminCreateOAuthClient({
		headers: cookieHeaders(envAdmin.headers),
		body: {
			client_name: `Role Suite ${runId}`,
			redirect_uris: [callback],
			scope: "openid profile email offline_access",
			skip_consent: true,
			token_endpoint_auth_method: "client_secret_basic",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		},
	});
	clientId = client.client_id;
	clientSecret = client.client_secret as string;
});

describe("moderator role (CRU, no delete)", () => {
	test("creates accounts but cannot grant roles at creation", async () => {
		const created = await adminRequest("/admin/create-user", moderatorHeaders, {
			name: "Hired Employee",
			email: `hired-${runId}@example.com`,
			password,
		});
		expect(created.status).toBe(200);
		const escalation = await adminRequest(
			"/admin/create-user",
			moderatorHeaders,
			{
				name: "Sneaky Admin",
				email: `sneaky-${runId}@example.com`,
				password,
				role: "admin",
			},
		);
		const dataSmuggle = await adminRequest(
			"/admin/create-user",
			moderatorHeaders,
			{
				name: "Pre-verified",
				email: `preverified-${runId}@example.com`,
				password,
				data: { emailVerified: true, twoFactorEnabled: false },
			},
		);
		expect(dataSmuggle.status).toBe(403);
		expect(escalation.status).toBe(403);
	});

	test("lists users", async () => {
		const response = await adminRequest(
			"/admin/list-users?limit=5",
			moderatorHeaders,
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { users: unknown[]; total: number };
		expect(body.total).toBeGreaterThanOrEqual(4);
	});

	test("updates allowlisted profile fields only", async () => {
		const rename = await adminRequest("/admin/update-user", moderatorHeaders, {
			userId: employeeId,
			data: { name: "Employee Renamed" },
		});
		expect(rename.status).toBe(200);

		// Non-allowlisted fields are rejected even though the plugin's generic
		// `update` permission would have forwarded them to the database.
		const twoFactorKill = await adminRequest(
			"/admin/update-user",
			moderatorHeaders,
			{ userId: employeeId, data: { twoFactorEnabled: false } },
		);
		expect(twoFactorKill.status).toBe(403);

		const verifiedFlip = await adminRequest(
			"/admin/update-user",
			moderatorHeaders,
			{ userId: employeeId, data: { emailVerified: true } },
		);
		expect(verifiedFlip.status).toBe(403);

		const idRewrite = await adminRequest(
			"/admin/update-user",
			moderatorHeaders,
			{ userId: employeeId, data: { id: "forged-id" } },
		);
		expect(idRewrite.status).toBe(403);

		const timestampRewrite = await adminRequest(
			"/admin/update-user",
			moderatorHeaders,
			{ userId: employeeId, data: { createdAt: new Date().toISOString() } },
		);
		expect(timestampRewrite.status).toBe(403);

		const roleChange = await adminRequest(
			"/admin/update-user",
			moderatorHeaders,
			{ userId: employeeId, data: { role: "moderator" } },
		);
		expect(roleChange.status).toBe(403);

		const setRole = await adminRequest("/admin/set-role", moderatorHeaders, {
			userId: employeeId,
			role: "moderator",
		});
		expect(setRole.status).toBe(403);

		const emailChange = await adminRequest(
			"/admin/update-user",
			moderatorHeaders,
			{ userId: employeeId, data: { email: `stolen-${runId}@example.com` } },
		);
		expect(emailChange.status).toBe(403);

		const passwordChange = await adminRequest(
			"/admin/set-user-password",
			moderatorHeaders,
			{ userId: employeeId, newPassword: "hijacked-password-1234" },
		);
		expect(passwordChange.status).toBe(403);
	});

	test("ban disables sign-in and revokes sessions; unban restores access", async () => {
		const banned = await adminRequest("/admin/ban-user", moderatorHeaders, {
			userId: employeeId,
			banReason: "Offboarding hold",
		});
		expect(banned.status).toBe(200);
		expect(await signInStatus(employeeEmail)).toBe(403);

		const unbanned = await adminRequest("/admin/unban-user", moderatorHeaders, {
			userId: employeeId,
		});
		expect(unbanned.status).toBe(200);
		expect(await signInStatus(employeeEmail)).toBe(200);
	});

	test("cannot delete accounts", async () => {
		const removed = await adminRequest("/admin/remove-user", moderatorHeaders, {
			userId: employeeId,
		});
		expect(removed.status).toBe(403);
		const stillThere = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.id, employeeId));
		expect(stillThere).toHaveLength(1);
	});

	test("has no session-management endpoints", async () => {
		const list = await adminRequest(
			"/admin/list-user-sessions",
			moderatorHeaders,
			{ userId: adminId },
		);
		expect(list.status).toBe(403);
		const revoke = await adminRequest(
			"/admin/revoke-user-sessions",
			moderatorHeaders,
			{ userId: adminId },
		);
		expect(revoke.status).toBe(403);
	});

	test("cannot ban or ban-edit an admin account", async () => {
		const direct = await adminRequest("/admin/ban-user", moderatorHeaders, {
			userId: adminId,
			banReason: "hostile takeover",
		});
		expect(direct.status).toBe(403);

		const viaUpdate = await adminRequest(
			"/admin/update-user",
			moderatorHeaders,
			{ userId: adminId, data: { banned: true } },
		);
		expect(viaUpdate.status).toBe(403);

		// Unban is a ban-state mutation too: a moderator must not be able to
		// re-enable an admin account another admin deliberately disabled.
		const unban = await adminRequest("/admin/unban-user", moderatorHeaders, {
			userId: adminId,
		});
		expect(unban.status).toBe(403);

		const rows = await db
			.select({ banned: user.banned })
			.from(user)
			.where(eq(user.id, adminId));
		expect(rows[0]?.banned).not.toBe(true);
	});

	test("cannot impersonate", async () => {
		const response = await adminRequest(
			"/admin/impersonate-user",
			moderatorHeaders,
			{ userId: employeeId },
		);
		expect(response.status).toBe(403);
	});
});

describe("role boundaries", () => {
	test("regular users get no operator access", async () => {
		const list = await adminRequest("/admin/list-users?limit=1", plainHeaders);
		expect(list.status).toBe(403);
		const ban = await adminRequest("/admin/ban-user", plainHeaders, {
			userId: employeeId,
		});
		expect(ban.status).toBe(403);
	});

	test("admins retain delete", async () => {
		const disposable = await provision(
			"Disposable",
			`disposable-${runId}@example.com`,
			"user",
		);
		const removed = await adminRequest("/admin/remove-user", adminHeaders, {
			userId: disposable.id,
		});
		expect(removed.status).toBe(200);
		const gone = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.id, disposable.id));
		expect(gone).toHaveLength(0);
	});
});

describe("ban enforcement across the OAuth surface", () => {
	test("pre-ban refresh tokens and auth codes stop minting after ban", async () => {
		const worker = await provision(
			"OAuth Employee",
			`oauth-employee-${runId}@example.com`,
			"user",
		);
		const verifier = `role-suite-verifier-${runId}-aaaaaaaaaaaaaaaaaaaaaaaa`;
		const code = await authorizeCode(worker.headers, verifier);
		const issued = await tokenRequest({
			grant_type: "authorization_code",
			code,
			redirect_uri: callback,
			code_verifier: verifier,
			resource: issuer,
		});
		expect(issued.status).toBe(200);
		const tokens = (await issued.json()) as { refresh_token?: string };
		expect(tokens.refresh_token).toBeTruthy();

		// Pre-ban, refresh works and rotates.
		const refreshed = await tokenRequest({
			grant_type: "refresh_token",
			refresh_token: tokens.refresh_token as string,
		});
		expect(refreshed.status).toBe(200);
		const rotated = (await refreshed.json()) as { refresh_token?: string };
		expect(rotated.refresh_token).toBeTruthy();

		// A still-valid pre-ban authorization code (60s TTL).
		const verifier2 = `${verifier}-second`;
		const preBanCode = await authorizeCode(worker.headers, verifier2);

		const banned = await adminRequest("/admin/ban-user", moderatorHeaders, {
			userId: worker.id,
			banReason: "offboarded",
		});
		expect(banned.status).toBe(200);

		// The refresh grant never consults `banned` upstream; the ban hook must
		// have revoked every refresh token.
		const postBanRefresh = await tokenRequest({
			grant_type: "refresh_token",
			refresh_token: rotated.refresh_token as string,
		});
		expect(postBanRefresh.status).toBe(400);

		// The pre-ban code cannot be exchanged either (token-response guard /
		// session teardown).
		const postBanCode = await tokenRequest({
			grant_type: "authorization_code",
			code: preBanCode,
			redirect_uri: callback,
			code_verifier: verifier2,
			resource: issuer,
		});
		expect(postBanCode.status).toBe(400);

		const liveRefresh = await db
			.select({ id: oauthRefreshToken.id })
			.from(oauthRefreshToken)
			.where(
				and(
					eq(oauthRefreshToken.userId, worker.id),
					isNull(oauthRefreshToken.revoked),
				),
			);
		expect(liveRefresh).toHaveLength(0);
	});

	test("token guard rejects issuance for a banned user even without revocation", async () => {
		const drifted = await provision(
			"Drifted Ban",
			`drifted-${runId}@example.com`,
			"user",
		);
		const verifier = `drift-verifier-${runId}-cccccccccccccccccccccccc`;
		const code = await authorizeCode(drifted.headers, verifier);
		const issued = await tokenRequest({
			grant_type: "authorization_code",
			code,
			redirect_uri: callback,
			code_verifier: verifier,
			resource: issuer,
		});
		expect(issued.status).toBe(200);
		const tokens = (await issued.json()) as { refresh_token?: string };
		expect(tokens.refresh_token).toBeTruthy();

		// Simulate ban-state drift: banned flag set directly with tokens and
		// sessions left alive. Upstream grants ignore `banned`, so only the
		// token-response guard stands between this state and fresh tokens.
		await db.update(user).set({ banned: true }).where(eq(user.id, drifted.id));

		// Refresh WITHOUT a resource parameter issues an OPAQUE access token —
		// exercises the guard's database-lookup branch.
		const opaqueRefresh = await tokenRequest({
			grant_type: "refresh_token",
			refresh_token: tokens.refresh_token as string,
		});
		expect(opaqueRefresh.status).toBe(400);
		const opaqueBody = (await opaqueRefresh.json()) as { error?: string };
		expect(opaqueBody.error).toBe("invalid_grant");

		// A fresh code exchange WITH a resource issues a JWT — exercises the
		// guard's sub-claim branch. The pre-ban session still exists because
		// drift bypassed the ban endpoint's session teardown.
		const verifier2 = `${verifier}-jwt`;
		const jwtCode = await authorizeCode(drifted.headers, verifier2);
		const jwtExchange = await tokenRequest({
			grant_type: "authorization_code",
			code: jwtCode,
			redirect_uri: callback,
			code_verifier: verifier2,
			resource: issuer,
		});
		expect(jwtExchange.status).toBe(400);
		const jwtBody = (await jwtExchange.json()) as { error?: string };
		expect(jwtBody.error).toBe("invalid_grant");
	});

	test("banning mid-2FA challenge blocks completion with a valid TOTP", async () => {
		const email = `twofa-race-${runId}@example.com`;
		await auth.api.signUpEmail({
			body: { name: "TwoFA Race", email, password },
		});
		const rows = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, email));
		const targetId = rows[0]?.id as string;
		await db
			.update(user)
			.set({ emailVerified: true })
			.where(eq(user.id, targetId));
		const signedIn = await auth.api.signInEmail({
			body: { email, password },
			returnHeaders: true,
		});
		const sessionHeaders = cookieHeaders(signedIn.headers);
		const setup = await auth.api.enableTwoFactor({
			headers: sessionHeaders,
			body: { password },
		});
		const encodedSecret = new URL(setup.totpURI).searchParams.get("secret");
		const secret = decodeBase32Secret(encodedSecret as string);
		await auth.api.verifyTOTP({
			headers: sessionHeaders,
			body: { code: await currentTotpCode(secret) },
		});
		await db.delete(session).where(eq(session.userId, targetId));

		// Password step succeeds -> pending 2FA challenge.
		const challenge = await auth.api.signInEmail({
			body: { email, password },
			returnHeaders: true,
		});
		expect(challenge.response?.twoFactorRedirect).toBe(true);
		const challengeHeaders = cookieHeaders(challenge.headers);

		const banned = await adminRequest("/admin/ban-user", moderatorHeaders, {
			userId: targetId,
			banReason: "banned mid-challenge",
		});
		expect(banned.status).toBe(200);

		// A VALID TOTP after the ban must not mint a session.
		const completion = await auth.handler(
			new Request(`${issuer}/two-factor/verify-totp`, {
				method: "POST",
				headers: new Headers({
					cookie: challengeHeaders.get("cookie") ?? "",
					"content-type": "application/json",
				}),
				body: JSON.stringify({ code: await currentTotpCode(secret) }),
			}),
		);
		expect(completion.status).toBe(403);
		const sessions = await db
			.select({ id: session.id })
			.from(session)
			.where(eq(session.userId, targetId));
		expect(sessions).toHaveLength(0);
	});
});
