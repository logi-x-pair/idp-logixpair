"use client";

import { Button } from "@krazil-idp/ui/components/button";
import { Input } from "@krazil-idp/ui/components/input";
import { Label } from "@krazil-idp/ui/components/label";
import { useState } from "react";
import QRCode from "react-qr-code";

import { authClient } from "@/lib/auth-client";

type SetupData = {
	totpURI: string;
	backupCodes: string[];
};

type TwoFactorSettingsProps = {
	initialEnabled: boolean;
};

const GENERIC_ERROR =
	"We couldn't complete that security change. Please try again.";

export default function TwoFactorSettings({
	initialEnabled,
}: TwoFactorSettingsProps) {
	const [enabled, setEnabled] = useState(initialEnabled);
	const [password, setPassword] = useState("");
	const [setup, setSetup] = useState<SetupData | null>(null);
	const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
	const [backupPassword, setBackupPassword] = useState("");
	const [verificationCode, setVerificationCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [copied, setCopied] = useState(false);

	const startSetup = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);
		setNotice(null);
		setBackupCodes(null);
		setCopied(false);
		setIsSubmitting(true);
		try {
			const { data, error: responseError } = await authClient.twoFactor.enable({
				password,
			});
			if (responseError || !data) {
				setError(GENERIC_ERROR);
				return;
			}
			setSetup(data);
			setPassword("");
		} catch {
			setError(GENERIC_ERROR);
		} finally {
			setIsSubmitting(false);
		}
	};

	const finishSetup = async (event: React.FormEvent<HTMLFormElement>) => {
		if (!setup) return;
		const currentSetup = setup;
		event.preventDefault();
		setError(null);
		setNotice(null);
		setIsSubmitting(true);
		try {
			const { data, error: responseError } =
				await authClient.twoFactor.verifyTotp({
					code: verificationCode,
				});
			if (responseError || !data) {
				setError(
					"That code was not accepted. Check your authenticator and try again.",
				);
				return;
			}
			setEnabled(true);
			setBackupCodes(currentSetup.backupCodes);
			setSetup(null);
			setVerificationCode("");
			setNotice("Two-step verification is now enabled for your account.");
		} catch {
			setError(
				"That code was not accepted. Check your authenticator and try again.",
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	const disable = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);
		setNotice(null);
		setIsSubmitting(true);
		try {
			const { data, error: responseError } = await authClient.twoFactor.disable(
				{
					password,
				},
			);
			if (responseError || !data) {
				setError(GENERIC_ERROR);
				return;
			}
			setEnabled(false);
			setBackupCodes(null);
			setPassword("");
			setNotice("Two-step verification is disabled.");
		} catch {
			setError(GENERIC_ERROR);
		} finally {
			setIsSubmitting(false);
		}
	};

	const regenerateBackupCodes = async (
		event: React.FormEvent<HTMLFormElement>,
	) => {
		event.preventDefault();
		setError(null);
		setNotice(null);
		setIsSubmitting(true);
		try {
			const { data, error: responseError } =
				await authClient.twoFactor.generateBackupCodes({
					password: backupPassword,
				});
			if (responseError || !data) {
				setError(GENERIC_ERROR);
				return;
			}
			setBackupCodes(data.backupCodes);
			setBackupPassword("");
			setNotice("New backup codes generated. Previous codes no longer work.");
		} catch {
			setError(GENERIC_ERROR);
		} finally {
			setIsSubmitting(false);
		}
	};

	const copyBackupCodes = async () => {
		if (!backupCodes) return;
		try {
			await navigator.clipboard.writeText(backupCodes.join("\n"));
			setError(null);
			setNotice("Backup codes copied. Store them somewhere safe.");
		} catch {
			setError(
				"We couldn't copy the backup codes. Select them and copy them manually.",
			);
		}
	};

	const copyUri = async () => {
		if (!setup) return;
		try {
			await navigator.clipboard.writeText(setup.totpURI);
			setCopied(true);
			setError(null);
		} catch {
			setError(
				"We couldn't copy the setup URI. Select it and copy it manually.",
			);
		}
	};

	if (setup) {
		return (
			<section
				className="mt-8 border-t pt-6"
				aria-labelledby="two-factor-title"
			>
				<h2 id="two-factor-title" className="font-medium text-lg">
					Finish authenticator setup
				</h2>
				<p className="mt-1 mb-5 text-muted-foreground text-sm">
					Scan this QR code with your authenticator app, then enter the
					six-digit code it generates.
				</p>

				{error && (
					<p
						role="alert"
						className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm"
					>
						{error}
					</p>
				)}

				<div className="flex justify-center rounded-md border bg-white p-4">
					<div role="img" aria-label="Authenticator setup QR code">
						<QRCode value={setup.totpURI} size={180} />
					</div>
				</div>

				<div className="mt-5 space-y-2">
					<Label htmlFor="totp-uri">Authenticator setup URI</Label>
					<div className="flex gap-2">
						<Input
							id="totp-uri"
							value={setup.totpURI}
							readOnly
							aria-describedby="totp-uri-help"
							className="min-w-0 flex-1"
							onFocus={(event) => event.currentTarget.select()}
						/>
						<Button type="button" variant="outline" onClick={copyUri}>
							{copied ? "Copied" : "Copy"}
						</Button>
					</div>
					<p id="totp-uri-help" className="text-muted-foreground text-xs">
						If you cannot scan the code, copy this URI into your authenticator
						app.
					</p>
				</div>

				<div className="mt-5 rounded-md border bg-muted/30 p-4">
					<h3 className="font-medium text-sm">Save your backup codes</h3>
					<p className="mt-1 text-muted-foreground text-xs">
						Each code works once if you lose access to your authenticator.
					</p>
					<ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-3">
						{setup.backupCodes.map((code) => (
							<li
								key={code}
								className="rounded border bg-background px-2 py-1 text-center"
							>
								{code}
							</li>
						))}
					</ul>
				</div>

				<form onSubmit={finishSetup} className="mt-5 space-y-4">
					<div className="space-y-2">
						<Label htmlFor="setup-code">Verification code</Label>
						<Input
							id="setup-code"
							inputMode="numeric"
							autoComplete="one-time-code"
							pattern="[0-9]*"
							maxLength={6}
							required
							value={verificationCode}
							onChange={(event) =>
								setVerificationCode(event.target.value.replace(/\D/g, ""))
							}
						/>
					</div>
					<Button
						type="submit"
						className="w-full"
						disabled={isSubmitting || verificationCode.length !== 6}
					>
						{isSubmitting ? "Verifying…" : "Verify and enable"}
					</Button>
				</form>
			</section>
		);
	}

	return (
		<section className="mt-8 border-t pt-6" aria-labelledby="two-factor-title">
			<h2 id="two-factor-title" className="font-medium text-lg">
				Two-step verification
			</h2>
			<p className="mt-1 text-muted-foreground text-sm">
				{enabled
					? "Your account requires an authenticator code when you sign in."
					: "Add an authenticator app to protect your account with an extra sign-in step."}
			</p>

			{error && (
				<p
					role="alert"
					className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm"
				>
					{error}
				</p>
			)}
			{notice && (
				<p
					role="status"
					className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
				>
					{notice}
				</p>
			)}

			{enabled ? (
				<>
					{backupCodes && (
						<div className="mt-5 rounded-md border bg-muted/30 p-4">
							<div className="flex items-start justify-between gap-3">
								<div>
									<h3 className="font-medium text-sm">New backup codes</h3>
									<p className="mt-1 text-muted-foreground text-xs">
										Save these codes now. They will not be shown again after
										leaving this page.
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={copyBackupCodes}
								>
									Copy all
								</Button>
							</div>
							<ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-3">
								{backupCodes.map((code) => (
									<li
										key={code}
										className="rounded border bg-background px-2 py-1 text-center"
									>
										{code}
									</li>
								))}
							</ul>
						</div>
					)}

					<form onSubmit={regenerateBackupCodes} className="mt-5 space-y-4">
						<div className="space-y-2">
							<Label htmlFor="regenerate-backup-password">
								Password to regenerate codes
							</Label>
							<Input
								id="regenerate-backup-password"
								type="password"
								autoComplete="current-password"
								required
								value={backupPassword}
								onChange={(event) => setBackupPassword(event.target.value)}
							/>
						</div>
						<Button
							type="submit"
							variant="outline"
							disabled={isSubmitting || backupPassword.length === 0}
						>
							{isSubmitting ? "Generating…" : "Generate new backup codes"}
						</Button>
					</form>

					<form onSubmit={disable} className="mt-5 space-y-4">
						<div className="space-y-2">
							<Label htmlFor="disable-two-factor-password">
								Password to disable
							</Label>
							<Input
								id="disable-two-factor-password"
								type="password"
								autoComplete="current-password"
								required
								value={password}
								onChange={(event) => setPassword(event.target.value)}
							/>
						</div>
						<Button
							type="submit"
							variant="outline"
							disabled={isSubmitting || password.length === 0}
						>
							{isSubmitting ? "Disabling…" : "Disable two-step verification"}
						</Button>
					</form>
				</>
			) : (
				<form onSubmit={startSetup} className="mt-5 space-y-4">
					<div className="space-y-2">
						<Label htmlFor="enable-two-factor-password">
							Confirm your password
						</Label>
						<Input
							id="enable-two-factor-password"
							type="password"
							autoComplete="current-password"
							required
							value={password}
							onChange={(event) => setPassword(event.target.value)}
						/>
					</div>
					<Button
						type="submit"
						disabled={isSubmitting || password.length === 0}
					>
						{isSubmitting ? "Preparing setup…" : "Set up authenticator"}
					</Button>
				</form>
			)}
		</section>
	);
}
