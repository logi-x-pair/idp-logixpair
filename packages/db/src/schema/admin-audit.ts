import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { organization } from "./organization";

export const adminAuditEvent = pgTable(
	"admin_audit_event",
	{
		eventId: text("event_id").primaryKey(),
		eventType: text("event_type").notNull(),
		occurredAt: timestamp("occurred_at").defaultNow().notNull(),
		// Historical identifiers remain immutable even if the referenced row is
		// later archived or deleted; authorization never depends on these fields.
		actorUserId: text("actor_user_id"),
		targetUserId: text("target_user_id"),
		targetId: text("target_id"),
		organizationId: text("organization_id"),
		outcome: text("outcome").notNull(),
		reasonCode: text("reason_code").notNull(),
		ipAddress: text("ip_address"),
		requestId: text("request_id").notNull(),
		metadata: jsonb("metadata"),
	},
	(table) => [
		index("admin_audit_event_occurred_event_idx").on(
			table.occurredAt,
			table.eventId,
		),
		index("admin_audit_event_actor_user_id_idx").on(table.actorUserId),
		index("admin_audit_event_target_user_id_idx").on(table.targetUserId),
		index("admin_audit_event_org_occurred_idx").on(
			table.organizationId,
			table.occurredAt.desc(),
			table.eventId.desc(),
		),
		index("admin_audit_event_request_id_idx").on(table.requestId),
		check(
			"admin_audit_event_outcome_check",
			sql`${table.outcome} in ('success', 'failure', 'denied')`,
		),
		check(
			"admin_audit_event_type_check",
			sql`${table.eventType} in (
				'admin.login.succeeded',
				'admin.login.failed',
				'admin.2fa.succeeded',
				'admin.2fa.failed',
				'admin.logout',
				'admin.user.created',
				'admin.user.profile_changed',
				'admin.user.banned',
				'admin.user.unbanned',
				'admin.user.deleted',
				'admin.platform_role.changed',
				'admin.organization.created',
				'admin.organization.updated',
				'admin.organization.suspended',
				'admin.organization.archived',
				'admin.member.invited',
				'admin.member.invitation_cancelled',
				'admin.member.invitation_expired',
				'admin.member.added',
				'admin.member.removed',
				'admin.member.role_changed',
				'admin.binding.created',
				'admin.binding.updated',
				'admin.binding.status_changed',
				'admin.binding.health_checked',
				'admin.audit.read',
				'admin.audit.retention_purged'
			)`,
		),
	],
);

export const adminAuditOutbox = pgTable(
	"admin_audit_outbox",
	{
		outboxId: text("outbox_id").primaryKey(),
		auditEventId: text("audit_event_id")
			.notNull()
			.references(() => adminAuditEvent.eventId, { onDelete: "cascade" }),
		payload: jsonb("payload").notNull(),
		status: text("status").default("pending").notNull(),
		attempts: integer("attempts").default(0).notNull(),
		nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
		leaseUntil: timestamp("lease_until"),
		deliveredAt: timestamp("delivered_at"),
		lastErrorCode: text("last_error_code"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("admin_audit_outbox_event_unique").on(table.auditEventId),
		index("admin_audit_outbox_claim_idx").on(table.status, table.nextAttemptAt),
		check(
			"admin_audit_outbox_status_check",
			sql`${table.status} in ('pending', 'processing', 'failed', 'delivered')`,
		),
		check("admin_audit_outbox_attempts_check", sql`${table.attempts} >= 0`),
	],
);

export const adminAuditEventRelations = relations(
	adminAuditEvent,
	({ one }) => ({
		actor: one(user, {
			fields: [adminAuditEvent.actorUserId],
			references: [user.id],
			relationName: "adminAuditActor",
		}),
		targetUser: one(user, {
			fields: [adminAuditEvent.targetUserId],
			references: [user.id],
			relationName: "adminAuditTarget",
		}),
		organization: one(organization, {
			fields: [adminAuditEvent.organizationId],
			references: [organization.id],
		}),
		outbox: one(adminAuditOutbox),
	}),
);

export const adminAuditOutboxRelations = relations(
	adminAuditOutbox,
	({ one }) => ({
		event: one(adminAuditEvent, {
			fields: [adminAuditOutbox.auditEventId],
			references: [adminAuditEvent.eventId],
		}),
	}),
);
