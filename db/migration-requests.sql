-- ════════════════════════════════════════════════════════════
-- Harbour Automation — client requests / intake (Documents tab)
-- Run in Supabase → SQL Editor → New query → Run. Idempotent.
-- ════════════════════════════════════════════════════════════
create table if not exists requests (
    id           uuid primary key default gen_random_uuid(),
    client_id    uuid references profiles(id) on delete cascade,
    type         text,                       -- business_details | access | assets | documents | phone | availability | content | approval | custom
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
