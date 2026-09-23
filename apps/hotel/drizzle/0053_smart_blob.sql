CREATE TYPE "public"."paymongo_connection_status" AS ENUM('connected', 'webhook_error');--> statement-breakpoint
CREATE TYPE "public"."paymongo_mode" AS ENUM('test', 'live');--> statement-breakpoint
CREATE TABLE "email_settings" (
	"hotel_id" uuid PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 587 NOT NULL,
	"secure" boolean DEFAULT false NOT NULL,
	"username" text,
	"password_enc" text,
	"password_hint" text,
	"from_name" text,
	"from_address" text NOT NULL,
	"reply_to" text,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_error" text,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paymongo_settings" (
	"hotel_id" uuid PRIMARY KEY NOT NULL,
	"mode" "paymongo_mode" NOT NULL,
	"secret_key_enc" text NOT NULL,
	"secret_key_hint" text NOT NULL,
	"webhook_id" text,
	"webhook_url" text,
	"webhook_secret_enc" text,
	"status" "paymongo_connection_status" DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paymongo_settings" ADD CONSTRAINT "paymongo_settings_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paymongo_settings" ADD CONSTRAINT "paymongo_settings_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;