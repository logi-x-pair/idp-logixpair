import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
} from "@krazil-idp/ui/components/card";
import { Skeleton } from "@krazil-idp/ui/components/skeleton";

const APPLICATION_CARDS = ["application-one", "application-two"] as const;

export default function DashboardLoading() {
	return (
		<main
			aria-busy="true"
			className="mx-auto w-full max-w-7xl px-4 py-8"
			role="status"
		>
			<span className="sr-only">Loading dashboard…</span>
			<div aria-hidden="true" className="space-y-8">
				<section className="space-y-2">
					<Skeleton className="h-3 w-24" />
					<Skeleton className="h-9 w-full max-w-md" />
					<Skeleton className="h-4 w-full max-w-2xl" />
				</section>

				<section>
					<Skeleton className="h-6 w-52" />
					<div className="mt-4 grid gap-4 md:grid-cols-2">
						{APPLICATION_CARDS.map((card) => (
							<Card className="border-l-4 border-l-muted" key={card}>
								<CardHeader className="space-y-2">
									<Skeleton className="h-4 w-40" />
									<Skeleton className="h-3 w-full max-w-sm" />
								</CardHeader>
								<CardContent>
									<Skeleton className="h-8 w-32" />
								</CardContent>
							</Card>
						))}
					</div>
				</section>

				<Card className="max-w-2xl">
					<CardHeader className="space-y-2">
						<Skeleton className="h-4 w-28" />
						<Skeleton className="h-3 w-64 max-w-full" />
					</CardHeader>
					<CardContent className="grid gap-3 sm:grid-cols-3">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</CardContent>
					<CardFooter>
						<Skeleton className="h-4 w-28" />
					</CardFooter>
				</Card>
			</div>
		</main>
	);
}
