import PlatformUserWorkspace from "@/components/platform-user-workspace";
import { listPlatformUsers } from "@/lib/server/control-queries";
import { requirePagePlatformAccountOperator } from "@/lib/server/policies";

export const dynamic = "force-dynamic";

export default async function PlatformUsersPage({
	searchParams,
}: {
	searchParams: Promise<{ cursor?: string; q?: string }>;
}) {
	const session = await requirePagePlatformAccountOperator();
	const params = await searchParams;
	const page = await listPlatformUsers({
		search: params.q,
		cursor: params.cursor,
	});
	const next = page.nextCursor
		? `/admin/platform/users?${new URLSearchParams({
				cursor: page.nextCursor,
				...(params.q ? { q: params.q } : {}),
			}).toString()}`
		: undefined;

	return (
		<main className="mx-auto w-full max-w-7xl px-4 py-8">
			<PlatformUserWorkspace
				actorRole={session.user.platformRole}
				nextHref={next}
				search={params.q}
				users={page.items}
			/>
		</main>
	);
}
