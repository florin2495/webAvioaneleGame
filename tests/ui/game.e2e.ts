// Scenario 1: two real browsers play a live round on the deployed site: create, join by link, random planes,
// ready (auto start), every shot reaches the other player through Realtime (well under the 15 s polling
// fallback), the turn passes both ways, heads keep the turn, the last head wins, the winner pop-up, both layouts
// revealed, a new round followed live, leave. Runs on every project.
import { expect, test } from "@playwright/test";
import {
  board,
  closeWinner,
  createRoom,
  joinRoom,
  leaveAll,
  placeAndStart,
  playRound,
  PLANES,
  REALTIME_MS,
  roomState,
  withPlayers,
} from "./helpers";

test("two players play a live round to the last head", async ({ browser }) => {
  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("host creates a room, the guest joins by link", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      await expect(guest.page.getByTestId("placement-board")).toBeVisible();
      await expect(host.page.getByTestId("player-list")).toContainText(guest.name, { timeout: REALTIME_MS });
    });

    await test.step("both place random planes and get ready, the game starts by itself", () =>
      placeAndStart(players, room.code),
    );

    const { winner, loser } = await test.step("play a round, every shot live on the other screen", () =>
      playRound(players, room.code),
    );

    await test.step("both see the winner pop-up, then both layouts revealed", async () => {
      await expect(winner.page.getByTestId("winner-dialog")).toContainText("Ai câștigat!");
      await expect(loser.page.getByTestId("winner-dialog")).toContainText(`${winner.name} a câștigat`, { timeout: REALTIME_MS });
      await closeWinner(players);
      const winnerSeat = (await roomState(winner, room.code)).me.seat!;
      const loserSeat = winnerSeat === 1 ? 2 : 1;
      for (const p of players) {
        await expect(p.page.getByTestId("status-banner")).toHaveAttribute("data-turn", "none");
        for (const seat of [winnerSeat, loserSeat] as const) {
          await expect(board(p, seat).locator("[data-plane]")).toHaveCount(PLANES * 8);
        }
      }
    });

    await test.step("host starts a new round, the guest follows live", async () => {
      await host.page.getByTestId("new-round").click();
      await expect(host.page.getByTestId("placement-board")).toBeVisible();
      await expect(guest.page.getByTestId("placement-board")).toBeVisible({ timeout: REALTIME_MS });
    });

    await test.step("both leave, the room closes", async () => {
      await leaveAll([guest, host]);
      room.closed = true;
    });
  });
});
