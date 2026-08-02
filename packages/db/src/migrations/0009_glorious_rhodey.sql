ALTER TABLE "admin_audit_event" DROP CONSTRAINT "admin_audit_event_type_check";--> statement-breakpoint
DROP INDEX "organization_slug_idx";--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "role" SET DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "admin_audit_event" ADD CONSTRAINT "admin_audit_event_type_check" CHECK ("admin_audit_event"."event_type" in (
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
				'admin.member.invitation_cancelled',
				'admin.member.invitation_expired',
				'admin.member.added',
				'admin.member.removed',
				'admin.member.role_changed',
				'admin.binding.created',
				'admin.binding.updated',
				'admin.binding.status_changed',
				'admin.binding.health_checked',
				'admin.audit.read',
				'admin.audit.retention_purged'
			));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_check" CHECK ("user"."role" in ('admin', 'moderator', 'hr_user', 'user'));--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_email_check" CHECK (char_length("invitation"."email") between 3 and 254 and "invitation"."email" = lower("invitation"."email"));--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_role_check" CHECK ("invitation"."role" in ('admin', 'moderator', 'user'));--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_role_check" CHECK ("member"."role" in ('admin', 'moderator', 'user'));--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_name_check" CHECK (char_length(btrim("organization"."name")) between 1 and 120 and char_length("organization"."name") <= 120);--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_slug_check" CHECK (char_length("organization"."slug") <= 63 and "organization"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');