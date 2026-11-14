"use client";

import { useState } from "react";
import { api, settle } from "@/lib/client/api";
import {
  CELLS,
  DIR_LABEL,
  DIRS,
  layoutError,
  PLANES_MAX,
  PLANES_MIN,
  placementError,
  planeCells,
  randomLayout,
  type Dir,
  type Plane,
} from "@/lib/game";
import type { RoomState } from "@/lib/types";
import { Board, planeMap, type CellView } from "./Board";
import { PlayerList } from "./PlayerList";
import { Button, Card, ErrorText } from "./ui";

interface Props {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
  apply: (s: RoomState) => void;
}

export function Lobby({ state, token, refresh, apply }: Props) {
  const { room, me, players } = state;
  const isHost = room.hostPlayerId === me.id;
  const seated = players.filter((p) => p.seat);

  return (
    <>
      <Card>
        <h2 className="mb-1 font-bold">Jucători</h2>
        <PlayerList state={state} token={token} refresh={refresh} apply={apply} />
        <p className="mt-2 text-xs text-zinc-500">
          {seated.length < 2
            ? "Aștept al doilea jucător. Spectatorii pot intra oricând, și în timpul jocului."
            : "Jocul pornește singur când amândoi jucătorii sunt gata."}
        </p>
      </Card>

      {isHost && <HostSettings state={state} token={token} refresh={refresh} apply={apply} />}

      {me.seat ? (
        <Placement key={`${room.round}-${room.planesCount}`} state={state} token={token} refresh={refresh} apply={apply} />
      ) : (
        <SpectatorLobby state={state} token={token} refresh={refresh} apply={apply} />
      )}
    </>
  );
}

