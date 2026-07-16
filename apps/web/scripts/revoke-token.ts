import {
	denylistVerifiedAccessToken,
	verifyRevocableAccessToken,
} from "@krazil-idp/auth/jwt-revocation";
import { env } from "@krazil-idp/env/server";

const token = process.argv[2];
if (!token) {
	console.error("Usage: bun run revoke-token <jwt-access-token>");
	process.exit(1);
}

const issuerUrl = new URL(env.BETTER_AUTH_URL);
issuerUrl.pathname = `${issuerUrl.pathname.replace(/\/$/, "")}/api/auth`;
const issuer = issuerUrl.toString().replace(/\/$/, "");
const audience = env.OAUTH_VALID_AUDIENCES
	? env.OAUTH_VALID_AUDIENCES.split(",")
			.map((value) => value.trim())
			.filter(Boolean)
	: issuer;

try {
	const claims = await verifyRevocableAccessToken({
		token,
		issuer,
		audience,
	});
	await denylistVerifiedAccessToken(claims);
	console.log(
		JSON.stringify({
			audit: true,
			event: "token.denylisted",
			at: new Date().toISOString(),
			jti: claims.jti,
			expiresAt: new Date(claims.exp * 1000).toISOString(),
			clientId: claims.azp,
		}),
	);
	console.log(
		"Introspection and hybrid/immediate status checks now reject this JWT. Short-lived local-only verification honors it until exp.",
	);
} catch (error) {
	console.error(
		`Refusing to denylist token: ${error instanceof Error ? error.message : error}`,
	);
	process.exit(1);
}
