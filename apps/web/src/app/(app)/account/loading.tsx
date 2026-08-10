import { env } from "@krazil-idp/env/server";
import { Skeleton } from "@krazil-idp/ui/components/skeleton";

const CONNECTED_APPLICATIONS = ["application-one", "application-two"] as const;

export default function AccountLoading() {
	return (
		<main
			aria-busy="true"
			className="mx-auto w-full max-w-2xl px-4 py-8"
			role="status"
		>
			<span className="sr-only">Loading account settings…</span>
			<div aria-hidden="true">
				<Skeleton className="h-7 w-32" />
				<Skeleton className="mt-2 h-4 w-56 max-w-full" />

				{env.TWO_FACTOR_ENABLED === "true" && (
					<section className="mt-8 border-t pt-6">
						<Skeleton className="h-5 w-48" />
						<Skeleton className="mt-2 h-4 w-full max-w-lg" />
						<div className="mt-5 space-y-4">
							<Skeleton className="h-3 w-20" />
							<Skeleton className="h-8 w-full" />
							<Skeleton className="h-8 w-36" />
						</div>
					</section>
				)}

				<section className="mt-8">
					<Skeleton className="h-5 w-52" />
					<Skeleton className="mt-2 h-4 w-80 max-w-full" />
					<ul className="mt-4 space-y-4">
						{CONNECTED_APPLICATIONS.map((application) => (
							<li
								className="flex items-center justify-between gap-4 rounded-lg border p-4"
								key={application}
							>
								<div className="w-full max-w-sm space-y-2">
									<Skeleton className="h-4 w-40" />
									<Skeleton className="h-3 w-64 max-w-full" />
								</div>
								<Skeleton className="h-7 w-20 shrink-0" />
							</li>
						))}
					</ul>
				</section>
			</div>
		</main>
	);
}
