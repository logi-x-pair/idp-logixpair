/**
 * Incident kill-switch: revokes ALL of a user's refresh tokens, opaque access
 * tokens, and sessions — cutting off new token issuance instantly.
 *
 *   bun run revoke-user <email>
 *
 * What dies immediately:
 *   - new authorization flows (sessions deleted)
 *   - refresh grants (refresh tokens revoked; introspection reports inactive)
 *   - opaque access tokens (rows deleted; introspection reports inactive)
 *
 * Residual exposure (JWTs cannot be un-issued): already-issued JWT access
 * tokens stay valid until their TTL (max 1h; shorter for scopes listed in
 * scopeExpirations) — BOTH for local JWKS verification AND for
 * /oauth2/introspect in this plugin version, which only drops the `sid`
 * claim when the backing session is gone. If a JWT must die sooner than its
 * TTL, the only lever is signing-key rotation (invalidates ALL outstanding
 * tokens — RUNBOOK.md incident procedure). See INTEGRATION.md for the
 * resource-server guidance.
 */
import { db } from "@krazil-idp/db";
import {
	oauthAccessToken,
	oauthRefreshToken,
	session,
	user,
} from "@krazil-idp/db/schema/auth";
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

const revokedRefresh = await db
	.update(oauthRefreshToken)
	.set({ revoked: new Date() })
	.where(eq(oauthRefreshToken.userId, userId))
	.returning({ id: oauthRefreshToken.id });
const deletedAccess = await db
	.delete(oauthAccessToken)
	.where(eq(oauthAccessToken.userId, userId))
	.returning({ id: oauthAccessToken.id });
const deletedSessions = await db
	.delete(session)
	.where(eq(session.userId, userId))
	.returning({ id: session.id });

console.log(
	JSON.stringify({
		audit: true,
		event: "user.tokens_revoked",
		at: new Date().toISOString(),
		userId,
		email,
		refreshTokensRevoked: revokedRefresh.length,
		opaqueAccessTokensDeleted: deletedAccess.length,
		sessionsDeleted: deletedSessions.length,
	}),
);
console.log(
	"Done. Already-issued JWT access tokens remain valid until their TTL (max 1h); key rotation is the only earlier kill (RUNBOOK.md).",
);
process.exit(0);
