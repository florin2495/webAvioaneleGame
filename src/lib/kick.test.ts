import { describe, expect, it } from "vitest";
import { isKickExpired, KICK_GRACE_MS, kickRemainingMs } from "./kick";

describe("kickRemainingMs", () => {
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  it("is null without a pending kick", () => {
    expect(kickRemainingMs(null, t0)).toBeNull();
    expect(kickRemainingMs(undefined, t0)).toBeNull();
    expect(kickRemainingMs("garbage", t0)).toBeNull();
  });
  it("counts down and clamps to [0, 10000]", () => {
    const iso = new Date(t0).toISOString();
    expect(kickRemainingMs(iso, t0)).toBe(KICK_GRACE_MS);
    expect(kickRemainingMs(iso, t0 + 4000)).toBe(6000);
    expect(kickRemainingMs(iso, t0 + 10_000)).toBe(0);
    expect(kickRemainingMs(iso, t0 + 60_000)).toBe(0);
    expect(kickRemainingMs(iso, t0 - 5000)).toBe(KICK_GRACE_MS); // server clock slightly behind
  });
});

describe("isKickExpired", () => {
  const t0 = 1_000_000;
  it("is false with no kick and within grace + 2 s", () => {
    expect(isKickExpired(null, t0)).toBe(false);
    expect(isKickExpired(t0, t0 + 12_000)).toBe(false);
  });
  it("is true after grace + 2 s", () => {
    expect(isKickExpired(t0, t0 + 12_001)).toBe(true);
  });
});
