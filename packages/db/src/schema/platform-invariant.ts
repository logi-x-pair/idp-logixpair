import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Singleton row locked while platform-admin invariants are evaluated. */
export const platformRoleInvariant = pgTable("platform_role_invariant", {
	id: text("id").primaryKey(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});
