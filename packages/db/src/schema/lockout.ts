import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Failed-login tracking for temporary account lockout (anomaly visibility).
 * One row per email; reset on successful sign-in.
 */
export const loginAttempt = pgTable("login_attempt", {
	email: text("email").primaryKey(),
	failedCount: integer("failed_count").default(0).notNull(),
	lockedUntil: timestamp("locked_until"),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
