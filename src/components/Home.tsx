"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiRequestError, clearSession, deviceId, listSessions, parseSession, readSessionRaw, saveSession } from "@/lib/client/api";
import { PREF_NICKNAME, useStringPref, writePref } from "@/lib/client/prefs";
import { NICKNAME_MAX, PLANES_DEFAULT, PLANES_MAX, PLANES_MIN } from "@/lib/game";
import type { RoomListItem, RoomState } from "@/lib/types";
import { FeedbackButton } from "./FeedbackButton";
import { RoomList } from "./RoomList";
import { Button, Card, ErrorText, Field, Toggle } from "./ui";

interface JoinResult {
  code: string;
  playerId: string;
  token: string;
}

export function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Nickname defaults to the last one used on this device.
  const storedNickname = useStringPref(PREF_NICKNAME);
  const [typedNickname, setNickname] = useState<string | null>(null);
  const nickname = typedNickname ?? storedNickname ?? "";
  const [roomName, setRoomName] = useState("");
  const [password, setPassword] = useState("");
  const [planes, setPlanes] = useState(PLANES_DEFAULT);
  const [code, setCode] = useState("");
  const [spectator, setSpectator] = useState(false);
  const [picked, setPicked] = useState<RoomListItem | null>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);

  function pickRoom(room: RoomListItem) {
    setPicked(room);
    setCode(room.code);
    setPassword("");
    setError("");
    nicknameRef.current?.focus();
  }

  const pickedRoom = picked && picked.code === code ? picked : null;
  const showPassword = tab === "create" || !(pickedRoom && !pickedRoom.hasPassword);
  const onlyWatch = pickedRoom !== null && (pickedRoom.status !== "lobby" || pickedRoom.players >= 2);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const joinCode = code.trim().toUpperCase();
    // Already a member on this device: go back to the seat instead of joining again.
    if (tab === "join" && parseSession(readSessionRaw(joinCode))) {
      router.push(`/room/${joinCode}`);
      return;
    }
    setBusy(true);
    setError("");
    writePref(PREF_NICKNAME, nickname.trim());
    try {
      const res =
        tab === "create"
          ? await api<JoinResult>("/api/rooms", { body: { name: roomName, nickname, password, planesCount: planes, deviceId: deviceId() } })
          : await api<JoinResult>(`/api/rooms/${encodeURIComponent(joinCode)}/join`, {
              body: { nickname, password, spectator, deviceId: deviceId() },
            });
      saveSession(res.code, { playerId: res.playerId, token: res.token });
      router.push(`/room/${res.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        {/* Plain <a> on purpose: "/" is the hub zone (outside basePath), needs a full navigation. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300">
          ← Back to haiLaTăt.icu hub
        </a>
        <FeedbackButton />
      </div>
      <header className="text-center">
        <h1 className="text-4xl font-black tracking-tight">✈️ Avioanele</h1>
        <p className="mt-1 text-sm text-zinc-500">Jocul de pe foaia de matematică, jucat în doi, pe telefon. Prietenii pot privi.</p>
      </header>

      <RejoinCards onRejoin={(c) => router.push(`/room/${c}`)} />

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-200 p-1 dark:bg-zinc-800" role="tablist">
        {(["create", "join"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setError("");
            }}
            className={`min-h-10 rounded-lg text-sm font-semibold ${tab === t ? "bg-white shadow dark:bg-zinc-950" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            {t === "create" ? "Creează cameră" : "Intră în cameră"}
          </button>
        ))}
      </div>

      {tab === "join" && (
        <Card>
          <RoomList selected={pickedRoom?.code ?? null} onSelect={pickRoom} onRejoin={(c) => router.push(`/room/${c}`)} />
        </Card>
      )}

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {tab === "join" && (
            <Field
              label="Codul camerei"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="ex. K7QM2X"
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              required
            />
          )}
          {tab === "create" && (
            <Field label="Numele camerei" value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={40} required />
          )}
          <Field
            ref={nicknameRef}
            label="Nickname-ul tău"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={NICKNAME_MAX}
            autoComplete="nickname"
            required
          />
          {showPassword && (
            <Field
              label={tab === "create" ? "Parolă (opțional)" : pickedRoom ? "Parola camerei" : "Parolă (dacă are camera)"}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={100}
              autoComplete="off"
              required={tab === "join" && pickedRoom?.hasPassword === true}
            />
          )}

          {tab === "create" && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Avioane de fiecare
              <select
                value={planes}
                onChange={(e) => setPlanes(Number(e.target.value))}
                className="min-h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              >
                {Array.from({ length: PLANES_MAX - PLANES_MIN + 1 }, (_, i) => PLANES_MIN + i).map((n) => (
                  <option key={n} value={n}>
                    {n} avioane
                  </option>
                ))}
              </select>
            </label>
          )}

          {tab === "join" &&
            (onlyWatch ? (
              <p className="text-sm text-zinc-500">👀 Jocul are deja 2 jucători: intri ca spectator.</p>
            ) : (
              <Toggle
                label="Intru doar ca spectator"
                hint="Privești jocul fără să joci."
                checked={spectator}
                onChange={setSpectator}
              />
            ))}

          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} data-testid="home-submit">
            {busy ? "Se încarcă…" : tab === "create" ? "Creează camera" : onlyWatch || spectator ? "Privește" : "Intră"}
          </Button>
        </form>
      </Card>

      <details className="text-sm text-zinc-600 dark:text-zinc-400">
        <summary className="cursor-pointer font-semibold">Reguli</summary>
        <pre aria-hidden className="my-2 text-center font-mono text-base leading-tight text-indigo-600 dark:text-indigo-400">
          {" ■ \n■■■\n ■ \n■■■"}
        </pre>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Tabla e de 10×10. Fiecare își ascunde avioanele (3, implicit) cu forma de mai sus, rotite cum vrea.</li>
          <li>Două avioane nu au voie să se atingă, nici măcar pe colț.</li>
          <li>Pe rând, tragi într-o celulă de pe tabla adversarului: aer, lovit sau cap.</li>
          <li>Dacă nimerești un avion, mai tragi o dată, cât timp tot nimerești.</li>
          <li>Dacă nimerești capul, avionul cade pe loc și mai tragi. Forma lui o deduci singur.</li>
          <li>
            Pe tabla adversarului poți nota: „✕ Marchez X” pentru locuri unde nu mai vrei să tragi și „✈ Poz. avion” ca să desenezi unde
            crezi că e un avion. Notițele sunt doar ale tale.
          </li>
          <li>Câștigă cine doboară primul toate avioanele adversarului.</li>
          <li>Sus e tabla ta, jos e tabla adversarului, unde tragi. Poți trage oriunde, și lângă un avion găsit.</li>
          <li>Spectatorii pot intra chiar dacă jocul a început și pot cere „Intră la runda următoare”.</li>
        </ol>
      </details>
    </main>
  );
}

