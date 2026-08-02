CREATE TABLE "admin_audit_event" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"target_user_id" text,
	"target_id" text,
	"organization_id" text,
	"outcome" text NOT NULL,
	"reason_code" text NOT NULL,
	"ip_address" text,
	"request_id" text NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "admin_audit_event_outcome_check" CHECK ("admin_audit_event"."outcome" in ('success', 'failure', 'denied')),
	CONSTRAINT "admin_audit_event_type_check" CHECK ("admin_audit_event"."event_type" in (
				'admin.login.succeeded',
				'admin.login.failed',
				'admin.2fa.succeeded',
				'admin.2fa.failed',
				'admin.logout',
				'admin.user.created',
				'admin.user.profile_changed',
				'admin.user.banned',
				'admin.user.unbanned',
				'admin.user.deleted',
				'admin.platform_role.changed',
				'admin.organization.created',
				'admin.organization.updated',
				'admin.organization.suspended',
				'admin.organization.archived',
				'admin.member.invited',
				'admin.member.added',
				'admin.member.removed',
				'admin.member.role_changed',
				'admin.binding.created',
				'admin.binding.updated',
				'admin.binding.status_changed',
				'admin.binding.health_checked'
			))
);
--> statement-breakpoint
CREATE TABLE "admin_audit_outbox" (
	"outbox_id" text PRIMARY KEY NOT NULL,
	"audit_event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"lease_until" timestamp,
	"delivered_at" timestamp,
	"last_error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_audit_outbox_status_check" CHECK ("admin_audit_outbox"."status" in ('pending', 'processing', 'failed', 'delivered')),
	CONSTRAINT "admin_audit_outbox_attempts_check" CHECK ("admin_audit_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tenant_database_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"application_id" text NOT NULL,
	"isolation_mode" text DEFAULT 'dedicated' NOT NULL,
	"secret_ref" text,
	"database_profile" text NOT NULL,
	"database_label" text,
	"region" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"last_health_check_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_database_binding_isolation_mode_check" CHECK ("tenant_database_binding"."isolation_mode" in ('dedicated', 'shared')),
	CONSTRAINT "tenant_database_binding_status_check" CHECK ("tenant_database_binding"."status" in ('pending', 'provisioning', 'migrating', 'active', 'failed', 'suspended', 'archived')),
	CONSTRAINT "tenant_database_binding_shared_secret_check" CHECK ("tenant_database_binding"."isolation_mode" <> 'shared' or "tenant_database_binding"."secret_ref" is null),
	CONSTRAINT "tenant_database_binding_active_secret_check" CHECK ("tenant_database_binding"."status" in ('pending', 'provisioning', 'failed', 'archived') or "tenant_database_binding"."isolation_mode" = 'shared' or nullif("tenant_database_binding"."secret_ref", '') is not null)
);
--> statement-breakpoint
CREATE TABLE "platform_role_invariant" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "admin_audit_outbox" ADD CONSTRAINT "admin_audit_outbox_audit_event_id_admin_audit_event_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."admin_audit_event"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_database_binding" ADD CONSTRAINT "tenant_database_binding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_event_occurred_at_idx" ON "admin_audit_event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "admin_audit_event_actor_user_id_idx" ON "admin_audit_event" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_event_target_user_id_idx" ON "admin_audit_event" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_event_organization_id_idx" ON "admin_audit_event" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "admin_audit_event_request_id_idx" ON "admin_audit_event" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_audit_outbox_event_unique" ON "admin_audit_outbox" USING btree ("audit_event_id");--> statement-breakpoint
CREATE INDEX "admin_audit_outbox_claim_idx" ON "admin_audit_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "invitation_organization_id_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organization_id_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_user_id_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_user_unique" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_slug_idx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_database_binding_organization_application_unique" ON "tenant_database_binding" USING btree ("organization_id","application_id");--> statement-breakpoint
CREATE INDEX "tenant_database_binding_status_idx" ON "tenant_database_binding" USING btree ("status");