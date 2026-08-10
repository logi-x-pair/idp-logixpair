"use client";

import { Button } from "@krazil-idp/ui/components/button";
import { useActionState } from "react";

import { initialActionState } from "@/lib/action-state";
import { setActiveOrganizationAction } from "@/lib/server/organization-selection-actions";

import ActionFeedback from "./action-feedback";

export default function OrganizationActivation({
	organizationId,
	isActive,
}: {
	organizationId: string;
	isActive: boolean;
}) {
	const [state, formAction] = useActionState(
		setActiveOrganizationAction,
		initialActionState,
	);

	return (
		<form action={formAction} className="mt-5">
			<input name="organizationId" type="hidden" value={organizationId} />
			<Button disabled={isActive} type="submit">
				{isActive ? "Active organization" : "Set as active organization"}
			</Button>
			<ActionFeedback state={state} />
		</form>
	);
}
