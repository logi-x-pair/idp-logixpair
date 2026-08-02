import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { member, organization } from "@krazil-idp/db/schema/organization";
import { and, eq, inArray } from "drizzle-orm";

import { recordAdminAuditEvent } from "./admin-audit";
import {
	organizationMemberHasRole as hasRole,
	type OrganizationPolicyContext,
	OrganizationPolicyError,
	organizationPolicyReasonCode as reasonCodeFor,
	validateOrganizationPolicyContext as validateContext,
	validateOrganizationPolicyRole as validateRole,
} from "./organization-policy";
import type { PolicyTransaction } from "./platform-policy";

export interface AddOrganizationMemberInput extends OrganizationPolicyContext {
	targetUserId: string;
	requestedRole: "admin" | "moderator" | "user";
}

export interface AddedOrganizationMember {
	id: string;
	organizationId: string;
	userId: string;
	role: "admin" | "moderator" | "user";
}

type OperationResult<T> =
	| { value: T; error?: never }
	| { value?: never; error: OrganizationPolicyError };

async function deny<T>(
	transaction: PolicyTransaction,
	input: OrganizationPolicyContext,
	targetUserId: string,
	code: "POLICY_DENIED" | "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT",
	message: string,
): Promise<OperationResult<T>> {
	await recordAdminAuditEvent(transaction, {
		eventType: "admin.member.added",
		outcome: "denied",
		reasonCode: reasonCodeFor(code),
		requestId: input.requestId,
		actorUserId: input.actorUserId,
		targetUserId,
		organizationId: input.organizationId,
	});
	return { error: new OrganizationPolicyError(code, message) };
}

export async function addOrganizationMember(
	input: AddOrganizationMemberInput,
): Promise<AddedOrganizationMember> {
	validateContext(input);
	const requestedRole = validateRole(input.requestedRole);
	const result: OperationResult<AddedOrganizationMember> = await db.transaction(
		async (transaction): Promise<OperationResult<AddedOrganizationMember>> => {
			const organizations = await transaction
				.select({ id: organization.id, status: organization.status })
				.from(organization)
				.where(eq(organization.id, input.organizationId))
				.for("update");
			const currentOrganization = organizations[0];
			if (!currentOrganization) {
				return deny(
					transaction,
					input,
					input.targetUserId,
					"NOT_FOUND",
					"Organization was not found",
				);
			}
			if (currentOrganization.status !== "active") {
				return deny(
					transaction,
					input,
					input.targetUserId,
					"POLICY_DENIED",
					"Organization membership is not active",
				);
			}
			const userIds = [
				...new Set([input.actorUserId, input.targetUserId]),
			].sort();
			const users = await transaction
				.select({ id: user.id, banned: user.banned })
				.from(user)
				.where(inArray(user.id, userIds))
				.orderBy(user.id)
				.for("update");
			const actor = users.find((row) => row.id === input.actorUserId);
			const target = users.find((row) => row.id === input.targetUserId);
			if (!actor || !target) {
				return deny(
					transaction,
					input,
					input.targetUserId,
					"NOT_FOUND",
					"Actor or target user was not found",
				);
			}
			const memberships = await transaction
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
			const actorMembership = memberships.find(
				(row) => row.userId === input.actorUserId,
			);
			if (
				actor.banned === true ||
				!actorMembership ||
				!hasRole(actorMembership, "admin")
			) {
				return deny(
					transaction,
					input,
					input.targetUserId,
					"POLICY_DENIED",
					"Only an active organization admin may add members",
				);
			}
			if (memberships.some((row) => row.userId === input.targetUserId)) {
				return deny(
					transaction,
					input,
					input.targetUserId,
					"CONFLICT",
					"Target user is already an organization member",
				);
			}
			const [created] = await transaction
				.insert(member)
				.values({
					id: crypto.randomUUID(),
					organizationId: input.organizationId,
					userId: input.targetUserId,
					role: requestedRole,
					createdAt: new Date(),
				})
				.returning({
					id: member.id,
					organizationId: member.organizationId,
					userId: member.userId,
					role: member.role,
				});
			if (!created)
				throw new OrganizationPolicyError(
					"CONFLICT",
					"Member could not be added",
				);
			await recordAdminAuditEvent(transaction, {
				eventType: "admin.member.added",
				outcome: "success",
				reasonCode: "authorized",
				requestId: input.requestId,
				actorUserId: input.actorUserId,
				targetUserId: input.targetUserId,
				targetId: created.id,
				organizationId: input.organizationId,
				ipAddress: input.ipAddress,
				metadata: { requested_role: requestedRole },
			});
			return { value: { ...created, role: validateRole(created.role) } };
		},
	);
	if (result.error) throw result.error;
	return result.value;
}
