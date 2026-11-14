// Shared steps for the Playwright UI tests (tests/ui/*.e2e.ts). Not a test file itself (no .e2e.ts suffix).
// Rooms are named "e2e-test-ui-…"; a leftover is deleted with the service key (env) as a safety net.
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

/** A change has to show up on another screen within this, without a reload. Polling alone takes up to 15 s. */
export const REALTIME_MS = 5_000;

/** Planes per player in the test rooms: the minimum, so a round is short. */
export const PLANES = 2;

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

type Dir = "N" | "E" | "S" | "W";
interface Plane {
  head: number;
  dir: Dir;
}
type Seat = 1 | 2;

// Minimal copy of the plane geometry (src/lib/game.ts), to aim at the opponent's planes read from /state.
const SHAPE = [[0, 0], [1, -1], [1, 0], [1, 1], [2, 0], [3, -1], [3, 0], [3, 1]];
function planeCells({ head, dir }: Plane): number[] {
  const hr = Math.floor(head / 10);
  const hc = head % 10;
  return SHAPE.map(([back, side]) => {
    const [r, c] = { N: [hr + back, hc + side], S: [hr - back, hc - side], E: [hr + side, hc - back], W: [hr - side, hc + back] }[dir];
    return r * 10 + c;
  });
}

/** A separate browser context = a separate device (own localStorage session), with the project's device settings. */
export async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    locale: use.locale,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
  });
  return { name, context, page: await context.newPage() };
}

/** The game board of `seat` (the one that seat's opponent shoots at), on any member's screen. */
export const board = (p: Player, seat: Seat) => p.page.locator(`[data-testid="board"][data-seat="${seat}"]`);
export const boardCell = (p: Player, seat: Seat, cell: number) => board(p, seat).locator(`[data-cell="${cell}"]`);
export const banner = (p: Player) => p.page.getByTestId("status-banner");

/** Host creates a room from the home page; returns its code. */
export async function createRoom(host: Player): Promise<string> {
  const page = host.page;
  await page.goto("./");
  await page.getByLabel("Numele camerei").fill(`e2e-test-ui-${Date.now().toString(36)}`);
  await page.getByLabel("Nickname-ul tău").fill(host.name);
  await page.getByLabel("Avioane de fiecare").selectOption(String(PLANES));
  await page.getByTestId("home-submit").click();
  await page.waitForURL(/\/room\/[A-Z0-9]{4,8}$/);
  await expect(page.getByTestId("placement-board")).toBeVisible();
  return page.url().match(/\/room\/([A-Z0-9]{4,8})$/)![1];
}

/** Opens the invite link and joins with the player's nickname (lands in the lobby or as a spectator). */
export async function joinRoom(p: Player, code: string): Promise<void> {
  await p.page.goto(`room/${code}`);
  await p.page.getByLabel("Nickname-ul tău").fill(p.name);
  await p.page.getByTestId("join-submit").click();
  await expect(p.page.getByTestId("join-submit")).toBeHidden();
}

/** Both players place random planes and confirm; the game starts by itself once both are ready. */
export async function placeAndStart(players: Player[], code: string): Promise<void> {
  for (const p of players) {
    await p.page.getByTestId("random-layout").click();
    await expect(p.page.getByTestId("placement-board").locator("[data-plane]")).toHaveCount(PLANES * 8);
    await Promise.all([
      p.page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${code}/ready`) && r.ok()),
      p.page.getByTestId("ready").click(),
    ]);
  }
  for (const p of players) await expect(banner(p)).toBeVisible({ timeout: REALTIME_MS });
}

/** The member's /state, read with the token the page stored (what the UI itself renders). */
export async function roomState(p: Player, code: string) {
  const raw = await p.page.evaluate((k) => localStorage.getItem(k), `avioane:session:${code}`);
  const token = (JSON.parse(raw ?? "{}") as { token?: string }).token;
  expect(token, `${p.name} has a session for ${code}`).toBeTruthy();
  const res = await p.page.request.get(`api/rooms/${code}/state`, { headers: { "x-player-token": token! } });
  expect(res.ok()).toBe(true);
  return (await res.json()) as {
    room: { status: string; turnSeat: Seat | null; winnerPlayerId: string | null };
    me: { id: string; seat: Seat | null };
    myPlanes: Plane[] | null;
  };
}

/** A cell of `planes`' board that holds no plane part (and is not in `skip`). */
export function emptyCell(planes: Plane[], skip: number[] = []): number {
  const taken = new Set([...planes.flatMap(planeCells), ...skip]);
  return [...Array(100).keys()].find((c) => !taken.has(c))!;
}

/**
 * `shooter` fires at `cell` on the board of `targetSeat` (their turn, tap or click) and waits for the server.
 * The result must reach every one of `watchers` live. Returns the result ("miss" | "hit" | "head").
 */
export async function shoot(
  shooter: Player,
  code: string,
  targetSeat: Seat,
  cell: number,
  watchers: Player[],
  how: "click" | "tap" = "click",
): Promise<string> {
  await expect(banner(shooter)).toHaveAttribute("data-turn", "me", { timeout: REALTIME_MS });
  const target: Locator = boardCell(shooter, targetSeat, cell);
  await expect(target).toBeEnabled();
  await Promise.all([
    shooter.page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${code}/shoot`) && r.ok()),
    how === "tap" ? target.tap() : target.click(),
  ]);
  await expect(target).toHaveAttribute("data-shot", /^(miss|hit|head)$/);
  const result = (await target.getAttribute("data-shot"))!;
  for (const w of watchers) {
    await expect(boardCell(w, targetSeat, cell)).toHaveAttribute("data-shot", result, { timeout: REALTIME_MS });
  }
  return result;
}

