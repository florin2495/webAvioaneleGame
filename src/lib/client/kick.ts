"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Live countdown for a pending kick. `remainingMs` is what the server reported when `stamp` (the state
 * object it arrived in) was received; the countdown runs locally from that moment, so clock skew is
 * irrelevant. Returns whole seconds left (rounded up) or null when nothing is pending. `onZero` fires
 * once per pending kick when it reaches 0, so the removal gets enforced promptly.
 */
export function useKickCountdown(remainingMs: number | null, stamp: unknown, onZero: () => void): number | null {
  const [now, setNow] = useState(0);
  const [end, setEnd] = useState<number | null>(null);
  const zeroFor = useRef<number | null>(null);
  const cb = useRef(onZero);

  useEffect(() => {
    cb.current = onZero;
  });

  useEffect(() => {
    if (remainingMs === null) {
      const t = window.setTimeout(() => setEnd(null), 0);
      zeroFor.current = null;
      return () => window.clearTimeout(t);
    }
    const target = Date.now() + remainingMs;
    const tick = () => {
      const n = Date.now();
      setNow(n);
      if (n >= target && zeroFor.current !== target) {
        zeroFor.current = target;
        cb.current();
      }
    };
    const first = window.setTimeout(() => {
      setEnd(target);
      tick();
    }, 0);
    const interval = window.setInterval(tick, 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [remainingMs, stamp]);

  if (remainingMs === null) return null;
  if (end === null) return Math.ceil(remainingMs / 1000);
  return Math.max(0, Math.ceil((end - Math.max(now, end - remainingMs)) / 1000));
}
