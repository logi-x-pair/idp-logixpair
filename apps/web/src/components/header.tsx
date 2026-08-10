import { branding } from "@krazil-idp/branding/config";
import type { Route } from "next";
import Link from "next/link";

import type { SafeNavigationViewModel } from "@/lib/navigation-types";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header({
	navigation,
}: {
	navigation: SafeNavigationViewModel;
}) {
	return (
		<header className="border-b bg-background">
			<div className="mx-auto flex min-h-14 w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2">
				<nav
					aria-label="Primary"
					className="flex flex-wrap items-center gap-x-5 gap-y-2"
				>
					<Link
						href={"/dashboard" as Route}
						className="flex items-center gap-2"
					>
						{/* eslint-disable-next-line @next/next/no-img-element -- brand assets are deployment-local files */}
						{/* biome-ignore lint/performance/noImgElement: deployment-local brand assets are not remote optimized content */}
						<img
							src={branding.logoLight}
							alt={branding.brandName}
							className="h-6 dark:hidden"
						/>
						{/* eslint-disable-next-line @next/next/no-img-element -- brand assets are deployment-local files */}
						{/* biome-ignore lint/performance/noImgElement: deployment-local brand assets are not remote optimized content */}
						<img
							src={branding.logoDark}
							alt={branding.brandName}
							className="hidden h-6 dark:block"
						/>
					</Link>
					<Link
						className="text-sm underline-offset-4 hover:underline"
						href={"/dashboard" as Route}
					>
						Applications
					</Link>
					<Link
						className="text-sm underline-offset-4 hover:underline"
						href={"/account" as Route}
					>
						Account
					</Link>
					{navigation.capabilities.canSwitchOrganizations && (
						<Link
							className="text-sm underline-offset-4 hover:underline"
							href={"/organizations" as Route}
						>
							Organizations
						</Link>
					)}
					{navigation.capabilities.canManageActiveOrganization &&
						navigation.activeOrganization && (
							<Link
								className="text-sm underline-offset-4 hover:underline"
								href={
									`/admin/organizations/${navigation.activeOrganization.id}` as Route
								}
							>
								Manage organization
							</Link>
						)}
					{navigation.capabilities.canManageUsers && (
						<Link
							className="text-sm underline-offset-4 hover:underline"
							href={"/admin/platform/users" as Route}
						>
							Manage user accounts
						</Link>
					)}
					{navigation.capabilities.canOpenPlatform && (
						<Link
							className="text-sm underline-offset-4 hover:underline"
							href={"/admin/platform" as Route}
						>
							Platform administration
						</Link>
					)}
				</nav>
				<div className="flex items-center gap-2">
					<ModeToggle />
					<UserMenu navigation={navigation} />
				</div>
			</div>
		</header>
	);
}
