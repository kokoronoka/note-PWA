-- Inkpad cloud sync (Phase 2) — run manually in Supabase Dashboard → SQL Editor.
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

-- Inkpad realtime sync (Phase 3)
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
