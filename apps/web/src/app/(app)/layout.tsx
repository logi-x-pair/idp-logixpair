import { headers } from "next/headers";

import Header from "@/components/header";
import { loadNavigationViewModel } from "@/lib/server/navigation";
import { requirePageSession, safeReturnPath } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const requestHeaders = await headers();
	const currentPath = requestHeaders.get("x-pathname");
	const session = await requirePageSession(safeReturnPath(currentPath));
	const navigation = await loadNavigationViewModel(session);

	return (
		<div className="grid min-h-svh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
			<Header navigation={navigation} />
			{children}
		</div>
	);
}
