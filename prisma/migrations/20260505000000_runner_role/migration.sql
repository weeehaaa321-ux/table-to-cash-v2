-- Add RUNNER as a first-class staff role. The runner-mode toggle
-- (Restaurant.serviceModel) shipped earlier was already routing
-- WAITER staff to /runner when the restaurant flips to RUNNER,
-- but the dashboard had no way to *create* a runner-only staff
-- record. With this enum value the role picker can offer RUNNER,
-- which logs in to /runner regardless of mode.

ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'RUNNER';
