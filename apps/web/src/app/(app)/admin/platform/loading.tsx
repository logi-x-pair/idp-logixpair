import { Card, CardContent, CardHeader } from "@krazil-idp/ui/components/card";
import { Skeleton } from "@krazil-idp/ui/components/skeleton";

const WORKSPACE_CARDS = ["organizations", "users", "audit"] as const;

export default function PlatformAdminLoading() {
	return (
		<main
			aria-busy="true"
			className="mx-auto w-full max-w-7xl px-4 py-8"
			role="status"
		>
			<span className="sr-only">Loading platform administration…</span>
			<div aria-hidden="true">
				<Skeleton className="h-3 w-40" />
				<Skeleton className="mt-2 h-9 w-72 max-w-full" />
				<Skeleton className="mt-3 h-4 w-full max-w-2xl" />
				<div className="mt-8 grid gap-4 md:grid-cols-3">
					{WORKSPACE_CARDS.map((card) => (
						<Card key={card}>
							<CardHeader className="space-y-2">
								<Skeleton className="h-5 w-32" />
								<Skeleton className="h-3 w-full" />
								<Skeleton className="h-3 w-4/5" />
							</CardHeader>
							<CardContent>
								<Skeleton className="h-4 w-32" />
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		</main>
	);
}
