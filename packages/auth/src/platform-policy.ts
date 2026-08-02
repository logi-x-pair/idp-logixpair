import type { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { platformRoleInvariant } from "@krazil-idp/db/schema/platform-invariant";
import { and, eq, inArray, sql } from "drizzle-orm";

import {
	type AdminAuditEventType,
	type AdminAuditMetadata,
	type AdminAuditReasonCode,
	recordAdminAuditEvent,
} from "./admin-audit";
import type { OperatorRole } from "./permissions";

export const PLATFORM_ROLE_LOOKUP: Record<string, true> = {
	admin: true,
	moderator: true,
	hr_user: true,
	user: true,
};

const PLATFORM_INVARIANT_ID = "platform-roles";

export type PlatformPolicyErrorCode =
	| "POLICY_DENIED"
	| "NOT_FOUND"
	| "CONFLICT"
	| "LAST_ADMIN_PROTECTED"
	| "INVALID_INPUT";

export class PlatformPolicyError extends Error {
	constructor(
		public readonly code: PlatformPolicyErrorCode,
		message: string,
	) {
		super(message);
		this.name = "PlatformPolicyError";
	}
}

export interface PlatformPolicyContext {
	actorUserId: string;
	requestId: string;
	ipAddress?: string;
}

export interface LockedUser {
	id: string;
	name: string;
	email: string;
	role: OperatorRole;
	banned: boolean;
	banExpires: Date | null;
}

export type PolicyTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];

export type PolicyResult<T> =
	| { value: T; error?: never }
	| { value?: never; error: PlatformPolicyError };

export function operatorRole(value: string): OperatorRole {
	if (PLATFORM_ROLE_LOOKUP[value] !== true) {
		throw new PlatformPolicyError(
			"INVALID_INPUT",
			"Stored platform role is not supported",
		);
	}
	return value as OperatorRole;
}

export async function lockPlatformInvariant(
	transaction: PolicyTransaction,
): Promise<void> {
	await transaction
		.insert(platformRoleInvariant)
		.values({ id: PLATFORM_INVARIANT_ID })
		.onConflictDoNothing();
	await transaction
		.select({ id: platformRoleInvariant.id })
		.from(platformRoleInvariant)
		.where(eq(platformRoleInvariant.id, PLATFORM_INVARIANT_ID))
		.for("update");
}

export async function lockUsers(
	transaction: PolicyTransaction,
	userIds: string[],
): Promise<LockedUser[]> {
	const orderedIds = [...new Set(userIds)].sort();
	const rows = await transaction
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			banned: user.banned,
			banExpires: user.banExpires,
		})
		.from(user)
		.where(inArray(user.id, orderedIds))
		.orderBy(user.id)
		.for("update");
	return rows.map((row) => ({
		...row,
		role: operatorRole(row.role),
		banned: row.banned === true,
	}));
}

export function findLockedUser(
	rows: LockedUser[],
	userId: string,
): LockedUser | undefined {
	return rows.find((row) => row.id === userId);
}

export function isActivePolicyActor(actor: LockedUser): boolean {
	return actor.banned === false;
}

export function canManageTarget(
	actorRole: OperatorRole,
	targetRole: OperatorRole,
): boolean {
	if (actorRole === "admin") return true;
	if (actorRole === "moderator") return targetRole !== "admin";
	if (actorRole === "hr_user") {
		return targetRole === "hr_user" || targetRole === "user";
	}
	return false;
}

export function canAssignRole(
	actorRole: OperatorRole,
	targetRole: OperatorRole,
	requestedRole: OperatorRole,
): boolean {
	if (actorRole === "admin") return true;
	if (actorRole === "moderator") {
		return targetRole !== "admin" && requestedRole !== "admin";
	}
	if (actorRole === "hr_user") {
		return (
			(targetRole === "hr_user" || targetRole === "user") &&
			(requestedRole === "hr_user" || requestedRole === "user")
		);
	}
	return false;
}

export async function countActiveAdmins(
	transaction: PolicyTransaction,
): Promise<number> {
	const rows = await transaction
		.select({ count: sql<number>`count(*)` })
		.from(user)
		.where(and(eq(user.role, "admin"), eq(user.banned, false)));
	return Number(rows[0]?.count ?? 0);
}

export async function recordDeniedAction(
	transaction: PolicyTransaction,
	context: PlatformPolicyContext,
	eventType: AdminAuditEventType,
	targetUserId: string | undefined,
	reasonCode: AdminAuditReasonCode,
	metadata?: AdminAuditMetadata,
): Promise<void> {
	await recordAdminAuditEvent(transaction, {
		eventType,
		outcome: "denied",
		reasonCode,
		requestId: context.requestId,
		actorUserId: context.actorUserId,
		targetUserId,
		ipAddress: context.ipAddress,
		metadata,
	});
}

export function unwrapPolicyResult<T>(result: PolicyResult<T>): T {
	if (result.error) throw result.error;
	return result.value as T;
}

export function notFoundError(): PlatformPolicyError {
	return new PlatformPolicyError(
		"NOT_FOUND",
		"Actor or target user was not found",
	);
}
