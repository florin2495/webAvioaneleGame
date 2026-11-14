// End-to-end test of the Avioanele API with two real players and spectators.
// Usage: node scripts/e2e.mjs [baseUrl incl. /airplanes] [vercelProjectUrl incl. /airplanes]
// Default: production (https://games.hailatat.icu/airplanes). Local: node scripts/e2e.mjs http://localhost:3000/airplanes
// Rooms are named "e2e-test-..."; every room it creates is deleted at the end (leave as everyone, then a DB
// delete of leftovers as a safety net: env NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, else .env.local).
// Sends nothing to /api/feedback.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "https://games.hailatat.icu/airplanes").replace(/\/$/, "");
const VERCEL =
  process.argv[3] ?? (BASE.startsWith("https://games.hailatat.icu/") ? "https://web-avioanele-game.vercel.app/airplanes" : null);
const created = new Set();
let failures = 0;

function check(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
}

async function call(path, { token, body, method } = {}) {
  const headers = {};
  if (token) headers["x-player-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, region: res.headers.get("x-vercel-id") };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async (code, p) => (await call(`/api/rooms/${code}/state`, { token: p.token })).data;

// Minimal copy of the plane geometry (src/lib/game.ts); the server re-checks everything.
const SHAPE = [[0, 0], [1, -1], [1, 0], [1, 1], [2, 0], [3, -1], [3, 0], [3, 1]];
function planeCells({ head, dir }) {
  const hr = Math.floor(head / 10);
  const hc = head % 10;
  const out = [];
  for (const [back, side] of SHAPE) {
    const [r, c] = { N: [hr + back, hc + side], S: [hr - back, hc - side], E: [hr + side, hc - back], W: [hr - side, hc + back] }[dir];
    if (r < 0 || r > 9 || c < 0 || c > 9) return null;
    out.push(r * 10 + c);
  }
  return out;
}
const allCells = (planes) => new Set(planes.flatMap((p) => planeCells(p)));
// Key order is not stable through jsonb ({head, dir} comes back as {dir, head}): compare with sorted keys.
const canon = (v) =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const sameJson = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const assetsOf = (html, basePath) =>
  [...new Set([...html.matchAll(new RegExp(`${basePath}/_next/static/[^"'\\s\\\\]+`, "g"))].map((m) => m[0]))].sort();

/** Pages, assets, manifest and icons over plain HTTP, and the Vercel project URL serving the same build. */
async function httpChecks() {
  console.log("HTTP");
  const origin = new URL(BASE).origin;
  const basePath = new URL(BASE).pathname;
  const page = await fetch(BASE, { cache: "no-store" });
  const html = await page.text();
  check(page.status === 200 && html.includes("<html"), `page ${basePath} = ${page.status}`);
  const assets = assetsOf(html, basePath);
  const statuses = await Promise.all(assets.map(async (a) => (await fetch(origin + a)).status));
  check(assets.length > 0 && statuses.every((x) => x === 200), `${assets.length} /_next assets = 200`);
  // The version (next to "Setări") is only on the room page: look in the JS chunks of both pages.
  const roomHtml = await (await fetch(`${BASE}/room/XXXXXX`, { cache: "no-store" })).text();
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  const js = [...new Set([...assets, ...assetsOf(roomHtml, basePath)])].filter((a) => a.endsWith(".js"));
  let hasVersion = false;
  for (const a of js) if (!hasVersion && (await (await fetch(origin + a)).text()).includes(`"${version}"`)) hasVersion = true;
  check(hasVersion, `client JS contains version ${version} (${js.length} chunks)`);
  const manifest = await fetch(`${BASE}/manifest.webmanifest`);
  const m = await manifest.json().catch(() => ({}));
  check(manifest.status === 200 && m.start_url === `${basePath}/`, `manifest = ${manifest.status}, start_url ${m.start_url}`);
  const icons = [...(m.icons ?? []).map((i) => i.src), `${basePath}/favicon.ico`, `${basePath}/pwa-icon/apple`];
  const iconRes = await Promise.all(icons.map((src) => fetch(origin + src)));
  check(
    icons.length === 5 && iconRes.every((x) => x.status === 200 && /image/.test(x.headers.get("content-type") ?? "")),
    `${icons.length} icons = 200 image/*`,
  );
  check(html.includes(`${basePath}/manifest.webmanifest`) && html.includes(`${basePath}/pwa-icon/apple`), "page links manifest and apple icon under the base path");
  const roomPage = await fetch(`${BASE}/room/XXXXXX`);
  check(roomPage.status === 200, `GET ${basePath}/room/XXXXXX = ${roomPage.status}`);
  const roomPage4 = await fetch(`${BASE}/room/XXXX`);
  check(roomPage4.status === 200, `GET ${basePath}/room/XXXX = ${roomPage4.status}`);
  if (VERCEL) {
    const v = await fetch(VERCEL, { cache: "no-store" });
    const vAssets = assetsOf(await v.text(), basePath);
    check(v.status === 200 && vAssets.join() === assets.join(), `${VERCEL} = ${v.status}, same build`);
  }
}

async function main() {
  console.log(`E2E against ${BASE}`);
  await httpChecks();

  console.log("Room, join, list");
  const roomName = `e2e-test-${Date.now().toString(36)}`;
  const devA = randomUUID();
  const r = await call("/api/rooms", { body: { name: roomName, nickname: "Ana", password: "pw", planesCount: 2, deviceId: devA } });
  check(r.status === 200, `create room (${r.status}) region=${r.region ?? "local"}`);
  const code = r.data.code;
  if (code) created.add(code);
  const A = { ...r.data, name: "Ana", deviceId: devA };
  check(typeof code === "string" && /^[A-Z2-9]{6}$/.test(code) && typeof A.token === "string", `room code ${code}`);
  check((await call("/api/rooms", { body: { name: "e2e-test-bad", nickname: "Ana", planesCount: 7 } })).status === 400, "7 planes = 400");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "nope" } })).status === 403, "wrong password = 403");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob" } })).status === 403, "missing password = 403");
  const join = async (nickname, extra = {}) => {
    const deviceId = randomUUID();
    const res = await call(`/api/rooms/${code}/join`, { body: { nickname, password: "pw", deviceId, ...extra } });
    return { ...res.data, status: res.status, name: nickname, deviceId };
  };
  const B = await join("Bob");
  check(B.status === 200 && B.seat === 2, "Bob joins on seat 2");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "bob", password: "pw" } })).status === 409, "duplicate nickname (connected) = 409");
  const list = await call("/api/rooms");
  const listed = list.data.rooms?.find((x) => x.code === code);
  check(listed?.name === roomName && listed.hasPassword && listed.players === 2 && listed.spectators === 0 && listed.status === "lobby", "room in public list: password, 2 players");
  check(!/scrypt|password_hash|token/.test(JSON.stringify(list.data)), "room list leaks no hashes");

  console.log("Tokens and rejoin (lobby)");
  check((await call(`/api/rooms/${code}/state`)).status === 401, "state without token = 401");
  check((await call(`/api/rooms/${code}/state`, { token: "forged-token" })).status === 401, "state with a forged token = 401");
  check((await call(`/api/rooms/${code}/state`, { token: B.token.replace(/^./, (c) => (c === "a" ? "b" : "a")) })).status === 401, "state with a tampered token = 401");
  const reload = await call(`/api/rooms/${code}/state`, { token: B.token });
  check(reload.status === 200 && reload.data.me.id === B.playerId && reload.data.me.seat === 2, "reload with the saved token = same player");
  const raw = JSON.stringify(reload.data);
  check(!/token|device|scrypt/.test(raw) && !raw.includes(A.token), "state leaks no tokens, hashes or device ids");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "pw", deviceId: randomUUID() } })).status === 409, "rejoin as a connected player from another device = 409");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "nope", deviceId: B.deviceId } })).status === 403, "rejoin with a wrong password = 403");
  const reB = await call(`/api/rooms/${code}/join`, { body: { nickname: "BOB", password: "pw", deviceId: B.deviceId } });
  check(reB.status === 200 && reB.data.playerId === B.playerId && reB.data.seat === 2, "rejoin from the same device reclaims the seat");
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 401, "old token is dead after the rejoin");
  if (reB.data.token) B.token = reB.data.token;

  console.log("Kick, leave, sit in the lobby");
  const F = await join("Fil");
  check(F.status === 200 && F.seat === null, "Fil joins as spectator (seats full)");
  check((await call(`/api/rooms/${code}/sit`, { token: F.token, body: {} })).status === 409, "sit with no free seat = 409");
  check((await call(`/api/rooms/${code}/kick`, { token: B.token, body: { playerId: F.playerId } })).status === 403, "non-host kick = 403");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: A.playerId } })).status === 400, "host kicking self = 400");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: "not-a-uuid" } })).status === 404, "kick of an unknown id = 404");
  const kickF = await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: F.playerId } });
  check(kickF.status === 200 && !kickF.data.pending, "lobby kick is immediate");
  check((await call(`/api/rooms/${code}/state`, { token: F.token })).status === 401, "kicked player loses access");
  const G = await join("Gia");
  check((await call(`/api/rooms/${code}/leave`, { token: G.token, body: {} })).status === 200, "Gia leaves the lobby");
  const D = await join("Dan", { spectator: true });
  check(D.status === 200 && D.seat === null, "Dan joins as spectator on request");
  let s = await state(code, A);
  check(s.players.length === 3 && s.players.map((p) => p.seat).join() === "1,2,", "3 members: seat 1, seat 2, spectator");

  console.log("Settings and boards");
  check((await call(`/api/rooms/${code}/settings`, { token: B.token, body: { planesCount: 3 } })).status === 403, "non-host settings = 403");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { planesCount: 5 } })).status === 400, "5 planes = 400");
  check((await call(`/api/rooms/${code}/board`, { token: D.token, body: { generate: true } })).status === 403, "spectator board = 403");
  check((await call(`/api/rooms/${code}/ready`, { token: A.token, body: { ready: true } })).status === 400, "ready without a board = 400");
  check((await call(`/api/rooms/${code}/board`, { token: A.token, body: { planes: [{ head: 22, dir: "N" }, { head: 33, dir: "N" }] } })).status === 400, "overlapping planes = 400");
  check((await call(`/api/rooms/${code}/board`, { token: A.token, body: { planes: [{ head: 22, dir: "N" }, { head: 25, dir: "N" }] } })).status === 400, "touching planes = 400");
  check((await call(`/api/rooms/${code}/board`, { token: A.token, body: { planes: [{ head: 2, dir: "S" }, { head: 77, dir: "S" }] } })).status === 400, "plane off the board = 400");
  check((await call(`/api/rooms/${code}/board`, { token: A.token, body: { planes: [{ head: 22, dir: "N" }] } })).status === 400, "wrong plane count = 400");
  // Ana: plane 1 head C3 pointing up (could also point left), plane 2 head H8 pointing down.
  const aPlanes = [{ head: 22, dir: "N" }, { head: 77, dir: "S" }];
  check((await call(`/api/rooms/${code}/board`, { token: A.token, body: { planes: aPlanes } })).status === 200, "Ana places her planes");
  check((await call(`/api/rooms/${code}/board`, { token: B.token, body: { generate: true } })).status === 200, "Bob generates a layout");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { planesCount: 3 } })).status === 200, "host switches to 3 planes");
  s = await state(code, A);
  check(s.room.planesCount === 3 && s.myPlanes === null, "layouts dropped when the plane count changes");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { planesCount: 2 } })).status === 200, "host switches back to 2 planes");
  await call(`/api/rooms/${code}/board`, { token: A.token, body: { planes: aPlanes } });
  await call(`/api/rooms/${code}/board`, { token: B.token, body: { generate: true } });

  console.log("Ready and auto start");
  check((await call(`/api/rooms/${code}/ready`, { token: A.token, body: { ready: true } })).data.started === false, "Ana ready, not started yet");
  check((await call(`/api/rooms/${code}/board`, { token: A.token, body: { generate: true } })).status === 409, "board change after ready = 409");
  check((await call(`/api/rooms/${code}/shoot`, { token: A.token, body: { cell: 0 } })).status === 409, "shot in the lobby = 409");
  const startRes = await call(`/api/rooms/${code}/ready`, { token: B.token, body: { ready: true } });
  check(startRes.status === 200 && startRes.data.started === true, "Bob ready -> game starts");
  check((await call(`/api/rooms/${code}/ready`, { token: B.token, body: { ready: false } })).status === 409, "unready after start = 409");
  const [sa, sb, sd] = await Promise.all([state(code, A), state(code, B), state(code, D)]);
  check(sa.room.status === "playing" && sa.room.turnSeat === 1, "round 1: seat 1 shoots first");
  check(sameJson(sa.myPlanes, aPlanes) && sb.myPlanes?.length === 2, "each player gets their own layout");
  check(sd.myPlanes === null && sa.reveal === null && sb.reveal === null && sd.reveal === null, "nobody sees hidden planes while playing");
  const bPlanes = sb.myPlanes;
  check(!JSON.stringify(sa).includes(JSON.stringify(bPlanes)) && !JSON.stringify(sb).includes(JSON.stringify(aPlanes)), "opponent's layout not in the state");

  console.log("Turns and hits");
  const bCells = allCells(bPlanes);
  const missCell = [...Array(100).keys()].find((c) => !bCells.has(c));
  check((await call(`/api/rooms/${code}/shoot`, { token: B.token, body: { cell: 5 } })).status === 409, "shot out of turn = 409");
  check((await call(`/api/rooms/${code}/shoot`, { token: D.token, body: { cell: 5 } })).status === 403, "spectator shot = 403");
  check((await call(`/api/rooms/${code}/shoot`, { token: "forged-token", body: { cell: 5 } })).status === 401, "shot with a forged token = 401");
  check((await call(`/api/rooms/${code}/shoot`, { token: A.token, body: { cell: 100 } })).status === 409, "cell 100 rejected");
  check((await call(`/api/rooms/${code}/shoot`, { token: A.token, body: { cell: "x" } })).status === 409, "non-numeric cell rejected");
  const miss = await call(`/api/rooms/${code}/shoot`, { token: A.token, body: { cell: missCell } });
  check(miss.status === 200 && miss.data.result === "miss", "Ana misses");
  check((await call(`/api/rooms/${code}/shoot`, { token: A.token, body: { cell: (missCell + 1) % 100 } })).status === 409, "Ana again after a miss = 409");

  // Mid-game rejoin while it is Bob's turn.
  const reB2 = await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "pw", deviceId: B.deviceId } });
  check(reB2.status === 200 && reB2.data.playerId === B.playerId && reB2.data.seat === 2, "Bob rejoins mid-game on his seat");
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 401, "old token is dead");
  if (reB2.data.token) B.token = reB2.data.token;
  s = await state(code, B);
  check(s.room.turnSeat === 2 && sameJson(s.myPlanes, bPlanes) && s.moves.length === 1, "same seat, same planes, same history, his turn");

  const E = await join("Ema");
  check(E.status === 200 && E.seat === null, "Ema joins mid-game as spectator");
  const H = await join("Hal");
  check(H.status === 200 && H.seat === null, "more spectators fit (up to 16)");
  check((await call(`/api/rooms/${code}/sit`, { token: E.token, body: {} })).status === 409, "sit mid-game = 409");

  // Bob: body hit on Ana's plane 1 (C4), shoots it again, then hits the head (C3) and keeps shooting.
  const hit = await call(`/api/rooms/${code}/shoot`, { token: B.token, body: { cell: 32 } });
  check(hit.status === 200 && hit.data.result === "hit", "Bob hits a body cell");
  check((await call(`/api/rooms/${code}/shoot`, { token: B.token, body: { cell: 32 } })).status === 409, "same cell twice = 409");
  const head = await call(`/api/rooms/${code}/shoot`, { token: B.token, body: { cell: 22 } });
  check(head.status === 200 && head.data.result === "head" && head.data.won === false, "hit keeps the turn; Bob hits a head");
  s = await state(code, D);
  check(s.room.turnSeat === 2 && s.room.downed[1] === 1, "plane downed, Bob keeps the turn (seen by spectator)");
  check((await call(`/api/rooms/${code}/guess`, { token: B.token, body: { dir: "N" } })).status === 404, "guess endpoint is gone");
  const miss2 = await call(`/api/rooms/${code}/shoot`, { token: B.token, body: { cell: allCells(aPlanes).has(0) ? 99 : 0 } });
  check(miss2.status === 200 && miss2.data.result === "miss", "Bob shoots again after the head and misses");
  s = await state(code, A);
  check(s.room.turnSeat === 1 && s.room.downed[1] === 1, "turn passes to Ana, plane stays down");

  // Ana: two identical shots at once at Bob's first head -> exactly one counts.
  const [p1, p2] = bPlanes;
  const race = await Promise.all([1, 2].map(() => call(`/api/rooms/${code}/shoot`, { token: A.token, body: { cell: p1.head } })));
  check(race.map((x) => x.status).sort().join() === "200,409" && race.find((x) => x.status === 200).data.result === "head", "double tap: one shot counts, the other = 409");
  const views = await Promise.all([A, B, D, E].map((p) => state(code, p)));
  check(views.every((v) => sameJson(v.moves, views[0].moves) && sameJson(v.room, views[0].room)), "players and spectators see the same moves and room");
  check(views[2].myPlanes === null && views[3].myPlanes === null && views.every((v) => v.reveal === null), "spectators see no planes mid-game");

  const last = await call(`/api/rooms/${code}/shoot`, { token: A.token, body: { cell: p2.head } });
  check(last.status === 200 && last.data.result === "head" && last.data.won === true, "last head wins at once");
  s = await state(code, D);
  check(s.room.status === "finished" && s.room.winnerPlayerId === A.playerId, "game over, Ana wins");
  check(sameJson(s.reveal?.[1], aPlanes) && sameJson(s.reveal?.[2], bPlanes), "both layouts revealed at the end");
  check((await call(`/api/rooms/${code}/shoot`, { token: B.token, body: { cell: 0 } })).status === 409, "shot after the game = 409");

  console.log("Round 2: kick with Ignoră");
  check((await call(`/api/rooms/${code}/new-round`, { token: B.token, body: {} })).status === 403, "non-host new round = 403");
  const nr = await Promise.all([1, 2].map(() => call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} })));
  check(nr.map((x) => x.status).sort().join() === "200,409", "double new-round: one 200, one 409");
  s = await state(code, A);
  check(s.room.status === "lobby" && s.room.round === 2 && s.players.every((p) => !p.ready) && s.myPlanes === null && s.moves.length === 0, "lobby, round 2, ready reset, fresh boards");
  for (const p of [A, B]) await call(`/api/rooms/${code}/board`, { token: p.token, body: { generate: true } });
  await call(`/api/rooms/${code}/ready`, { token: A.token, body: { ready: true } });
  await call(`/api/rooms/${code}/ready`, { token: B.token, body: { ready: true } });
  s = await state(code, A);
  check(s.room.status === "playing" && s.room.turnSeat === 2, "round 2 starts with seat 2");
  check((await call(`/api/rooms/${code}/kick`, { token: D.token, body: { playerId: B.playerId } })).status === 403, "spectator kick = 403");
  const k1 = await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: B.playerId } });
  check(k1.data.pending === true, "kick of the opponent mid-game is pending");
  check((await state(code, B)).me.kickRemainingMs > 0, "kicked player sees the countdown");
  check((await call(`/api/rooms/${code}/kick/ignore`, { token: B.token, body: {} })).status === 200, "Bob presses Ignoră");
  check((await state(code, B)).me.kickRemainingMs === null && (await state(code, A)).room.status === "playing", "kick cleared, game goes on");
  await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: B.playerId } });
  await sleep(12_500);
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 401, "kick enforced after 12 s");
  s = await state(code, A);
  check(s.room.status === "finished" && s.room.winnerPlayerId === A.playerId && s.players.length === 4, "Bob removed, Ana wins");

  console.log("Round 3: spectator sits, leaves mid-game");
  await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} });
  const sit = await call(`/api/rooms/${code}/sit`, { token: D.token, body: {} });
  check(sit.status === 200 && sit.data.seat === 2, "Dan takes the free seat");
  for (const p of [A, D]) await call(`/api/rooms/${code}/board`, { token: p.token, body: { generate: true } });
  await call(`/api/rooms/${code}/ready`, { token: D.token, body: { ready: true } });
  await call(`/api/rooms/${code}/ready`, { token: A.token, body: { ready: true } });
  s = await state(code, E);
  check(s.room.status === "playing" && s.room.round === 3 && s.room.turnSeat === 1, "round 3 starts with seat 1");
  check((await call(`/api/rooms/${code}/leave`, { token: D.token, body: {} })).status === 200, "Dan leaves mid-game");
  s = await state(code, E);
  check(s.room.status === "finished" && s.room.winnerPlayerId === A.playerId, "the one who stays wins");

  console.log("Cleanup");
  check((await call(`/api/rooms/${code}/leave`, { token: A.token, body: {} })).data.roomClosed === false, "host leaves, room stays");
  s = await state(code, E);
  check(s.room.hostPlayerId === E.playerId && s.me.isHost, "host passes to the spectator");
  check((await call(`/api/rooms/${code}/leave`, { token: H.token, body: {} })).data.roomClosed === false, "Hal leaves");
  const lastOut = await call(`/api/rooms/${code}/leave`, { token: E.token, body: {} });
  check(lastOut.data.roomClosed === true, "last one out closes the room");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "X", password: "pw" } })).status === 404, "room gone");
  created.delete(code);
}

/** Supabase URL + service key: environment (GitHub Actions secrets) first, else .env.local. */
function supabaseEnv() {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) return { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  return Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
  );
}

/** Safety net: delete rooms left behind by a failed run, straight in the DB (service key from env or .env.local). */
async function cleanup() {
  if (created.size === 0) return;
  try {
    const env = supabaseEnv();
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/airplanes_rooms?code=in.(${[...created].join(",")})&name=like.e2e-test-*`;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(url, { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` } });
    console.log(`  cleanup: deleted leftover rooms ${[...created].join(", ")} (${res.status})`);
  } catch (err) {
    console.log("  cleanup failed, delete these rooms by hand:", [...created].join(", "), err.message);
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await cleanup();
}
console.log(failures === 0 ? "\nE2E OK" : `\nE2E FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
