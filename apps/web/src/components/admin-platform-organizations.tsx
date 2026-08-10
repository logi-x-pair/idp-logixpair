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
import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import type {
	PlatformOrganizationItem,
	PlatformUserItem,
} from "@/lib/server/control-queries";
import {
	changeOrganizationStatusAction,
	createOrganizationAction,
} from "@/lib/server/organization-actions";

import ActionFeedback from "./action-feedback";
import ConfirmationSubmit from "./confirmation-submit";

export default function AdminPlatformOrganizations({
	organizations,
	initialAdmins,
	initialAdminNextHref,
	initialAdminSearch,
	nextHref,
	search,
}: {
	organizations: PlatformOrganizationItem[];
	initialAdmins: PlatformUserItem[];
	initialAdminNextHref?: string;
	initialAdminSearch?: string;
	nextHref?: string;
	search?: string;
}) {
	const [createState, createAction] = useActionState(
		createOrganizationAction,
		initialActionState,
	);
	const [statusState, statusAction] = useActionState(
		changeOrganizationStatusAction,
		initialActionState,
	);

	return (
		<div className="space-y-8">
			<section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
				<div>
					<p className="font-medium text-primary text-xs uppercase tracking-[0.18em]">
						Platform control plane
					</p>
					<h1 className="mt-1 font-semibold text-3xl tracking-tight">
						Organizations
					</h1>
					<p className="mt-2 max-w-2xl text-muted-foreground text-sm">
						Create and supervise organization lifecycle state. Binding details
						are kept deliberately separate from credentials.
					</p>
				</div>
				<Card>
					<CardHeader>
						<CardTitle>Organization lifecycle</CardTitle>
						<CardDescription>
							Every change is authorized and recorded before it is visible here.
						</CardDescription>
					</CardHeader>
				</Card>
			</section>

			<Card>
				<CardHeader>
					<CardTitle>Create organization</CardTitle>
					<CardDescription>
						The selected active account becomes the initial organization
						administrator.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="mb-4 flex gap-2" method="get">
						<label className="sr-only" htmlFor="initial-admin-search">
							Search active accounts
						</label>
						<input
							className="h-9 rounded-md border bg-background px-3 text-sm"
							defaultValue={initialAdminSearch}
							id="initial-admin-search"
							name="userQ"
							placeholder="Find an active account"
						/>
						<Button type="submit" variant="outline">
							Find accounts
						</Button>
					</form>
					<form action={createAction} className="grid gap-4 md:grid-cols-2">
						<label className="grid gap-1.5 text-sm" htmlFor="organization-name">
							Organization name
							<input
								className="h-9 rounded-md border bg-background px-3"
								id="organization-name"
								name="name"
								required
							/>
						</label>
						<label className="grid gap-1.5 text-sm" htmlFor="organization-slug">
							Slug
							<input
								className="h-9 rounded-md border bg-background px-3"
								id="organization-slug"
								name="slug"
								pattern="[a-z0-9]+(-[a-z0-9]+)*"
								required
							/>
						</label>
						<label
							className="grid gap-1.5 text-sm"
							htmlFor="organization-initial-admin"
						>
							Initial administrator
							<select
								className="h-9 rounded-md border bg-background px-3"
								id="organization-initial-admin"
								name="initialAdminUserId"
								required
							>
								<option value="">Select an active account</option>
								{initialAdmins.map((account) => (
									<option
										disabled={account.banned}
										key={account.id}
										value={account.id}
									>
										{account.name} · {account.email}
									</option>
								))}
							</select>
						</label>
						{initialAdminNextHref && (
							<Link
								className="mt-2 inline-flex text-sm underline-offset-4 hover:underline"
								href={initialAdminNextHref as Route}
							>
								Load more accounts
							</Link>
						)}
						<label className="grid gap-1.5 text-sm" htmlFor="organization-logo">
							Logo URL (optional)
							<input
								className="h-9 rounded-md border bg-background px-3"
								id="organization-logo"
								name="logo"
								type="url"
							/>
						</label>
						<div className="md:col-span-2">
							<Button type="submit">Create organization</Button>
							<ActionFeedback state={createState} />
						</div>
					</form>
				</CardContent>
			</Card>

			<section aria-labelledby="organization-list-title" className="space-y-4">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2 id="organization-list-title" className="font-semibold text-xl">
							Organization directory
						</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							Server-filtered and keyset-paginated.
						</p>
					</div>
					<form className="flex gap-2" method="get">
						<label className="sr-only" htmlFor="platform-organization-search">
							Search organizations
						</label>
						<input
							className="h-9 rounded-md border bg-background px-3 text-sm"
							defaultValue={search}
							id="platform-organization-search"
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
						<CardContent className="py-6 text-muted-foreground text-sm">
							No organizations match this directory view.
						</CardContent>
					</Card>
				) : (
					<div className="grid gap-3">
						{organizations.map((organization) => {
							const statusFormId = `organization-status-${organization.id}`;
							return (
								<Card key={organization.id}>
									<CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
										<div>
											<p className="font-medium">{organization.name}</p>
											<p className="text-muted-foreground text-sm">
												{organization.slug}
											</p>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<span className="rounded-full border px-2 py-0.5 text-xs">
												{organization.status}
											</span>
											<Link
												className="text-sm underline-offset-4 hover:underline"
												href={
													`/admin/organizations/${organization.id}` as Route
												}
											>
												Open administration
											</Link>
											<form action={statusAction} id={statusFormId}>
												<input
													name="organizationId"
													type="hidden"
													value={organization.id}
												/>
												<input
													name="expectedStatus"
													type="hidden"
													value={organization.status}
												/>
												{organization.status === "active" && (
													<>
														<input
															name="requestedStatus"
															type="hidden"
															value="suspended"
														/>
														<ConfirmationSubmit
															description={`Suspend ${organization.name}. Members cannot use organization administration while suspended.`}
															formId={statusFormId}
															label="Suspend"
															variant="outline"
														/>
													</>
												)}
												{organization.status === "suspended" && (
													<>
														<input
															name="requestedStatus"
															type="hidden"
															value="active"
														/>
														<Button type="submit" variant="outline">
															Restore
														</Button>
													</>
												)}
											</form>
											{organization.status !== "archived" && (
												<form
													action={statusAction}
													id={`${statusFormId}-archive`}
												>
													<input
														name="organizationId"
														type="hidden"
														value={organization.id}
													/>
													<input
														name="expectedStatus"
														type="hidden"
														value={organization.status}
													/>
													<input
														name="requestedStatus"
														type="hidden"
														value="archived"
													/>
													<ConfirmationSubmit
														confirmationLabel={`Type ${organization.name} to archive`}
														description={`Archive ${organization.name}. This is a terminal organization lifecycle state.`}
														formId={`${statusFormId}-archive`}
														label="Archive"
													/>
												</form>
											)}
										</div>
									</CardContent>
								</Card>
							);
						})}
					</div>
				)}
				<ActionFeedback state={statusState} />
				{nextHref && (
					<Link
						className="inline-flex text-sm underline-offset-4 hover:underline"
						href={nextHref as Route}
					>
						Load more organizations
					</Link>
				)}
			</section>
		</div>
	);
}
