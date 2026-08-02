import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { eq } from "drizzle-orm";

import { recordAdminAuditEvent } from "./admin-audit";
import {
	countActiveAdmins,
	findLockedUser,
	isActivePolicyActor,
	lockPlatformInvariant,
	lockUsers,
	notFoundError,
	PlatformPolicyError,
	recordDeniedAction,
	type PlatformPolicyContext,
	type PolicyResult,
	type PolicyTransaction,
	unwrapPolicyResult,
} from "./platform-policy";

export interface DeletePlatformUserInput extends PlatformPolicyContext {
	targetUserId: string;
}

async function deleteUserInTransaction(
	transaction: PolicyTransaction,
	input: DeletePlatformUserInput,
): Promise<PolicyResult<{ id: string }>> {
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
			"admin.user.deleted",
			input.targetUserId,
			"not_found",
		);
		return { error: notFoundError() };
	}
	if (!isActivePolicyActor(actor) || actor.role !== "admin" || actor.id === target.id) {
		await recordDeniedAction(
			transaction,
			input,
			"admin.user.deleted",
			target.id,
			"policy_denied",
		);
		return {
			error: new PlatformPolicyError(
				"POLICY_DENIED",
				"Actor may not delete this user",
			),
		};
	}
	if (target.role === "admin" && (await countActiveAdmins(transaction)) <= 1) {
		await recordDeniedAction(
			transaction,
			input,
			"admin.user.deleted",
			target.id,
			"last_admin_protected",
		);
		return {
			error: new PlatformPolicyError(
				"LAST_ADMIN_PROTECTED",
				"The last active platform admin cannot be deleted",
			),
		};
	}
	await recordAdminAuditEvent(transaction, {
		eventType: "admin.user.deleted",
		outcome: "success",
		reasonCode: "authorized",
		requestId: input.requestId,
		actorUserId: actor.id,
		targetUserId: target.id,
		ipAddress: input.ipAddress,
		metadata: { previous_role: target.role },
	});
	await transaction.delete(user).where(eq(user.id, target.id));
	return { value: { id: target.id } };
}

export async function deletePlatformUser(
	input: DeletePlatformUserInput,
): Promise<{ id: string }> {
	const result = await db.transaction((transaction) =>
		deleteUserInTransaction(transaction, input),
	);
	return unwrapPolicyResult(result);
}
