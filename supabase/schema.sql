-- Avioanele multiplayer - Supabase schema
-- Run this whole file once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- All tables are prefixed with "airplanes_" so they can live in the same project as Bingo
-- (rooms / players / boards there) without clashing. Idempotent: re-running drops nothing.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- airplanes_rooms: one row per room. Turns are NOT stored: they are replayed from airplanes_moves.
-- ---------------------------------------------------------------------------
create table if not exists public.airplanes_rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  name             text not null check (char_length(name) between 1 and 40),
  password_hash    text,                                   -- scrypt hash, null = no password
  planes_count     smallint not null default 3 check (planes_count between 2 and 4),
  status           text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  round            integer not null default 1 check (round >= 1),
  host_player_id   uuid,
  winner_player_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index if not exists airplanes_rooms_status_activity_idx on public.airplanes_rooms (status, last_activity_at);

-- ---------------------------------------------------------------------------
-- airplanes_players: members of a room. seat 1/2 = the two players, null = spectator.
-- Identity = random token kept by the browser, only its SHA-256 hash is stored.
-- ---------------------------------------------------------------------------
create table if not exists public.airplanes_players (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.airplanes_rooms (id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 1 and 20),
  token_hash text not null unique,
  is_host    boolean not null default false,
  seat       smallint check (seat in (1, 2)),
  ready      boolean not null default false,
  joined_at  timestamptz not null default now(),
  kick_requested_at timestamptz, -- pending host kick during a game (null = none), see migrations/001
  last_seen_at timestamptz not null default now(), -- presence: disconnected after 45 s, see migrations/002
  device_hash  text,                               -- sha256 of the browser's device id, see migrations/002
  queued_at    timestamptz                         -- spectator waiting for a seat next round, see migrations/003
);
create unique index if not exists airplanes_players_room_nickname_uq on public.airplanes_players (room_id, lower(nickname));
create unique index if not exists airplanes_players_room_seat_uq on public.airplanes_players (room_id, seat) where seat is not null;
create index if not exists airplanes_players_room_idx on public.airplanes_players (room_id);
-- Existing databases: the column lines above only apply to a fresh table.
alter table public.airplanes_players add column if not exists kick_requested_at timestamptz;
alter table public.airplanes_players add column if not exists last_seen_at timestamptz not null default now();
alter table public.airplanes_players add column if not exists device_hash text;
alter table public.airplanes_players add column if not exists queued_at timestamptz;
create index if not exists airplanes_players_room_seen_idx on public.airplanes_players (room_id, last_seen_at);

do $$ begin
  alter table public.airplanes_rooms
    add constraint airplanes_rooms_host_fk foreign key (host_player_id) references public.airplanes_players (id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.airplanes_rooms
    add constraint airplanes_rooms_winner_fk foreign key (winner_player_id) references public.airplanes_players (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- airplanes_boards: a player's hidden planes for one round: [{ "head": 0-99, "dir": "N|E|S|W" }].
-- The layout (count, bounds, no touching) is validated in the Route Handlers.
-- ---------------------------------------------------------------------------
create table if not exists public.airplanes_boards (
  player_id  uuid not null references public.airplanes_players (id) on delete cascade,
  room_id    uuid not null references public.airplanes_rooms (id) on delete cascade,
  round      integer not null,
  planes     jsonb not null check (jsonb_typeof(planes) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (player_id, round)
);
create index if not exists airplanes_boards_room_round_idx on public.airplanes_boards (room_id, round);

-- ---------------------------------------------------------------------------
-- airplanes_moves: the ordered list of shots and shape guesses of a round.
-- unique (room, round, seq) makes moves race-safe without locks: two concurrent
-- moves computed from the same state compete for the same seq, only one wins.
-- ---------------------------------------------------------------------------
create table if not exists public.airplanes_moves (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.airplanes_rooms (id) on delete cascade,
  round      integer not null,
  seq        integer not null check (seq >= 1),
  kind       text not null check (kind in ('shot', 'guess')),
  seat       smallint not null check (seat in (1, 2)),       -- who moved; target = the other seat
  cell       smallint not null check (cell between 0 and 99),
  dir        text check (dir in ('N', 'E', 'S', 'W')),
  result     text not null check (result in ('miss', 'hit', 'head', 'correct', 'wrong')),
  created_at timestamptz not null default now(),
  unique (room_id, round, seq)
);

-- ---------------------------------------------------------------------------
-- Security: RLS on, NO policies -> anon / authenticated roles can read or write
-- nothing. Only the service role (Next.js Route Handlers) touches these tables.
-- ---------------------------------------------------------------------------
alter table public.airplanes_rooms   enable row level security;
alter table public.airplanes_players enable row level security;
alter table public.airplanes_boards  enable row level security;
alter table public.airplanes_moves   enable row level security;

revoke all on public.airplanes_rooms, public.airplanes_players, public.airplanes_boards, public.airplanes_moves from anon, authenticated;
