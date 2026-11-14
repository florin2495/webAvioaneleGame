// Scenario 3 (phone only): the 10x10 boards on a small screen. No screen may scroll sideways, every cell must
// stay big enough to tap (WCAG 2.2 minimum target: 24 x 24 CSS px), and a real touch tap must fire a shot that
// the other phone sees live. Scenario 1 already plays a full round on the emulated iPhone; this one checks layout.
import { expect, test } from "@playwright/test";
import {
  board,
  closeWinner,
  createRoom,
  emptyCell,
  expectNoHorizontalScroll,
  joinRoom,
  leaveAll,
  placeAndStart,
  REALTIME_MS,
  roomState,
  shoot,
  smallestCell,
  withPlayers,
} from "./helpers";

const MIN_TAP_PX = 24;

test("boards fit a phone screen and a tap fires a shot", async ({ browser }) => {
  test.skip(!test.info().project.use.isMobile, "phone layout only");

  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("home page fits the screen", async () => {
      await host.page.goto("./");
      await expect(host.page.getByTestId("home-submit")).toBeVisible();
      await expectNoHorizontalScroll(host.page);
    });

    await test.step("lobby with the placement board fits the screen", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      for (const p of players) {
        await expect(p.page.getByTestId("placement-board")).toBeVisible();
        await expectNoHorizontalScroll(p.page);
        expect(await smallestCell(p.page.getByTestId("placement-board")), `${p.name}'s placement cells`).toBeGreaterThanOrEqual(MIN_TAP_PX);
      }
    });

    await test.step("game screen fits, every cell is big enough to tap", async () => {
      await placeAndStart(players, room.code);
      for (const p of players) {
        await expectNoHorizontalScroll(p.page);
        for (const seat of [1, 2] as const) {
          expect(await smallestCell(board(p, seat)), `${p.name}'s board ${seat}`).toBeGreaterThanOrEqual(MIN_TAP_PX);
        }
      }
    });

    await test.step("a touch tap fires a shot, the other phone sees it live", async () => {
      const [hs, gs] = await Promise.all([roomState(host, room.code), roomState(guest, room.code)]);
      const shooter = hs.room.turnSeat === hs.me.seat ? host : guest;
      const other = shooter === host ? guest : host;
      const targetSeat = (shooter === host ? gs : hs).me.seat!;
      const targetPlanes = (shooter === host ? gs : hs).myPlanes!;
      expect(await shoot(shooter, room.code, targetSeat, emptyCell(targetPlanes), [other], "tap")).toBe("miss");
      await expectNoHorizontalScroll(other.page);
    });

    await test.step("one leaves mid-game (the other wins), the room closes", async () => {
      await leaveAll([guest]);
      await expect(host.page.getByTestId("winner-dialog")).toContainText("Ai câștigat!", { timeout: REALTIME_MS });
      await closeWinner([host]);
      await leaveAll([host]);
      room.closed = true;
    });
  });
});
