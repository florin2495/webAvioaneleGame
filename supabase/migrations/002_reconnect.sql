-- Rejoin the same seat: per-player presence and a device fingerprint.
--  last_seen_at: touched by every authenticated request (at most every ~10 s); a member not seen for 45 s
--                counts as disconnected and can be reclaimed by re-joining with the same nickname.
--  device_hash:  sha256 of a random per-browser id; the same device may reclaim its place at any time.
-- Additive and idempotent. Run once in the Supabase SQL editor.
alter table public.airplanes_players add column if not exists last_seen_at timestamptz not null default now();
alter table public.airplanes_players add column if not exists device_hash text;
create index if not exists airplanes_players_room_seen_idx on public.airplanes_players (room_id, last_seen_at);
