"use client";

import { Button } from "@krazil-idp/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@krazil-idp/ui/components/dropdown-menu";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import type { SafeNavigationViewModel } from "@/lib/navigation-types";

export default function UserMenu({
	navigation,
}: {
	navigation: SafeNavigationViewModel;
}) {
	const router = useRouter();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Button aria-label="Open user menu" variant="outline" />}
			>
				{navigation.user.name}
			</DropdownMenuTrigger>
			<DropdownMenuContent className="bg-card">
				<DropdownMenuGroup>
					<DropdownMenuLabel>{navigation.user.email}</DropdownMenuLabel>
					<DropdownMenuItem disabled>
						Platform role: {navigation.user.platformRole}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						onClick={() => {
							authClient.signOut({
								fetchOptions: {
									onSuccess: () => router.replace("/"),
								},
							});
						}}
					>
						Sign out
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
