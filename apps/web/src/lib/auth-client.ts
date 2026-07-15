import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	// Auto-forwards the signed `oauth_query` parameter through the login and
	// consent flows so the provider can continue the authorization flow.
	plugins: [oauthProviderClient()],
});
