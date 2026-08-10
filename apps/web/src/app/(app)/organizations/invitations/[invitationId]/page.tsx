import InvitationResolution from "@/components/invitation-resolution";
import { requirePageSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function InvitationResolutionPage({
	params,
}: {
	params: Promise<{ invitationId: string }>;
}) {
	await requirePageSession("/organizations");
	const { invitationId } = await params;

	return (
		<main className="px-4 py-8">
			<InvitationResolution invitationId={invitationId} />
		</main>
	);
}
