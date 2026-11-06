"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import type { RoomState } from "@/lib/types";
import { ErrorText } from "./ui";

export function PlayerList({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const { players, me, room } = state;
  const canKick = room.hostPlayerId === me.id;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const freeSeats = 2 - players.filter((p) => p.seat).length;

  async function kick(id: string, nickname: string, seated: boolean) {
    const midGame = room.status === "playing" && seated ? " Jocul se termină și câștigi tu." : "";
    if (!window.confirm(`Îl scoți pe ${nickname} din cameră?${midGame}`)) return;
    setBusy(id);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/kick`, { token, body: { playerId: id } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
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
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {!p.seat ? (
                  <span className="text-xs text-zinc-500">spectator</span>
                ) : room.status === "lobby" ? (
                  p.ready ? (
                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">✓ gata</span>
                  ) : (
                    <span className="text-sm text-zinc-500">își așază avioanele…</span>
                  )
                ) : isWinner ? (
                  <span className="text-sm font-bold text-amber-600">🏆 câștigător</span>
                ) : isTurn ? (
                  <span className="text-xs">{room.pending ? "ghicește forma" : "trage"}</span>
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
      <ErrorText>{error}</ErrorText>
    </>
  );
}
