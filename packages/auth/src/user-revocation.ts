import { db } from "@krazil-idp/db";
import {
	oauthAccessToken,
	oauthRefreshToken,
	session,
} from "@krazil-idp/db/schema/auth";
import { eq } from "drizzle-orm";

export interface UserTokenRevocation {
	refreshTokensRevoked: number;
	opaqueAccessTokensDeleted: number;
	sessionsDeleted: number;
}

/**
 * Kill switch for one user's entire token surface: revokes every OAuth
 * refresh token, deletes opaque access tokens, and deletes sessions in one
 * transaction. Used by the incident CLI (revoke-user) and automatically when
 * an operator bans an account (guards.ts banEnforcementPlugin) — the Better
 * Auth admin plugin only deletes sessions on ban, which would leave OAuth
 * refresh grants minting new tokens for a banned user.
 *
 * Already-issued JWT access tokens are NOT enumerated here; they stay valid
 * until `exp` for RPs that only verify locally. Hybrid/immediate status
 * checks reject them immediately because the sessions are gone.
 */
export async function revokeUserTokens(
	userId: string,
): Promise<UserTokenRevocation> {
	return db.transaction(async (tx) => {
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
}
