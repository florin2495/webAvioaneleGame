"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { PREF_CONFIRM_SHOT, readPref, useBoolPref, writePref } from "@/lib/client/prefs";
import { cellLabel, DIRS, DIR_LABEL, other, type Dir, type Move, type Seat } from "@/lib/game";
import {
  drawnCells,
  emptyNotes,
  missedNotedCells,
  notesKey,
  parseNotes,
  toggleMark,
  togglePlane,
  type Notes,
} from "@/lib/notes";
import type { PublicPlayer, RoomState } from "@/lib/types";
import { Board, boardView, planeMap } from "./Board";
import { OfflineBadge, PlayerList } from "./PlayerList";
import { Button, Card, ErrorText } from "./ui";

interface Props {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
}

export function Game({ state, token, refresh, apply }: Props & { apply: (s: RoomState) => void }) {
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
  /** Cell fired at, shown right away while the server answers. */
  const [firing, setFiring] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("shoot");
  const [planeDir, setPlaneDir] = useState<Dir>("N");
  const noteKey = mySeat ? notesKey(room.code, room.round, me.id) : null;
  const [notesState, setNotesState] = useState<{ key: string | null; notes: Notes }>(() => ({
    key: noteKey,
    notes: noteKey ? parseNotes(readPref(noteKey)) : emptyNotes(),
  }));
  // A new round means other notes: read them from storage again.
  const notes = notesState.key === noteKey ? notesState.notes : noteKey ? parseNotes(readPref(noteKey)) : emptyNotes();
  // Latest notes, readable synchronously: two taps before a re-render (two fingers, fast taps) both apply.
  const latest = useRef(notesState);
  const pendingSave = useRef<{ key: string; json: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  function flushSave() {
    const p = pendingSave.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingSave.current = null;
    writePref(p.key, p.json);
  }
  // Saved NOTES_SAVE_DEBOUNCE_MS after the last X / plane change (and right away when leaving the page).
  useEffect(() => {
    window.addEventListener("pagehide", flushSave);
    return () => {
      window.removeEventListener("pagehide", flushSave);
      flushSave();
    };
  }, []);
  function updateNotes(change: (n: Notes) => Notes) {
    const base = latest.current.key === noteKey ? latest.current.notes : notes;
    const next = { key: noteKey, notes: change(base) };
    latest.current = next;
    setNotesState(next);
    if (!noteKey) return;
    if (pendingSave.current) clearTimeout(pendingSave.current.timer);
    pendingSave.current = { key: noteKey, json: JSON.stringify(next.notes), timer: setTimeout(flushSave, NOTES_SAVE_DEBOUNCE_MS) };
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [winnerSeen, setWinnerSeen] = useState<string | null>(null);

  const playing = room.status === "playing";
  const myTurn = playing && mySeat !== null && room.turnSeat === mySeat;
  const canNote = playing && mySeat !== null;
  const activeTool: Tool = canNote ? tool : "shoot";

  const known = new Set(moves.filter((m) => m.seat === topSeat).map((m) => m.cell));

  async function shoot(cell: number) {
    setBusy(true);
    setError("");
    setFiring(cell);
    try {
      // The answer carries the new state: no second request before the result shows up.
      const res = await api<{ state: RoomState }>(`/api/rooms/${room.code}/shoot`, { token, body: { cell } });
      setSelected(null);
      apply(res.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      await refresh();
    } finally {
      setBusy(false);
      setFiring(null);
    }
  }

  function tapTarget(cell: number) {
    if (activeTool === "mark") {
      if (!known.has(cell)) updateNotes((n) => toggleMark(n, cell));
      return;
    }
    if (activeTool === "plane") {
      updateNotes((n) => togglePlane(n, { head: cell, dir: planeDir }, room.planesCount));
      return;
    }
    if (!myTurn || busy || known.has(cell)) return;
    if (confirmShot) setSelected(selected === cell ? null : cell);
    else void shoot(cell);
  }

  // Top board: what has been fired at `topSeat`.
  const topPlanes = finished ? (reveal?.[topSeat] ?? null) : mySeat === topSeat ? myPlanes : null;
  const top = boardView(topSeat, moves, topPlanes);

  const bottomPlanes = finished ? (reveal?.[bottomSeat] ?? null) : null;
  const bottom = boardView(bottomSeat, moves, bottomPlanes);
  if (canNote) {
    for (const c of notes.marks) bottom[c].cross = true;
    for (const p of notes.planes) drawnCells(p).forEach((c, i) => (bottom[c].guess = i === 0 ? "head" : "body"));
  } else if (finished && mySeat && bottomPlanes) {
    // Result card: noted cells that turned out to be empty get an X.
    const real = new Set(planeMap(bottomPlanes).keys());
    const shot = new Set(moves.filter((m) => m.seat === mySeat).map((m) => m.cell));
    for (const c of missedNotedCells(notes, shot, real)) bottom[c].cross = true;
  }
  bottom.forEach((v, i) => {
    // A guessed plane may have its head on a cell already shot (e.g. the head just hit).
    v.clickable = canNote && (activeTool === "plane" || (!known.has(i) && (activeTool !== "shoot" || (myTurn && !busy))));
    v.selected = (activeTool === "shoot" && selected === i) || firing === i;
  });

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
        <Board cells={top} label={mySeat ? "Tabla mea" : `Tabla lui ${name(topSeat)}`} dim={myTurn} />
      </Card>

      <Card className={`p-3 ${myTurn ? "ring-2 ring-indigo-500" : ""}`}>
        <BoardTitle
          title={mySeat ? `Tabla lui ${name(bottomSeat)} — aici tragi` : `Tabla lui ${name(bottomSeat)}`}
          sub={`${mySeat ? "Ai doborât" : `${name(topSeat)} a doborât`} ${room.downed[bottomSeat]}/${room.planesCount}`}
          connected={bySeat(bottomSeat)?.connected}
        />
        <Board cells={bottom} onCell={tapTarget} label={`Tabla lui ${name(bottomSeat)}`} dim={!myTurn && !!mySeat} />

        {canNote && (
          <NoteTools
            tool={tool}
            onTool={setTool}
            dir={planeDir}
            onDir={setPlaneDir}
            notes={notes}
            planesCount={room.planesCount}
            onClearMarks={() => updateNotes((n) => ({ ...n, marks: [] }))}
            onClearPlanes={() => updateNotes((n) => ({ ...n, planes: [] }))}
          />
        )}

        {confirmShot && myTurn && activeTool === "shoot" && (
          <Button className="mt-3 w-full" onClick={() => selected !== null && void shoot(selected)} disabled={selected === null || busy}>
            {selected === null ? "Alege o celulă" : `Trage în ${cellLabel(selected)}`}
          </Button>
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
  } else {
    const mine = room.turnSeat !== null && room.turnSeat === me.seat;
    const again = last && last.seat === room.turnSeat && (last.result === "hit" || last.result === "head");
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
  const where = cellLabel(m.cell);
  if (m.result === "miss") return `${who}: ${where} aer. `;
  if (m.result === "hit") return `${who}: ${where} lovit! `;
  return `${who}: ${where} cap! `;
}

const NOTES_SAVE_DEBOUNCE_MS = 350;

type Tool = "shoot" | "mark" | "plane";

function NoteTools({
  tool,
  onTool,
  dir,
  onDir,
  notes,
  planesCount,
  onClearMarks,
  onClearPlanes,
}: {
  tool: Tool;
  onTool: (t: Tool) => void;
  dir: Dir;
  onDir: (d: Dir) => void;
  notes: Notes;
  planesCount: number;
  onClearMarks: () => void;
  onClearPlanes: () => void;
}) {
  const toggle = (t: Exclude<Tool, "shoot">) => onTool(tool === t ? "shoot" : t);
  const btn = (active: boolean) =>
    `min-h-10 rounded-lg px-2 text-sm font-semibold ${active ? "bg-indigo-600 text-white" : "bg-zinc-200 dark:bg-zinc-800"}`;
  return (
    <div className="mt-3 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
      <div className="grid grid-cols-2 gap-1">
        <button type="button" aria-pressed={tool === "mark"} onClick={() => toggle("mark")} className={btn(tool === "mark")}>
          ✕ Marchez X
        </button>
        <button type="button" aria-pressed={tool === "plane"} onClick={() => toggle("plane")} className={btn(tool === "plane")}>
          ✈ Poz. avion
        </button>
      </div>
      {tool === "mark" && (
        <p className="mt-2 text-xs text-zinc-500">
          Atinge celulele unde nu mai vrei să tragi. Atinge din nou ca să scoți X-ul. Notițele sunt doar ale tale.
        </p>
      )}
      {tool === "plane" && (
        <>
          <div className="mt-2 grid grid-cols-4 gap-1" role="radiogroup" aria-label="Direcția capului">
            {DIRS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={dir === d}
                onClick={() => onDir(d)}
                className={`min-h-10 rounded-lg text-xs font-semibold ${dir === d ? "bg-teal-600 text-white" : "bg-zinc-200 dark:bg-zinc-800"}`}
              >
                {DIR_LABEL[d]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Alege direcția capului, apoi atinge celula unde crezi că e capul avionului adversarului (poate fi și o poziție greșită).
            Atinge aceeași celulă cu aceeași direcție ca să-l ștergi. {notes.planes.length}/{planesCount}.
          </p>
        </>
      )}
      {(notes.marks.length > 0 || notes.planes.length > 0) && (
        <div className="mt-2 flex gap-3 text-xs">
          {notes.marks.length > 0 && (
            <button type="button" onClick={onClearMarks} className="min-h-8 font-semibold text-zinc-600 underline dark:text-zinc-400">
              Șterge X-urile
            </button>
          )}
          {notes.planes.length > 0 && (
            <button type="button" onClick={onClearPlanes} className="min-h-8 font-semibold text-zinc-600 underline dark:text-zinc-400">
              Șterge avioanele
            </button>
          )}
        </div>
      )}
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
      {item("bg-white border border-zinc-300 dark:bg-zinc-900 dark:border-zinc-700", <span className="h-1 w-1 rounded-full bg-zinc-500" />, "aer")}
      {item("bg-rose-500 text-white", "✕", "lovit")}
      {item("bg-zinc-900", "💥", "cap (doborât)")}
      {item("bg-indigo-400 dark:bg-indigo-700", "", "avion")}
      {item("bg-white border border-zinc-300 text-zinc-700 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-200", "✕", "notiță X")}
      {item("bg-teal-300 dark:bg-teal-800", "", "avion presupus")}
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
                {`${cellLabel(m.cell)} · ${{ miss: "aer", hit: "lovit", head: "cap 💥" }[m.result]}`}
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
