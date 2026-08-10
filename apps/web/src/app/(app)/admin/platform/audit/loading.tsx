import { Card } from "@krazil-idp/ui/components/card";
import { Skeleton } from "@krazil-idp/ui/components/skeleton";

const EVENT_ROWS = [
	"event-one",
	"event-two",
	"event-three",
	"event-four",
] as const;

export default function PlatformAuditLoading() {
	return (
		<main
			aria-busy="true"
			className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8"
			role="status"
		>
			<span className="sr-only">Loading audit trail…</span>
			<div aria-hidden="true" className="space-y-6">
				<div>
					<Skeleton className="h-3 w-40" />
					<Skeleton className="mt-2 h-9 w-48 max-w-full" />
					<Skeleton className="mt-3 h-4 w-full max-w-2xl" />
				</div>
				<div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-4">
					<Skeleton className="h-14 w-40" />
					<Skeleton className="h-14 w-full max-w-xs" />
					<Skeleton className="h-9 w-32" />
				</div>
				<Card>
					<div className="space-y-4 p-6">
						{EVENT_ROWS.map((row) => (
							<div
								className="flex items-center justify-between gap-4 border-b pb-4"
								key={row}
							>
								<div className="w-full space-y-2">
									<Skeleton className="h-4 w-64 max-w-full" />
									<Skeleton className="h-3 w-40 max-w-full" />
								</div>
								<Skeleton className="h-6 w-20 shrink-0" />
							</div>
						))}
					</div>
				</Card>
			</div>
		</main>
	);
}
