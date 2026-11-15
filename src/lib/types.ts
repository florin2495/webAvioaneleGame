import type { Move, Plane, Seat } from "./game";

export type RoomStatus = "lobby" | "playing" | "finished";

export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  ready: boolean;
  /** 1 or 2 for the two players, null for a spectator. */
  seat: Seat | null;
  /** Ms left of a pending host kick (10 s grace), null when none. Relative, so no clock skew. */
  kickRemainingMs: number | null;
  /** A spectator waiting for a seat in the next round ("Intră la runda următoare"). */
  queued: boolean;
  /** 1-based place in the queue of spectators, null when not queued. */
  queuePos: number | null;
  /** Seen in the last 301 s (see lib/reconnect.ts). False = phone in the background, closed tab, no network. */
  connected: boolean;
}

/** What GET /api/rooms/[code]/state returns to a member. Never contains the opponent's planes while playing. */
export interface RoomState {
  room: {
    id: string;
    code: string;
    name: string;
    planesCount: number;
    status: RoomStatus;
    round: number;
    hasPassword: boolean;
    hostPlayerId: string | null;
    winnerPlayerId: string | null;
    /** Whose shot it is while playing. */
    turnSeat: Seat | null;
    downed: Record<Seat, number>;
  };
  /** Seat 1, seat 2, then spectators in join order. */
  players: PublicPlayer[];
  me: PublicPlayer;
  /** My own layout for this round (players only). */
  myPlanes: Plane[] | null;
  /** Every shot of the round - public knowledge for both players and spectators. */
  moves: Move[];
  /** Both layouts - only once the game is finished. */
  reveal: Partial<Record<Seat, Plane[]>> | null;
}

/** Item of the public room list (GET /api/rooms). */
export interface RoomListItem {
  code: string;
  name: string;
  planesCount: number;
  status: RoomStatus;
  hasPassword: boolean;
  /** Seated players (0-2). */
  players: number;
  spectators: number;
}

export interface Session {
  playerId: string;
  token: string;
}
