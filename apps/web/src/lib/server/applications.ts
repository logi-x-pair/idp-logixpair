import "server-only";

import { dashboardApplications } from "@krazil-idp/branding/applications";
import { clientSeeds } from "@krazil-idp/branding/clients";

import type { ServerSession } from "./session";

export interface LaunchpadApplication {
	name: string;
	description: string;
	launchUrl: string;
	requiresOrganization: boolean;
}

export function loadLaunchpadApplications(
	session: ServerSession,
): LaunchpadApplication[] {
	return dashboardApplications.flatMap((application) => {
		if (!application.enabled) return [];
		if (
			application.requiresOrganization &&
			!session.session.activeOrganizationId
		)
			return [];
		const client = clientSeeds.find(
			(seed) => seed.name === application.clientName && seed.uri,
		);
		if (!client?.uri) return [];
		return [
			{
				name: application.name,
				description: application.description,
				launchUrl: new URL("/login", client.uri).toString(),
				requiresOrganization: application.requiresOrganization,
			},
		];
	});
}
