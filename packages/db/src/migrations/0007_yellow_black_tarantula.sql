ALTER TABLE "admin_audit_event" DROP CONSTRAINT "admin_audit_event_type_check";--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_unique" ON "invitation" USING btree ("organization_id","email") WHERE "invitation"."status" = 'pending';--> statement-breakpoint
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
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_status_check" CHECK ("invitation"."status" in ('pending', 'accepted', 'rejected', 'cancelled', 'expired'));