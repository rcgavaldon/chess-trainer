create table public.students (
  username        text primary key,
  name            text not null,
  group_id        text default 'ms',
  coach           text,
  role            text default 'student',
  ladder_rating   int,
  chesscom_rating int,
  uscf_id         text,
  uscf_rating     int,
  updated_at      timestamptz default now()
);

create table public.snapshots (
  username text not null,
  d        date not null,
  rating   int,
  acc      int,
  dims     jsonb,
  primary key (username, d)
);

create table public.admins (
  username text primary key,
  added_by text
);

insert into public.admins (username, added_by) values ('rcgavaldon', 'rcgavaldon')
  on conflict (username) do nothing;

alter table public.students  enable row level security;
alter table public.snapshots enable row level security;
alter table public.admins    enable row level security;

create policy anon_all on public.students  for all using (true) with check (true);
create policy anon_all on public.snapshots for all using (true) with check (true);
create policy anon_read on public.admins   for select using (true);
create policy anon_write on public.admins  for all using (true) with check (true);
