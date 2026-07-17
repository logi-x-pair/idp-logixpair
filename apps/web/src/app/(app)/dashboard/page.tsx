import { auth } from "@krazil-idp/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import Dashboard from "./dashboard";

export default async function DashboardPage() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		redirect("/sign-in");
	}

	return (
		<main className="mx-auto w-full max-w-2xl px-4 py-8">
			<h1 className="font-semibold text-2xl tracking-tight">Dashboard</h1>
			<p className="mt-1 mb-6 text-muted-foreground text-sm">
				Welcome back, {session.user.name}.
			</p>
			<Dashboard session={session} />
		</main>
	);
}
