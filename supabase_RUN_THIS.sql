-- ============================================================================
-- RUN THIS ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run (everything is idempotent). Nothing here breaks the live app.
--
-- Project: ukorgxlabzoslxxxhtvm   (Supabase → SQL Editor)
-- ============================================================================

-- 1) Adaptive puzzle rating per player -----------------------------------------
--    Without this, the "⚡ Puzzles" stat on a student's digest never shows.
alter table public.students add column if not exists puzzle_rating int;


-- 2) Puzzle attempts ----------------------------------------------------------
--    Without this table the coach's "🧩 Puzzle history" is not just empty — it
--    actively LIES ("no puzzles logged for X yet") even for kids who trained.
--    This is the ONLY evidence of student effort anywhere in the app.
create table if not exists public.puzzle_attempts (
  id        bigserial primary key,
  username  text not null,
  puzzle_id text,
  fen       text,
  moves     text,         -- solution moves (space-separated UCI)
  tried     text,         -- the move the player actually played on a miss (UCI)
  theme     text,
  solved    boolean,
  rating    int,
  ts        timestamptz default now()
);
alter table public.puzzle_attempts add column if not exists tried text;

create index if not exists puzzle_attempts_user_solved on public.puzzle_attempts (username, solved, ts desc);
create index if not exists puzzle_attempts_user_ts     on public.puzzle_attempts (username, ts desc);

alter table public.puzzle_attempts enable row level security;
drop policy if exists anon_all on public.puzzle_attempts;
create policy anon_all on public.puzzle_attempts for all using (true) with check (true);


-- 3) Close the admin self-promotion hole ---------------------------------------
--    `anon_write on admins` let ANYONE insert themselves into the admins table.
--    Nothing in the app writes to admins (addAdmin() is never called), so making
--    it read-only breaks nothing.
drop policy if exists anon_write on public.admins;
-- (anon_read stays: select-only.)


-- ============================================================================
-- STILL OPEN — needs a decision from you, NOT just SQL
-- ============================================================================
-- The students table is world-readable AND world-writable by anyone who reads
-- the public key out of the repo. That's every kid's first name + username.
--
-- I did NOT "fix" that here, because the honest fix is a real choice:
--
--   A) Supabase Auth: coaches sign in; anon gets SELECT + INSERT (self-enroll)
--      only; UPDATE/DELETE require a signed-in coach. The RIGHT fix. It's a
--      project: the app currently does everything with the anon key, so the
--      coach flows (roster edits, USCF ids, the daily cron) all need wiring to
--      an authed client.
--
--   B) Don't store anything worth leaking: first initial + Chess.com handle
--      instead of real names. Cheap, and makes a leak boring.
--
--   C) Accept the risk for a small club and move on.
--
-- Note: locking DELETE alone doesn't help while UPDATE is open — anyone could
-- still blank every row. It's auth or it isn't protected.
-- ============================================================================
