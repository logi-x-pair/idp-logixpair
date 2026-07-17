import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@krazil-idp/ui/components/card";
import Link from "next/link";

type DashboardSession = {
	user: {
		name: string;
		email: string;
		emailVerified: boolean;
	};
	session: {
		expiresAt: Date | string;
	};
};

/**
 * Session overview for the signed-in user: identity, email verification
 * state, and when the current session expires.
 */
export default function Dashboard({ session }: { session: DashboardSession }) {
	const expiresAt = new Date(session.session.expiresAt);
	const expiresLabel = new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(expiresAt);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Your session</CardTitle>
				<CardDescription>
					The account this session is signed in as.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<dl className="grid gap-3">
					<div className="grid gap-0.5">
						<dt className="text-muted-foreground">Name</dt>
						<dd className="text-sm">{session.user.name}</dd>
					</div>
					<div className="grid gap-0.5">
						<dt className="text-muted-foreground">Email</dt>
						<dd className="flex items-center gap-2 text-sm">
							{session.user.email}
							{session.user.emailVerified ? (
								<span className="text-muted-foreground text-xs">Verified</span>
							) : (
								<span className="text-destructive text-xs">Not verified</span>
							)}
						</dd>
					</div>
					<div className="grid gap-0.5">
						<dt className="text-muted-foreground">Session expires</dt>
						<dd className="text-sm">
							<time dateTime={expiresAt.toISOString()}>{expiresLabel}</time>
						</dd>
					</div>
				</dl>
			</CardContent>
			<CardFooter>
				<Link
					href="/account"
					className="text-sm underline-offset-4 hover:underline"
				>
					Manage account
				</Link>
			</CardFooter>
		</Card>
	);
}
