/**
 * Incident kill-switch: revokes all of a user's refresh tokens, opaque access
 * tokens, and sessions — cutting off new token issuance instantly.
 *
 *   bun run revoke-user <email>
 *
 * What dies immediately:
 *   - new authorization flows (sessions deleted)
 *   - refresh grants (refresh tokens revoked; introspection reports inactive)
 *   - opaque access tokens (rows deleted; introspection reports inactive)
 *
 * This command does not enumerate already-issued JWTs. For one known JWT, use
 * `bun run revoke-token <jwt_access_token>`; that verified `jti` is enforced by
 * introspection and the private status endpoint. Raw local JWKS verification
 * remains valid until the JWT expires. Signing-key rotation invalidates every
 * outstanding JWT and is the emergency global fallback.
 */
import { revokeUserTokens } from "@krazil-idp/auth/user-revocation";
import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { eq } from "drizzle-orm";

const email = process.argv[2];
if (!email) {
	console.error("Usage: bun run revoke-user <email>");
	process.exit(1);
}

const users = await db
	.select({ id: user.id })
	.from(user)
	.where(eq(user.email, email));
if (users.length === 0) {
	console.error(`No user with email ${email}`);
	process.exit(1);
}
const userId = users[0].id;

const revocation = await revokeUserTokens(userId);

console.log(
	JSON.stringify({
		audit: true,
		event: "user.tokens_revoked",
		at: new Date().toISOString(),
		userId,
		email,
		refreshTokensRevoked: revocation.refreshTokensRevoked,
		opaqueAccessTokensDeleted: revocation.opaqueAccessTokensDeleted,
		sessionsDeleted: revocation.sessionsDeleted,
	}),
);
console.log(
	"Done. Status-aware hybrid/immediate resources reject deleted-session user tokens; use revoke-token for a known JWT and jti-specific status/introspection revocation.",
);
process.exit(0);
