import { Card, CardHeader } from "@krazil-idp/ui/components/card";
import { Skeleton } from "@krazil-idp/ui/components/skeleton";

const TABLE_ROWS = ["row-one", "row-two", "row-three", "row-four"] as const;

export default function PlatformOrganizationsLoading() {
	return (
		<main
			aria-busy="true"
			className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8"
			role="status"
		>
			<span className="sr-only">Loading platform organizations…</span>
			<div aria-hidden="true" className="space-y-6">
				<div>
					<Skeleton className="h-3 w-40" />
					<Skeleton className="mt-2 h-9 w-64 max-w-full" />
					<Skeleton className="mt-3 h-4 w-full max-w-2xl" />
				</div>
				<Card>
					<CardHeader className="space-y-2">
						<Skeleton className="h-5 w-44" />
						<Skeleton className="h-3 w-full max-w-md" />
					</CardHeader>
					<div className="grid gap-3 p-6 pt-0 sm:grid-cols-2">
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-9 w-full" />
					</div>
				</Card>
				<Card>
					<div className="space-y-4 p-6">
						<div className="flex items-center justify-between gap-3">
							<Skeleton className="h-9 w-full max-w-xs" />
							<Skeleton className="h-9 w-28" />
						</div>
						{TABLE_ROWS.map((row) => (
							<div
								className="flex items-center justify-between gap-4 border-b pb-4"
								key={row}
							>
								<div className="w-full space-y-2">
									<Skeleton className="h-4 w-48 max-w-full" />
									<Skeleton className="h-3 w-32 max-w-full" />
								</div>
								<Skeleton className="h-8 w-40 shrink-0" />
							</div>
						))}
					</div>
				</Card>
			</div>
		</main>
	);
}
