import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	// Auto-forwards the signed `oauth_query` parameter through every auth
	// request, including the 2FA verification POSTs.
	plugins: [
		oauthProviderClient(),
		twoFactorClient({
			onTwoFactorRedirect() {
				// Keep the signed authorization query intact while the user completes
				// the second factor. The provider resumes OAuth after verification.
				window.location.href = `/two-factor${window.location.search}`;
			},
		}),
	],
});
