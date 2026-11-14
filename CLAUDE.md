@AGENTS.md

# webAvioaneleGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webAvioaneleGame`, public). Never the work account.
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
| `supabase/migrations/003_spectator_queue.sql` | yes (2026-11-08, verified by effect) | `airplanes_players.queued_at timestamptz` (spectator queue "Intră la runda următoare"). Every query selects this column (`PLAYER_COLUMNS`), so do not push before it is run. |

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

## Abandoned rooms (120 s)
- `GET /api/rooms` (the room list behind "Intră în cameră") also runs `cleanupAbandonedRooms` (`src/lib/server/room.ts`):
  every room in ANY status (also `playing`) whose `last_activity_at` is older than `ROOM_ABANDONED_MS` (120 s, `game.ts`)
  and with no member (player or spectator, both are `airplanes_players` rows) `last_seen_at` within 120 s is deleted
  (players, boards and moves cascade). Open room pages keep both fresh (`/state` polls every 15 s, touching
  `last_seen_at` every 10 s and `last_activity_at` every 20 s), so only rooms nobody has open disappear. The 10/30-minute
  idle expiry stays too.

## Testing (GitHub Actions, manual only)
Tests run only in GitHub Actions on the free tier (the repo is public, so Actions minutes are free): `ubuntu-latest`
runners only, never billed / larger / macOS runners, and never locally (see `D:\_DEv\CLAUDE.md`). Every workflow is `workflow_dispatch`
only (no automatic trigger): nothing gates a push, and Vercel deploys `main` regardless.
Start one with `gh workflow run <file> --ref main`, then `gh run watch` (or the Actions tab, "Run workflow").

| Workflow | Runs |
| --- | --- |
| `.github/workflows/check.yml` "Check code" | `npx next typegen` + `npx tsc --noEmit` (typegen first, so route types in `.next/types` are checked), `npx eslint src`, `npx next build`. Every step runs even if an earlier one failed |
| `.github/workflows/unit-tests.yml` "Unit tests" | `npm test` (Vitest: `src/lib/*.test.ts`, pure logic, no DB) |
| `.github/workflows/e2e.yml` "E2E" | `node scripts/e2e.mjs <base_url>` (input, default production `https://games.hailatat.icu/airplanes`); one run at a time |
| `.github/workflows/e2e-ui.yml` "E2E UI (Playwright)" | `npx playwright test` (`playwright.config.ts`, tests in `tests/ui/*.e2e.ts`) against `base_url` (`E2E_BASE_URL`, default production), on desktop Chromium and an emulated iPhone 13 (WebKit). Same concurrency group as "E2E". On failure the report (traces, screenshots, videos) is uploaded as the `playwright-report` artifact |

- E2E needs the repo secrets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (only for the cleanup safety net;
  locally the script falls back to `.env.local`). It checks that the deployed client JS contains the `package.json`
  version of the checked-out ref, so run it on `main` after the Vercel deploy of that version has finished.
- What E2E does (`scripts/e2e.mjs`, Node built-ins only): checks page / `_next` assets / version / manifest / icons /
  `room/XXXXXX` over HTTP and that `web-avioanele-game.vercel.app/airplanes` serves the same build, then drives the real
  API (production DB) with 2 players and spectators: create (password), wrong / missing password, join, duplicate
  nickname, forged / tampered tokens, rejoin (same device, old token dead, also mid-game), lobby kick, leave, spectator
  on request, settings, illegal layouts (overlap, touching, off board, wrong count), ready -> auto start, no layout
  leaks, out-of-turn / spectator / invalid shots, miss passes the turn, hit and head keep it, double tap race, last head
  wins, reveal, new round (double new-round race), pending kick with "Ignoră" then enforced after 12 s, spectator sits,
  leave mid-game (the other wins), host handover, last one out closes the room. Rooms are named `e2e-test-…` and deleted
  at the end; it never calls `/api/feedback`.
- What E2E UI does (`tests/ui/`, shared steps in `helpers.ts`; every change must reach the other screens within 5 s
  without a reload, polling is 15 s, so this checks Realtime). Rooms use 2 planes; the tests aim by reading the
  opponent's planes from `/state` with the token the page stored (`avioane:session:<code>`), so no move is hard-coded:
  - `game.e2e.ts` (both projects): two browser contexts (= two devices) create a room, join by link, random planes,
    ready (auto start), the first shooter misses, the other misses back, the first downs every head (heads keep the
    turn), each shot seen live on the other screen, winner pop-up on both, both layouts revealed, new round, leave.
  - `spectator.e2e.ts` (desktop Chromium only): a third person joins mid-game = spectator (both boards, no planes, no
    placement / note tools), the players see them, they queue ("în coadă #1" seen by the host), see every shot and the
    end live; the guest leaves and "Rundă nouă" seats the queued spectator.
  - `mobile.e2e.ts` (iPhone only): no horizontal scroll on home / lobby / game, every board cell >= 24 px, a touch tap
    fires a shot seen live by the other phone, leave mid-game makes the other the winner.
  Rooms are `e2e-test-ui-…`; a leftover is deleted with the service key from the same repo secrets.
- Playwright files are `*.e2e.ts`, never `*.spec.ts` / `*.test.ts` (Vitest would pick those up).
- The UI tests find elements by `data-testid`: `home-submit`, `join-submit`, `leave`, `placement-board`,
  `random-layout`, `ready`, `ready-status`, `board` (game boards, with `data-seat` = the seat whose board it is),
  `status-banner` (`data-turn` = `me` / `other` / `none`), `note-tools`, `winner-dialog`, `winner-close`, `new-round`,
  `player-list`, `queue-toggle`, `spectator-badge`, `spectator-lobby`, `app-version`. Board cells (`Board.tsx`) carry
  `data-cell` (0-99), `data-shot` (`miss` / `hit` / `head`) and `data-plane` (`head` / `body`, only where the viewer may
  see a plane). Renaming or removing one breaks `tests/ui`.

