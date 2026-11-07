"use client";

import { useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { PREF_CONFIRM_SHOT, useBoolPref } from "@/lib/client/prefs";
import { cellLabel, DIR_LABEL, other, planeCells, possibleDirs, type Dir, type Move, type Seat } from "@/lib/game";
import type { PublicPlayer, RoomState } from "@/lib/types";
import { Board, boardView } from "./Board";
import { OfflineBadge, PlayerList } from "./PlayerList";
import { Button, Card, ErrorText } from "./ui";

interface Props {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
}

export function Game({ state, token, refresh }: Props) {
  const { room, me, players, moves, myPlanes, reveal } = state;
  const finished = room.status === "finished";
  const mySeat = me.seat;
  const bySeat = (s: Seat) => players.find((p) => p.seat === s) ?? null;
  const name = (s: Seat) => bySeat(s)?.nickname ?? `Jucătorul ${s}`;

  // Players: own board on top, the opponent's (where you shoot) below. Spectators: seat 1 on top.
  const topSeat: Seat = mySeat ?? 1;
  const bottomSeat: Seat = other(topSeat);

  const [confirmShot] = useBoolPref(PREF_CONFIRM_SHOT, false);
  const [selected, setSelected] = useState<number | null>(null);
  const [guessDir, setGuessDir] = useState<Dir | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [winnerSeen, setWinnerSeen] = useState<string | null>(null);

  const myTurn = room.status === "playing" && mySeat !== null && room.turnSeat === mySeat && !room.pending;
  const myGuess = room.status === "playing" && mySeat !== null && room.pending?.seat === mySeat ? room.pending : null;

  const known = new Set(
    moves
      .filter((m) => m.seat === topSeat)
      .flatMap((m) => (m.kind === "shot" ? [m.cell] : m.result === "correct" && m.dir ? (planeCells({ head: m.cell, dir: m.dir }) ?? []) : [])),
  );

  async function shoot(cell: number) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/shoot`, { token, body: { cell } });
      setSelected(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function guess(dir: Dir) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/guess`, { token, body: { dir } });
      setGuessDir(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function tapTarget(cell: number) {
    if (!myTurn || busy || known.has(cell)) return;
    if (confirmShot) setSelected(selected === cell ? null : cell);
    else void shoot(cell);
  }

  // Top board: what has been fired at `topSeat`.
  const topPlanes = finished ? (reveal?.[topSeat] ?? null) : mySeat === topSeat ? myPlanes : null;
  const top = boardView(topSeat, moves, topPlanes);

  const bottomPlanes = finished ? (reveal?.[bottomSeat] ?? null) : null;
  const bottom = boardView(bottomSeat, moves, bottomPlanes);
  bottom.forEach((v, i) => {
    v.clickable = myTurn && !known.has(i) && !busy;
    v.selected = selected === i;
  });
  if (myGuess && guessDir) {
    for (const c of planeCells({ head: myGuess.head, dir: guessDir }) ?? []) bottom[c].preview = true;
  }

  const winner = players.find((p) => p.id === room.winnerPlayerId) ?? null;
  const showWinner = finished && winnerSeen !== `${room.round}`;

  return (
    <>
      <StatusBanner state={state} name={name} />

      <Card className="p-3">
        <BoardTitle
          title={mySeat ? "Tabla mea" : `Tabla lui ${name(topSeat)}`}
          sub={`${name(bottomSeat)} a doborât ${room.downed[topSeat]}/${room.planesCount}`}
          connected={mySeat ? undefined : bySeat(topSeat)?.connected}
        />
        <Board cells={top} label={mySeat ? "Tabla mea" : `Tabla lui ${name(topSeat)}`} dim={myTurn || !!myGuess} />
      </Card>

      <Card className={`p-3 ${myTurn || myGuess ? "ring-2 ring-indigo-500" : ""}`}>
        <BoardTitle
          title={mySeat ? `Tabla lui ${name(bottomSeat)} — aici tragi` : `Tabla lui ${name(bottomSeat)}`}
          sub={`${mySeat ? "Ai doborât" : `${name(topSeat)} a doborât`} ${room.downed[bottomSeat]}/${room.planesCount}`}
          connected={bySeat(bottomSeat)?.connected}
        />
        <Board cells={bottom} onCell={tapTarget} label={`Tabla lui ${name(bottomSeat)}`} dim={!myTurn && !myGuess && !!mySeat} />

        {confirmShot && myTurn && (
          <Button className="mt-3 w-full" onClick={() => selected !== null && void shoot(selected)} disabled={selected === null || busy}>
            {selected === null ? "Alege o celulă" : `Trage în ${cellLabel(selected)}`}
          </Button>
        )}

        {myGuess && (
          <GuessPanel head={myGuess.head} dir={guessDir} onDir={setGuessDir} onConfirm={guess} busy={busy} />
        )}
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </Card>

      <Legend />

      <Card>
        <h2 className="mb-1 font-bold">În cameră</h2>
        <PlayerList state={state} token={token} refresh={refresh} />
      </Card>

      <MoveLog moves={moves} name={name} />

      {finished && <FinishedActions state={state} token={token} refresh={refresh} />}

      {showWinner && (
        <WinnerPopup
          winner={winner}
          me={me}
          forfeit={!winner?.seat || room.downed[other(winner.seat)] < room.planesCount}
          onClose={() => setWinnerSeen(`${room.round}`)}
        />
      )}
    </>
  );
}

function BoardTitle({ title, sub, connected }: { title: string; sub: string; connected?: boolean }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <span className="flex min-w-0 items-baseline gap-2">
        <h2 className="truncate font-bold">{title}</h2>
        <OfflineBadge connected={connected} />
      </span>
      <span className="shrink-0 text-xs font-semibold text-zinc-500">{sub}</span>
    </div>
  );
}

