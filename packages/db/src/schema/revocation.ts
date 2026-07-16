import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Individual JWT ids revoked before their signed expiration. */
export const revokedToken = pgTable(
	"revoked_token",
	{
		jti: text("jti").primaryKey(),
		expiresAt: timestamp("expires_at").notNull(),
		revokedAt: timestamp("revoked_at").defaultNow().notNull(),
		clientId: text("client_id"),
	},
	(table) => [index("revoked_token_expiresAt_idx").on(table.expiresAt)],
);
