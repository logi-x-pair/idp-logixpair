import { auth } from "@krazil-idp/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * The IdP root is an entry point, not a landing page: signed-in users go to
 * their dashboard, everyone else to sign-in.
 */
export default async function Home() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	redirect(session?.user ? "/dashboard" : "/sign-in");
}
