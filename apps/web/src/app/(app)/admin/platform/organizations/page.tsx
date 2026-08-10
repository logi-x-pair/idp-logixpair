import AdminPlatformOrganizations from "@/components/admin-platform-organizations";
import {
	listPlatformOrganizations,
	listPlatformUsers,
} from "@/lib/server/control-queries";
import { requirePagePlatformAdmin } from "@/lib/server/policies";

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

export default async function PlatformOrganizationsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, SearchParamValue>>;
}) {
	await requirePagePlatformAdmin();
	const params = await searchParams;
	const organizationSearch = scalar(params.q);
	const organizationCursor = scalar(params.cursor);
	const initialAdminSearch = scalar(params.userQ);
	const initialAdminCursor = scalar(params.userCursor);
	const [organizations, accounts] = await Promise.all([
		listPlatformOrganizations({
			search: organizationSearch,
			cursor: organizationCursor,
		}),
		listPlatformUsers({
			search: initialAdminSearch,
			cursor: initialAdminCursor,
		}),
	]);
	const next = organizations.nextCursor
		? (() => {
				const query = copySearchParams(params);
				query.set("cursor", organizations.nextCursor as string);
				return `/admin/platform/organizations?${query.toString()}`;
			})()
		: undefined;
	const initialAdminNextHref = accounts.nextCursor
		? (() => {
				const query = copySearchParams(params);
				query.set("userCursor", accounts.nextCursor as string);
				return `/admin/platform/organizations?${query.toString()}`;
			})()
		: undefined;

	return (
		<main className="mx-auto w-full max-w-7xl px-4 py-8">
			<AdminPlatformOrganizations
				initialAdminNextHref={initialAdminNextHref}
				initialAdminSearch={initialAdminSearch}
				initialAdmins={accounts.items}
				nextHref={next}
				organizations={organizations.items}
				search={organizationSearch}
			/>
		</main>
	);
}
