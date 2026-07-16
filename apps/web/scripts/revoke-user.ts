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
 * Residual exposure depends on the resource-server mode:
 *   - short-lived/local verification: authorization-code JWTs remain usable
 *     until their 10-minute TTL (machine tokens retain their 1-hour TTL).
 *   - hybrid/immediate status-aware resources reject deleted-session user JWTs
 *     at the next status check; raw JWKS verification and OAuth introspection
 *     still report a JWT as valid until expiry in OAuth Provider 1.6.23.
 * If an individual JWT must die sooner than its TTL, use a token denylist or
 * signing-key rotation (which invalidates ALL outstanding tokens). See
 * INTEGRATION.md and RUNBOOK.md.
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

const revocation = await db.transaction(async (tx) => {
	const revokedRefresh = await tx
		.update(oauthRefreshToken)
		.set({ revoked: new Date() })
		.where(eq(oauthRefreshToken.userId, userId))
		.returning({ id: oauthRefreshToken.id });
	const deletedAccess = await tx
		.delete(oauthAccessToken)
		.where(eq(oauthAccessToken.userId, userId))
		.returning({ id: oauthAccessToken.id });
	const deletedSessions = await tx
		.delete(session)
		.where(eq(session.userId, userId))
		.returning({ id: session.id });
	return {
		refreshTokensRevoked: revokedRefresh.length,
		opaqueAccessTokensDeleted: deletedAccess.length,
		sessionsDeleted: deletedSessions.length,
	};
});

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
	"Done. Status-aware hybrid/immediate resources reject deleted-session user tokens; local-only JWT checks remain valid until TTL. Individual JWT revocation requires a denylist or key rotation.",
);
process.exit(0);
