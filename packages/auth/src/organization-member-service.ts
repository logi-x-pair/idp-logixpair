import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { member, organization } from "@krazil-idp/db/schema/organization";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { AdminAuditEventType } from "./admin-audit";
import { recordAdminAuditEvent } from "./admin-audit";
import {
	type ChangeOrganizationMemberRoleInput,
	organizationMemberHasRole as hasRole,
	type LockedOrganizationMember as LockedMember,
	type LockedOrganizationMutationContext as LockedMutationContext,
	type LockedOrganizationUser as LockedUser,
	type OrganizationMemberMutation,
	type OrganizationPolicyContext,
	OrganizationPolicyError,
	type OrganizationPolicyDenial as PolicyDenial,
	type RemoveOrganizationMemberInput,
	organizationPolicyReasonCode as reasonCodeFor,
	validateOrganizationPolicyContext as validateContext,
	validateOrganizationPolicyRole as validateRole,
} from "./organization-policy";
import type { PolicyResult, PolicyTransaction } from "./platform-policy";

export { OrganizationPolicyError } from "./organization-policy";

async function deny<T>(
	transaction: PolicyTransaction,
	input: OrganizationPolicyContext,
	eventType: AdminAuditEventType,
	targetUserId: string,
	denial: PolicyDenial,
): Promise<PolicyResult<T>> {
	await recordAdminAuditEvent(transaction, {
		eventType,
		outcome: "denied",
		reasonCode: reasonCodeFor(denial.code),
		requestId: input.requestId,
		actorUserId: input.actorUserId,
		targetUserId,
		organizationId: input.organizationId,
		ipAddress: input.ipAddress,
		metadata: denial.metadata,
	});
	return {
		error: new OrganizationPolicyError(denial.code, denial.message),
	};
}

async function lockMutationContext(
	transaction: PolicyTransaction,
	input: OrganizationPolicyContext,
	targetUserId: string,
): Promise<LockedMutationContext> {
	const organizations = await transaction
		.select({ id: organization.id, status: organization.status })
		.from(organization)
		.where(eq(organization.id, input.organizationId))
		.for("update");
	if (organizations.length === 0) return { organizationExists: false };

	const userIds = [...new Set([input.actorUserId, targetUserId])].sort();
	const users = await transaction
		.select({ id: user.id, banned: user.banned })
		.from(user)
		.where(inArray(user.id, userIds))
		.orderBy(user.id)
		.for("update");
	const members = await transaction
		.select({
			id: member.id,
			userId: member.userId,
			organizationId: member.organizationId,
			role: member.role,
		})
		.from(member)
		.where(
			and(
				eq(member.organizationId, input.organizationId),
				inArray(member.userId, userIds),
			),
		)
		.orderBy(member.userId)
		.for("update");
	return {
		organizationExists: true,
		organizationStatus: organizations[0]?.status,
		actorUser: users.find((row) => row.id === input.actorUserId),
		targetUser: users.find((row) => row.id === targetUserId),
		actorMember: members.find((row) => row.userId === input.actorUserId),
		targetMember: members.find((row) => row.userId === targetUserId),
	};
}

function contextDenial(
	context: LockedMutationContext,
): PolicyDenial | undefined {
	if (!context.organizationExists) {
		return { code: "NOT_FOUND", message: "Organization was not found" };
	}
	if (context.organizationStatus !== "active") {
		return {
			code: "POLICY_DENIED",
			message: "Organization membership is not active",
		};
	}
	if (!context.targetUser || !context.targetMember) {
		return { code: "NOT_FOUND", message: "Organization member was not found" };
	}
	if (!context.actorUser || !context.actorMember) {
		return {
			code: "POLICY_DENIED",
			message: "Actor is not an organization member",
		};
	}
	if (context.actorUser.banned === true) {
		return {
			code: "POLICY_DENIED",
			message: "Inactive actors may not mutate organization membership",
		};
	}
}

