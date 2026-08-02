import { db } from "@krazil-idp/db";
import {
	oauthAccessToken,
	oauthRefreshToken,
	session,
	user,
} from "@krazil-idp/db/schema/auth";
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

export interface SetPlatformUserBanInput extends PlatformPolicyContext {
	targetUserId: string;
	banned: boolean;
	banReason?: string;
	banExpires?: Date | null;
}

export interface ChangedPlatformBan {
	id: string;
	banned: boolean;
}

function validateBanInput(input: SetPlatformUserBanInput): void {
	if (input.banReason && input.banReason.length > 200) {
		throw new PlatformPolicyError("INVALID_INPUT", "Ban reason is too long");
	}
}

async function setBanInTransaction(
	transaction: PolicyTransaction,
	input: SetPlatformUserBanInput,
): Promise<PolicyResult<ChangedPlatformBan>> {
	await lockPlatformInvariant(transaction);
	const rows = await lockUsers(transaction, [
		input.actorUserId,
		input.targetUserId,
	]);
	const actor = findLockedUser(rows, input.actorUserId);
	const target = findLockedUser(rows, input.targetUserId);
	const eventType = input.banned ? "admin.user.banned" : "admin.user.unbanned";
	if (!actor || !target) {
		await recordDeniedAction(
			transaction,
			input,
			eventType,
			input.targetUserId,
			"not_found",
		);
		return { error: notFoundError() };
	}
	if (!isActivePolicyActor(actor)) {
		await recordDeniedAction(
			transaction,
			input,
			eventType,
			target.id,
			"policy_denied",
		);
		return {
			error: new PlatformPolicyError(
				"POLICY_DENIED",
				"Inactive actors may not change user ban state",
			),
		};
	}
	const removesActiveAdmin =
		input.banned && target.banned === false && target.role === "admin";
	if (
		actor.role === "admin" &&
		removesActiveAdmin &&
		(await countActiveAdmins(transaction)) <= 1
	) {
		await recordDeniedAction(
			transaction,
			input,
			eventType,
			target.id,
			"last_admin_protected",
		);
		return {
			error: new PlatformPolicyError(
				"LAST_ADMIN_PROTECTED",
				"The last active platform admin cannot be banned",
			),
		};
	}
	const mayBan =
		actor.id !== target.id &&
		(actor.role === "admin" ||
			(actor.role === "moderator" && target.role !== "admin"));
	if (!mayBan) {
		await recordDeniedAction(
			transaction,
			input,
			eventType,
			target.id,
			"policy_denied",
		);
		return {
			error: new PlatformPolicyError(
				"POLICY_DENIED",
				"Actor may not change this user's ban state",
			),
		};
	}
	await transaction
		.update(user)
		.set({
			banned: input.banned,
			banReason: input.banned ? input.banReason : null,
			banExpires: input.banned ? input.banExpires : null,
		})
		.where(eq(user.id, target.id));
	if (input.banned) {
		await transaction.delete(session).where(eq(session.userId, target.id));
		await transaction
			.delete(oauthAccessToken)
			.where(eq(oauthAccessToken.userId, target.id));
		await transaction
			.delete(oauthRefreshToken)
			.where(eq(oauthRefreshToken.userId, target.id));
	}
	await recordAdminAuditEvent(transaction, {
		eventType,
		outcome: "success",
		reasonCode: "authorized",
		requestId: input.requestId,
		actorUserId: actor.id,
		targetUserId: target.id,
		ipAddress: input.ipAddress,
		metadata: { banned: input.banned },
	});
	return { value: { id: target.id, banned: input.banned } };
}

export async function setPlatformUserBan(
	input: SetPlatformUserBanInput,
): Promise<ChangedPlatformBan> {
	validateBanInput(input);
	const result = await db.transaction((transaction) =>
		setBanInTransaction(transaction, input),
	);
	return unwrapPolicyResult(result);
}
