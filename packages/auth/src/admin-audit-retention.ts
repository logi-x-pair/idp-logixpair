import { db } from "@krazil-idp/db";
import {
	adminAuditEvent,
	adminAuditOutbox,
} from "@krazil-idp/db/schema/admin-audit";
import { user } from "@krazil-idp/db/schema/auth";
import { and, eq, inArray, lt } from "drizzle-orm";

import { recordAdminAuditEvent } from "./admin-audit";
import { PlatformPolicyError } from "./platform-policy";

export const DEFAULT_ADMIN_AUDIT_RETENTION_DAYS = 365;
const MIN_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3_650;
const DEFAULT_PURGE_BATCH_SIZE = 500;
const MAX_PURGE_BATCH_SIZE = 1_000;

export interface PurgeAdminAuditInput {
	actorUserId: string;
	requestId: string;
	retentionDays?: number;
	batchSize?: number;
}

export interface PurgeAdminAuditResult {
	deleted: number;
	cutoff: Date;
}

type RetentionResult =
	| { value: PurgeAdminAuditResult; error?: never }
	| { value?: never; error: PlatformPolicyError };

function validateInput(input: PurgeAdminAuditInput): {
	retentionDays: number;
	batchSize: number;
} {
	if (!input.actorUserId || !input.requestId || input.requestId.length > 128) {
		throw new PlatformPolicyError(
			"INVALID_INPUT",
			"Audit retention context is invalid",
		);
	}
	const retentionDays =
		input.retentionDays ?? DEFAULT_ADMIN_AUDIT_RETENTION_DAYS;
	const batchSize = input.batchSize ?? DEFAULT_PURGE_BATCH_SIZE;
	if (
		!Number.isInteger(retentionDays) ||
		retentionDays < MIN_RETENTION_DAYS ||
		retentionDays > MAX_RETENTION_DAYS
	) {
		throw new PlatformPolicyError(
			"INVALID_INPUT",
			"Audit retention period is invalid",
		);
	}
	if (
		!Number.isInteger(batchSize) ||
		batchSize < 1 ||
		batchSize > MAX_PURGE_BATCH_SIZE
	) {
		throw new PlatformPolicyError(
			"INVALID_INPUT",
			"Audit purge batch size is invalid",
		);
	}
	return { retentionDays, batchSize };
}

export async function purgeDeliveredAdminAuditEvents(
	input: PurgeAdminAuditInput,
): Promise<PurgeAdminAuditResult> {
	const { retentionDays, batchSize } = validateInput(input);
	const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
	const result: RetentionResult = await db.transaction(
		async (transaction): Promise<RetentionResult> => {
			const actors = await transaction
				.select({ id: user.id, role: user.role, banned: user.banned })
				.from(user)
				.where(eq(user.id, input.actorUserId))
				.for("update");
			const actor = actors[0];
			if (!actor || actor.banned === true || actor.role !== "admin") {
				await recordAdminAuditEvent(transaction, {
					eventType: "admin.audit.retention_purged",
					outcome: "denied",
					reasonCode: "policy_denied",
					requestId: input.requestId,
					actorUserId: input.actorUserId,
				});
				return {
					error: new PlatformPolicyError(
						"POLICY_DENIED",
						"Audit retention access is denied",
					),
				};
			}
			const candidates = await transaction
				.select({ eventId: adminAuditEvent.eventId })
				.from(adminAuditEvent)
				.innerJoin(
					adminAuditOutbox,
					eq(adminAuditOutbox.auditEventId, adminAuditEvent.eventId),
				)
				.where(
					and(
						eq(adminAuditOutbox.status, "delivered"),
						lt(adminAuditEvent.occurredAt, cutoff),
					),
				)
				.orderBy(adminAuditEvent.occurredAt, adminAuditEvent.eventId)
				.limit(batchSize)
				.for("update", { skipLocked: true });
			const eventIds = candidates.map((candidate) => candidate.eventId);
			if (eventIds.length > 0) {
				await transaction
					.delete(adminAuditEvent)
					.where(inArray(adminAuditEvent.eventId, eventIds));
			}
			await recordAdminAuditEvent(transaction, {
				eventType: "admin.audit.retention_purged",
				outcome: "success",
				reasonCode: "authorized",
				requestId: input.requestId,
				actorUserId: actor.id,
				metadata: {
					deleted_count: eventIds.length,
					retention_days: retentionDays,
				},
			});
			return { value: { deleted: eventIds.length, cutoff } };
		},
	);
	if (result.error) throw result.error;
	return result.value;
}
