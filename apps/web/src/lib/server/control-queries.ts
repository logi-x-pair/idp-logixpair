import "server-only";

import {
	ADMIN_AUDIT_EVENT_TYPES,
	type AdminAuditEventType,
} from "@krazil-idp/auth/admin-audit";
import {
	type AdminAuditReadCursor,
	type AdminAuditReadPage,
	readAdminAuditEvents,
} from "@krazil-idp/auth/admin-audit-read";
import { parseStoredOrganizationRoles } from "@krazil-idp/auth/organization-policy";
import type { OrganizationRole } from "@krazil-idp/auth/permissions";
import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import {
	invitation,
	member,
	organization,
} from "@krazil-idp/db/schema/organization";
import { tenantDatabaseBinding } from "@krazil-idp/db/schema/tenant-database-binding";
import { and, asc, desc, eq, gt, ilike, lt, or, type SQL } from "drizzle-orm";
import type { OrganizationAccess } from "./policies";
import type { ServerSession } from "./session";

const PAGE_SIZE = 25;

export interface KeysetPage<T> {
	items: T[];
	nextCursor?: string;
}

function encodeCursor(value: Record<string, string>): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(
	value: string | undefined,
): Record<string, string> | undefined {
	if (!value || value.length > 512) return undefined;
	try {
		const decoded = JSON.parse(
			Buffer.from(value, "base64url").toString("utf8"),
		);
		if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
			return undefined;
		}
		const entries: Record<string, string> = {};
		for (const [key, item] of Object.entries(decoded)) {
			if (typeof item === "string") entries[key] = item;
		}
		return entries;
	} catch {
		return undefined;
	}
}

function normalizedSearch(
	value: string | string[] | undefined,
): string | undefined {
	const candidate = Array.isArray(value) ? value[0] : value;
	const search = candidate?.trim().replace(/\s+/g, " ");
	return search && search.length <= 64 ? search : undefined;
}
function displayOrganizationRole(value: string): {
	role: OrganizationRole;
	roleSet: string;
} {
	const roles = parseStoredOrganizationRoles(value);
	const role = roles.includes("admin")
		? "admin"
		: roles.includes("moderator")
			? "moderator"
			: "user";
	return { role, roleSet: value };
}

export interface PlatformOrganizationItem {
	id: string;
	name: string;
	slug: string;
	status: "active" | "suspended" | "archived";
	createdAt: Date;
}

export async function listPlatformOrganizations(input: {
	search?: string | string[];
	cursor?: string;
}): Promise<KeysetPage<PlatformOrganizationItem>> {
	const search = normalizedSearch(input.search);
	const cursor = decodeCursor(input.cursor);
	const conditions: SQL[] = [];
	if (search) {
		const searchCondition = or(
			ilike(organization.name, `%${search}%`),
			ilike(organization.slug, `%${search}%`),
		);
		if (searchCondition) conditions.push(searchCondition);
	}
	if (cursor?.id) conditions.push(gt(organization.id, cursor.id));
	const rows = await db
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			status: organization.status,
			createdAt: organization.createdAt,
		})
		.from(organization)
		.where(conditions.length === 0 ? undefined : and(...conditions))
		.orderBy(asc(organization.id))
		.limit(PAGE_SIZE + 1);
	const hasMore = rows.length > PAGE_SIZE;
	const items = rows.slice(0, PAGE_SIZE).map((row) => ({
		...row,
		status: row.status as PlatformOrganizationItem["status"],
	}));
	const last = items.at(-1);
	return {
		items,
		nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : undefined,
	};
}

export interface OrganizationMembershipItem {
	id: string;
	name: string;
	slug: string;
	status: "active" | "suspended" | "archived";
	role: "admin" | "moderator" | "user";
}

