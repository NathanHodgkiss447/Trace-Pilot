CREATE TYPE "public"."severity" AS ENUM ('critical', 'high', 'medium', 'low');
--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM ('open', 'investigating', 'resolved');
--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM ('debug', 'info', 'warn', 'error', 'fatal');
--> statement-breakpoint
CREATE TYPE "public"."investigation_status" AS ENUM ('running', 'completed', 'failed');
--> statement-breakpoint
CREATE TABLE "incidents" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "service_name" text NOT NULL,
  "severity" "severity" NOT NULL,
  "status" "incident_status" DEFAULT 'open' NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "incident_id_format" CHECK ("incidents"."id" ~ '^INC-[0-9]{4,8}$'),
  CONSTRAINT "incident_resolution_order" CHECK ("incidents"."resolved_at" IS NULL OR "incidents"."resolved_at" >= "incidents"."started_at")
);
--> statement-breakpoint
CREATE TABLE "application_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "incident_id" text NOT NULL,
  "service_name" text NOT NULL,
  "level" "log_level" NOT NULL,
  "message" text NOT NULL,
  "request_id" text,
  "timestamp" timestamp with time zone NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "log_id_format" CHECK ("application_logs"."id" ~ '^LOG-[A-Za-z0-9-]+$'),
  CONSTRAINT "log_message_size" CHECK (length("application_logs"."message") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "deployment_events" (
  "id" text PRIMARY KEY NOT NULL,
  "service_name" text NOT NULL,
  "version" text NOT NULL,
  "deployed_at" timestamp with time zone NOT NULL,
  "environment" text NOT NULL,
  "description" text NOT NULL,
  CONSTRAINT "deployment_id_format" CHECK ("deployment_events"."id" ~ '^DEP-[A-Za-z0-9-]+$')
);
--> statement-breakpoint
CREATE TABLE "runbooks" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "service_name" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "runbook_id_format" CHECK ("runbooks"."id" ~ '^RUN-[A-Za-z0-9-]+$'),
  CONSTRAINT "runbook_content_size" CHECK (length("runbooks"."content") <= 8000)
);
--> statement-breakpoint
CREATE TABLE "investigations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "incident_id" text NOT NULL,
  "status" "investigation_status" DEFAULT 'running' NOT NULL,
  "summary" text,
  "severity" "severity",
  "hypotheses" jsonb,
  "observations" jsonb,
  "missing_evidence" jsonb,
  "recommended_actions" jsonb,
  "human_review_required" boolean DEFAULT true NOT NULL,
  "evidence_ids" jsonb NOT NULL,
  "evidence_snapshot" jsonb NOT NULL,
  "model_name" text NOT NULL,
  "usage" jsonb,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "investigation_completion" CHECK (("investigations"."status" = 'running' AND "investigations"."completed_at" IS NULL) OR ("investigations"."status" IN ('completed', 'failed') AND "investigations"."completed_at" IS NOT NULL)),
  CONSTRAINT "investigation_result_required" CHECK ("investigations"."status" <> 'completed' OR ("investigations"."summary" IS NOT NULL AND "investigations"."hypotheses" IS NOT NULL AND "investigations"."recommended_actions" IS NOT NULL AND "investigations"."observations" IS NOT NULL AND "investigations"."missing_evidence" IS NOT NULL AND "investigations"."severity" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text,
  "request_id" text NOT NULL,
  "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_usage" (
  "day" date PRIMARY KEY NOT NULL,
  "count" integer NOT NULL,
  CONSTRAINT "daily_usage_nonnegative" CHECK ("daily_usage"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "application_logs" ADD CONSTRAINT "application_logs_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "incidents_service_started_idx" ON "incidents" USING btree ("service_name", "started_at");
--> statement-breakpoint
CREATE INDEX "incidents_severity_idx" ON "incidents" USING btree ("severity");
--> statement-breakpoint
CREATE INDEX "logs_incident_time_idx" ON "application_logs" USING btree ("incident_id", "timestamp");
--> statement-breakpoint
CREATE INDEX "logs_request_idx" ON "application_logs" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX "deployments_service_time_idx" ON "deployment_events" USING btree ("service_name", "deployed_at");
--> statement-breakpoint
CREATE INDEX "runbooks_service_idx" ON "runbooks" USING btree ("service_name");
--> statement-breakpoint
CREATE INDEX "investigations_incident_created_idx" ON "investigations" USING btree ("incident_id", "created_at");
--> statement-breakpoint
CREATE INDEX "audit_request_idx" ON "audit_events" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX "audit_resource_time_idx" ON "audit_events" USING btree ("resource_type", "resource_id", "timestamp");
--> statement-breakpoint
ALTER TABLE "incidents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "application_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deployment_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "runbooks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "investigations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "daily_usage" ENABLE ROW LEVEL SECURITY;
