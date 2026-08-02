DROP INDEX "admin_audit_event_occurred_at_idx";--> statement-breakpoint
DROP INDEX "admin_audit_event_organization_id_idx";--> statement-breakpoint
CREATE INDEX "admin_audit_event_occurred_event_idx" ON "admin_audit_event" USING btree ("occurred_at","event_id");--> statement-breakpoint
CREATE INDEX "admin_audit_event_org_occurred_idx" ON "admin_audit_event" USING btree ("organization_id","occurred_at" DESC NULLS LAST,"event_id" DESC NULLS LAST);