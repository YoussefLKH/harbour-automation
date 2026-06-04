-- ════════════════════════════════════════════════════════════
-- HARBOUR AUTOMATION — Supabase / Postgres schema
-- Run this in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════

-- ── Clients (linked to Supabase auth.users) ──────────────────
create table if not exists profiles (
    id            uuid primary key references auth.users(id) on delete cascade,
    full_name     text,
    business_name text,
    email         text,
    phone         text,
    role          text default 'client',   -- client | admin
    status        text default 'active',   -- active | paused
    created_at    timestamptz default now()
);

-- ── Applications (inbound leads from the apply form) ──────────
create table if not exists applications (
    id                uuid primary key default gen_random_uuid(),
    full_name         text not null,
    business_name     text,
    email             text not null,
    phone             text,
    industry          text,
    team_size         text,
    monthly_revenue   text,
    pain_points       text[],              -- tasks they want automated
    biggest_challenge text,
    budget            text,
    status            text default 'pending',  -- pending | reviewing | accepted | rejected
    admin_notes       text,
    created_at        timestamptz default now()
);

-- ── Invites (generated when an application is accepted) ───────
create table if not exists invites (
    id             uuid primary key default gen_random_uuid(),
    application_id uuid references applications(id) on delete set null,
    email          text not null,
    token          text unique not null,
    status         text default 'sent',    -- sent | accepted | expired
    expires_at     timestamptz default (now() + interval '14 days'),
    created_at     timestamptz default now()
);

-- ── Systems (the automations built per client) ───────────────
create table if not exists systems (
    id          uuid primary key default gen_random_uuid(),
    client_id   uuid references profiles(id) on delete cascade,
    name        text not null,
    type        text,                       -- receptionist | bookkeeping | support | followup
    status      text default 'building',    -- building | live | paused
    description text,
    created_at  timestamptz default now()
);

-- ── Support chat (realtime) ──────────────────────────────────
create table if not exists support_threads (
    id               uuid primary key default gen_random_uuid(),
    client_id        uuid references profiles(id) on delete cascade,
    status           text default 'open',   -- open | closed
    last_message     text,
    last_message_at  timestamptz,
    unread_by_admin  boolean default false,
    unread_by_client boolean default false,
    created_at       timestamptz default now()
);

create table if not exists support_messages (
    id          uuid primary key default gen_random_uuid(),
    thread_id   uuid references support_threads(id) on delete cascade,
    sender_role text,                        -- client | admin
    sender_name text,
    body        text not null,
    created_at  timestamptz default now()
);

-- ── Invoices (Stripe-backed) ─────────────────────────────────
create table if not exists invoices (
    id                uuid primary key default gen_random_uuid(),
    client_id         uuid references profiles(id) on delete cascade,
    stripe_invoice_id text,
    description       text,
    amount_cents      integer,
    currency          text default 'cad',
    status            text default 'draft',  -- draft | sent | paid | void
    due_date          date,
    created_at        timestamptz default now()
);

-- ── Monthly reports (dashboard stats) ────────────────────────
create table if not exists reports (
    id             uuid primary key default gen_random_uuid(),
    client_id      uuid references profiles(id) on delete cascade,
    period         text,                     -- e.g. '2026-06'
    calls_handled  integer default 0,
    hours_saved    numeric default 0,
    leads_captured integer default 0,
    summary        text,
    created_at     timestamptz default now()
);

-- ════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- The server uses the SERVICE_ROLE key (bypasses RLS) for all
-- writes. These policies protect any direct client-side reads.
-- ════════════════════════════════════════════════════════════
alter table profiles         enable row level security;
alter table systems          enable row level security;
alter table support_threads  enable row level security;
alter table support_messages enable row level security;
alter table invoices         enable row level security;
alter table reports          enable row level security;

-- Clients can read only their own rows
create policy "own profile"  on profiles        for select using (auth.uid() = id);
create policy "own systems"  on systems         for select using (auth.uid() = client_id);
create policy "own threads"  on support_threads for select using (auth.uid() = client_id);
create policy "own invoices" on invoices        for select using (auth.uid() = client_id);
create policy "own reports"  on reports         for select using (auth.uid() = client_id);
create policy "own messages" on support_messages for select using (
    exists (select 1 from support_threads t where t.id = thread_id and t.client_id = auth.uid())
);

-- applications & invites are server-only (no client policies = no client access)
alter table applications enable row level security;
alter table invites      enable row level security;
