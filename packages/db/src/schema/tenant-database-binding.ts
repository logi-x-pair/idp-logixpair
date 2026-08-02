import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./organization";

export const ORGANIZATION_BINDING_ISOLATION_MODES = [
	"dedicated",
	"shared",
] as const;

export const ORGANIZATION_BINDING_STATUSES = [
	"pending",
	"provisioning",
	"migrating",
	"active",
	"failed",
	"suspended",
	"archived",
] as const;

export type OrganizationBindingIsolationMode =
	(typeof ORGANIZATION_BINDING_ISOLATION_MODES)[number];
export type OrganizationBindingStatus =
	(typeof ORGANIZATION_BINDING_STATUSES)[number];

export const tenantDatabaseBinding = pgTable(
	"tenant_database_binding",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		applicationId: text("application_id").notNull(),
		isolationMode: text("isolation_mode").default("dedicated").notNull(),
		secretRef: text("secret_ref"),
		databaseProfile: text("database_profile").notNull(),
		databaseLabel: text("database_label"),
		region: text("region"),
		status: text("status").default("pending").notNull(),
		schemaVersion: integer("schema_version").default(1).notNull(),
		lastHealthCheckAt: timestamp("last_health_check_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("tenant_database_binding_organization_application_unique").on(
			table.organizationId,
			table.applicationId,
		),
		index("tenant_database_binding_status_idx").on(table.status),
		check(
			"tenant_database_binding_isolation_mode_check",
			sql`${table.isolationMode} in ('dedicated', 'shared')`,
		),
		check(
			"tenant_database_binding_status_check",
			sql`${table.status} in ('pending', 'provisioning', 'migrating', 'active', 'failed', 'suspended', 'archived')`,
		),
		check(
			"tenant_database_binding_shared_secret_check",
			sql`${table.isolationMode} <> 'shared' or ${table.secretRef} is null`,
		),
		check(
			"tenant_database_binding_active_secret_check",
			sql`${table.status} in ('pending', 'provisioning', 'failed', 'archived') or ${table.isolationMode} = 'shared' or nullif(${table.secretRef}, '') is not null`,
		),
	],
);

export const tenantDatabaseBindingRelations = relations(
	tenantDatabaseBinding,
	({ one }) => ({
		organization: one(organization, {
			fields: [tenantDatabaseBinding.organizationId],
			references: [organization.id],
		}),
	}),
);
