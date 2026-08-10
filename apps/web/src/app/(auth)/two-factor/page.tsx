import TwoFactorChallenge from "@/components/two-factor-challenge";
import { safeReturnPath } from "@/lib/server/session";

export default async function TwoFactorPage({
	searchParams,
}: {
	searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
	const params = await searchParams;
	const returnTo = safeReturnPath(
		typeof params.returnTo === "string" ? params.returnTo : undefined,
	);
	return <TwoFactorChallenge postSignInPath={returnTo} />;
}