function roleChangeDenial(
	context: LockedMutationContext,
	input: ChangeOrganizationMemberRoleInput,
): PolicyDenial | undefined {
	const actor = context.actorMember as LockedMember;
	const target = context.targetMember as LockedMember;
	if (!hasRole(actor, "admin")) {
		return {
			code: "POLICY_DENIED",
			message: "Only organization admins may change member roles",
		};
	}
	if (target.role !== input.expectedCurrentRole) {
		return {
			code: "CONFLICT",
			message: "Organization member role changed before this request completed",
			metadata: { expected_role: input.expectedCurrentRole },
		};
	}
	if (input.requestedRole === input.expectedCurrentRole) {
		return {
			code: "CONFLICT",
			message: "Organization member role is unchanged",
		};
	}
}

function removeDenial(
	context: LockedMutationContext,
	input: RemoveOrganizationMemberInput,
): PolicyDenial | undefined {
	const actor = context.actorMember as LockedMember;
	const target = context.targetMember as LockedMember;
	const actorCanRemove =
		hasRole(actor, "admin") ||
		(hasRole(actor, "moderator") && hasRole(target, "user"));
	if (!actorCanRemove) {
		return {
			code: "POLICY_DENIED",
			message: "Actor cannot remove this organization member",
		};
	}
	if (target.role !== input.expectedCurrentRole) {
		return {
			code: "CONFLICT",
			message: "Organization member role changed before this request completed",
			metadata: { expected_role: input.expectedCurrentRole },
		};
	}
}

async function countActiveAdmins(
	transaction: PolicyTransaction,
	organizationId: string,
): Promise<number> {
	const rows = await transaction
		.select({ count: sql<number>`count(*)` })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(member.organizationId, organizationId),
				or(eq(user.banned, false), isNull(user.banned)),
				sql`${member.role} ~ '(^|,)[[:space:]]*admin([[:space:]]*,|$)'`,
			),
		);
	return Number(rows[0]?.count ?? 0);
}

async function isLastActiveAdmin(
	transaction: PolicyTransaction,
	input: OrganizationPolicyContext,
	context: LockedMutationContext,
): Promise<boolean> {
	const target = context.targetMember as LockedMember;
	const targetUser = context.targetUser as LockedUser;
	if (!hasRole(target, "admin") || targetUser.banned === true) return false;
	return (await countActiveAdmins(transaction, input.organizationId)) <= 1;
}

async function changeRoleInTransaction(
	transaction: PolicyTransaction,
	input: ChangeOrganizationMemberRoleInput,
): Promise<PolicyResult<OrganizationMemberMutation>> {
	const context = await lockMutationContext(
		transaction,
		input,
		input.targetUserId,
	);
	const denial = contextDenial(context) ?? roleChangeDenial(context, input);
	if (denial) {
		return deny(
			transaction,
			input,
			"admin.member.role_changed",
			input.targetUserId,
			denial,
		);
	}
	if (await isLastActiveAdmin(transaction, input, context)) {
		return deny(
			transaction,
			input,
			"admin.member.role_changed",
			input.targetUserId,
			{
				code: "LAST_ADMIN_PROTECTED",
				message: "The last active organization admin cannot be demoted",
			},
		);
	}
	return updateMemberRole(
		transaction,
		input,
		context.targetMember as LockedMember,
	);
}

