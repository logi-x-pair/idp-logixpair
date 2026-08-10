import type { ActionState } from "@/lib/action-state";

export default function ActionFeedback({ state }: { state: ActionState }) {
	if (state.status === "idle" || !state.message) return null;
	return (
		<p
			className={
				state.status === "error"
					? "mt-3 text-destructive text-sm"
					: "mt-3 text-emerald-700 text-sm dark:text-emerald-400"
			}
			role={state.status === "error" ? "alert" : "status"}
		>
			{state.message}
		</p>
	);
}
