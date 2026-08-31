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