async function updateMemberRole(
	transaction: PolicyTransaction,
	input: ChangeOrganizationMemberRoleInput,
	target: LockedMember,
): Promise<PolicyResult<OrganizationMemberMutation>> {
	const [updated] = await transaction
		.update(member)
		.set({ role: input.requestedRole })
		.where(
			and(
				eq(member.id, target.id),
				eq(member.organizationId, input.organizationId),
				eq(member.role, input.expectedCurrentRole),
			),
		)
		.returning({
			id: member.id,
			userId: member.userId,
			organizationId: member.organizationId,
			role: member.role,
		});
	if (!updated) {
		return deny(
			transaction,
			input,
			"admin.member.role_changed",
			input.targetUserId,
			{
				code: "CONFLICT",
				message: "Organization member role update lost its compare-and-swap",
			},
		);
	}
	await recordAdminAuditEvent(transaction, {
		eventType: "admin.member.role_changed",
		outcome: "success",
		reasonCode: "authorized",
		requestId: input.requestId,
		actorUserId: input.actorUserId,
		targetUserId: input.targetUserId,
		targetId: target.id,
		organizationId: input.organizationId,
		ipAddress: input.ipAddress,
		metadata: {
			previous_role: input.expectedCurrentRole,
			requested_role: input.requestedRole,
		},
	});
	return { value: { ...updated, role: validateRole(updated.role) } };
}

async function removeMemberInTransaction(
	transaction: PolicyTransaction,
	input: RemoveOrganizationMemberInput,
): Promise<PolicyResult<OrganizationMemberMutation>> {
	const context = await lockMutationContext(
		transaction,
		input,
		input.targetUserId,
	);
	const denial = contextDenial(context) ?? removeDenial(context, input);
	if (denial) {
		return deny(
			transaction,
			input,
			"admin.member.removed",
			input.targetUserId,
			denial,
		);
	}
	if (await isLastActiveAdmin(transaction, input, context)) {
		return deny(
			transaction,
			input,
			"admin.member.removed",
			input.targetUserId,
			{
				code: "LAST_ADMIN_PROTECTED",
				message: "The last active organization admin cannot be removed",
			},
		);
	}
	return deleteMember(transaction, input, context.targetMember as LockedMember);
}

async function deleteMember(
	transaction: PolicyTransaction,
	input: RemoveOrganizationMemberInput,
	target: LockedMember,
): Promise<PolicyResult<OrganizationMemberMutation>> {
	const [removed] = await transaction
		.delete(member)
		.where(
			and(
				eq(member.id, target.id),
				eq(member.organizationId, input.organizationId),
				eq(member.role, input.expectedCurrentRole),
			),
		)
		.returning({
			id: member.id,
			userId: member.userId,
			organizationId: member.organizationId,
			role: member.role,
		});
	if (!removed) {
		return deny(
			transaction,
			input,
			"admin.member.removed",
			input.targetUserId,
			{
				code: "CONFLICT",
				message: "Organization member removal lost its compare-and-swap",
			},
		);
	}
	await recordAdminAuditEvent(transaction, {
		eventType: "admin.member.removed",
		outcome: "success",
		reasonCode: "authorized",
		requestId: input.requestId,
		actorUserId: input.actorUserId,
		targetUserId: input.targetUserId,
		targetId: target.id,
		organizationId: input.organizationId,
		ipAddress: input.ipAddress,
		metadata: { previous_role: input.expectedCurrentRole },
	});
	return { value: { ...removed, role: validateRole(removed.role) } };
}

function unwrap<T>(result: PolicyResult<T>): T {
	if (result.error) throw result.error;
	return result.value as T;
}

export async function changeOrganizationMemberRole(
	input: ChangeOrganizationMemberRoleInput,
): Promise<OrganizationMemberMutation> {
	validateContext(input);
	const expectedCurrentRole = validateRole(input.expectedCurrentRole);
	const requestedRole = validateRole(input.requestedRole);
	return unwrap(
		await db.transaction((transaction) =>
			changeRoleInTransaction(transaction, {
				...input,
				expectedCurrentRole,
				requestedRole,
			}),
		),
	);
}

export async function removeOrganizationMember(
	input: RemoveOrganizationMemberInput,
): Promise<OrganizationMemberMutation> {
	validateContext(input);
	const expectedCurrentRole = validateRole(input.expectedCurrentRole);
	return unwrap(
		await db.transaction((transaction) =>
			removeMemberInTransaction(transaction, {
				...input,
				expectedCurrentRole,
			}),
		),
	);
}
