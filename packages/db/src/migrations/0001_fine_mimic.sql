CREATE TABLE "revoked_token" (
	"jti" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp DEFAULT now() NOT NULL,
	"client_id" text
);
--> statement-breakpoint
CREATE INDEX "revoked_token_expiresAt_idx" ON "revoked_token" USING btree ("expires_at");