/**
 * Rooms this device still has a place in (lobby or a running game). Stored sessions are checked once
 * against /state; 401/404 ones are dropped.
 */
function RejoinCards({ onRejoin }: { onRejoin: (code: string) => void }) {
  const [rooms, setRooms] = useState<{ code: string; name: string; playing: boolean; spectator: boolean }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const checks = await Promise.all(
        listSessions().map(async ({ code, session }) => {
          try {
            const s = await api<RoomState>(`/api/rooms/${code}/state`, { token: session.token });
            return { code, name: s.room.name, playing: s.room.status === "playing", spectator: s.me.seat === null };
          } catch (err) {
            if (err instanceof ApiRequestError && (err.status === 401 || err.status === 404)) clearSession(code);
            return null;
          }
        }),
      );
      if (!cancelled) setRooms(checks.filter((r) => r !== null));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (rooms.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {rooms.map((r) => (
        <button
          key={r.code}
          type="button"
          onClick={() => onRejoin(r.code)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3 text-left dark:border-indigo-800 dark:bg-indigo-950"
        >
          <span className="min-w-0">
            <span className="block font-bold">
              Revino în camera <span className="font-mono tracking-widest">{r.code}</span>
            </span>
            <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400">
              {r.name}
              {r.playing ? " · joc în desfășurare" : ""}
              {r.spectator ? " · spectator" : ""}
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-indigo-600 dark:text-indigo-400">Reintră →</span>
        </button>
      ))}
    </div>
  );
}
