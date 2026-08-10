import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@krazil-idp/ui/components/card";
import type { Route } from "next";
import Link from "next/link";

import { requirePagePlatformAdmin } from "@/lib/server/policies";

export const dynamic = "force-dynamic";

const destinations = [
	{
		href: "/admin/platform/organizations",
		title: "Organizations",
		description:
			"Create organizations and supervise lifecycle and safe binding status.",
	},
	{
		href: "/admin/platform/users",
		title: "User accounts",
		description:
			"Manage platform account lifecycle within the current role hierarchy.",
	},
	{
		href: "/admin/platform/audit",
		title: "Audit trail",
		description: "Review read-only control-plane events with bounded filters.",
	},
] as const;

export default async function PlatformAdministrationPage() {
	await requirePagePlatformAdmin();

	return (
		<main className="mx-auto w-full max-w-7xl px-4 py-8">
			<p className="font-medium text-primary text-xs uppercase tracking-[0.18em]">
				Platform control plane
			</p>
			<h1 className="mt-1 font-semibold text-3xl tracking-tight">
				Platform administration
			</h1>
			<p className="mt-2 max-w-2xl text-muted-foreground text-sm">
				Choose a bounded workspace. Every read and mutation rechecks server
				authority.
			</p>
			<div className="mt-8 grid gap-4 md:grid-cols-3">
				{destinations.map((destination) => (
					<Card
						key={destination.href}
						className="transition-colors hover:border-primary/60"
					>
						<CardHeader>
							<CardTitle>{destination.title}</CardTitle>
							<CardDescription>{destination.description}</CardDescription>
						</CardHeader>
						<CardContent>
							<Link
								className="text-sm underline-offset-4 hover:underline"
								href={destination.href as Route}
							>
								Open workspace
							</Link>
						</CardContent>
					</Card>
				))}
			</div>
		</main>
	);
}