function HostSettings({ state, token, refresh, apply }: Props) {
  const { room } = state;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function change(planesCount: number) {
    if (planesCount === room.planesCount) return;
    setBusy(true);
    setError("");
    try {
      await settle(await api<{ state?: RoomState }>(`/api/rooms/${room.code}/settings`, { token, body: { planesCount } }), apply, refresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <label className="flex items-center justify-between gap-3 text-sm font-medium">
        Avioane de fiecare
        <select
          value={room.planesCount}
          disabled={busy}
          onChange={(e) => void change(Number(e.target.value))}
          className="min-h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        >
          {Array.from({ length: PLANES_MAX - PLANES_MIN + 1 }, (_, i) => PLANES_MIN + i).map((n) => (
            <option key={n} value={n}>
              {n} avioane
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-xs text-zinc-500">Dacă schimbi numărul, amândoi își așază avioanele din nou.</p>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function SpectatorLobby({ state, token, refresh, apply }: Props) {
  const { room, players } = state;
  const free = players.filter((p) => p.seat).length < 2;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sit() {
    setBusy(true);
    setError("");
    try {
      await settle(await api<{ state?: RoomState }>(`/api/rooms/${room.code}/sit`, { token, body: {} }), apply, refresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="text-center">
      <p className="font-semibold" data-testid="spectator-lobby">
        👀 Ești spectator
      </p>
      <p className="mt-1 text-sm text-zinc-500">Vezi loviturile amândurora. Avioanele se arată doar la final.</p>
      {free && (
        <Button className="mt-3 w-full" onClick={() => void sit()} disabled={busy}>
          {busy ? "…" : "Ia locul liber și joacă"}
        </Button>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

/** Where the plane would go if the head were put on `head`, for the preview. */
function ghostCells(head: number | null, dir: Dir): number[] {
  if (head === null) return [];
  return planeCells({ head, dir }) ?? [];
}

function Placement({ state, token, refresh, apply }: Props) {
  const { room, me, myPlanes } = state;
  const count = room.planesCount;
  const [planes, setPlanes] = useState<Plane[]>(myPlanes ?? []);
  const [dir, setDir] = useState<Dir>("N");
  const [hover, setHover] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = me.ready;
  const shown = ready ? (myPlanes ?? []) : planes;

  function tap(cell: number) {
    setError("");
    const hitIndex = shown.findIndex((p) => planeCells(p)?.includes(cell));
    if (hitIndex >= 0) {
      setPlanes(planes.filter((_, i) => i !== hitIndex)); // tap a plane to pick it up
      setHover(null);
      return;
    }
    if (planes.length >= count) {
      setError(`Ai deja ${count} avioane. Atinge unul ca să-l muți.`);
      return;
    }
    const plane = { head: cell, dir };
    const err = placementError(planes, plane);
    if (err) {
      setError(err);
      return;
    }
    setPlanes([...planes, plane]);
    setHover(null);
  }

  async function confirm() {
    const err = layoutError(planes, count);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/board`, { token, body: { planes } });
      await settle(await api<{ state?: RoomState }>(`/api/rooms/${room.code}/ready`, { token, body: { ready: true } }), apply, refresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  async function unready() {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ state?: RoomState }>(`/api/rooms/${room.code}/ready`, { token, body: { ready: false } });
      setPlanes(myPlanes ?? []);
      await settle(res, apply, refresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  const parts = planeMap(shown);
  const ghost = new Set(ready || planes.length >= count ? [] : ghostCells(hover, dir));
  const cells: CellView[] = Array.from({ length: CELLS }, (_, i) => ({
    plane: parts.get(i),
    preview: ghost.has(i),
    clickable: !ready,
  }));

  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="font-bold">Avioanele tale</h2>
        <span className="text-sm font-semibold text-zinc-500">
          {shown.length}/{count}
        </span>
      </div>

      {!ready && (
        <>
          <p className="mb-2 text-xs text-zinc-500">
            Alege direcția capului, apoi atinge celula unde vrei capul. Atinge un avion ca să-l ridici. Avioanele nu au voie să se
            atingă, nici pe colț.
          </p>
          <div className="mb-3 grid grid-cols-4 gap-1 rounded-xl bg-zinc-200 p-1 dark:bg-zinc-800" role="radiogroup" aria-label="Direcția capului">
            {DIRS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={dir === d}
                onClick={() => setDir(d)}
                className={`min-h-10 rounded-lg text-xs font-semibold ${dir === d ? "bg-white shadow dark:bg-zinc-950" : "text-zinc-600 dark:text-zinc-400"}`}
              >
                {DIR_LABEL[d]}
              </button>
            ))}
          </div>
        </>
      )}

      <div onMouseLeave={() => setHover(null)}>
        <BoardWithHover cells={cells} onCell={ready ? undefined : tap} onHover={ready ? undefined : setHover} />
      </div>

      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
      </div>

      {ready ? (
        <div className="mt-3 flex flex-col gap-2">
          <p data-testid="ready-status" className="text-center text-sm font-semibold text-emerald-600 dark:text-emerald-400">✓ Ești gata. Aștept adversarul…</p>
          <Button variant="secondary" onClick={() => void unready()} disabled={busy}>
            Modifică avioanele
          </Button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            data-testid="random-layout"
            onClick={() => {
              setPlanes(randomLayout(count));
              setError("");
            }}
          >
            🎲 Aleatoriu
          </Button>
          <Button variant="secondary" onClick={() => setPlanes([])} disabled={planes.length === 0}>
            Șterge tot
          </Button>
          <Button
            className="col-span-2"
            onClick={() => void confirm()}
            disabled={busy || planes.length !== count}
            data-testid="ready"
          >
            {busy ? "Se salvează…" : planes.length === count ? "Gata, sunt pregătit" : `Mai ai ${count - planes.length} de așezat`}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Board plus pointer hover tracking for the placement preview (desktop; on phones a tap places directly). */
function BoardWithHover({
  cells,
  onCell,
  onHover,
}: {
  cells: CellView[];
  onCell?: (cell: number) => void;
  onHover?: (cell: number | null) => void;
}) {
  return (
    <div
      onPointerOver={(e) => {
        if (!onHover || e.pointerType !== "mouse") return;
        const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
        onHover(el ? Number(el.dataset.cell) : null);
      }}
    >
      <Board cells={cells} onCell={onCell} label="Tabla ta" testId="placement-board" />
    </div>
  );
}
