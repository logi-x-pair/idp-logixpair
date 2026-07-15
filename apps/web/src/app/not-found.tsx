import Link from "next/link";

import AuthShell from "@/components/auth-shell";

export default function NotFound() {
	return (
		<AuthShell>
			<h1 className="font-semibold text-2xl tracking-tight">Page not found</h1>
			<p className="mt-3 text-muted-foreground text-sm">
				The page you're looking for doesn't exist or has moved.
			</p>
			<Link
				href="/"
				className="mt-6 inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground text-sm hover:opacity-90"
			>
				Go home
			</Link>
		</AuthShell>
	);
}
