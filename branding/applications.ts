export interface DashboardApplication {
	clientName: string;
	name: string;
	description: string;
	enabled: boolean;
	requiresOrganization: boolean;
}

/**
 * Explicit launchpad visibility. This is intentionally separate from the full
 * OAuth client seed list so demo, consent, machine, and internal clients are
 * not listed merely because they exist in the control plane.
 */
export const dashboardApplications: DashboardApplication[] = [
	{
		clientName: "Test RP One",
		name: "Test RP One",
		description:
			"A first-party relying-party workspace for the local IdP harness.",
		enabled: true,
		requiresOrganization: false,
	},
	{
		clientName: "Test RP Two",
		name: "Test RP Two",
		description:
			"A second relying-party workspace for silent SSO and logout checks.",
		enabled: true,
		requiresOrganization: false,
	},
];