function StatusBanner({ state, name }: { state: RoomState; name: (s: Seat) => string }) {
  const { room, me, moves } = state;
  const last = moves.at(-1);
  let text: string;
  let tone = "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100";

  if (room.status === "finished") {
    const w = state.players.find((p) => p.id === room.winnerPlayerId);
    text = w ? (w.id === me.id ? "🏆 Ai câștigat!" : `🏆 ${w.nickname} a câștigat.`) : "Jocul s-a terminat.";
    tone = "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  } else if (room.pending) {
    const mine = room.pending.seat === me.seat;
    text = mine
      ? `💥 Cap lovit în ${cellLabel(room.pending.head)}! Avionul e doborât. Ghicește-i forma ca să-l vezi și să mai tragi.`
      : `💥 ${name(room.pending.seat)} a lovit un cap și ghicește forma avionului.`;
    tone = mine ? "bg-indigo-600 text-white" : tone;
  } else {
    const mine = room.turnSeat !== null && room.turnSeat === me.seat;
    const again = last && last.seat === room.turnSeat && (last.result === "hit" || last.result === "correct");
    const prefix = lastText(last, name);
    if (mine) {
      text = `${prefix}${again ? "Mai tragi o dată!" : "E rândul tău. Trage pe tabla de jos."}`;
      tone = "bg-indigo-600 text-white";
    } else {
      text = `${prefix}Trage ${room.turnSeat ? name(room.turnSeat) : "…"}.`;
    }
  }

  return (
    <p role="status" aria-live="polite" className={`rounded-xl px-4 py-3 text-center text-sm font-semibold ${tone}`}>
      {text}
    </p>
  );
}

function lastText(m: Move | undefined, name: (s: Seat) => string): string {
  if (!m) return "";
  const who = name(m.seat);
  if (m.kind === "guess") return m.result === "correct" ? `${who} a ghicit forma! ` : `${who} n-a ghicit forma. `;
  const where = cellLabel(m.cell);
  if (m.result === "miss") return `${who}: ${where} apă. `;
  if (m.result === "hit") return `${who}: ${where} lovit! `;
  return `${who}: ${where} cap! `;
}

