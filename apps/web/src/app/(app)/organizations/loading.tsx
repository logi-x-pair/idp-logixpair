import { Card, CardContent, CardHeader } from "@krazil-idp/ui/components/card";
import { Skeleton } from "@krazil-idp/ui/components/skeleton";

const ORGANIZATION_CARDS = [
	"organization-one",
	"organization-two",
	"organization-three",
	"organization-four",
] as const;

export default function OrganizationsLoading() {
	return (
		<main
			aria-busy="true"
			className="mx-auto w-full max-w-7xl px-4 py-8"
			role="status"
		>
			<span className="sr-only">Loading organizations…</span>
			<section aria-hidden="true" className="space-y-5">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div className="w-full max-w-2xl space-y-2">
						<Skeleton className="h-3 w-36" />
						<Skeleton className="h-8 w-64 max-w-full" />
						<Skeleton className="h-4 w-full" />
					</div>
					<div className="flex gap-2">
						<Skeleton className="h-9 w-48" />
						<Skeleton className="h-9 w-20" />
					</div>
				</div>

				<div className="grid gap-3 sm:grid-cols-2">
					{ORGANIZATION_CARDS.map((organization) => (
						<Card className="border-l-4 border-l-muted" key={organization}>
							<CardHeader className="space-y-2">
								<div className="flex items-start justify-between gap-3">
									<div className="w-full space-y-2">
										<Skeleton className="h-4 w-40 max-w-full" />
										<Skeleton className="h-3 w-24" />
									</div>
									<Skeleton className="h-5 w-16" />
								</div>
							</CardHeader>
							<CardContent className="flex items-center gap-3">
								<Skeleton className="h-4 w-14" />
								<Skeleton className="h-8 w-24" />
								<Skeleton className="h-4 w-24" />
							</CardContent>
						</Card>
					))}
				</div>
			</section>
		</main>
	);
}
