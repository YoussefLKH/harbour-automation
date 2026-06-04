-- ════════════════════════════════════════════════════════════
-- Harbour Automation — systems (quote / deposit / stages / ETA)
-- Consolidated + idempotent. Run in Supabase → SQL Editor → Run.
-- Safe to run even if you already ran earlier migrations.
-- ════════════════════════════════════════════════════════════

-- (from earlier admin migration — included so this is the only file you need)
alter table applications add column if not exists transcript text;
alter table applications add column if not exists plan jsonb;
alter table applications add column if not exists reviewed_at timestamptz;
alter table profiles    add column if not exists must_change_password boolean default false;
alter table invoices    add column if not exists payment_url text;
alter table invoices    add column if not exists stripe_session_id text;

-- systems: pricing, deposit, ETA, Stripe links, payment flags
alter table systems add column if not exists quote_cents    integer;
alter table systems add column if not exists deposit_cents  integer default 5000;   -- $50 deposit
alter table systems add column if not exists eta            text;
alter table systems add column if not exists deposit_url    text;
alter table systems add column if not exists balance_url    text;
alter table systems add column if not exists deposit_paid   boolean default false;
alter table systems add column if not exists balance_paid   boolean default false;

-- migrate any existing systems to the new 3 stages:
--   waiting_deposit  →  in_progress  →  active
update systems set status = 'active'          where status = 'live';
update systems set status = 'in_progress'     where status = 'building';
update systems set status = 'waiting_deposit' where status not in ('active', 'in_progress');
