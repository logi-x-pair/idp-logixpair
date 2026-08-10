export interface ActionState {
	status: "idle" | "success" | "error";
	message?: string;
	shareLink?: string;
}

export const initialActionState: ActionState = { status: "idle" };
