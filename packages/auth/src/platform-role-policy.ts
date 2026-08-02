import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { and, eq } from "drizzle-orm";

import { recordAdminAuditEvent } from "./admin-audit";
import type { OperatorRole } from "./permissions";
import {
	canAssignRole,
	countActiveAdmins,
	findLockedUser,
	isActivePolicyActor,
	lockPlatformInvariant,
	lockUsers,
	notFoundError,
	PLATFORM_ROLE_LOOKUP,
	PlatformPolicyError,
	recordDeniedAction,
	type PlatformPolicyContext,
	type PolicyResult,
	type PolicyTransaction,
	unwrapPolicyResult,
} from "./platform-policy";

export interface ChangePlatformRoleInput extends PlatformPolicyContext {
	targetUserId: string;
	expectedCurrentRole: OperatorRole;
	requestedRole: OperatorRole;
}

export interface ChangedPlatformRole {
	id: string;
	role: OperatorRole;
}

function validateRoleInput(input: ChangePlatformRoleInput): void {
	if (
		PLATFORM_ROLE_LOOKUP[input.expectedCurrentRole] !== true ||
		PLATFORM_ROLE_LOOKUP[input.requestedRole] !== true
	) {
		throw new PlatformPolicyError("INVALID_INPUT", "Role is invalid");
	}
}

async function changeRoleInTransaction(
	transaction: PolicyTransaction,
	input: ChangePlatformRoleInput,
): Promise<PolicyResult<ChangedPlatformRole>> {
	await lockPlatformInvariant(transaction);
	const rows = await lockUsers(transaction, [
		input.actorUserId,
		input.targetUserId,
	]);
	const actor = findLockedUser(rows, input.actorUserId);
	const target = findLockedUser(rows, input.targetUserId);
	if (!actor || !target) {
		await recordDeniedAction(
			transaction,
			input,
			"admin.platform_role.changed",
			input.targetUserId,
			"not_found",
		);
		return { error: notFoundError() };
	}
	if (
		!isActivePolicyActor(actor) ||
		actor.id === target.id ||
		!canAssignRole(actor.role, target.role, input.requestedRole)
	) {
		await recordDeniedAction(
			transaction,
			input,
			"admin.platform_role.changed",
			target.id,
			"policy_denied",
			{ current_role: target.role, requested_role: input.requestedRole },
		);
		return {
			error: new PlatformPolicyError(
				"POLICY_DENIED",
				"Platform role transition is not permitted",
			),
		};
	}
	if (target.role !== input.expectedCurrentRole) {
		await recordDeniedAction(
			transaction,
			input,
			"admin.platform_role.changed",
			target.id,
			"conflict",
			{ current_role: target.role, requested_role: input.requestedRole },
		);
		return {
			error: new PlatformPolicyError("CONFLICT", "Platform role is stale"),
		};
	}
	if (
		target.role === "admin" &&
		input.requestedRole !== "admin" &&
		(await countActiveAdmins(transaction)) <= 1
	) {
		await recordDeniedAction(
			transaction,
			input,
			"admin.platform_role.changed",
			target.id,
			"last_admin_protected",
		);
		return {
			error: new PlatformPolicyError(
				"LAST_ADMIN_PROTECTED",
				"The last active platform admin cannot be demoted",
			),
		};
	}
	await transaction
		.update(user)
		.set({ role: input.requestedRole })
		.where(and(eq(user.id, target.id), eq(user.role, target.role)));
	await recordAdminAuditEvent(transaction, {
		eventType: "admin.platform_role.changed",
		outcome: "success",
		reasonCode: "authorized",
		requestId: input.requestId,
		actorUserId: actor.id,
		targetUserId: target.id,
		ipAddress: input.ipAddress,
		metadata: { previous_role: target.role, requested_role: input.requestedRole },
	});
	return { value: { id: target.id, role: input.requestedRole } };
}

export async function changePlatformRole(
	input: ChangePlatformRoleInput,
): Promise<ChangedPlatformRole> {
	validateRoleInput(input);
	const result = await db.transaction((transaction) =>
		changeRoleInTransaction(transaction, input),
	);
	return unwrapPolicyResult(result);
}
