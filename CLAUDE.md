@AGENTS.md

# webAvioaneleGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webAvioaneleGame`, private). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project is connected by the user by hand. Once it is, every push to `main` deploys to production
  (served at `games.hailatat.icu/airplanes` via a multi-zones rewrite in the hub `florin2495/hailataticu-hub` to `web-avioanele-game.vercel.app/airplanes`; `basePath` is `/airplanes`, so client `fetch`/share URLs must add `NEXT_PUBLIC_BASE_PATH`).
- Ask the user before pushing (= deploying), unless they explicitly say to deploy.
- **Before every push, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown in-game next to "Setări".
- Functions run in `fra1` (Frankfurt, `vercel.json` `{ "regions": ["fra1"] }`), next to the Supabase DB. Never remove it: the Vercel default `iad1` (Washington) makes every DB query cross the Atlantic (1-2 s per request instead of ~0.3 s).

## Database (Supabase project shared with Bingo)
Same project as Bingo; every table here is prefixed `airplanes_` so the two games never touch each other's tables.
Migrations are run by hand in the Supabase SQL editor, so this list is the source of truth.
**Update it whenever the user confirms a migration ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | yes (2026-11-06, verified) | `airplanes_rooms`, `airplanes_players`, `airplanes_boards`, `airplanes_moves` |
| `supabase/migrations/001_pending_kick.sql` | yes (2026-11-07, verified) | `airplanes_players.kick_requested_at timestamptz` (pending kick during a game). Do not push the kick-with-ignore code before it is run. |
| `supabase/migrations/002_reconnect.sql` | yes (2026-11-07, verified: service role 200, anon 401) | `airplanes_players.last_seen_at`, `device_hash` + index (rejoin the same seat). Do not push the reconnect code before it is run. |
| `supabase/migrations/003_spectator_queue.sql` | **no, to be run** | `airplanes_players.queued_at timestamptz` (spectator queue "Intră la runda următoare"). Every query selects this column (`PLAYER_COLUMNS`), so do not push before it is run. |

Rules for schema changes:
- New migration = new numbered file in `supabase/migrations/`, additive when possible, folded into `supabase/schema.sql` too.
- Code that needs a migration must not be pushed until the user has run it. Verify it by effect with the service key.
- Never print or commit the keys in `.env.local`.

Rejoin the same seat (`src/lib/reconnect.ts`): every member request stamps `last_seen_at` (at most every 10 s);
re-joining with an existing nickname reclaims that member row (new token; seat, ready flag and planes kept) from the
same device (`device_hash`) or once it has been unseen for 45 s, also mid-game. `/state` exposes only a derived
`connected` flag ("deconectat" badge). Lobby/finished rooms close after 10 idle minutes, games after 30.

Leaderboard (`src/lib/server/leaderboard.ts`): when a round ends (last head, or a player leaves mid-game) `finishGame` reports to the hub's
`hub_leaderboard` / `hub_leaderboard_rounds` (slug `airplanes`; migration `002_hub_leaderboard.sql` lives in the hub repo and must be run
first). Best effort, never fails the game. Spectator queue: `POST /queue` toggles `queued_at`; `new-round` seats queued spectators
(queue order) in free seats. Host reorder: `POST /reorder` swaps seats 1/2 in the lobby. Private notes (X marks, guessed plane) are
client-only (`src/lib/notes.ts`, localStorage); the old "guess the shape" move/endpoint is gone.

Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by `florin2495/hailataticu-hub`, slug `airplanes`); this game must not be deployed before that table exists.

## Testing
- `npm test` (Vitest, pure rules in `src/lib/game.ts`), `npx tsc --noEmit`, `npx eslint src`, `npx next build`.
- End-to-end: drive the real API with two players and a spectator (create, join, board, ready -> auto start,
  shoot, guess, leave mid-game, new-round, sit, kick) against `npm run dev`. Delete the test rooms afterwards.