export async function listUserOrganizations(input: {
	userId: string;
	search?: string | string[];
	cursor?: string;
}): Promise<KeysetPage<OrganizationMembershipItem>> {
	const search = normalizedSearch(input.search);
	const cursor = decodeCursor(input.cursor);
	const conditions: SQL[] = [eq(member.userId, input.userId)];
	if (search) {
		const searchCondition = or(
			ilike(organization.name, `%${search}%`),
			ilike(organization.slug, `%${search}%`),
		);
		if (searchCondition) conditions.push(searchCondition);
	}
	if (cursor?.id) conditions.push(gt(organization.id, cursor.id));
	const rows = await db
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			status: organization.status,
			role: member.role,
		})
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.where(and(...conditions))
		.orderBy(asc(organization.id))
		.limit(PAGE_SIZE + 1);
	const hasMore = rows.length > PAGE_SIZE;
	const items = rows.slice(0, PAGE_SIZE).map((row) => ({
		...row,
		status: row.status as OrganizationMembershipItem["status"],
		role: row.role as OrganizationMembershipItem["role"],
	}));
	const last = items.at(-1);
	return {
		items,
		nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : undefined,
	};
}

export interface PlatformUserItem {
	id: string;
	name: string;
	email: string;
	role: "admin" | "moderator" | "hr_user" | "user";
	banned: boolean;
	emailVerified: boolean;
	createdAt: Date;
}

export async function listPlatformUsers(input: {
	search?: string | string[];
	cursor?: string;
}): Promise<KeysetPage<PlatformUserItem>> {
	const search = normalizedSearch(input.search);
	const cursor = decodeCursor(input.cursor);
	const conditions: SQL[] = [];
	if (search) {
		const searchCondition = or(
			ilike(user.name, `%${search}%`),
			ilike(user.email, `%${search}%`),
		);
		if (searchCondition) conditions.push(searchCondition);
	}
	if (cursor?.id) conditions.push(gt(user.id, cursor.id));
	const rows = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			banned: user.banned,
			emailVerified: user.emailVerified,
			createdAt: user.createdAt,
		})
		.from(user)
		.where(conditions.length === 0 ? undefined : and(...conditions))
		.orderBy(asc(user.id))
		.limit(PAGE_SIZE + 1);
	const hasMore = rows.length > PAGE_SIZE;
	const items = rows.slice(0, PAGE_SIZE).map((row) => ({
		...row,
		role: row.role as PlatformUserItem["role"],
		banned: row.banned === true,
	}));
	const last = items.at(-1);
	return {
		items,
		nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : undefined,
	};
}

export interface OrganizationMemberItem {
	memberId: string;
	userId: string;
	name: string;
	email: string;
	role: OrganizationRole;
	roleSet: string;
	createdAt: Date;
}

export async function listOrganizationMembers(input: {
	organizationId: string;
	cursor?: string;
}): Promise<KeysetPage<OrganizationMemberItem>> {
	const cursor = decodeCursor(input.cursor);
	const conditions = [eq(member.organizationId, input.organizationId)];
	if (cursor?.id) conditions.push(gt(member.id, cursor.id));
	const rows = await db
		.select({
			memberId: member.id,
			userId: user.id,
			name: user.name,
			email: user.email,
			role: member.role,
			createdAt: member.createdAt,
		})
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(and(...conditions))
		.orderBy(asc(member.id))
		.limit(PAGE_SIZE + 1);
	const hasMore = rows.length > PAGE_SIZE;
	const items = rows.slice(0, PAGE_SIZE).map((row) => ({
		...row,
		...displayOrganizationRole(row.role),
	}));
	const last = items.at(-1);
	return {
		items,
		nextCursor:
			hasMore && last ? encodeCursor({ id: last.memberId }) : undefined,
	};
}

export interface OrganizationInvitationItem {
	id: string;
	email: string;
	role: "admin" | "moderator" | "user";
	status: "pending" | "accepted" | "rejected" | "cancelled" | "expired";
	expiresAt: Date;
	createdAt: Date;
}

