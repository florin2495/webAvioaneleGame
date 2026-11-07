@AGENTS.md

# webAvioaneleGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webAvioaneleGame`, private). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project is connected by the user by hand. Once it is, every push to `main` deploys to production
  (domain: `airplanes.hailatat.icu`, listed on the hub `florin2495/hailataticu-hub`).
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
| `supabase/migrations/001_pending_kick.sql` | **not yet applied** | `airplanes_players.kick_requested_at timestamptz` (pending kick during a game). Do not push the kick-with-ignore code before it is run. |

Rules for schema changes:
- New migration = new numbered file in `supabase/migrations/`, additive when possible, folded into `supabase/schema.sql` too.
- Code that needs a migration must not be pushed until the user has run it. Verify it by effect with the service key.
- Never print or commit the keys in `.env.local`.

Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by `florin2495/hailataticu-hub`, slug `airplanes`); this game must not be deployed before that table exists.

## Testing
- `npm test` (Vitest, pure rules in `src/lib/game.ts`), `npx tsc --noEmit`, `npx eslint src`, `npx next build`.
- End-to-end: drive the real API with two players and a spectator (create, join, board, ready -> auto start,
  shoot, guess, leave mid-game, new-round, sit, kick) against `npm run dev`. Delete the test rooms afterwards.
