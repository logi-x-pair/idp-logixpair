import { APIError } from "better-auth";
import type { OrganizationOptions } from "better-auth/plugins";

import type { AdminAuditMetadata, AdminAuditReasonCode } from "./admin-audit";
import type { OrganizationRole } from "./permissions";

const ORGANIZATION_ROLE_LOOKUP: Record<string, true> = {
	admin: true,
	moderator: true,
	user: true,
};
const organizationSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ORGANIZATION_STATUSES = [
	"active",
	"suspended",
	"archived",
] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export type OrganizationPolicyErrorCode =
	| "POLICY_DENIED"
	| "NOT_FOUND"
	| "CONFLICT"
	| "LAST_ADMIN_PROTECTED"
	| "INVALID_INPUT";

export class OrganizationPolicyError extends Error {
	readonly code: OrganizationPolicyErrorCode;

	constructor(code: OrganizationPolicyErrorCode, message: string) {
		super(message);
		this.name = "OrganizationPolicyError";
		this.code = code;
	}
}

export interface OrganizationPolicyContext {
	organizationId: string;
	actorUserId: string;
	requestId: string;
	ipAddress?: string;
}

export interface ChangeOrganizationMemberRoleInput
	extends OrganizationPolicyContext {
	targetUserId: string;
	expectedCurrentRole: OrganizationRole;
	requestedRole: OrganizationRole;
}

export interface RemoveOrganizationMemberInput
	extends OrganizationPolicyContext {
	targetUserId: string;
	expectedCurrentRole: OrganizationRole;
}

export interface OrganizationMemberMutation {
	id: string;
	userId: string;
	organizationId: string;
	role: OrganizationRole;
}

export interface LockedOrganizationUser {
	id: string;
	role: string;
	banned: boolean | null;
}

export interface LockedOrganizationMember {
	id: string;
	userId: string;
	organizationId: string;
	role: string;
}

export interface LockedOrganizationMutationContext {
	organizationExists: boolean;
	organizationStatus?: string;
	actorUser?: LockedOrganizationUser;
	targetUser?: LockedOrganizationUser;
	actorMember?: LockedOrganizationMember;
	targetMember?: LockedOrganizationMember;
}

export interface OrganizationPolicyDenial {
	code: OrganizationPolicyErrorCode;
	message: string;
	metadata?: AdminAuditMetadata;
}

export function validateOrganizationPolicyContext(
	input: OrganizationPolicyContext,
): void {
	if (!input.organizationId || !input.actorUserId) {
		throw new OrganizationPolicyError(
			"INVALID_INPUT",
			"Organization and actor identifiers are required",
		);
	}
	if (!input.requestId || input.requestId.length > 128) {
		throw new OrganizationPolicyError(
			"INVALID_INPUT",
			"Organization policy request ID is invalid",
		);
	}
}

export function validateOrganizationPolicyRole(
	value: string,
): OrganizationRole {
	if (ORGANIZATION_ROLE_LOOKUP[value] !== true) {
		throw new OrganizationPolicyError(
			"INVALID_INPUT",
			`Unsupported organization role: ${value}`,
		);
	}
	return value as OrganizationRole;
}

export function parseStoredOrganizationRoles(
	value: string,
): OrganizationRole[] {
	const roles = value
		.split(",")
		.map((role) => role.trim())
		.filter(Boolean);
	if (roles.length === 0 || new Set(roles).size !== roles.length) {
		throw new OrganizationPolicyError(
			"INVALID_INPUT",
			"Stored organization roles are invalid",
		);
	}
	return roles.map(validateOrganizationPolicyRole);
}

export function organizationMemberHasRole(
	memberRecord: LockedOrganizationMember,
	role: OrganizationRole,
): boolean {
	return parseStoredOrganizationRoles(memberRecord.role).includes(role);
}

export function organizationPolicyReasonCode(
	code: OrganizationPolicyErrorCode,
): AdminAuditReasonCode {
	if (code === "POLICY_DENIED") return "policy_denied";
	if (code === "NOT_FOUND") return "not_found";
	if (code === "CONFLICT") return "conflict";
	if (code === "LAST_ADMIN_PROTECTED") return "last_admin_protected";
	return "invalid_input";
}

function badRequest(message: string): never {
	throw new APIError("BAD_REQUEST", { message });
}

function forbidden(message: string): never {
	throw new APIError("FORBIDDEN", { message });
}

export function parseOrganizationRoles(value: string): OrganizationRole[] {
	const roles = value
		.split(",")
		.map((role) => role.trim())
		.filter(Boolean);
	if (roles.length === 0 || new Set(roles).size !== roles.length) {
		return badRequest("Organization roles must be non-empty and unique");
	}
	for (const role of roles) {
		if (ORGANIZATION_ROLE_LOOKUP[role] !== true) {
			return badRequest(`Unsupported organization role: ${role}`);
		}
	}
	return roles as OrganizationRole[];
}

function validateOrganizationIdentity(
	name: string | undefined,
	slug: string | undefined,
): void {
	if (name !== undefined && (name.trim().length === 0 || name.length > 120)) {
		badRequest("Organization name must contain 1 to 120 characters");
	}
	if (
		slug !== undefined &&
		(slug.length > 63 || !organizationSlug.test(slug))
	) {
		badRequest("Organization slug must be a lowercase DNS label");
	}
}

function assertOrdinaryMember(role: string): void {
	const roles = parseOrganizationRoles(role);
	if (roles.includes("admin") || roles.includes("moderator")) {
		forbidden("Protected organization roles require the policy service");
	}
}

/**
 * Defense-in-depth validation for Better Auth's organization plugin. These are
 * deliberately before-hooks only: they validate inputs, but never claim audit
 * atomicity. Privileged writes use the transaction-owning policy services.
 */
export const organizationHooks: NonNullable<
	OrganizationOptions["organizationHooks"]
> = {
	beforeCreateOrganization: async ({ organization }) => {
		validateOrganizationIdentity(organization.name, organization.slug);
	},
	beforeUpdateOrganization: async ({ organization }) => {
		validateOrganizationIdentity(organization.name, organization.slug);
	},
	beforeDeleteOrganization: async () => {
		forbidden("Organizations are archived, not deleted");
	},
	beforeAddMember: async ({ member }) => {
		parseOrganizationRoles(member.role);
	},
	beforeRemoveMember: async ({ member }) => {
		assertOrdinaryMember(member.role);
	},
	beforeUpdateMemberRole: async ({ member, newRole }) => {
		assertOrdinaryMember(member.role);
		parseOrganizationRoles(newRole);
	},
	beforeCreateInvitation: async ({ invitation }) => {
		parseOrganizationRoles(invitation.role);
	},
	beforeAcceptInvitation: async ({ invitation }) => {
		if (invitation.role) parseOrganizationRoles(invitation.role);
	},
};
