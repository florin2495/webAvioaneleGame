// A shot pushed through the Realtime broadcast, applied to the state a client already has, so the
// opponent and the spectators see it without asking /state. Pure, no I/O.
//
// Only public data travels this way (cell, shooter, result - every member sees every shot anyway).
// The end of a game is never applied here: the revealed layouts come from /state.

import { isCell, replay, type Move } from "./game";
import type { RoomState } from "./types";

export function isMove(v: unknown): v is Move {
  if (!v || typeof v !== "object") return false;
  const m = v as Move;
  return (
    Number.isInteger(m.seq) &&
    m.seq >= 1 &&
    (m.seat === 1 || m.seat === 2) &&
    isCell(m.cell) &&
    (m.result === "miss" || m.result === "hit" || m.result === "head")
  );
}

/**
 * The state after `move`, or null when it cannot be applied locally and the client must ask /state:
 * not playing, another round, a missed shot in between (gap), or the move ends the game.
 * A move already applied (seq already known) returns the state unchanged.
 */
export function applyShot(state: RoomState, round: number, move: unknown): RoomState | null {
  if (!isMove(move) || state.room.status !== "playing" || round !== state.room.round) return null;
  const known = state.moves.length;
  if (move.seq <= known) return state.moves[move.seq - 1]?.cell === move.cell ? state : null;
  if (move.seq !== known + 1) return null; // gap: something was missed
  const moves = [...state.moves, move];
  const progress = replay(moves, state.room.round, state.room.planesCount);
  if (progress.winner) return null;
  return {
    ...state,
    moves,
    room: { ...state.room, turnSeat: progress.turn, downed: progress.downed },
  };
}
