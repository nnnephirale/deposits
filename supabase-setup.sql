-- deposits — Supabase schema + row-level security
-- Run this ONCE in the SQL editor of your existing project (uauqqdaalnddedgjdgcg),
-- the same project SSaved uses. It only ADDS deposits_* tables; it never touches
-- SSaved's collections/folders/cards.
--
-- Privacy model: every row is owned by a Supabase Auth user. RLS below means a
-- logged-in user can only ever read/write their own rows, even though the anon key
-- is public. No login = no data. This is what makes it safe on a public repo.

-- ---------- entries ----------
create table if not exists public.deposits_entries (
  id          text primary key,                       -- app id: Date.now().toString(36)
  user_id     uuid not null default auth.uid()
                references auth.users(id) on delete cascade,
  text        text not null default '',
  tags        jsonb not null default '[]'::jsonb,      -- mix of topic + mode ids
  year        int,                                     -- ISO week-year
  week        int,                                     -- ISO week number
  day         int,                                     -- 0-6 (Mon=0), null = no day
  locked      boolean not null default false,
  source_id   text,                                    -- set on deposits cut from a ramble: id of the hidden original
  segmented   boolean not null default false,          -- true on a ramble original that now lives behind its deposits
  images      jsonb,                                   -- pasted images: { id: dataURL }, referenced in text as ![photo:id]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),      -- bumped on edit; drives last-write-wins
  deleted_at  timestamptz                              -- soft delete so removals sync across devices
);
create index if not exists deposits_entries_user_idx on public.deposits_entries(user_id);

-- ---------- migration for existing installs ----------
-- Safe to re-run; no-ops once the columns exist. Until this runs, the app pushes
-- without these columns (it detects the missing-column error and retries stripped).
alter table public.deposits_entries add column if not exists source_id text;   -- 17 Jul 2026: ramble segmentation
alter table public.deposits_entries add column if not exists segmented boolean not null default false;
alter table public.deposits_entries add column if not exists images jsonb;     -- 19 Jul 2026: pasted inline images

-- ---------- weekly summaries ----------
create table if not exists public.deposits_week_summaries (
  user_id     uuid not null default auth.uid()
                references auth.users(id) on delete cascade,
  week_key    text not null,                           -- "YYYY-WW"
  text        text not null default '',
  origin      text not null default 'ai',              -- 'ai' | 'mine'
  version     int  not null default 1,                 -- AI take count (V1, V2…)
  edited      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  primary key (user_id, week_key)
);

-- ---------- row-level security: each user sees only their own rows ----------
alter table public.deposits_entries        enable row level security;
alter table public.deposits_week_summaries enable row level security;

drop policy if exists "own entries"   on public.deposits_entries;
drop policy if exists "own summaries" on public.deposits_week_summaries;

create policy "own entries" on public.deposits_entries
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own summaries" on public.deposits_week_summaries
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
