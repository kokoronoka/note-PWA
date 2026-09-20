-- Welovenote cloud sync (Phase 2) — run manually in Supabase Dashboard → SQL Editor.
-- This file is a reference only; nothing in the app executes it automatically.

create table notes (
  id          text primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  title       text default '',
  type        text default 'ink',
  text_data   text default '',
  ink_data    text,
  zoom        float default 1,
  pan_x       float default 0,
  pan_y       float default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Enable Row Level Security
alter table notes enable row level security;

-- Policy: users can only access their own notes
create policy "Users can CRUD own notes"
on notes for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Welovenote realtime sync (Phase 3)
-- Enable realtime for notes table:
-- Go to: Supabase Dashboard → Database → Replication
-- Find the notes table and toggle ON "Insert", "Update", "Delete"

-- REQUIRED for DELETE events to actually reach other devices: verified live
-- (two browsers signed into the same account) that INSERT and UPDATE synced
-- instantly, but DELETE silently never arrived. This is a documented
-- Supabase behavior, not a bug in the app: a DELETE's "old row" payload only
-- includes the primary key by default, but Realtime needs the full old row
-- (specifically user_id) to check it against the RLS policy above — with
-- only the primary key available, it can't verify the policy, so it drops
-- the event rather than risk leaking it. Run this once to fix it:
alter table notes replica identity full;

-- Welovenote folders (Phase 4) — already applied; kept here for reference.

create table folders (
  id          text primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text default 'Untitled Folder',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table folders enable row level security;

create policy "Users can CRUD own folders"
on folders for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Same DELETE-over-Realtime fix as notes above
alter table folders replica identity full;

-- A deleted folder's notes fall back to unfoldered rather than being deleted
-- themselves (app-side deleteFolder() also does this before calling
-- deleteFolderFromCloud(), so this is a backstop for deletes made directly
-- in the DB, not the primary path)
alter table notes add column folder_id text references folders(id) on delete set null;

-- Enable realtime for folders table the same way as notes:
-- Supabase Dashboard → Database → Replication → folders → Insert/Update/Delete ON
--
-- That dashboard toggle IS this SQL — run it directly if you'd rather not
-- click through the UI. This is the single most likely cause of "folders
-- don't sync across devices": creating the table does NOT add it to the
-- realtime publication, that's a separate, manual step.
--
-- IMPORTANT: subscribeToRealtime() in index.html puts the notes and folders
-- listeners on ONE shared channel. If folders isn't in the publication, the
-- whole channel — including the notes listener — fails to subscribe
-- (CHANNEL_ERROR), which would also explain new notes silently failing to
-- sync, not just folders.
alter publication supabase_realtime add table folders;

-- ════════════════════════════════════════════════════════════════════════
-- Welovenote subscriptions (Monetization Phase A) — run once in SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

create table profiles (
  id                      uuid references auth.users(id) on delete cascade primary key,
  subscription_tier       text not null default 'free'
                            check (subscription_tier in ('free', 'pro', 'business')),
  subscription_status     text not null default 'active',
  stripe_customer_id      text unique,
  stripe_subscription_id  text,
  current_period_end      timestamptz,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

alter table profiles enable row level security;

-- Read-only for the owner. There is deliberately NO insert/update/delete
-- policy: only the Edge Functions (service_role key, which bypasses RLS) may
-- write here. A client-writable subscription_tier would let anyone grant
-- themselves Pro from the browser console.
create policy "Users can read own profile"
on profiles for select
using (auth.uid() = id);

-- RLS already blocks writes, but revoke the table privileges too so a future
-- permissive policy added by mistake still can't open this up to the browser.
revoke insert, update, delete on profiles from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill: the trigger only fires for sign-ups from now on, so every account
-- that already exists needs its row created once here.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
