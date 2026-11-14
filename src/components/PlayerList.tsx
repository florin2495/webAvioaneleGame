"use client";

import { useState } from "react";
import { api, settle } from "@/lib/client/api";
import { useKickCountdown } from "@/lib/client/kick";
import { startSeat } from "@/lib/game";
import type { RoomState } from "@/lib/types";
import { ErrorText } from "./ui";

function KickBadge({ remainingMs, state, refresh }: { remainingMs: number | null; state: RoomState; refresh: () => Promise<void> }) {
  const seconds = useKickCountdown(remainingMs, state, () => void refresh());
  if (seconds === null) return null;
  return <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">iese în {seconds} s</span>;
}

/** Shown next to a member not seen for 45 s (phone in the background, closed tab, no network). */
export function OfflineBadge({ connected }: { connected: boolean | undefined }) {
  if (connected !== false) return null;
  return (
    <span className="shrink-0 rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      deconectat
    </span>
  );
}

export function PlayerList({
  state,
  token,
  refresh,
  apply,
}: {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
  apply: (s: RoomState) => void;
}) {
  const { players, me, room } = state;
  const canKick = room.hostPlayerId === me.id;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const seated = players.filter((p) => p.seat);
  const freeSeats = 2 - seated.length;
  // Host reorders the two players in the lobby (also between rounds): decides who starts.
  const canReorder = canKick && room.status === "lobby" && seated.length === 2;
  const canQueue = me.seat === null && (room.status !== "lobby" || freeSeats === 0);

  async function reorder() {
    setBusy("reorder");
    setError("");
    try {
      // Swap the two seats: the player now on seat 2 goes first.
      const order = [...seated].reverse().map((p) => p.id);
      await settle(await api<{ state?: RoomState }>(`/api/rooms/${room.code}/reorder`, { token, body: { order } }), apply, refresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleQueue() {
    setBusy("queue");
    setError("");
    try {
      await settle(await api<{ state?: RoomState }>(`/api/rooms/${room.code}/queue`, { token, body: {} }), apply, refresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(null);
    }
  }

  async function kick(id: string, nickname: string, seated: boolean) {
    const midGame =
      room.status === "playing" && seated ? " Are 10 secunde să refuze; dacă nu, jocul se termină și câștigă celălalt jucător." : "";
    if (!window.confirm(`Scoți jucătorul ${nickname} din cameră?${midGame}`)) return;
    setBusy(id);
    setError("");
    try {
      await settle(await api<{ state?: RoomState }>(`/api/rooms/${room.code}/kick`, { token, body: { playerId: id } }), apply, refresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <ul data-testid="player-list" className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {players.map((p) => {
          const isTurn = room.status === "playing" && p.seat !== null && room.turnSeat === p.seat;
          const isWinner = room.winnerPlayerId === p.id;
          return (
            <li key={p.id} className={`flex items-center justify-between gap-2 py-2 ${isTurn ? "font-bold text-indigo-600 dark:text-indigo-400" : ""}`}>
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="w-5 text-center">
                  {p.seat ? "✈️" : "👀"}
                </span>
                <span className="truncate">
                  {p.nickname}
                  {p.id === me.id && <span className="text-zinc-500"> (tu)</span>}
                </span>
                {p.isHost && (
                  <span className="rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase dark:bg-zinc-800">host</span>
                )}
                <OfflineBadge connected={p.connected} />
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <KickBadge remainingMs={p.kickRemainingMs} state={state} refresh={refresh} />
                {canReorder && p.seat && (
                  <button
                    type="button"
                    onClick={() => void reorder()}
                    disabled={busy !== null}
                    className="min-h-8 min-w-8 rounded-md border border-zinc-300 px-2 text-sm font-semibold disabled:opacity-40 dark:border-zinc-700"
                    aria-label={`Schimbă ordinea jucătorilor (mută pe ${p.nickname} ${p.seat === 1 ? "mai jos" : "mai sus"})`}
                  >
                    {p.seat === 1 ? "↓" : "↑"}
                  </button>
                )}
                {!p.seat ? (
                  <span className="text-xs text-zinc-500">{p.queued ? `în coadă #${p.queuePos ?? ""}` : "spectator"}</span>
                ) : room.status === "lobby" ? (
                  p.ready ? (
                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">✓ gata</span>
                  ) : (
                    <span className="text-sm text-zinc-500">își așază avioanele…</span>
                  )
                ) : isWinner ? (
                  <span className="text-sm font-bold text-amber-600">🏆 câștigător</span>
                ) : isTurn ? (
                  <span className="text-xs">trage</span>
                ) : null}
                {canKick && p.id !== me.id && (
                  <button
                    type="button"
                    onClick={() => void kick(p.id, p.nickname, p.seat !== null)}
                    disabled={busy !== null}
                    className="min-h-8 rounded-md border border-rose-300 px-2 text-xs font-semibold text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
                    aria-label={`Scoate pe ${p.nickname}`}
                  >
                    {busy === p.id ? "…" : "Scoate"}
                  </button>
                )}
              </span>
            </li>
          );
        })}
        {room.status === "lobby" &&
          Array.from({ length: freeSeats }, (_, i) => (
            <li key={`free-${i}`} className="py-2 text-sm text-zinc-500">
              <span aria-hidden className="mr-2 inline-block w-5 text-center">
                ·
              </span>
              loc liber pentru jucător — trimite codul camerei
            </li>
          ))}
      </ul>
      {room.status === "lobby" && seated.length === 2 && (
        <p className="mt-2 text-xs text-zinc-500">
          Începe runda {room.round}: <strong>{seated.find((p) => p.seat === startSeat(room.round))?.nickname}</strong>
          {canReorder && " (↑↓ schimbă ordinea)"}
        </p>
      )}
      {canQueue && (
        <button
          type="button"
          data-testid="queue-toggle"
          onClick={() => void toggleQueue()}
          disabled={busy !== null}
          className={`mt-2 min-h-11 w-full rounded-xl px-4 text-sm font-semibold disabled:opacity-40 ${
            me.queued ? "bg-emerald-600 text-white" : "bg-indigo-600 text-white"
          }`}
        >
          {busy === "queue" ? "…" : me.queued ? `✓ Intri la runda următoare (loc ${me.queuePos ?? ""}) — apasă ca să renunți` : "Intră la runda următoare"}
        </button>
      )}
      <ErrorText>{error}</ErrorText>
    </>
  );
}
