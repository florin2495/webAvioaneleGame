// Scenario 2: someone opens the invite link of a running game. They become a spectator (both boards, no planes,
// no placement, no note tools), the players see them live, they queue for the next round ("în coadă" seen live
// by the players), see every shot live, see the end of the round; one player leaves and the host's "Rundă nouă"
// seats the queued spectator. Desktop Chromium only: it checks game logic and Realtime, the device does not
// matter (scenario 1 already runs on WebKit).
import { expect, test } from "@playwright/test";
import {
  board,
  closeWinner,
  createRoom,
  joinRoom,
  leaveAll,
  placeAndStart,
  playRound,
  REALTIME_MS,
  withPlayers,
} from "./helpers";

test("a late joiner watches as a spectator and plays from the next round", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop-chromium", "game logic, one browser is enough");

  await withPlayers(browser, ["Ana", "Bob", "Cris"], async (players, room) => {
    const [host, guest, spectator] = players;

    await test.step("two players start a game", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      await placeAndStart([host, guest], room.code);
    });

    await test.step("a third person joins mid-game and becomes a spectator", async () => {
      await joinRoom(spectator, room.code);
      const sp = spectator.page;
      await expect(sp.getByTestId("spectator-badge")).toBeVisible();
      await expect(sp.getByTestId("board")).toHaveCount(2);
      await expect(sp.locator('[data-testid="board"] [data-plane]')).toHaveCount(0);
      for (const id of ["placement-board", "note-tools", "random-layout", "ready"]) await expect(sp.getByTestId(id)).toHaveCount(0);
      for (const p of [host, guest]) {
        await expect(p.page.getByTestId("player-list")).toContainText(spectator.name, { timeout: REALTIME_MS });
      }
    });

    await test.step("the spectator queues for the next round, the players see it live", async () => {
      await spectator.page.getByTestId("queue-toggle").click();
      await expect(spectator.page.getByTestId("queue-toggle")).toContainText("Intri la runda următoare");
      await expect(host.page.getByTestId("player-list")).toContainText("în coadă #1", { timeout: REALTIME_MS });
    });

    const { winner } = await test.step("the round is played; the spectator sees every shot live", () =>
      playRound([host, guest], room.code, [spectator]),
    );

    await test.step("the spectator sees the end of the round and both layouts", async () => {
      await expect(spectator.page.getByTestId("status-banner")).toContainText(`${winner.name} a câștigat`, {
        timeout: REALTIME_MS,
      });
      await closeWinner([spectator, host, guest]);
      for (const seat of [1, 2] as const) await expect(board(spectator, seat).locator("[data-plane]")).not.toHaveCount(0);
    });

    await test.step("a player leaves, the new round seats the queued spectator", async () => {
      await leaveAll([guest]);
      await host.page.getByTestId("new-round").click();
      await expect(spectator.page.getByTestId("placement-board")).toBeVisible({ timeout: REALTIME_MS });
      await expect(spectator.page.getByTestId("spectator-badge")).toHaveCount(0);
      await expect(host.page.getByTestId("player-list")).not.toContainText("în coadă");
    });

    await test.step("everyone leaves, the room closes", async () => {
      await leaveAll([spectator, host]);
      room.closed = true;
    });
  });
});
