"use client";

import { Button } from "@krazil-idp/ui/components/button";
import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

interface ConfirmationSubmitProps {
	formId: string;
	label: string;
	description: string;
	confirmationLabel?: string;
	confirmButtonLabel?: string;
	variant?: "destructive" | "outline";
}

export default function ConfirmationSubmit({
	formId,
	label,
	description,
	confirmationLabel,
	confirmButtonLabel = label,
	variant = "destructive",
}: ConfirmationSubmitProps) {
	const [open, setOpen] = useState(false);
	const triggerButton = useRef<HTMLButtonElement>(null);
	const confirmButton = useRef<HTMLButtonElement>(null);
	const dialog = useRef<HTMLDivElement>(null);
	const wasOpen = useRef(false);
	const descriptionId = useId();
	const titleId = useId();
	const { pending } = useFormStatus();

	useEffect(() => {
		if (open) {
			wasOpen.current = true;
			confirmButton.current?.focus();
			return;
		}
		if (wasOpen.current) {
			wasOpen.current = false;
			triggerButton.current?.focus();
		}
	}, [open]);

	const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			setOpen(false);
			return;
		}
		if (event.key !== "Tab") return;
		const focusable = dialog.current?.querySelectorAll<HTMLElement>(
			"button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]",
		);
		if (!focusable?.length) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	return (
		<>
			<Button
				ref={triggerButton}
				disabled={pending}
				type="button"
				variant={variant}
				onClick={() => setOpen(true)}
			>
				{label}
			</Button>
			{open && (
				<div
					aria-describedby={descriptionId}
					aria-labelledby={titleId}
					aria-modal="true"
					className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
					ref={dialog}
					onKeyDown={trapFocus}
					role="dialog"
				>
					<div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl">
						<h2 className="font-semibold text-lg" id={titleId}>
							Confirm {label.toLowerCase()}
						</h2>
						<p
							id={descriptionId}
							className="mt-2 text-muted-foreground text-sm"
						>
							{description}
						</p>
						{confirmationLabel && (
							<label
								className="mt-4 grid gap-1.5 text-sm"
								htmlFor={`${formId}-confirmation`}
							>
								{confirmationLabel}
								<input
									className="h-9 rounded-md border bg-background px-3"
									form={formId}
									id={`${formId}-confirmation`}
									name="confirmation"
								/>
							</label>
						)}
						<div className="mt-5 flex justify-end gap-2">
							<Button
								disabled={pending}
								type="button"
								variant="outline"
								onClick={() => setOpen(false)}
							>
								Cancel
							</Button>
							<Button
								disabled={pending}
								ref={confirmButton}
								type="button"
								variant={variant}
								onClick={() => {
									const form = document.getElementById(
										formId,
									) as HTMLFormElement | null;
									setOpen(false);
									form?.requestSubmit();
								}}
							>
								{confirmButtonLabel}
							</Button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
