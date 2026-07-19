import { createAccessControl } from "better-auth/plugins/access";
import {
	adminAc,
	defaultStatements,
	userAc,
} from "better-auth/plugins/admin/access";

/**
 * Operator access control for the admin plugin. Three roles:
 *
 * - `admin`: full operator. The only role that may delete accounts, change
 *   roles/emails/passwords, or impersonate. OAuth client management
 *   additionally requires OAUTH_ADMIN_EMAILS membership (see index.ts).
 * - `moderator`: account lifecycle WITHOUT destructive or escalating rights.
 *   Built for HR-style operators: create accounts, list/read, update profile
 *   fields, and enable/disable sign-in via ban/unban (`ban` covers both).
 *   Deliberately excluded:
 *     - `delete`          — account deletion is admin-only by requirement
 *     - `set-role`        — prevents self/peer privilege escalation
 *     - `set-password`,
 *       `set-email`       — account-takeover vectors; use the email reset flow
 *     - `impersonate`     — session takeover is admin-only
 * - `user`: no operator permissions (plugin default).
 *
 * Guard invariant (guards.ts adminTargetGuardPlugin): non-admin operators can
 * never ban, ban-edit, or delete an account that holds the admin role.
 */
export const ac = createAccessControl(defaultStatements);

export const roles = {
	admin: ac.newRole(adminAc.statements),
	moderator: ac.newRole({
		user: ["create", "list", "get", "update", "ban"],
		session: ["list", "revoke"],
	}),
	user: ac.newRole(userAc.statements),
};

/** Roles assignable through the set-role operator CLI. */
export const ASSIGNABLE_ROLES = ["admin", "moderator", "user"] as const;

export type OperatorRole = (typeof ASSIGNABLE_ROLES)[number];
