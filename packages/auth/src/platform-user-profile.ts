import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { recordAdminAuditEvent } from "./admin-audit";
import {
	canManageTarget,
	findLockedUser,
	isActivePolicyActor,
	lockUsers,
	notFoundError,
	PlatformPolicyError,
	recordDeniedAction,
	type PlatformPolicyContext,
	type PolicyResult,
	type PolicyTransaction,
	unwrapPolicyResult,
} from "./platform-policy";

export interface UpdatePlatformProfileInput extends PlatformPolicyContext {
	targetUserId: string;
	name?: string;
	image?: string | null;
}

type ProfileUpdate = { name?: string; image?: string | null };

function validateProfileUpdate(input: UpdatePlatformProfileInput): ProfileUpdate {
	const update: ProfileUpdate = {};
	if (input.name !== undefined) {
		const name = z.string().trim().min(1).max(120).safeParse(input.name);
		if (!name.success) {
			throw new PlatformPolicyError("INVALID_INPUT", "User name is invalid");
		}
		update.name = name.data;
	}
	if (input.image !== undefined) {
		const image = z.url().max(2048).nullable().safeParse(input.image);
		if (!image.success) {
			throw new PlatformPolicyError("INVALID_INPUT", "User image is invalid");
		}
		update.image = image.data;
	}
	if (Object.keys(update).length === 0) {
		throw new PlatformPolicyError("INVALID_INPUT", "No profile fields supplied");
	}
	return update;
}

async function updateProfileInTransaction(
	transaction: PolicyTransaction,
	input: UpdatePlatformProfileInput,
	update: ProfileUpdate,
): Promise<PolicyResult<{ id: string }>> {
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
			"admin.user.profile_changed",
			input.targetUserId,
			"not_found",
		);
		return { error: notFoundError() };
	}
	if (!isActivePolicyActor(actor) || !canManageTarget(actor.role, target.role)) {
		await recordDeniedAction(
			transaction,
			input,
			"admin.user.profile_changed",
			target.id,
			"policy_denied",
		);
		return {
			error: new PlatformPolicyError(
				"POLICY_DENIED",
				"Actor may not update this user",
			),
		};
	}
	await transaction.update(user).set(update).where(eq(user.id, target.id));
	await recordAdminAuditEvent(transaction, {
		eventType: "admin.user.profile_changed",
		outcome: "success",
		reasonCode: "authorized",
		requestId: input.requestId,
		actorUserId: actor.id,
		targetUserId: target.id,
		ipAddress: input.ipAddress,
		metadata: { fields: Object.keys(update).sort().join(",") },
	});
	return { value: { id: target.id } };
}

export async function updatePlatformUserProfile(
	input: UpdatePlatformProfileInput,
): Promise<{ id: string }> {
	const update = validateProfileUpdate(input);
	const result = await db.transaction((transaction) =>
		updateProfileInTransaction(transaction, input, update),
	);
	return unwrapPolicyResult(result);
}
