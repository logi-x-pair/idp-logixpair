import { describe, expect, test } from "bun:test";

import {
	isAccessTokenMode,
	isUserAccessToken,
	parseAccessTokenClaims,
	parseIdTokenClaims,
	parseUserInfo,
	revocationIdentity,
} from "../src/index";

const userToken = {
	iss: "http://localhost:3000/api/auth",
	azp: "client-1",
	scope: "openid profile email offline_access",
	jti: "8f14e45f-ea3c-4b6d-9c3f-2d1a5b0c7e9a",
	iat: 1_700_000_000,
	exp: 1_700_003_600,
	aud: "http://localhost:3000/api/auth",
	sub: "user-1",
	sid: "session-1",
};

const machineToken = {
	iss: "http://localhost:3000/api/auth",
	azp: "client-m2m",
	scope: "read:example",
	jti: "6d3b9f2a-1c4e-4f8b-a7d0-5e2c8b9f1a3d",
	iat: 1_700_000_000,
	exp: 1_700_003_600,
};

describe("parseAccessTokenClaims", () => {
	test("accepts a session-issued user token and narrows to the user variant", () => {
		const claims = parseAccessTokenClaims(userToken);
		expect(isUserAccessToken(claims)).toBe(true);
		expect(claims.sub).toBe("user-1");
		expect(claims.sid).toBe("session-1");
	});

	test("accepts a client_credentials token without sub or sid", () => {
		const claims = parseAccessTokenClaims(machineToken);
		expect(isUserAccessToken(claims)).toBe(false);
		expect(claims.azp).toBe("client-m2m");
	});

	test("accepts a refresh-issued user token without sid", () => {
		const { sid: _sid, ...withoutSid } = userToken;
		const claims = parseAccessTokenClaims(withoutSid);
		expect(isUserAccessToken(claims)).toBe(true);
	});

	test("rejects sid without sub", () => {
		const { sub: _sub, ...sidOnly } = userToken;
		expect(() => parseAccessTokenClaims(sidOnly)).toThrow(
			'"sid" without "sub"',
		);
	});

	test.each(["iss", "azp", "scope", "jti"] as const)(
		"rejects a missing %s claim",
		(claim) => {
			const { [claim]: _dropped, ...rest } = userToken;
			expect(() => parseAccessTokenClaims(rest)).toThrow(`"${claim}"`);
		},
	);

	test("rejects a non-string aud", () => {
		expect(() => parseAccessTokenClaims({ ...userToken, aud: 42 })).toThrow(
			'"aud"',
		);
	});

	test("rejects non-object payloads", () => {
		expect(() => parseAccessTokenClaims(null)).toThrow("claims object");
		expect(() => parseAccessTokenClaims([userToken])).toThrow("claims object");
	});
});

describe("revocationIdentity", () => {
	test("maps a user token to sid+sub+jti", () => {
		expect(revocationIdentity(parseAccessTokenClaims(userToken))).toEqual({
			sid: "session-1",
			sub: "user-1",
			jti: userToken.jti,
		});
	});

	test("maps a machine token to azp+jti", () => {
		expect(revocationIdentity(parseAccessTokenClaims(machineToken))).toEqual({
			azp: "client-m2m",
			jti: machineToken.jti,
		});
	});

	test("fails closed on a user token without sid", () => {
		const { sid: _sid, ...withoutSid } = userToken;
		expect(() =>
			revocationIdentity(parseAccessTokenClaims(withoutSid)),
		).toThrow("refusing revocation-status check");
	});
});

const idToken = {
	iss: "http://localhost:3000/api/auth",
	sub: "user-1",
	aud: "client-1",
	iat: 1_700_000_000,
	exp: 1_700_003_600,
	nonce: "n-1",
	auth_time: 1_699_999_000,
	name: "Ada Lovelace",
	email: "ada@example.com",
	email_verified: true,
};

describe("parseIdTokenClaims", () => {
	test("accepts a full ID token", () => {
		expect(parseIdTokenClaims(idToken).email).toBe("ada@example.com");
	});

	test("accepts scope-gated claims being absent", () => {
		const { name: _n, email: _e, email_verified: _v, ...minimal } = idToken;
		expect(parseIdTokenClaims(minimal).sub).toBe("user-1");
	});

	test.each([
		["email", 42],
		["email_verified", "yes"],
		["auth_time", "then"],
		["nonce", 7],
		["given_name", false],
	] as const)("rejects malformed optional claim %s", (claim, value) => {
		expect(() => parseIdTokenClaims({ ...idToken, [claim]: value })).toThrow(
			`"${claim}"`,
		);
	});
});

describe("parseUserInfo", () => {
	test("accepts sub plus scope-gated claims", () => {
		const info = parseUserInfo({ sub: "user-1", email: "ada@example.com" });
		expect(info.email).toBe("ada@example.com");
	});

	test("rejects a missing sub", () => {
		expect(() => parseUserInfo({ email: "ada@example.com" })).toThrow('"sub"');
	});

	test.each([
		["email", 42],
		["email_verified", 1],
		["picture", {}],
	] as const)("rejects malformed optional claim %s", (claim, value) => {
		expect(() => parseUserInfo({ sub: "user-1", [claim]: value })).toThrow(
			`"${claim}"`,
		);
	});
});

describe("isAccessTokenMode", () => {
	test.each(["short-lived", "hybrid", "immediate"])("accepts %s", (mode) => {
		expect(isAccessTokenMode(mode)).toBe(true);
	});

	test("rejects unknown modes", () => {
		expect(isAccessTokenMode("eventual")).toBe(false);
		expect(isAccessTokenMode(undefined)).toBe(false);
	});
});
