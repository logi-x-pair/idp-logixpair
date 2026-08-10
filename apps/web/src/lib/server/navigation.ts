import "server-only";

import { parseStoredOrganizationRoles } from "@krazil-idp/auth/organization-policy";
import { db } from "@krazil-idp/db";
import { member, organization } from "@krazil-idp/db/schema/organization";
import { and, eq } from "drizzle-orm";

import type { SafeNavigationViewModel } from "@/lib/navigation-types";

import type { ServerSession } from "./session";

function navigationRole(
	value: string | null,
): "admin" | "moderator" | "user" | null {
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

export async function loadNavigationViewModel(
	session: ServerSession,
): Promise<SafeNavigationViewModel> {
	let activeOrganization: SafeNavigationViewModel["activeOrganization"] = null;
	if (session.session.activeOrganizationId) {
		const rows = await db
			.select({
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				status: organization.status,
				role: member.role,
			})
			.from(organization)
			.innerJoin(
				member,
				and(
					eq(member.organizationId, organization.id),
					eq(member.userId, session.user.id),
				),
			)
			.where(eq(organization.id, session.session.activeOrganizationId))
			.limit(1);
		const current = rows[0];
		const role = current ? navigationRole(current.role) : null;
		if (current?.status === "active" && role) {
			activeOrganization = {
				id: current.id,
				name: current.name,
				slug: current.slug,
				role,
			};
		}
	}

	const canOpenPlatform = session.user.platformRole === "admin";
	const canManageUsers =
		session.user.platformRole === "admin" ||
		session.user.platformRole === "moderator" ||
		session.user.platformRole === "hr_user";
	return {
		user: {
			name: session.user.name,
			email: session.user.email,
			platformRole: session.user.platformRole,
		},
		activeOrganization,
		capabilities: {
			canOpenPlatform,
			canManageUsers,
			canManageActiveOrganization:
				activeOrganization?.role === "admin" ||
				activeOrganization?.role === "moderator",
			canSwitchOrganizations: true,
		},
	};
}
