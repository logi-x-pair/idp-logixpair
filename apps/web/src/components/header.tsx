"use client";
import { branding } from "@krazil-idp/branding/config";
import Link from "next/link";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
	return (
		<div>
			<div className="flex flex-row items-center justify-between px-3 py-2">
				<nav className="flex items-center gap-6">
					<Link href="/" className="flex items-center gap-2">
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
					<Link href="/dashboard" className="text-sm hover:underline">
						Dashboard
					</Link>
					<Link href="/account" className="text-sm hover:underline">
						Account
					</Link>
				</nav>
				<div className="flex items-center gap-2">
					<ModeToggle />
					<UserMenu />
				</div>
			</div>
			<hr />
		</div>
	);
}
