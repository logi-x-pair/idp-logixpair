import { readOrganizationProfile } from "@krazil-idp/auth/organization-profile-service";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@krazil-idp/ui/components/card";
import type { Route } from "next";
import Link from "next/link";
import OrganizationActivation from "@/components/organization-activation";
import { requirePageOrganization } from "@/lib/server/policies";

export const dynamic = "force-dynamic";

export default async function OrganizationContextPage({
	params,
}: {
	params: Promise<{ organizationId: string }>;
}) {
	const { organizationId } = await params;
	const { session, access } = await requirePageOrganization(organizationId);
	const profile = await readOrganizationProfile({
		actorUserId: session.user.id,
		organizationId,
	});

	return (
		<main className="mx-auto w-full max-w-3xl px-4 py-8">
			<Card>
				<CardHeader>
					<CardTitle>{profile.name}</CardTitle>
					<CardDescription>
						{profile.slug} · {profile.status} · your role:{" "}
						{access.organizationRole ?? "platform administrator"}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground text-sm">
						Choose this organization before opening an organization-dependent
						application. Membership and organization status are rechecked when
						you set it active.
					</p>
					<OrganizationActivation
						isActive={session.session.activeOrganizationId === organizationId}
						organizationId={organizationId}
					/>
					{access.canManageProfile && (
						<Link
							className="mt-5 inline-flex text-sm underline-offset-4 hover:underline"
							href={`/admin/organizations/${organizationId}` as Route}
						>
							Manage this organization
						</Link>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
