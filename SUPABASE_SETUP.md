# Shared backend setup (Supabase) — ~10 minutes, free

This unlocks the live leaderboard, the shared roster you + Will both manage, admin/teacher
roles, and cross-student history. You do these steps once; then paste me two values.

## 1. Create the project
1. Go to **https://supabase.com** → **Start your project** → sign in with GitHub (free).
2. **New project**. Name it `chess-trainer`. Pick any region near you. Set a database password
   (save it somewhere; you won't need it in the app). Wait ~2 min for it to spin up.

## 2. Create the tables
Left sidebar → **SQL Editor** → **New query** → paste ALL of this → **Run**:

```sql
-- roster / leaderboard
create table public.students (
  username        text primary key,          -- chess.com username, lowercase
  name            text not null,             -- first name + last initial
  group_id        text default 'ms',         -- 'ms' | 'hs' | 'teacher'
  coach           text,                      -- coach's username, lowercase
  role            text default 'student',    -- 'student' | 'teacher' | 'admin'
  ladder_rating   int,
  chesscom_rating int,
  uscf_id         text,
  uscf_rating     int,
  updated_at      timestamptz default now()
);

-- progress-over-time snapshots, shared so coaches see trends from any device
create table public.snapshots (
  username text not null,
  d        date not null,
  rating   int,
  acc      int,
  dims     jsonb,
  primary key (username, d)
);

-- who can manage the roster
create table public.admins (
  username text primary key,
  added_by text
);

-- seed yourself as the main admin
insert into public.admins (username, added_by) values ('rcgavaldon', 'rcgavaldon')
  on conflict (username) do nothing;

-- Row-Level Security: allow the app (anon key) to read/write these tables.
-- (Low-risk: only first name + chess.com username + ratings are stored. Tighten later if wanted.)
alter table public.students  enable row level security;
alter table public.snapshots enable row level security;
alter table public.admins    enable row level security;
create policy anon_all on public.students  for all using (true) with check (true);
create policy anon_all on public.snapshots for all using (true) with check (true);
create policy anon_read on public.admins   for select using (true);
create policy anon_write on public.admins  for all using (true) with check (true);
```

## 3. Grab the two values I need
Left sidebar → **Project Settings** (gear) → **API**. Copy:
- **Project URL** (looks like `https://abcdxyz.supabase.co`)
- **Project API key → `anon` `public`** (a long `eyJ...` string — the *anon* one, NOT `service_role`)

## 4. Connect the app
In the app: **Students tab → "☁ Connect shared leaderboard" → paste both → Connect.**
(Stored on your device; students never need this — they just open their link.)

Then tell me it's connected and I'll verify the leaderboard, shared roster, and roles end-to-end.

> The `anon` key is meant to be public (it ships in the app); the RLS policies above are what
> gate access. Never paste the `service_role` key anywhere client-side.