export async function listOrganizationInvitations(input: {
	organizationId: string;
	cursor?: string;
}): Promise<KeysetPage<OrganizationInvitationItem>> {
	const cursor = decodeCursor(input.cursor);
	const conditions = [eq(invitation.organizationId, input.organizationId)];
	if (cursor?.id) conditions.push(lt(invitation.id, cursor.id));
	const rows = await db
		.select({
			id: invitation.id,
			email: invitation.email,
			role: invitation.role,
			status: invitation.status,
			expiresAt: invitation.expiresAt,
			createdAt: invitation.createdAt,
		})
		.from(invitation)
		.where(and(...conditions))
		.orderBy(desc(invitation.id))
		.limit(PAGE_SIZE + 1);
	const hasMore = rows.length > PAGE_SIZE;
	const items = rows.slice(0, PAGE_SIZE).map((row) => ({
		...row,
		role: row.role as OrganizationInvitationItem["role"],
		status: row.status as OrganizationInvitationItem["status"],
	}));
	const last = items.at(-1);
	return {
		items,
		nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : undefined,
	};
}

export interface SafeBindingItem {
	id: string;
	applicationId: string;
	isolationMode: "dedicated" | "shared";
	databaseProfile: string;
	databaseLabel: string | null;
	region: string | null;
	status: string;
	schemaVersion: number;
	lastHealthCheckAt: Date | null;
}

export async function listSafeBindings(
	organizationId: string,
): Promise<SafeBindingItem[]> {
	const rows = await db
		.select({
			id: tenantDatabaseBinding.id,
			applicationId: tenantDatabaseBinding.applicationId,
			isolationMode: tenantDatabaseBinding.isolationMode,
			databaseProfile: tenantDatabaseBinding.databaseProfile,
			databaseLabel: tenantDatabaseBinding.databaseLabel,
			region: tenantDatabaseBinding.region,
			status: tenantDatabaseBinding.status,
			schemaVersion: tenantDatabaseBinding.schemaVersion,
			lastHealthCheckAt: tenantDatabaseBinding.lastHealthCheckAt,
		})
		.from(tenantDatabaseBinding)
		.where(eq(tenantDatabaseBinding.organizationId, organizationId))
		.orderBy(asc(tenantDatabaseBinding.applicationId))
		.limit(PAGE_SIZE);
	return rows.map((row) => ({
		...row,
		isolationMode: row.isolationMode as SafeBindingItem["isolationMode"],
	}));
}

export function validAuditEventType(
	value: string | undefined,
): AdminAuditEventType | undefined {
	return value && (ADMIN_AUDIT_EVENT_TYPES as readonly string[]).includes(value)
		? (value as AdminAuditEventType)
		: undefined;
}

export function encodeAuditCursor(
	cursor: AdminAuditReadCursor | undefined,
): string | undefined {
	return cursor
		? encodeCursor({
				occurredAt: cursor.occurredAt.toISOString(),
				eventId: cursor.eventId,
			})
		: undefined;
}

export function decodeAuditCursor(
	value: string | undefined,
): AdminAuditReadCursor | undefined {
	const cursor = decodeCursor(value);
	if (!cursor?.occurredAt || !cursor.eventId) return undefined;
	const occurredAt = new Date(cursor.occurredAt);
	return Number.isNaN(occurredAt.getTime()) || cursor.eventId.length > 128
		? undefined
		: { occurredAt, eventId: cursor.eventId };
}

export async function readScopedAudit(input: {
	session: ServerSession;
	access?: OrganizationAccess;
	cursor?: string;
	eventType?: string;
	outcome?: string;
}): Promise<AdminAuditReadPage> {
	const eventType = validAuditEventType(input.eventType);
	const outcome =
		input.outcome === "success" ||
		input.outcome === "failure" ||
		input.outcome === "denied"
			? input.outcome
			: undefined;
	return readAdminAuditEvents({
		actorUserId: input.session.user.id,
		organizationId: input.access?.organization.id,
		requestId: crypto.randomUUID(),
		cursor: decodeAuditCursor(input.cursor),
		pageSize: PAGE_SIZE,
		eventTypes: eventType ? [eventType] : undefined,
		outcome,
	});
}
