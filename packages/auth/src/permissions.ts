import { createAccessControl } from "better-auth/plugins/access";
import {
	adminAc,
	defaultStatements,
	userAc,
} from "better-auth/plugins/admin/access";
import {
	adminAc as organizationAdminAc,
	defaultStatements as organizationDefaultStatements,
	memberAc as organizationMemberAc,
} from "better-auth/plugins/organization/access";

/**
 * Operator access control for the admin plugin. Three roles:
 *
 * - `admin`: full operator. The only role that may delete accounts, change
 *   roles/emails/passwords, manage sessions, or impersonate. OAuth client
 *   management additionally requires OAUTH_ADMIN_EMAILS membership (see
 *   index.ts).
 * - `moderator`: account lifecycle WITHOUT destructive or escalating rights.
 *   Built for HR-style operators: create accounts, list/read, update profile
 *   fields (allowlisted in guards.ts — name/image only), and enable/disable
 *   sign-in via ban/unban. Banning also revokes the user's sessions, OAuth
 *   refresh tokens, and opaque access tokens (guards.ts
 *   banEnforcementPlugin).
 * - `user`: no operator permissions (plugin default).
 *
 * Deliberately excluded from `moderator` — each exclusion is a deployment
 * policy choice; adjust this list to your org's needs, but understand what
 * each grant re-opens:
 *   - `delete`             — account deletion stays admin-only. Grant it only
 *                            if HR truly owns offboarding data destruction;
 *                            ban already removes all access and is reversible.
 *   - `set-role`           — would let moderators promote themselves/peers.
 *   - `set-password`,
 *     `set-email`          — account-takeover vectors; password changes
 *                            belong to the email reset flow.
 *   - `impersonate`        — session takeover is admin-only.
 *   - `session` statements — ban covers access removal; direct session
 *                            list/revoke would let moderators target admin
 *                            sessions (the target guard only covers
 *                            ban/update/remove routes).
 *
 * Guard invariants (guards.ts adminTargetGuardPlugin): non-admin operators
 * can never ban, ban-edit, or remove an account holding the admin role, and
 * their update-user requests are restricted to a field allowlist.
 */
export const ac = createAccessControl(defaultStatements);

export const roles = {
	admin: ac.newRole(adminAc.statements),
	moderator: ac.newRole({
		user: ["create", "list", "get", "update", "ban"],
	}),
	hr_user: ac.newRole({
		user: ["create", "list", "get", "update"],
	}),
	user: ac.newRole(userAc.statements),
};

/**
 * Organization permissions are separate from platform account permissions.
 * Start from Better Auth's complete statement set so adding custom roles does
 * not silently remove required organization/member/invitation actions.
 */
export const organizationAc = createAccessControl(organizationDefaultStatements);

export const organizationRoles = {
	admin: organizationAc.newRole(organizationAdminAc.statements),
	// Member role changes, invitations, and profile fields are service-owned;
	// Better Auth's generic member.update cannot express the display allowlist.
	moderator: organizationAc.newRole({
		member: ["delete"],
		invitation: [],
		team: [],
		ac: ["read"],
	}),
	user: organizationAc.newRole(organizationMemberAc.statements),
};

export const ORGANIZATION_ROLES = ["admin", "moderator", "user"] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** Roles assignable through the set-role operator CLI. */
export const ASSIGNABLE_ROLES = ["admin", "moderator", "hr_user", "user"] as const;

export type OperatorRole = (typeof ASSIGNABLE_ROLES)[number];
