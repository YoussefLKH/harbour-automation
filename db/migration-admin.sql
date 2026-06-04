-- ════════════════════════════════════════════════════════════
-- Migration: admin workflow support
-- Run in Supabase → SQL Editor → New query → Run.
-- Safe to re-run (uses IF NOT EXISTS).
-- ════════════════════════════════════════════════════════════

-- Store the AI interview transcript + generated plan with each application
alter table applications add column if not exists transcript text;
alter table applications add column if not exists plan jsonb;
alter table applications add column if not exists reviewed_at timestamptz;

-- Force a password change on a client's first login
alter table profiles add column if not exists must_change_password boolean default false;

-- Stripe one-time payment link on each invoice
alter table invoices add column if not exists payment_url text;
alter table invoices add column if not exists stripe_session_id text;
