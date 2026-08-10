"use client";

import { Button } from "@krazil-idp/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@krazil-idp/ui/components/card";
import { useActionState } from "react";

import { initialActionState } from "@/lib/action-state";
import { resolveInvitationAction } from "@/lib/server/organization-selection-actions";

import ActionFeedback from "./action-feedback";

export default function InvitationResolution({
	invitationId,
}: {
	invitationId: string;
}) {
	const [state, formAction] = useActionState(
		resolveInvitationAction,
		initialActionState,
	);

	return (
		<Card className="mx-auto mt-12 w-full max-w-lg">
			<CardHeader>
				<CardTitle>Organization invitation</CardTitle>
				<CardDescription>
					Your signed-in email, the invitation status, expiry, and organization
					state are checked again before this invitation changes.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ActionFeedback state={state} />
			</CardContent>
			<CardFooter className="flex gap-2">
				<form action={formAction}>
					<input name="invitationId" type="hidden" value={invitationId} />
					<input name="resolution" type="hidden" value="accept" />
					<Button type="submit">Accept invitation</Button>
				</form>
				<form action={formAction}>
					<input name="invitationId" type="hidden" value={invitationId} />
					<input name="resolution" type="hidden" value="reject" />
					<Button type="submit" variant="outline">
						Decline
					</Button>
				</form>
			</CardFooter>
		</Card>
	);
}
