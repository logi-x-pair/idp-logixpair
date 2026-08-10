import type { Route } from "next";
import { redirect } from "next/navigation";

import { requirePageSession } from "@/lib/server/session";

/**
 * The IdP root is a fixed destination resolver: verified platform admins land
 * in platform administration and every other role lands in Applications.
 */
export default async function Home() {
	const session = await requirePageSession();
	redirect(
		(session.user.platformRole === "admin"
			? "/admin/platform"
			: "/dashboard") as Route,
	);
}
