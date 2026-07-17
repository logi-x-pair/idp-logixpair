"use client";

import { Button } from "@krazil-idp/ui/components/button";
import { Input } from "@krazil-idp/ui/components/input";
import { Label } from "@krazil-idp/ui/components/label";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { inOAuthFlow, withCurrentQuery } from "@/lib/oauth-flow";

type VerificationMethod = "totp" | "backup";

const GENERIC_CODE_ERROR =
	"We couldn't verify that code. Check the code and try again.";

function redirectsToAnotherFactor(data: unknown): boolean {
	return (
		typeof data === "object" &&
		data !== null &&
		"twoFactorRedirect" in data &&
		data.twoFactorRedirect === true
	);
}

export default function TwoFactorChallenge() {
	const router = useRouter();
	const [method, setMethod] = useState<VerificationMethod>("totp");
	const [code, setCode] = useState("");
	const [trustDevice, setTrustDevice] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const showMethod = (nextMethod: VerificationMethod) => {
		setMethod(nextMethod);
		setCode("");
		setError(null);
	};

	const onVerified = (data: unknown) => {
		// The 2FA plugin owns any redirect to a further factor.
		if (redirectsToAnotherFactor(data)) return;
		// In OAuth, the provider resumes the signed authorization flow after the
		// verification endpoint sets the session cookie.
		if (!inOAuthFlow()) {
			router.push("/dashboard");
		}
	};

	const verify = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);
		setIsSubmitting(true);

		try {
			if (method === "totp") {
				await authClient.twoFactor.verifyTotp(
					{ code, trustDevice },
					{
						onSuccess: (context) => onVerified(context.data),
						onError: () => setError(GENERIC_CODE_ERROR),
					},
				);
			} else {
				await authClient.twoFactor.verifyBackupCode(
					{ code, trustDevice },
					{
						onSuccess: (context) => onVerified(context.data),
						onError: () => setError(GENERIC_CODE_ERROR),
					},
				);
			}
		} catch {
			setError(GENERIC_CODE_ERROR);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div>
			<h1 className="font-semibold text-2xl tracking-tight">
				Two-step verification
			</h1>
			<p className="mt-1 mb-6 text-muted-foreground text-sm">
				{method === "totp"
					? "Enter the code from your authenticator app to continue."
					: "Enter one of your saved backup codes to continue."}
			</p>

			{error && (
				<p
					role="alert"
					className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm"
				>
					{error}
				</p>
			)}

			<form onSubmit={verify} className="space-y-5">
				<div className="space-y-2">
					<Label htmlFor="two-factor-code">
						{method === "totp" ? "Authenticator code" : "Backup code"}
					</Label>
					<Input
						id="two-factor-code"
						name="code"
						type="text"
						inputMode={method === "totp" ? "numeric" : "text"}
						autoComplete={method === "totp" ? "one-time-code" : "off"}
						pattern={method === "totp" ? "[0-9]*" : undefined}
						maxLength={method === "totp" ? 6 : 64}
						required
						autoFocus
						value={code}
						onChange={(event) => {
							const value =
								method === "totp"
									? event.target.value.replace(/\D/g, "")
									: event.target.value;
							setCode(value);
						}}
					/>
				</div>

				<label className="flex cursor-pointer items-start gap-2 text-sm">
					<input
						type="checkbox"
						checked={trustDevice}
						onChange={(event) => setTrustDevice(event.target.checked)}
						className="mt-0.5 size-4 accent-[var(--brand-accent)]"
					/>
					<span>
						Trust this device for 30 days
						<span className="mt-0.5 block text-muted-foreground text-xs">
							Only choose this on a private device you control.
						</span>
					</span>
				</label>

				<Button
					type="submit"
					className="w-full"
					disabled={
						isSubmitting ||
						(method === "totp" ? code.length !== 6 : code.trim().length === 0)
					}
				>
					{isSubmitting ? "Verifying…" : "Verify"}
				</Button>
			</form>

			<div className="mt-6 space-y-2 text-center text-sm">
				<button
					type="button"
					onClick={() => showMethod(method === "totp" ? "backup" : "totp")}
					className="font-medium text-[var(--brand-accent)] underline-offset-4 hover:underline"
				>
					{method === "totp"
						? "Use a backup code instead"
						: "Use an authenticator code instead"}
				</button>
				<div>
					<button
						type="button"
						onClick={() => router.push(withCurrentQuery("/sign-in"))}
						className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
					>
						Return to sign in
					</button>
				</div>
			</div>
		</div>
	);
}
