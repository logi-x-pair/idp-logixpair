export interface SafeNavigationViewModel {
	user: {
		name: string;
		email: string;
		platformRole: "admin" | "moderator" | "hr_user" | "user";
	};
	activeOrganization: {
		id: string;
		name: string;
		slug: string;
		role: "admin" | "moderator" | "user";
	} | null;
	capabilities: {
		canOpenPlatform: boolean;
		canManageUsers: boolean;
		canManageActiveOrganization: boolean;
		canSwitchOrganizations: boolean;
	};
}
