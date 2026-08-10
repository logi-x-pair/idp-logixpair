import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@krazil-idp/ui/components/card";
import type { Route } from "next";
import Link from "next/link";

import type { LaunchpadApplication } from "@/lib/server/applications";
import type { ServerSession } from "@/lib/server/session";

export default function Dashboard({
	session,
	applications,
}: {
	session: ServerSession;
	applications: LaunchpadApplication[];
}) {
	const expiresLabel = new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(session.session.expiresAt);

	return (
		<div className="space-y-8">
			<section>
				<p className="font-medium text-primary text-xs uppercase tracking-[0.18em]">
					Applications
				</p>
				<h1 className="mt-1 font-semibold text-3xl tracking-tight">
					Welcome back, {session.user.name}
				</h1>
				<p className="mt-2 max-w-2xl text-muted-foreground text-sm">
					Launch an approved relying party from a server-derived list. The
					browser never constructs an authorization request.
				</p>
			</section>

			<section aria-labelledby="application-list-title">
				<h2 id="application-list-title" className="font-semibold text-xl">
					Available applications
				</h2>
				{applications.length === 0 ? (
					<Card className="mt-4">
						<CardContent className="py-6 text-muted-foreground text-sm">
							No applications are available for this account and organization
							context.
						</CardContent>
					</Card>
				) : (
					<div className="mt-4 grid gap-4 md:grid-cols-2">
						{applications.map((application) => (
							<Card
								key={application.name}
								className="border-l-4 border-l-primary/60"
							>
								<CardHeader>
									<CardTitle>{application.name}</CardTitle>
									<CardDescription>{application.description}</CardDescription>
								</CardHeader>
								<CardContent>
									<a
										className="inline-flex rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										href={application.launchUrl}
									>
										Open application
									</a>
								</CardContent>
							</Card>
						))}
					</div>
				)}
			</section>

			<Card className="max-w-2xl">
				<CardHeader>
					<CardTitle>Your session</CardTitle>
					<CardDescription>
						The account this session is signed in as.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<dl className="grid gap-3 sm:grid-cols-3">
						<div className="grid gap-0.5">
							<dt className="text-muted-foreground">Email</dt>
							<dd className="text-sm">{session.user.email}</dd>
						</div>
						<div className="grid gap-0.5">
							<dt className="text-muted-foreground">Platform role</dt>
							<dd className="text-sm">{session.user.platformRole}</dd>
						</div>
						<div className="grid gap-0.5">
							<dt className="text-muted-foreground">Session expires</dt>
							<dd className="text-sm">
								<time dateTime={session.session.expiresAt.toISOString()}>
									{expiresLabel}
								</time>
							</dd>
						</div>
					</dl>
				</CardContent>
				<CardFooter>
					<Link
						className="text-sm underline-offset-4 hover:underline"
						href={"/account" as Route}
					>
						Manage account
					</Link>
				</CardFooter>
			</Card>
		</div>
	);
}
