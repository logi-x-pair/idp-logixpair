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
import type { PlatformUserItem } from "@/lib/server/control-queries";
import {
	changePlatformRoleAction,
	createPlatformUserAction,
	setPlatformUserBanAction,
	updatePlatformUserProfileAction,
} from "@/lib/server/platform-actions";
import type { PlatformRole } from "@/lib/server/session";

import ActionFeedback from "./action-feedback";
import ConfirmationSubmit from "./confirmation-submit";

function allowedRoleAssignments(
	actorRole: PlatformRole,
	target: PlatformUserItem,
): PlatformUserItem["role"][] {
	if (target.id === "") return [];
	if (actorRole === "admin") return ["admin", "moderator", "hr_user", "user"];
	if (actorRole === "moderator" && target.role !== "admin") {
		return ["moderator", "hr_user", "user"];
	}
	if (
		actorRole === "hr_user" &&
		(target.role === "hr_user" || target.role === "user")
	) {
		return ["hr_user", "user"];
	}
	return [];
}

export default function PlatformUserWorkspace({
	actorRole,
	users,
	nextHref,
	search,
}: {
	actorRole: PlatformRole;
	users: PlatformUserItem[];
	nextHref?: string;
	search?: string;
}) {
	const [createState, createAction] = useActionState(
		createPlatformUserAction,
		initialActionState,
	);
	const [profileState, profileAction] = useActionState(
		updatePlatformUserProfileAction,
		initialActionState,
	);
	const [roleState, roleAction] = useActionState(
		changePlatformRoleAction,
		initialActionState,
	);
	const [banState, banAction] = useActionState(
		setPlatformUserBanAction,
		initialActionState,
	);

	return (
		<div className="space-y-8">
			<section>
				<p className="font-medium text-primary text-xs uppercase tracking-[0.18em]">
					Platform account lifecycle
				</p>
				<h1 className="mt-1 font-semibold text-3xl tracking-tight">
					Manage user accounts
				</h1>
				<p className="mt-2 max-w-2xl text-muted-foreground text-sm">
					Permissions shown here are discoverability hints. Every submitted
					change is authorized again against the current actor and target state.
				</p>
			</section>

			<Card>
				<CardHeader>
					<CardTitle>Create account</CardTitle>
					<CardDescription>
						New accounts begin with a server-validated password and email
						verification requirement.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form action={createAction} className="grid gap-4 md:grid-cols-2">
						<label className="grid gap-1.5 text-sm" htmlFor="new-account-name">
							Name
							<input
								className="h-9 rounded-md border bg-background px-3"
								id="new-account-name"
								name="name"
								required
							/>
						</label>
						<label className="grid gap-1.5 text-sm" htmlFor="new-account-email">
							Email
							<input
								className="h-9 rounded-md border bg-background px-3"
								id="new-account-email"
								name="email"
								required
								type="email"
							/>
						</label>
						<label
							className="grid gap-1.5 text-sm"
							htmlFor="new-account-password"
						>
							Temporary password
							<input
								className="h-9 rounded-md border bg-background px-3"
								id="new-account-password"
								minLength={12}
								name="password"
								required
								type="password"
							/>
						</label>
						{actorRole === "admin" ? (
							<label
								className="grid gap-1.5 text-sm"
								htmlFor="new-account-role"
							>
								Platform role
								<select
									className="h-9 rounded-md border bg-background px-3"
									id="new-account-role"
									name="role"
									defaultValue="user"
								>
									<option value="user">user</option>
									<option value="hr_user">hr_user</option>
									<option value="moderator">moderator</option>
									<option value="admin">admin</option>
								</select>
							</label>
						) : (
							<input name="role" type="hidden" value="user" />
						)}
						<div className="md:col-span-2">
							<Button type="submit">Create account</Button>
							<ActionFeedback state={createState} />
						</div>
					</form>
				</CardContent>
			</Card>

			<section aria-labelledby="platform-user-list-title" className="space-y-4">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2 id="platform-user-list-title" className="font-semibold text-xl">
							Account directory
						</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							Server-filtered and keyset-paginated.
						</p>
					</div>
					<form className="flex gap-2" method="get">
						<label className="sr-only" htmlFor="platform-user-search">
							Search accounts
						</label>
						<input
							className="h-9 rounded-md border bg-background px-3 text-sm"
							defaultValue={search}
							id="platform-user-search"
							name="q"
							placeholder="Search name or email"
						/>
						<Button type="submit" variant="outline">
							Search
						</Button>
					</form>
				</div>

				{users.length === 0 ? (
					<Card>
						<CardContent className="py-6 text-muted-foreground text-sm">
							No accounts match this view.
						</CardContent>
					</Card>
				) : (
					<div className="relative overflow-x-auto rounded-lg border">
						<table className="w-full min-w-230 text-left text-sm">
							<thead className="border-b bg-muted/35 text-muted-foreground text-xs uppercase tracking-wide">
								<tr>
									<th className="px-3 py-3 font-medium">Account</th>
									<th className="px-3 py-3 font-medium">Role</th>
									<th className="px-3 py-3 font-medium">Access</th>
									<th className="px-3 py-3 font-medium">Actions</th>
								</tr>
							</thead>
							<tbody>
								{users.map((account) => {
									const assignments = allowedRoleAssignments(
										actorRole,
										account,
									);
									const mayBan =
										account.id !== "" &&
										(actorRole === "admin" ||
											(actorRole === "moderator" && account.role !== "admin"));
									return (
										<tr
											key={account.id}
											className="border-b align-top last:border-0"
										>
											<td className="px-3 py-4">
												<p className="font-medium">{account.name}</p>
												<p className="text-muted-foreground text-xs">
													{account.email}
												</p>
											</td>
											<td className="px-3 py-4">
												<span className="rounded-full border px-2 py-0.5 text-xs">
													{account.role}
												</span>
											</td>
											<td className="px-3 py-4">
												{account.banned ? "Banned" : "Active"}
											</td>
											<td className="min-w-105 space-y-2 px-3 py-3">
												<form
													action={profileAction}
													className="flex flex-wrap gap-2"
												>
													<input
														name="targetUserId"
														type="hidden"
														value={account.id}
													/>
													<label
														className="sr-only"
														htmlFor={`name-${account.id}`}
													>
														Update {account.email} name
													</label>
													<input
														className="h-8 rounded-md border bg-background px-2 text-xs"
														defaultValue={account.name}
														id={`name-${account.id}`}
														name="name"
														required
													/>
													<Button size="sm" type="submit" variant="outline">
														Save profile
													</Button>
												</form>
												{assignments.length > 0 && (
													<form
														action={roleAction}
														className="flex flex-wrap gap-2"
													>
														<input
															name="targetUserId"
															type="hidden"
															value={account.id}
														/>
														<input
															name="expectedCurrentRole"
															type="hidden"
															value={account.role}
														/>
														<label
															className="sr-only"
															htmlFor={`role-${account.id}`}
														>
															Change {account.email} role
														</label>
														<select
															className="h-8 rounded-md border bg-background px-2 text-xs"
															defaultValue={account.role}
															id={`role-${account.id}`}
															name="requestedRole"
														>
															{assignments.map((role) => (
																<option key={role} value={role}>
																	{role}
																</option>
															))}
														</select>
														<Button size="sm" type="submit" variant="outline">
															Change role
														</Button>
													</form>
												)}
												{mayBan && (
													<form
														action={banAction}
														id={`ban-${account.id}`}
														className="flex flex-wrap gap-2"
													>
														<input
															name="targetUserId"
															type="hidden"
															value={account.id}
														/>
														<input
															name="banned"
															type="hidden"
															value={account.banned ? "false" : "true"}
														/>
														{!account.banned && (
															<input
																name="banReason"
																type="hidden"
																value="Operator action"
															/>
														)}
														<ConfirmationSubmit
															description={
																account.banned
																	? `Restore ${account.email} access.`
																	: `Ban ${account.email} and revoke current sessions and OAuth tokens.`
															}
															formId={`ban-${account.id}`}
															label={
																account.banned
																	? "Restore access"
																	: "Ban account"
															}
															variant={
																account.banned ? "outline" : "destructive"
															}
														/>
													</form>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
				<ActionFeedback state={profileState} />
				<ActionFeedback state={roleState} />
				<ActionFeedback state={banState} />
				{nextHref && (
					<Link
						className="inline-flex text-sm underline-offset-4 hover:underline"
						href={nextHref as Route}
					>
						Load more accounts
					</Link>
				)}
			</section>
		</div>
	);
}
