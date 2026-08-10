import { loadLaunchpadApplications } from "@/lib/server/applications";
import { requirePageSession } from "@/lib/server/session";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
	const session = await requirePageSession("/dashboard");
	const applications = loadLaunchpadApplications(session);

	return (
		<main className="mx-auto w-full max-w-7xl px-4 py-8">
			<Dashboard applications={applications} session={session} />
		</main>
	);
}
