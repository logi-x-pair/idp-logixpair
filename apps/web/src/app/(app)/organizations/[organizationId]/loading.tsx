import { Card, CardContent, CardHeader } from "@krazil-idp/ui/components/card";
import { Skeleton } from "@krazil-idp/ui/components/skeleton";

export default function OrganizationContextLoading() {
	return (
		<main
			aria-busy="true"
			className="mx-auto w-full max-w-3xl px-4 py-8"
			role="status"
		>
			<span className="sr-only">Loading organization details…</span>
			<Card aria-hidden="true">
				<CardHeader className="space-y-2">
					<Skeleton className="h-5 w-56 max-w-full" />
					<Skeleton className="h-4 w-80 max-w-full" />
				</CardHeader>
				<CardContent className="space-y-5">
					<div className="space-y-2">
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-5/6" />
					</div>
					<div className="flex flex-wrap gap-3">
						<Skeleton className="h-8 w-32" />
						<Skeleton className="h-4 w-40" />
					</div>
				</CardContent>
			</Card>
		</main>
	);
}
