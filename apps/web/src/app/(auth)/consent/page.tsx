import { auth } from "@krazil-idp/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import ConsentForm from "@/components/consent-form";

export default async function ConsentPage() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});
	if (!session?.user) {
		redirect("/sign-in");
	}

	return <ConsentForm />;
}
