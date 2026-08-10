import { Skeleton } from "@krazil-idp/ui/components/skeleton";

export default function TwoFactorLoading() {
	return (
		<div aria-busy="true" role="status">
			<span className="sr-only">Loading two-step verification…</span>
			<div aria-hidden="true">
				<Skeleton className="h-7 w-64 max-w-full" />
				<div className="mt-2 mb-6 space-y-2">
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-4 w-4/5" />
				</div>
				<div className="space-y-5">
					<div className="space-y-2">
						<Skeleton className="h-3 w-32" />
						<Skeleton className="h-8 w-full" />
					</div>
					<div className="flex items-start gap-2">
						<Skeleton className="size-4 shrink-0" />
						<div className="w-full space-y-2">
							<Skeleton className="h-4 w-48" />
							<Skeleton className="h-3 w-full" />
						</div>
					</div>
					<Skeleton className="h-8 w-full" />
				</div>
				<div className="mt-6 space-y-3">
					<Skeleton className="mx-auto h-4 w-48" />
					<Skeleton className="mx-auto h-4 w-28" />
				</div>
			</div>
		</div>
	);
}
