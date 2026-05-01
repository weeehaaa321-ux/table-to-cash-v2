-- Per-subscription UI language so push notification title/body can
-- be rendered in the subscriber's chosen language. Existing rows
-- default to "en" — they were created before the field existed.

ALTER TABLE "PushSubscription"
  ADD COLUMN "lang" TEXT NOT NULL DEFAULT 'en';
