import { readOrganizationProfile } from "@krazil-idp/auth/organization-profile-service";
import OrganizationAdministration from "@/components/organization-administration";
import {
	encodeAuditCursor,
	listOrganizationInvitations,
	listOrganizationMembers,
	listSafeBindings,
	readScopedAudit,
} from "@/lib/server/control-queries";
import { requireOrganizationAdministrationPage } from "@/lib/server/policies";

export const dynamic = "force-dynamic";

type SearchParamValue = string | string[] | undefined;

function scalar(value: SearchParamValue): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

function cursorHref(
	organizationId: string,
	params: Record<string, SearchParamValue>,
	key: string,
	cursor: string,
): string {
	const query = new URLSearchParams();
	for (const [name, value] of Object.entries(params)) {
		if (Array.isArray(value)) {
			for (const item of value) query.append(name, item);
		} else if (typeof value === "string") {
			query.append(name, value);
		}
	}
	query.set(key, cursor);
	return `/admin/organizations/${organizationId}?${query.toString()}`;
}

export default async function OrganizationAdministrationPage({
	params,
	searchParams,
}: {
	params: Promise<{ organizationId: string }>;
	searchParams: Promise<Record<string, SearchParamValue>>;
}) {
	const { organizationId } = await params;
	const query = await searchParams;
	const { session, access } =
		await requireOrganizationAdministrationPage(organizationId);
	const [profile, members, invitations, bindings, auditPage] =
		await Promise.all([
			readOrganizationProfile({ actorUserId: session.user.id, organizationId }),
			listOrganizationMembers({
				organizationId,
				cursor: scalar(query.memberCursor),
			}),
			access.canInviteMembers
				? listOrganizationInvitations({
						organizationId,
						cursor: scalar(query.invitationCursor),
					})
				: Promise.resolve({
						items: [],
						nextCursor: undefined as string | undefined,
					}),
			access.isPlatformAdmin
				? listSafeBindings(organizationId)
				: Promise.resolve([]),
			access.canReadAudit
				? readScopedAudit({
						session,
						access,
						cursor: scalar(query.auditCursor),
					})
				: Promise.resolve(undefined),
		]);
	const memberNextHref = members.nextCursor
		? cursorHref(organizationId, query, "memberCursor", members.nextCursor)
		: undefined;
	const invitationNextHref = invitations.nextCursor
		? cursorHref(
				organizationId,
				query,
				"invitationCursor",
				invitations.nextCursor,
			)
		: undefined;
	const auditCursor = encodeAuditCursor(auditPage?.nextCursor);
	const auditNextHref = auditCursor
		? cursorHref(organizationId, query, "auditCursor", auditCursor)
		: undefined;

	return (
		<main className="mx-auto w-full max-w-7xl px-4 py-8">
			<OrganizationAdministration
				access={access}
				auditNextHref={auditNextHref}
				auditPage={auditPage}
				bindings={bindings}
				invitationNextHref={invitationNextHref}
				invitations={invitations.items}
				memberNextHref={memberNextHref}
				members={members.items}
				profile={profile}
			/>
		</main>
	);
}
