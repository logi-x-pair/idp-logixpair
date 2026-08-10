import SignInForm from "@/components/sign-in-form";
import { safeReturnPath } from "@/lib/server/session";

export default async function SignInPage({
	searchParams,
}: {
	searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
	const params = await searchParams;
	const returnTo = safeReturnPath(
		typeof params.returnTo === "string" ? params.returnTo : undefined,
	);
	return <SignInForm postSignInPath={returnTo} />;
}
