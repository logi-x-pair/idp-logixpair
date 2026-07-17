import { auth } from "@krazil-idp/auth";
import { env } from "@krazil-idp/env/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import ConsentList from "@/components/consent-list";
import TwoFactorSettings from "@/components/two-factor-settings";
export default async function AccountPage() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});
	if (!session?.user) {
		redirect("/sign-in");
	}

	const twoFactorEnabled =
		"twoFactorEnabled" in session.user &&
		session.user.twoFactorEnabled === true;

	return (
		<main className="mx-auto w-full max-w-2xl px-4 py-8">
			<h1 className="font-semibold text-2xl tracking-tight">Account</h1>
			<p className="mt-1 text-muted-foreground text-sm">
				Signed in as {session.user.email}
			</p>

			{env.TWO_FACTOR_ENABLED === "true" && (
				<TwoFactorSettings initialEnabled={twoFactorEnabled} />
			)}

			<h2 className="mt-8 font-medium text-lg">Connected applications</h2>
			<p className="mt-1 mb-4 text-muted-foreground text-sm">
				Applications you've allowed to access your account.
			</p>
			<ConsentList />
		</main>
	);
}
