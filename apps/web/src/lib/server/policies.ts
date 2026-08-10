import "server-only";

import { parseStoredOrganizationRoles } from "@krazil-idp/auth/organization-policy";
import { db } from "@krazil-idp/db";
import { member, organization } from "@krazil-idp/db/schema/organization";
import { and, eq } from "drizzle-orm";
import type { Route } from "next";
import { redirect } from "next/navigation";

import {
	type PlatformRole,
	requirePageSession,
	resolveServerSession,
	type SafeReturnPath,
	type ServerSession,
} from "./session";

export class AccessDeniedError extends Error {
	readonly status: 401 | 403 | 404;

	constructor(status: 401 | 403 | 404, message: string) {
		super(message);
		this.name = "AccessDeniedError";
		this.status = status;
	}
}

export type OrganizationRole = "admin" | "moderator" | "user";

export interface OrganizationAccess {
	organization: {
		id: string;
		name: string;
		slug: string;
		status: "active" | "suspended" | "archived";
	};
	organizationRole: OrganizationRole | null;
	isPlatformAdmin: boolean;
	canManageProfile: boolean;
	canInviteMembers: boolean;
	canManageMembers: boolean;
	canChangeMemberRoles: boolean;
	canReadAudit: boolean;
}

function organizationRole(value: string | null): OrganizationRole | null {
	if (!value) return null;
	try {
		const roles = parseStoredOrganizationRoles(value);
		return roles.includes("admin")
			? "admin"
			: roles.includes("moderator")
				? "moderator"
				: "user";
	} catch {
		return null;
	}
}

export function isPlatformAccountOperator(role: PlatformRole): boolean {
	return role === "admin" || role === "moderator" || role === "hr_user";
}

export async function requireAuthenticatedAction(
	requestHeaders: Headers,
): Promise<ServerSession> {
	const session = await resolveServerSession(requestHeaders);
	if (!session) {
		throw new AccessDeniedError(401, "Sign in again before continuing");
	}
	return session;
}

export async function requirePlatformAdminAction(
	requestHeaders: Headers,
): Promise<ServerSession> {
	const session = await requireAuthenticatedAction(requestHeaders);
	if (session.user.platformRole !== "admin") {
		throw new AccessDeniedError(
			403,
			"Platform administrator access is required",
		);
	}
	return session;
}

export async function requirePlatformAccountOperatorAction(
	requestHeaders: Headers,
): Promise<ServerSession> {
	const session = await requireAuthenticatedAction(requestHeaders);
	if (!isPlatformAccountOperator(session.user.platformRole)) {
		throw new AccessDeniedError(403, "Account management access is required");
	}
	return session;
}

export async function organizationAccessFor(
	session: ServerSession,
	organizationId: string,
): Promise<OrganizationAccess> {
	const rows = await db
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			status: organization.status,
			membershipRole: member.role,
		})
		.from(organization)
		.leftJoin(
			member,
			and(
				eq(member.organizationId, organization.id),
				eq(member.userId, session.user.id),
			),
		)
		.where(eq(organization.id, organizationId));
	const row = rows[0];
	if (!row) throw new AccessDeniedError(404, "Organization was not found");

	const isPlatformAdmin = session.user.platformRole === "admin";
	const membershipRole = organizationRole(row.membershipRole);
	const activeMembership = row.status === "active" ? membershipRole : null;
	if (!isPlatformAdmin && !activeMembership) {
		throw new AccessDeniedError(403, "Organization access is denied");
	}

	const hasOrganizationAdmin = activeMembership === "admin";
	const hasOrganizationModerator = activeMembership === "moderator";
	const activeOrganization = row.status === "active";
	return {
		organization: {
			id: row.id,
			name: row.name,
			slug: row.slug,
			status: row.status as OrganizationAccess["organization"]["status"],
		},
		organizationRole: membershipRole,
		isPlatformAdmin,
		canManageProfile:
			activeOrganization &&
			(isPlatformAdmin || hasOrganizationAdmin || hasOrganizationModerator),
		canInviteMembers:
			activeOrganization && (isPlatformAdmin || hasOrganizationAdmin),
		canManageMembers:
			activeOrganization &&
			(isPlatformAdmin || hasOrganizationAdmin || hasOrganizationModerator),
		canChangeMemberRoles:
			activeOrganization && (isPlatformAdmin || hasOrganizationAdmin),
		canReadAudit: isPlatformAdmin || hasOrganizationAdmin,
	};
}

export async function requireOrganizationAdministrationPage(
	organizationId: string,
): Promise<{ session: ServerSession; access: OrganizationAccess }> {
	const context = await requirePageOrganization(organizationId);
	const canOpenAdministration =
		context.access.isPlatformAdmin ||
		context.access.canManageProfile ||
		context.access.canManageMembers ||
		context.access.canInviteMembers;
	if (!canOpenAdministration) {
		// Authenticated viewers without administration capability get the same
		// fixed safe redirect as other bounded pages (fail closed, no error
		// page); forged/unknown organization ids are normalized to the same
		// redirect by requirePageOrganization, so this boundary discloses nothing.
		redirect("/organizations" as Route);
	}
	return context;
}

export async function requireOrganizationAction(
	requestHeaders: Headers,
	organizationId: string,
): Promise<{ session: ServerSession; access: OrganizationAccess }> {
	const session = await requireAuthenticatedAction(requestHeaders);
	return {
		session,
		access: await organizationAccessFor(session, organizationId),
	};
}

export async function requirePagePlatformAdmin(
	returnTo: SafeReturnPath = "/admin/platform",
): Promise<ServerSession> {
	const session = await requirePageSession(returnTo);
	if (session.user.platformRole !== "admin") redirect("/dashboard" as Route);
	return session;
}

export async function requirePagePlatformAccountOperator(): Promise<ServerSession> {
	const session = await requirePageSession("/admin/platform/users");
	if (!isPlatformAccountOperator(session.user.platformRole))
		redirect("/dashboard" as Route);
	return session;
}

export async function requirePageOrganization(
	organizationId: string,
): Promise<{ session: ServerSession; access: OrganizationAccess }> {
	const session = await requirePageSession("/organizations");
	try {
		return {
			session,
			access: await organizationAccessFor(session, organizationId),
		};
	} catch (error) {
		if (error instanceof AccessDeniedError) redirect("/organizations" as Route);
		throw error;
	}
}
