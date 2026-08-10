import type { AdminAuditReadPage } from "@krazil-idp/auth/admin-audit-read";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@krazil-idp/ui/components/card";
import type { Route } from "next";
import Link from "next/link";

function eventTime(value: Date): string {
	return value.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export default function AuditEventList({
	page,
	nextHref,
	title = "Audit events",
	description = "Read-only, server-authorized events. Secret-bearing fields are never included.",
}: {
	page: AdminAuditReadPage;
	nextHref?: string;
	title?: string;
	description?: string;
}) {
	return (
		<section aria-labelledby="audit-events-title">
			<Card>
				<CardHeader>
					<CardTitle id="audit-events-title">{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</CardHeader>
				<CardContent>
					{page.items.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							No events match this view.
						</p>
					) : (
						<div className="relative overflow-x-auto">
							<table className="w-full min-w-170 text-left text-sm">
								<thead className="border-b text-muted-foreground text-xs uppercase tracking-wide">
									<tr>
										<th className="px-2 py-2 font-medium">When</th>
										<th className="px-2 py-2 font-medium">Event</th>
										<th className="px-2 py-2 font-medium">Outcome</th>
										<th className="px-2 py-2 font-medium">Reason</th>
										<th className="px-2 py-2 font-medium">Request</th>
									</tr>
								</thead>
								<tbody>
									{page.items.map((event) => (
										<tr key={event.eventId} className="border-b last:border-0">
											<td className="whitespace-nowrap px-2 py-3">
												<time dateTime={event.occurredAt.toISOString()}>
													{eventTime(event.occurredAt)}
												</time>
											</td>
											<td className="px-2 py-3 font-mono text-xs">
												{event.eventType}
											</td>
											<td className="px-2 py-3">{event.outcome}</td>
											<td className="px-2 py-3">{event.reasonCode}</td>
											<td
												className="max-w-56 truncate px-2 py-3 font-mono text-xs"
												title={event.requestId}
											>
												{event.requestId}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					{nextHref && (
						<Link
							className="mt-4 inline-flex text-sm underline-offset-4 hover:underline"
							href={nextHref as Route}
						>
							Load more events
						</Link>
					)}
				</CardContent>
			</Card>
		</section>
	);
}