/**
 * Plays a short round: whoever starts misses, the other misses back (turn passes both ways, live), then the
 * first shooter downs every plane head of the opponent (a head keeps the turn). `watchers` (spectators) must
 * see every shot live. Returns { winner, loser }.
 */
export async function playRound(players: Player[], code: string, watchers: Player[] = []) {
  const states = await Promise.all(players.map((p) => roomState(p, code)));
  const turnSeat = states[0].room.turnSeat!;
  const i = states.findIndex((s) => s.me.seat === turnSeat);
  const [first, second] = [players[i], players[1 - i]];
  const [firstPlanes, secondPlanes] = [states[i].myPlanes!, states[1 - i].myPlanes!];
  const firstSeat = turnSeat;
  const secondSeat: Seat = firstSeat === 1 ? 2 : 1;

  expect(await shoot(first, code, secondSeat, emptyCell(secondPlanes), [second, ...watchers])).toBe("miss");
  await expect(banner(first)).toHaveAttribute("data-turn", "other");
  expect(await shoot(second, code, firstSeat, emptyCell(firstPlanes), [first, ...watchers])).toBe("miss");
  for (const [n, plane] of secondPlanes.entries()) {
    expect(await shoot(first, code, secondSeat, plane.head, [second, ...watchers])).toBe("head");
    if (n < secondPlanes.length - 1) await expect(banner(first)).toHaveAttribute("data-turn", "me");
  }
  return { winner: first, loser: second };
}

/** Closes the winner pop-up ("Vezi tablele") on each screen. */
export async function closeWinner(players: Player[]): Promise<void> {
  for (const p of players) {
    await expect(p.page.getByTestId("winner-dialog")).toBeVisible({ timeout: REALTIME_MS });
    await p.page.getByTestId("winner-close").click();
    await expect(p.page.getByTestId("winner-dialog")).toBeHidden();
  }
}

/** Leaves through the "Părăsește" button (accepting the confirm), in the given order. */
export async function leaveAll(players: Player[]): Promise<void> {
  for (const p of players) {
    p.page.once("dialog", (d) => void d.accept());
    await p.page.getByTestId("leave").click();
    await expect(p.page.getByTestId("home-submit")).toBeVisible();
  }
}

/** The page must not scroll sideways (the usual mobile layout bug). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
}

/** Smallest width/height (CSS px) of the cells of a board. */
export async function smallestCell(grid: Locator): Promise<number> {
  const sizes = await grid
    .locator("[data-cell]")
    .evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)));
  expect(sizes).toHaveLength(100);
  return Math.min(...sizes);
}

/** Safety net: delete the room straight in the DB if the UI flow did not close it. */
export async function deleteRoom(code: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(`cleanup: no Supabase env, delete room ${code} by hand if it is still there`);
    return;
  }
  const res = await fetch(`${url}/rest/v1/airplanes_rooms?code=eq.${code}&name=like.e2e-test-ui-*`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  console.log(`cleanup: room ${code} delete = ${res.status}`);
}

/** Runs `body` with fresh players; always closes their browsers and deletes the room if it was left open. */
export async function withPlayers(
  browser: Browser,
  names: string[],
  body: (players: Player[], room: { code: string; closed: boolean }) => Promise<void>,
): Promise<void> {
  const players = await Promise.all(names.map((n) => newPlayer(browser, n)));
  const room = { code: "", closed: false };
  try {
    await body(players, room);
  } finally {
    if (room.code && !room.closed) await deleteRoom(room.code);
    for (const p of players) await p.context.close();
  }
}
