"use client";

import { Button } from "@krazil-idp/ui/components/button";
import { Input } from "@krazil-idp/ui/components/input";
import { Label } from "@krazil-idp/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useState } from "react";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { inOAuthFlow, withCurrentQuery } from "@/lib/oauth-flow";

import Loader from "./loader";

export default function SignInForm() {
	const router = useRouter();
	const { isPending } = authClient.useSession();
	const [serverError, setServerError] = useState<string | null>(null);

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
		},
		onSubmit: async ({ value }) => {
			setServerError(null);
			await authClient.signIn.email(
				{
					email: value.email,
					password: value.password,
				},
				{
					onSuccess: () => {
						// Inside an OAuth authorization flow the provider plugin continues
						// the flow automatically once the session exists — never redirect
						// manually there.
						if (!inOAuthFlow()) {
							router.push("/dashboard");
						}
					},
					onError: (error) => {
						setServerError(
							error.error.message ||
								"We couldn't complete this request. The sign-in link may be invalid or expired — return to the app and try again.",
						);
					},
				},
			);
		},
		validators: {
			onSubmit: z.object({
				email: z.email("Enter a valid email address"),
				password: z.string().min(8, "Password must be at least 8 characters"),
			}),
		},
	});

	if (isPending) {
		return <Loader />;
	}

	return (
		<div>
			<h1 className="font-semibold text-2xl tracking-tight">Sign in</h1>
			<p className="mt-1 mb-6 text-muted-foreground text-sm">
				Use your account to continue.
			</p>

			{serverError && (
				<p
					role="alert"
					className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm"
				>
					{serverError}
				</p>
			)}

			<form
				noValidate
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					form.handleSubmit();
				}}
				className="space-y-5"
			>
				<form.Field name="email">
					{(field) => {
						const invalid = field.state.meta.errors.length > 0;
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Email</Label>
								<Input
									id={field.name}
									name={field.name}
									type="email"
									autoComplete="email"
									required
									aria-invalid={invalid || undefined}
									aria-describedby={invalid ? `${field.name}-error` : undefined}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p
										id={`${field.name}-error`}
										key={error?.message}
										className="text-destructive text-sm"
									>
										{error?.message}
									</p>
								))}
							</div>
						);
					}}
				</form.Field>

				<form.Field name="password">
					{(field) => {
						const invalid = field.state.meta.errors.length > 0;
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Password</Label>
								<Input
									id={field.name}
									name={field.name}
									type="password"
									autoComplete="current-password"
									required
									aria-invalid={invalid || undefined}
									aria-describedby={invalid ? `${field.name}-error` : undefined}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p
										id={`${field.name}-error`}
										key={error?.message}
										className="text-destructive text-sm"
									>
										{error?.message}
									</p>
								))}
							</div>
						);
					}}
				</form.Field>

				<form.Subscribe
					selector={(state) => ({
						canSubmit: state.canSubmit,
						isSubmitting: state.isSubmitting,
					})}
				>
					{({ canSubmit, isSubmitting }) => (
						<Button
							type="submit"
							className="w-full"
							disabled={!canSubmit || isSubmitting}
						>
							{isSubmitting ? "Signing in…" : "Sign in"}
						</Button>
					)}
				</form.Subscribe>
			</form>

			<p className="mt-6 text-center text-muted-foreground text-sm">
				Need an account?{" "}
				<button
					type="button"
					onClick={() => router.push(withCurrentQuery("/sign-up"))}
					className="font-medium text-[var(--brand-accent)] underline-offset-4 hover:underline"
				>
					Sign up
				</button>
			</p>
		</div>
	);
}
