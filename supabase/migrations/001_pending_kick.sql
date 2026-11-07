-- Kick during a running game waits 10 s and can be ignored by the target player.
-- null = no pending kick. Run by hand in the Supabase SQL editor.
alter table public.airplanes_players add column if not exists kick_requested_at timestamptz;
