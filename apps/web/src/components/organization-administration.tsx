"use client";

import type { AdminAuditReadPage } from "@krazil-idp/auth/admin-audit-read";
import type { OrganizationProfile } from "@krazil-idp/auth/organization-lifecycle-service";
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
import { type ComponentProps, useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { initialActionState } from "@/lib/action-state";
import type {
	OrganizationInvitationItem,
	OrganizationMemberItem,
	SafeBindingItem,
} from "@/lib/server/control-queries";
import {
	cancelOrganizationInvitationAction,
	changeOrganizationMemberRoleAction,
	inviteOrganizationMemberAction,
	removeOrganizationMemberAction,
	updateOrganizationProfileAction,
} from "@/lib/server/organization-actions";

import ActionFeedback from "./action-feedback";
import AuditEventList from "./audit-event-list";
import ConfirmationSubmit from "./confirmation-submit";

interface OrganizationAdministrationProps {
	profile: OrganizationProfile;
	access: {
		organizationRole: "admin" | "moderator" | "user" | null;
		isPlatformAdmin: boolean;
		canManageProfile: boolean;
		canInviteMembers: boolean;
		canManageMembers: boolean;
		canChangeMemberRoles: boolean;
		canReadAudit: boolean;
	};
	members: OrganizationMemberItem[];
	memberNextHref?: string;
	invitations: OrganizationInvitationItem[];
	invitationNextHref?: string;
	bindings: SafeBindingItem[];
	auditPage?: AdminAuditReadPage;
	auditNextHref?: string;
}

function PendingSubmitButton({
	children,
	...props
}: ComponentProps<typeof Button>) {
	const { pending } = useFormStatus();
	return (
		<Button {...props} aria-busy={pending} disabled={pending || props.disabled}>
			{pending ? "Working…" : children}
		</Button>
	);
}

function bindingTime(value: Date | null): string {
	if (!value) return "No health check recorded";
	return value.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export default function OrganizationAdministration({
	profile,
	access,
	members,
	memberNextHref,
	invitations,
	invitationNextHref,
	bindings,
	auditPage,
	auditNextHref,
}: OrganizationAdministrationProps) {
	const [profileState, profileAction] = useActionState(
		updateOrganizationProfileAction,
		initialActionState,
	);
	const [inviteState, inviteAction] = useActionState(
		inviteOrganizationMemberAction,
		initialActionState,
	);
	const [roleState, roleAction] = useActionState(
		changeOrganizationMemberRoleAction,
		initialActionState,
	);
	const [removeState, removeAction] = useActionState(
		removeOrganizationMemberAction,
		initialActionState,
	);
	const [cancelState, cancelAction] = useActionState(
		cancelOrganizationInvitationAction,
		initialActionState,
	);
	const [copied, setCopied] = useState(false);
	const canEditSlug =
		access.isPlatformAdmin || access.organizationRole === "admin";
	const mayRemove = (role: OrganizationMemberItem["role"]) =>
		access.isPlatformAdmin ||
		access.organizationRole === "admin" ||
		role === "user";

	return (
		<div className="space-y-8">
			<section>
				<p className="font-medium text-primary text-xs uppercase tracking-[0.18em]">
					Organization administration
				</p>
				<h1 className="mt-1 font-semibold text-3xl tracking-tight">
					{profile.name}
				</h1>
				<p className="mt-2 text-muted-foreground text-sm">
					{profile.slug} · {profile.status} ·{" "}
					{access.organizationRole ?? "platform administrator"}
				</p>
			</section>

			{access.canManageProfile && (
				<Card>
					<CardHeader>
						<CardTitle>Organization profile</CardTitle>
						<CardDescription>
							Only safe display metadata is editable here.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form action={profileAction} className="grid gap-4 md:grid-cols-3">
							<input name="organizationId" type="hidden" value={profile.id} />
							<label
								className="grid gap-1.5 text-sm"
								htmlFor="organization-profile-name"
							>
								Name
								<input
									className="h-9 rounded-md border bg-background px-3"
									defaultValue={profile.name}
									id="organization-profile-name"
									name="name"
									required
								/>
							</label>
							{canEditSlug && (
								<label
									className="grid gap-1.5 text-sm"
									htmlFor="organization-profile-slug"
								>
									Slug
									<input
										className="h-9 rounded-md border bg-background px-3"
										defaultValue={profile.slug}
										id="organization-profile-slug"
										name="slug"
										required
									/>
								</label>
							)}
							<label
								className="grid gap-1.5 text-sm"
								htmlFor="organization-profile-logo"
							>
								Logo URL
								<input
									className="h-9 rounded-md border bg-background px-3"
									defaultValue={profile.logo ?? ""}
									id="organization-profile-logo"
									name="logo"
									type="url"
								/>
							</label>
							<div className="md:col-span-3">
								<PendingSubmitButton type="submit">
									Save profile
								</PendingSubmitButton>
								<ActionFeedback state={profileState} />
							</div>
						</form>
					</CardContent>
				</Card>
			)}

			{access.canInviteMembers && (
				<Card>
					<CardHeader>
						<CardTitle>Invite member</CardTitle>
						<CardDescription>
							The invitation transaction completes before an operator-copied
							fixed-origin link is available.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							action={inviteAction}
							className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem_auto]"
						>
							<input name="organizationId" type="hidden" value={profile.id} />
							<label className="grid gap-1.5 text-sm" htmlFor="invite-email">
								Email
								<input
									className="h-9 rounded-md border bg-background px-3"
									id="invite-email"
									name="email"
									required
									type="email"
								/>
							</label>
							<label className="grid gap-1.5 text-sm" htmlFor="invite-role">
								Organization role
								<select
									className="h-9 rounded-md border bg-background px-3"
									defaultValue="user"
									id="invite-role"
									name="role"
								>
									<option value="user">user</option>
									<option value="moderator">moderator</option>
									<option value="admin">admin</option>
								</select>
							</label>
							<div className="flex items-end">
								<PendingSubmitButton type="submit">
									Create invitation
								</PendingSubmitButton>
							</div>
						</form>
						<ActionFeedback state={inviteState} />
						{inviteState.shareLink && (
							<div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
								<label className="sr-only" htmlFor="invitation-link">
									Invitation share link
								</label>
								<input
									className="min-w-0 flex-1 bg-transparent text-sm"
									id="invitation-link"
									readOnly
									value={inviteState.shareLink}
								/>
								<Button
									onClick={async () => {
										await navigator.clipboard.writeText(
											inviteState.shareLink ?? "",
										);
										setCopied(true);
										window.setTimeout(() => setCopied(false), 2_000);
									}}
									type="button"
									variant="outline"
								>
									{copied ? "Copied" : "Copy link"}
								</Button>
							</div>
						)}
					</CardContent>
				</Card>
			)}

			<section aria-labelledby="member-list-title">
				<Card>
					<CardHeader>
						<CardTitle id="member-list-title">Members</CardTitle>
						<CardDescription>
							Role and removal controls are filtered for clarity and authorized
							again on submit.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{members.length === 0 ? (
							<p className="text-muted-foreground text-sm">No members found.</p>
						) : (
							<div className="relative overflow-x-auto">
								<table className="w-full min-w-200 text-left text-sm">
									<thead className="border-b text-muted-foreground text-xs uppercase tracking-wide">
										<tr>
											<th className="px-2 py-2">Member</th>
											<th className="px-2 py-2">Role</th>
											<th className="px-2 py-2">Actions</th>
										</tr>
									</thead>
									<tbody>
										{members.map((member) => (
											<tr
												className="border-b last:border-0"
												key={member.memberId}
											>
												<td className="px-2 py-3">
													<p className="font-medium">{member.name}</p>
													<p className="text-muted-foreground text-xs">
														{member.email}
													</p>
												</td>
												<td className="px-2 py-3">
													<span className="rounded-full border px-2 py-0.5 text-xs">
														{member.roleSet}
													</span>
												</td>
												<td className="min-w-90 space-y-2 px-2 py-3">
													{access.canChangeMemberRoles &&
														member.roleSet === member.role && (
															<form
																action={roleAction}
																className="flex flex-wrap gap-2"
															>
																<input
																	name="organizationId"
																	type="hidden"
																	value={profile.id}
																/>
																<input
																	name="targetUserId"
																	type="hidden"
																	value={member.userId}
																/>
																<input
																	name="expectedCurrentRole"
																	type="hidden"
																	value={member.role}
																/>
																<label
																	className="sr-only"
																	htmlFor={`member-role-${member.memberId}`}
																>
																	Change {member.email} role
																</label>
																<select
																	className="h-8 rounded-md border bg-background px-2 text-xs"
																	defaultValue={member.role}
																	id={`member-role-${member.memberId}`}
																	name="requestedRole"
																>
																	<option value="user">user</option>
																	<option value="moderator">moderator</option>
																	<option value="admin">admin</option>
																</select>
																<PendingSubmitButton
																	size="sm"
																	type="submit"
																	variant="outline"
																>
																	Change role
																</PendingSubmitButton>
															</form>
														)}
													{access.canManageMembers &&
														member.roleSet === member.role &&
														mayRemove(member.role) && (
															<form
																action={removeAction}
																id={`remove-member-${member.memberId}`}
															>
																<input
																	name="organizationId"
																	type="hidden"
																	value={profile.id}
																/>
																<input
																	name="targetUserId"
																	type="hidden"
																	value={member.userId}
																/>
																<input
																	name="expectedCurrentRole"
																	type="hidden"
																	value={member.role}
																/>
																<ConfirmationSubmit
																	description={`Remove ${member.email} from ${profile.name}.`}
																	formId={`remove-member-${member.memberId}`}
																	label="Remove member"
																/>
															</form>
														)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
						<ActionFeedback state={roleState} />
						<ActionFeedback state={removeState} />
						{memberNextHref && (
							<Link
								className="mt-4 inline-flex text-sm underline-offset-4 hover:underline"
								href={memberNextHref as Route}
							>
								Load more members
							</Link>
						)}
					</CardContent>
				</Card>
			</section>

			{access.canInviteMembers && (
				<section aria-labelledby="invitation-list-title">
					<Card>
						<CardHeader>
							<CardTitle id="invitation-list-title">Invitations</CardTitle>
							<CardDescription>
								Pending invitations can be cancelled before acceptance.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{invitations.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									No invitations found.
								</p>
							) : (
								<div className="space-y-2">
									{invitations.map((invitation) => (
										<div
											className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
											key={invitation.id}
										>
											<div>
												<p className="font-medium text-sm">
													{invitation.email}
												</p>
												<p className="text-muted-foreground text-xs">
													{invitation.role} · {invitation.status} · expires{" "}
													{bindingTime(invitation.expiresAt)}
												</p>
											</div>
											{invitation.status === "pending" && (
												<form
													action={cancelAction}
													id={`cancel-invitation-${invitation.id}`}
												>
													<input
														name="organizationId"
														type="hidden"
														value={profile.id}
													/>
													<input
														name="invitationId"
														type="hidden"
														value={invitation.id}
													/>
													<ConfirmationSubmit
														description={`Cancel the pending invitation for ${invitation.email}.`}
														formId={`cancel-invitation-${invitation.id}`}
														label="Cancel invitation"
														variant="outline"
													/>
												</form>
											)}
										</div>
									))}
								</div>
							)}
							<ActionFeedback state={cancelState} />
							{invitationNextHref && (
								<Link
									className="mt-4 inline-flex text-sm underline-offset-4 hover:underline"
									href={invitationNextHref as Route}
								>
									Load more invitations
								</Link>
							)}
						</CardContent>
					</Card>
				</section>
			)}

			{access.isPlatformAdmin && (
				<section aria-labelledby="binding-status-title">
					<Card>
						<CardHeader>
							<CardTitle id="binding-status-title">Binding status</CardTitle>
							<CardDescription>
								Control-plane status only. Credentials, secret references,
								connection strings, and private addresses are never rendered.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{bindings.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									No binding is registered for this organization.
								</p>
							) : (
								<div className="grid gap-3 md:grid-cols-2">
									{bindings.map((binding) => (
										<article className="rounded-md border p-4" key={binding.id}>
											<p className="font-medium">
												{binding.databaseLabel ?? binding.applicationId}
											</p>
											<dl className="mt-3 grid gap-1 text-sm">
												<div className="flex justify-between gap-3">
													<dt className="text-muted-foreground">Mode</dt>
													<dd>{binding.isolationMode}</dd>
												</div>
												<div className="flex justify-between gap-3">
													<dt className="text-muted-foreground">Status</dt>
													<dd>{binding.status}</dd>
												</div>
												<div className="flex justify-between gap-3">
													<dt className="text-muted-foreground">Region</dt>
													<dd>{binding.region ?? "Not recorded"}</dd>
												</div>
												<div className="flex justify-between gap-3">
													<dt className="text-muted-foreground">Schema</dt>
													<dd>v{binding.schemaVersion}</dd>
												</div>
												<div className="flex justify-between gap-3">
													<dt className="text-muted-foreground">Health</dt>
													<dd>{bindingTime(binding.lastHealthCheckAt)}</dd>
												</div>
											</dl>
										</article>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</section>
			)}

			{access.canReadAudit && auditPage && (
				<AuditEventList
					description="Only organization-scoped member and organization events are visible here."
					nextHref={auditNextHref}
					page={auditPage}
					title="Organization audit events"
				/>
			)}
		</div>
	);
}
