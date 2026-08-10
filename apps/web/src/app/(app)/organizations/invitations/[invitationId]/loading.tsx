import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
} from "@krazil-idp/ui/components/card";
import { Skeleton } from "@krazil-idp/ui/components/skeleton";

export default function InvitationResolutionLoading() {
	return (
		<main aria-busy="true" className="px-4 py-8" role="status">
			<span className="sr-only">Loading organization invitation…</span>
			<Card aria-hidden="true" className="mx-auto mt-12 w-full max-w-lg">
				<CardHeader className="space-y-2">
					<Skeleton className="h-5 w-52" />
					<Skeleton className="h-3 w-full" />
					<Skeleton className="h-3 w-5/6" />
				</CardHeader>
				<CardContent>
					<Skeleton className="h-4 w-64 max-w-full" />
				</CardContent>
				<CardFooter className="flex gap-2">
					<Skeleton className="h-8 w-32" />
					<Skeleton className="h-8 w-20" />
				</CardFooter>
			</Card>
		</main>
	);
}
