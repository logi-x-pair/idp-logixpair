import OrganizationSwitcher from "@/components/organization-switcher";
import { listUserOrganizations } from "@/lib/server/control-queries";
import { requirePageSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

type SearchParamValue = string | string[] | undefined;

function scalar(value: SearchParamValue): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

function copySearchParams(params: Record<string, SearchParamValue>) {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (Array.isArray(value)) {
			for (const item of value) query.append(key, item);
		} else if (typeof value === "string") {
			query.append(key, value);
		}
	}
	return query;
}

export default async function OrganizationsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, SearchParamValue>>;
}) {
	const session = await requirePageSession("/organizations");
	const params = await searchParams;
	const search = scalar(params.q);
	const cursor = scalar(params.cursor);
	const page = await listUserOrganizations({
		userId: session.user.id,
		search,
		cursor,
	});
	const next = page.nextCursor
		? (() => {
				const query = copySearchParams(params);
				query.set("cursor", page.nextCursor as string);
				return `/organizations?${query.toString()}`;
			})()
		: undefined;

	return (
		<main className="mx-auto w-full max-w-7xl px-4 py-8">
			<OrganizationSwitcher
				activeOrganizationId={session.session.activeOrganizationId}
				nextHref={next}
				organizations={page.items}
				search={search}
			/>
		</main>
	);
}
