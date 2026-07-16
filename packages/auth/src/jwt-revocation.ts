import { db } from "@krazil-idp/db";
import { jwks } from "@krazil-idp/db/schema/auth";
import { revokedToken } from "@krazil-idp/db/schema/revocation";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { eq, lt } from "drizzle-orm";

import { TOKEN_LIFETIMES } from "./token-config";

const jwksCacheKey = {};
const DEFAULT_JWKS_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

const EXPECTED_REVOCATION_ERROR_NAMES: Record<string, true> = {
	JOSEAlgNotAllowed: true,
	JOSENotSupported: true,
	JWSInvalid: true,
	JWSSignatureVerificationFailed: true,
	JWKSNoMatchingKey: true,
	JWTClaimValidationFailed: true,
	JWTExpired: true,
	JWTInvalid: true,
	RevocationValidationError: true,
};

class RevocationValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RevocationValidationError";
	}
}

export function isExpectedRevocationValidationError(error: unknown): boolean {
	return (
		error instanceof TypeError ||
		(error instanceof Error &&
			EXPECTED_REVOCATION_ERROR_NAMES[error.name] === true)
	);
}

export interface VerifiedRevocableToken {
	jti: string;
	exp: number;
	azp: string;
}

async function localJwks() {
	const rows = await db
		.select({
			id: jwks.id,
			publicKey: jwks.publicKey,
			expiresAt: jwks.expiresAt,
		})
		.from(jwks);
	const now = Date.now();
	return {
		keys: rows
			.filter(
				(row) =>
					!row.expiresAt ||
					row.expiresAt.getTime() + DEFAULT_JWKS_GRACE_PERIOD_MS > now,
			)
			.map((row) => ({
				alg: "EdDSA",
				...(JSON.parse(row.publicKey) as Record<string, unknown>),
				kid: row.id,
			})),
	};
}

export async function verifyRevocableAccessToken(input: {
	token: string;
	issuer: string;
	audience: string | string[];
	expectedClientId?: string;
}): Promise<VerifiedRevocableToken> {
	const token = input.token.startsWith("Bearer ")
		? input.token.slice("Bearer ".length)
		: input.token;
	const payload = await verifyJwsAccessToken(token, {
		jwksFetch: localJwks,
		jwksCacheKey,
		verifyOptions: { issuer: input.issuer, audience: input.audience },
	});
	if (
		typeof payload.jti !== "string" ||
		payload.jti.length === 0 ||
		typeof payload.exp !== "number" ||
		typeof payload.azp !== "string" ||
		payload.exp <= Math.floor(Date.now() / 1000)
	) {
		throw new RevocationValidationError(
			"JWT is missing revocable access-token claims",
		);
	}
	if (input.expectedClientId && payload.azp !== input.expectedClientId) {
		throw new RevocationValidationError(
			"JWT was issued to a different OAuth client",
		);
	}
	return { jti: payload.jti, exp: payload.exp, azp: payload.azp };
}

export async function denylistVerifiedAccessToken(
	claims: VerifiedRevocableToken,
): Promise<void> {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const cappedExpiration = Math.min(
		claims.exp,
		nowSeconds + TOKEN_LIFETIMES.accessTokenSeconds + 60,
	);
	await db
		.insert(revokedToken)
		.values({
			jti: claims.jti,
			expiresAt: new Date(cappedExpiration * 1000),
			clientId: claims.azp,
		})
		.onConflictDoNothing();
	await db.delete(revokedToken).where(lt(revokedToken.expiresAt, new Date()));
}

export async function isAccessTokenDenylisted(jti: string): Promise<boolean> {
	const rows = await db
		.select({ jti: revokedToken.jti })
		.from(revokedToken)
		.where(eq(revokedToken.jti, jti));
	return rows.length > 0;
}
