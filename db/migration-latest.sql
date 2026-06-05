-- ════════════════════════════════════════════════════════════
-- Harbour Automation — LATEST migration (run this one)
-- Includes the requests table + Stripe receipt links.
-- Idempotent & safe to run even if you ran earlier migrations.
-- Supabase → SQL Editor → New query → paste → Run.
-- ════════════════════════════════════════════════════════════

-- Client requests / intake (Documents tab)
create table if not exists requests (
    id           uuid primary key default gen_random_uuid(),
    client_id    uuid references profiles(id) on delete cascade,
    type         text,
    title        text not null,
    description  text,
    status       text default 'pending',     -- pending | submitted | complete
    response     text,
    response_url text,
    created_at   timestamptz default now(),
    updated_at   timestamptz default now()
);
alter table requests enable row level security;
do $$ begin
    create policy "own requests" on requests for select using (auth.uid() = client_id);
exception when duplicate_object then null; end $$;

-- Stripe receipt links (shown in the Payments tab after payment)
alter table systems  add column if not exists deposit_receipt_url text;
alter table systems  add column if not exists balance_receipt_url text;
alter table invoices add column if not exists receipt_url text;

-- Client email notification preferences
alter table profiles add column if not exists notify_prefs jsonb default '{"payments":true,"documents":true,"support":true}'::jsonb;

-- The AI plan from their application, shown back to them in the dashboard
alter table profiles add column if not exists plan jsonb;
