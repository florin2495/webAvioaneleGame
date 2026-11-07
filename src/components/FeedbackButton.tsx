"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import { PREF_NICKNAME, useStringPref } from "@/lib/client/prefs";
import { Button, ErrorText } from "./ui";

const MAX = 1000;

export function FeedbackButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const nickname = useStringPref(PREF_NICKNAME);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    areaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => {
      setOpen(false);
      setSent(false);
      setMessage("");
    }, 1800);
    return () => clearTimeout(t);
  }, [sent]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) {
      setError("Scrie un mesaj.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/feedback", { body: { message, nickname: nickname?.trim() || undefined, website } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
        className={`shrink-0 rounded-lg border border-zinc-300 font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
          compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
        }`}
      >
        💬 Feedback
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
            className="flex w-full max-w-md flex-col gap-3 rounded-2xl bg-white p-4 shadow-xl dark:bg-zinc-900"
          >
            <h2 id="feedback-title" className="font-bold">
              Feedback
            </h2>
            {sent ? (
              <p role="status" className="py-6 text-center font-semibold text-emerald-600 dark:text-emerald-400">
                Mulțumim! Mesajul a ajuns.
              </p>
            ) : (
              <form onSubmit={submit} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Ce problemă ai găsit sau ce am putea îmbunătăți?
                  <textarea
                    ref={areaRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={MAX}
                    rows={5}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  <span className="self-end text-xs text-zinc-500">
                    {message.length}/{MAX}
                  </span>
                </label>
                <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                  <input
                    type="text"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </div>
                <ErrorText>{error}</ErrorText>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="submit" disabled={busy}>
                    {busy ? "Se trimite…" : "Trimite"}
                  </Button>
                  <Button variant="secondary" onClick={close}>
                    Anulează
                  </Button>
                </div>
                <a
                  href="/feedback"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-center text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                >
                  Vezi tot feedback-ul →
                </a>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
