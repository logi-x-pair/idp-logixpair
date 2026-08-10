import { Button } from "@krazil-idp/ui/components/button";

import AuditEventList from "@/components/audit-event-list";
import {
	encodeAuditCursor,
	readScopedAudit,
} from "@/lib/server/control-queries";
import { requirePagePlatformAdmin } from "@/lib/server/policies";

export const dynamic = "force-dynamic";

export default async function PlatformAuditPage({
	searchParams,
}: {
	searchParams: Promise<{
		cursor?: string;
		eventType?: string;
		outcome?: string;
	}>;
}) {
	const session = await requirePagePlatformAdmin();
	const params = await searchParams;
	const page = await readScopedAudit({
		session,
		cursor: params.cursor,
		eventType: params.eventType,
		outcome: params.outcome,
	});
	const cursor = encodeAuditCursor(page.nextCursor);
	const next = cursor
		? `/admin/platform/audit?${new URLSearchParams({
				cursor,
				...(params.eventType ? { eventType: params.eventType } : {}),
				...(params.outcome ? { outcome: params.outcome } : {}),
			}).toString()}`
		: undefined;

	return (
		<main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8">
			<div>
				<p className="font-medium text-primary text-xs uppercase tracking-[0.18em]">
					Platform control plane
				</p>
				<h1 className="mt-1 font-semibold text-3xl tracking-tight">
					Audit trail
				</h1>
				<p className="mt-2 text-muted-foreground text-sm">
					Bounded, read-only filters. Event details never render credential or
					token material.
				</p>
			</div>
			<form
				className="flex flex-wrap gap-3 rounded-lg border bg-muted/20 p-4"
				method="get"
			>
				<label className="grid gap-1 text-sm" htmlFor="audit-outcome">
					Outcome
					<select
						className="h-9 rounded-md border bg-background px-3"
						defaultValue={params.outcome ?? ""}
						id="audit-outcome"
						name="outcome"
					>
						<option value="">All outcomes</option>
						<option value="success">success</option>
						<option value="failure">failure</option>
						<option value="denied">denied</option>
					</select>
				</label>
				<label
					className="grid min-w-64 gap-1 text-sm"
					htmlFor="audit-event-type"
				>
					Event type
					<input
						className="h-9 rounded-md border bg-background px-3"
						defaultValue={params.eventType}
						id="audit-event-type"
						name="eventType"
						placeholder="e.g. admin.organization.created"
					/>
				</label>
				<div className="flex items-end">
					<Button type="submit" variant="outline">
						Apply filters
					</Button>
				</div>
			</form>
			<AuditEventList nextHref={next} page={page} />
		</main>
	);
}
