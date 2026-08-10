"use client";

import { Button } from "@krazil-idp/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@krazil-idp/ui/components/card";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
	type FormEvent,
	useActionState,
	useEffect,
	useRef,
	useState,
} from "react";
import { initialActionState } from "@/lib/action-state";
import { authClient } from "@/lib/auth-client";
import type { OrganizationMembershipItem } from "@/lib/server/control-queries";
import { setActiveOrganizationAction } from "@/lib/server/organization-selection-actions";

import ActionFeedback from "./action-feedback";

export default function OrganizationSwitcher({
	organizations,
	nextHref,
	search,
	activeOrganizationId,
}: {
	organizations: OrganizationMembershipItem[];
	nextHref?: string;
	search?: string;
	activeOrganizationId: string | null;
}) {
	const [state, formAction] = useActionState(
		setActiveOrganizationAction,
		initialActionState,
	);
	const router = useRouter();
	const searchParams = useSearchParams();
	const [isContinuing, setIsContinuing] = useState(false);
	const [continuationError, setContinuationError] = useState<string | null>(
		null,
	);
	const isOAuthPostLogin =
		searchParams.has("oauth_query") ||
		(searchParams.has("sig") && searchParams.has("ba_param"));

	const continuationStarted = useRef(false);
	useEffect(() => {
		if (
			state.status !== "success" ||
			!isOAuthPostLogin ||
			continuationStarted.current
		)
			return;
		continuationStarted.current = true;

		const continueAuthorization = async () => {
			setIsContinuing(true);
			setContinuationError(null);
			const { data, error } = await authClient.oauth2.continue({
				postLogin: true,
			});
			if (error || !data?.url) {
				setContinuationError(
					"We couldn't resume the application sign-in. Return to the application and try again.",
				);
				setIsContinuing(false);
				continuationStarted.current = false;
				return;
			}
		};

		void continueAuthorization();
	}, [isOAuthPostLogin, state]);

	const submitSearch = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const params = new URLSearchParams(searchParams.toString());
		const searchValue = new FormData(event.currentTarget).get("q");
		const searchTerm =
			typeof searchValue === "string" ? searchValue.trim() : "";
		params.delete("cursor");
		if (searchTerm) params.set("q", searchTerm);
		else params.delete("q");
		router.push(`/organizations?${params.toString()}` as Route);
	};

	return (
		<section
			aria-labelledby="organization-switcher-title"
			className="space-y-5"
		>
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="font-medium text-primary text-xs uppercase tracking-[0.18em]">
						Organization context
					</p>
					<h1
						id="organization-switcher-title"
						className="mt-1 font-semibold text-2xl tracking-tight"
					>
						Choose an organization
					</h1>
					<p className="mt-1 max-w-2xl text-muted-foreground text-sm">
						Your selection is revalidated on the server before it becomes
						active.
					</p>
				</div>
				<form className="flex gap-2" onSubmit={submitSearch}>
					<label className="sr-only" htmlFor="organization-search">
						Search organizations
					</label>
					<input
						className="h-9 rounded-md border bg-background px-3 text-sm"
						defaultValue={search}
						id="organization-search"
						name="q"
						placeholder="Search name or slug"
					/>
					<Button type="submit" variant="outline">
						Search
					</Button>
				</form>
			</div>

			{organizations.length === 0 ? (
				<Card>
					<CardHeader>
						<CardTitle>No organizations found</CardTitle>
						<CardDescription>
							You do not currently have an active organization membership
							matching this search.
						</CardDescription>
					</CardHeader>
				</Card>
			) : (
				<div className="grid gap-3 sm:grid-cols-2">
					{organizations.map((organization) => (
						<Card
							key={organization.id}
							className="border-l-4 border-l-primary/50"
						>
							<CardHeader className="pb-3">
								<div className="flex items-start justify-between gap-3">
									<div>
										<CardTitle>{organization.name}</CardTitle>
										<CardDescription>{organization.slug}</CardDescription>
									</div>
									<span className="rounded-full border px-2 py-0.5 text-xs">
										{organization.role}
									</span>
								</div>
							</CardHeader>
							<CardContent className="flex flex-wrap items-center gap-2">
								<span className="text-muted-foreground text-sm">
									{organization.status}
								</span>
								<form action={formAction}>
									<input
										name="organizationId"
										type="hidden"
										value={organization.id}
									/>
									<Button
										disabled={
											isContinuing ||
											organization.status !== "active" ||
											activeOrganizationId === organization.id
										}
										type="submit"
									>
										{activeOrganizationId === organization.id
											? "Active organization"
											: "Set active"}
									</Button>
								</form>
								{organization.status === "active" && (
									<Link
										className="text-sm underline-offset-4 hover:underline"
										href={
											`/organizations/${organization.id}${
												searchParams.size ? `?${searchParams.toString()}` : ""
											}` as Route
										}
									>
										Review access
									</Link>
								)}
							</CardContent>
						</Card>
					))}
				</div>
			)}
			{continuationError && <p role="alert">{continuationError}</p>}
			{isContinuing && <p role="status">Completing application sign-in…</p>}
			<ActionFeedback state={state} />
			{nextHref && (
				<Link
					className="inline-flex text-sm underline-offset-4 hover:underline"
					href={nextHref as Route}
				>
					Load more organizations
				</Link>
			)}
		</section>
	);
}
