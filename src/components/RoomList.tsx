"use client";

import { useCallback, useEffect, useState } from "react";
import { api, parseSession, readSessionRaw } from "@/lib/client/api";
import type { RoomListItem } from "@/lib/types";

const POLL_MS = 10_000;

/** Public list of open rooms: lobbies to play in, games in progress to watch. Tap one to select it. */
export function RoomList({
  selected,
  onSelect,
  onRejoin,
}: {
  selected: string | null;
  onSelect: (room: RoomListItem) => void;
  onRejoin: (code: string) => void;
}) {
  const [rooms, setRooms] = useState<RoomListItem[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ rooms: RoomListItem[] }>("/api/rooms");
      setRooms(res.rooms);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kick = () => void load();
    const first = window.setTimeout(kick, 0);
    const interval = window.setInterval(kick, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [load]);

  let content;
  if (rooms === null) {
    content = <p className="py-4 text-center text-sm text-zinc-500">{error || "Caut camere…"}</p>;
  } else if (rooms.length === 0) {
    content = (
      <p className="py-4 text-center text-sm text-zinc-500">
        {error || "Nicio cameră deschisă acum. Creează una sau introdu un cod mai jos."}
      </p>
    );
  } else {
    content = (
    <ul className="flex flex-col gap-2">
      {rooms.map((r) => {
        const mine = parseSession(readSessionRaw(r.code)) !== null;
        const active = selected === r.code;
        return (
          <li key={r.code}>
            <button
              type="button"
              onClick={() => (mine ? onRejoin(r.code) : onSelect(r))}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {r.hasPassword && <span aria-label="cu parolă">🔒 </span>}
                  {r.name}
                </span>
                <span className="block text-xs text-zinc-500">
                  {{ lobby: "Lobby", playing: "🔥 În joc", finished: "Terminat" }[r.status]} · {r.players}/2 jucători
                  {r.spectators > 0 && ` · ${r.spectators} ${r.spectators === 1 ? "spectator" : "spectatori"}`} ·{" "}
                  {r.planesCount} avioane
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-sm font-bold tracking-widest">{r.code}</span>
                <span className="block text-[10px] font-semibold uppercase text-indigo-600 dark:text-indigo-400">
                  {mine ? "Reintră" : r.status !== "lobby" || r.players >= 2 ? "Privește" : "Joacă"}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-bold">Camere deschise</h2>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Reîncarcă camerele"
          title="Reîncarcă camerele"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={loading ? "animate-spin" : ""}
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>
      {content}
    </>
  );
}