function GuessPanel({
  head,
  dir,
  onDir,
  onConfirm,
  busy,
}: {
  head: number;
  dir: Dir | null;
  onDir: (d: Dir) => void;
  onConfirm: (d: Dir) => void;
  busy: boolean;
}) {
  const dirs = possibleDirs(head);
  return (
    <div className="mt-3 rounded-xl border-2 border-indigo-500 p-3">
      <p className="text-sm font-semibold">Cum stă avionul cu capul în {cellLabel(head)}? Încotro arată capul?</p>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {(["N", "E", "S", "W"] as Dir[]).map((d) => (
          <button
            key={d}
            type="button"
            disabled={!dirs.includes(d) || busy}
            onClick={() => onDir(d)}
            className={`min-h-10 rounded-lg text-xs font-semibold disabled:opacity-30 ${
              dir === d ? "bg-indigo-600 text-white" : "bg-zinc-200 dark:bg-zinc-800"
            }`}
          >
            {DIR_LABEL[d]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">Forma aleasă apare cu galben pe tablă. Ghicit = vezi avionul și mai tragi. Greșit = tura trece.</p>
      <Button className="mt-2 w-full" disabled={!dir || busy} onClick={() => dir && onConfirm(dir)}>
        {busy ? "…" : dir ? "Confirmă forma" : "Alege o direcție"}
      </Button>
    </div>
  );
}

function Legend() {
  const item = (cls: string, content: ReactNode, label: string) => (
    <span className="flex items-center gap-1.5">
      <span className={`flex h-4 w-4 items-center justify-center rounded-sm text-[9px] ${cls}`}>{content}</span>
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
      {item("bg-white border border-zinc-300 dark:bg-zinc-900 dark:border-zinc-700", <span className="h-1 w-1 rounded-full bg-zinc-500" />, "apă")}
      {item("bg-rose-500 text-white", "✕", "lovit")}
      {item("bg-zinc-900", "💥", "cap (doborât)")}
      {item("bg-indigo-400 dark:bg-indigo-700", "", "avion")}
    </div>
  );
}

function MoveLog({ moves, name }: { moves: Move[]; name: (s: Seat) => string }) {
  if (moves.length === 0) return null;
  return (
    <Card className="py-2">
      <details>
        <summary className="flex min-h-10 cursor-pointer items-center font-bold">Istoric ({moves.length})</summary>
        <ol className="max-h-60 overflow-y-auto pb-2 text-sm">
          {[...moves].reverse().map((m) => (
            <li key={m.seq} className="flex justify-between gap-2 border-b border-zinc-100 py-1 last:border-0 dark:border-zinc-900">
              <span className="truncate">{name(m.seat)}</span>
              <span className="shrink-0 font-mono">
                {m.kind === "shot"
                  ? `${cellLabel(m.cell)} · ${{ miss: "apă", hit: "lovit", head: "cap 💥" }[m.result as "miss"]}`
                  : `formă ${DIR_LABEL[m.dir as Dir]} · ${m.result === "correct" ? "ghicit ✓" : "greșit ✕"}`}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </Card>
  );
}

function FinishedActions({ state, token, refresh }: Props) {
  const { room, me } = state;
  const isHost = room.hostPlayerId === me.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function newRound() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/new-round`, { token, body: {} });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="text-center">
      <p className="text-sm text-zinc-500">Acum se văd avioanele amândurora.</p>
      {isHost ? (
        <Button className="mt-3 w-full" onClick={() => void newRound()} disabled={busy}>
          {busy ? "…" : "Rundă nouă"}
        </Button>
      ) : (
        <p className="mt-2 text-sm font-semibold">Aștept ca host-ul să pornească o rundă nouă.</p>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function WinnerPopup({
  winner,
  me,
  forfeit,
  onClose,
}: {
  winner: PublicPlayer | null;
  me: PublicPlayer;
  forfeit: boolean;
  onClose: () => void;
}) {
  const mine = winner?.id === me.id;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <p className="text-5xl" aria-hidden>
          {mine ? "🏆" : winner ? "✈️" : "🏁"}
        </p>
        <p className="mt-3 text-2xl font-black">
          {mine ? "Ai câștigat!" : winner ? `${winner.nickname} a câștigat` : "Joc terminat"}
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          {forfeit
            ? "Adversarul a părăsit jocul."
            : mine
              ? "Ai doborât toate avioanele adversarului."
              : me.seat
                ? "Ți-au fost doborâte toate avioanele."
                : "Toate avioanele adversarului au fost doborâte."}
        </p>
        <Button className="mt-5 w-full" onClick={onClose}>
          Vezi tablele
        </Button>
      </div>
    </div>
  );
}
