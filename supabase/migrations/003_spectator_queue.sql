-- Spectator queue ("Intră la runda următoare"): a spectator who wants a seat in the next round is
-- stamped with the time they queued. At new-round, queued spectators take the free seats in queued_at order.
-- Additive and idempotent. Run once in the Supabase SQL editor.
alter table public.airplanes_players add column if not exists queued_at timestamptz;
