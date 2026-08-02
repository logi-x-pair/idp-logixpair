import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const organization = pgTable(
	"organization",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		slug: text("slug").notNull().unique(),
		logo: text("logo"),
		status: text("status").default("active").notNull(),
		createdAt: timestamp("created_at").notNull(),
		metadata: text("metadata"),
	},
	(table) => [
		check(
			"organization_name_check",
			sql`char_length(btrim(${table.name})) between 1 and 120 and char_length(${table.name}) <= 120`,
		),
		check(
			"organization_slug_check",
			sql`char_length(${table.slug}) <= 63 and ${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
		),
		check(
			"organization_status_check",
			sql`${table.status} in ('active', 'suspended', 'archived')`,
		),
	],
);

export const member = pgTable(
	"member",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role").default("user").notNull(),
		createdAt: timestamp("created_at").notNull(),
	},
	(table) => [
		index("member_organization_id_idx").on(table.organizationId),
		index("member_user_id_idx").on(table.userId),
		uniqueIndex("member_organization_user_unique").on(
			table.organizationId,
			table.userId,
		),
		check(
			"member_role_check",
			sql`${table.role} in ('admin', 'moderator', 'user')`,
		),
	],
);

export const invitation = pgTable(
	"invitation",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		role: text("role").notNull(),
		status: text("status").default("pending").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").notNull(),
		inviterId: text("inviter_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("invitation_organization_id_idx").on(table.organizationId),
		index("invitation_email_idx").on(table.email),
		uniqueIndex("invitation_pending_unique")
			.on(table.organizationId, table.email)
			.where(sql`${table.status} = 'pending'`),
		check(
			"invitation_status_check",
			sql`${table.status} in ('pending', 'accepted', 'rejected', 'cancelled', 'expired')`,
		),
		check(
			"invitation_email_check",
			sql`char_length(${table.email}) between 3 and 254 and ${table.email} = lower(${table.email})`,
		),
		check(
			"invitation_role_check",
			sql`${table.role} in ('admin', 'moderator', 'user')`,
		),
	],
);

export const organizationRelations = relations(organization, ({ many }) => ({
	members: many(member),
	invitations: many(invitation),
}));

export const memberRelations = relations(member, ({ one }) => ({
	organization: one(organization, {
		fields: [member.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [member.userId],
		references: [user.id],
	}),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
	organization: one(organization, {
		fields: [invitation.organizationId],
		references: [organization.id],
	}),
	inviter: one(user, {
		fields: [invitation.inviterId],
		references: [user.id],
	}),
}));
