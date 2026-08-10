import { Card, CardHeader } from "@krazil-idp/ui/components/card";
import { Skeleton } from "@krazil-idp/ui/components/skeleton";

const MEMBER_ROWS = ["member-one", "member-two", "member-three"] as const;

export default function OrganizationAdministrationLoading() {
	return (
		<main
			aria-busy="true"
			className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8"
			role="status"
		>
			<span className="sr-only">Loading organization administration…</span>
			<div aria-hidden="true" className="space-y-6">
				<div>
					<Skeleton className="h-3 w-48" />
					<Skeleton className="mt-2 h-9 w-72 max-w-full" />
					<Skeleton className="mt-3 h-4 w-full max-w-2xl" />
				</div>
				<div className="space-y-4">
					<Card>
						<CardHeader className="space-y-2">
							<Skeleton className="h-5 w-36" />
							<Skeleton className="h-3 w-full max-w-sm" />
						</CardHeader>
						<div className="grid gap-3 p-6 pt-0 sm:grid-cols-2">
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
						</div>
					</Card>
					<Card>
						<CardHeader className="space-y-2">
							<Skeleton className="h-5 w-32" />
							<Skeleton className="h-3 w-full max-w-sm" />
						</CardHeader>
						<div className="grid gap-3 p-6 pt-0 sm:grid-cols-2">
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
						</div>
					</Card>
				</div>
				<Card>
					<CardHeader className="space-y-2">
						<Skeleton className="h-5 w-28" />
						<Skeleton className="h-3 w-full max-w-md" />
					</CardHeader>
					<div className="space-y-4 p-6 pt-0">
						{MEMBER_ROWS.map((row) => (
							<div
								className="flex items-center justify-between gap-4 border-b pb-4"
								key={row}
							>
								<div className="w-full space-y-2">
									<Skeleton className="h-4 w-52 max-w-full" />
									<Skeleton className="h-3 w-32 max-w-full" />
								</div>
								<div className="flex shrink-0 gap-2">
									<Skeleton className="h-8 w-28" />
									<Skeleton className="h-8 w-20" />
								</div>
							</div>
						))}
					</div>
				</Card>
			</div>
		</main>
	);
}
