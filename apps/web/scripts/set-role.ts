/**
 * Assigns an operator role to an existing account (operator CLI; runs with
 * direct database access like seed:admin — no HTTP surface exposes this):
 *
 *   bun run set-role <email> <admin|moderator|user>
 *
 * Roles:
 * - admin: full operator, including account deletion and role assignment.
 * - moderator: HR-style account lifecycle — create/list/update accounts and
 *   ban/unban sign-in access. CANNOT delete accounts, change roles/emails/
 *   passwords, impersonate, or touch admin accounts (see
 *   packages/auth/src/permissions.ts and the admin-target guard).
 * - user: no operator permissions.
 *
 * Demoting the last admin is refused: role management would become
 * unreachable except through direct database access.
 */
import {
	ASSIGNABLE_ROLES,
	type OperatorRole,
} from "@krazil-idp/auth/permissions";
import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { and, eq, ne } from "drizzle-orm";

const [email, role] = process.argv.slice(2);
if (!email || !role) {
	console.error(
		`Usage: bun run set-role <email> <${ASSIGNABLE_ROLES.join("|")}>`,
	);
	process.exit(1);
}
if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
	console.error(
		`Unknown role "${role}". Assignable roles: ${ASSIGNABLE_ROLES.join(", ")}`,
	);
	process.exit(1);
}
const nextRole = role as OperatorRole;

const rows = await db
	.select({ id: user.id, role: user.role })
	.from(user)
	.where(eq(user.email, email.toLowerCase()));
const target = rows[0];
if (!target) {
	console.error(`No account exists for ${email}. Create it first.`);
	process.exit(1);
}
if (target.role === nextRole) {
	console.log(`${email} already has role ${nextRole}.`);
	process.exit(0);
}

if (target.role === "admin" && nextRole !== "admin") {
	const otherAdmins = await db
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.role, "admin"), ne(user.id, target.id)))
		.limit(1);
	if (otherAdmins.length === 0) {
		console.error(
			`REFUSING: ${email} is the last admin. Promote another admin first.`,
		);
		process.exit(1);
	}
}

await db.update(user).set({ role: nextRole }).where(eq(user.id, target.id));
console.log(
	JSON.stringify({
		audit: true,
		event: "role.assigned",
		at: new Date().toISOString(),
		email,
		from: target.role,
		to: nextRole,
	}),
);
if (nextRole === "admin") {
	console.log(
		"Reminder: OAuth client management additionally requires OAUTH_ADMIN_EMAILS membership.",
	);
}
process.exit(0);
