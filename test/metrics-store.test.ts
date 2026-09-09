import { describe, it, expect, vi } from "vitest";
import { MetricsStore } from "../src/eval/metrics-store.js";
import type { StateKV } from "../src/state/kv.js";
import type { FunctionMetrics } from "../src/types.js";

function fakeKv(store = new Map<string, FunctionMetrics>()): StateKV {
  return {
    get: async <T>(_scope: string, key: string) =>
      (store.get(key) as T) ?? null,
    set: async <T>(_scope: string, key: string, value: T) => {
      store.set(key, value as FunctionMetrics);
      return value;
    },
    update: async () => {
      throw new Error("not implemented");
    },
    delete: async (_scope: string, key: string) => {
      store.delete(key);
    },
    list: async () => Array.from(store.values()),
  } as unknown as StateKV;
}

describe("MetricsStore", () => {
  it("records lastFailureAt only on failures", async () => {
    const store = new MetricsStore(fakeKv());
    await store.record("f", 10, true);
    expect((await store.get("f"))?.lastFailureAt).toBeUndefined();
    await store.record("f", 10, false);
    const m = await store.get("f");
    expect(m?.failureCount).toBe(1);
    expect(typeof m?.lastFailureAt).toBe("number");
  });

  it("preserves every outcome in the 24-hour window", async () => {
    const store = new MetricsStore(fakeKv());
    await store.record("f", 1, false);
    for (let i = 0; i < 50; i++) await store.record("f", 1, true);
    const m = (await store.getAll()).find((entry) => entry.functionId === "f");
    expect(m?.recentCallCount).toBe(51);
    expect(m?.recentFailureRate).toBe(1 / 51);
  });

  it("aggregates high-volume outcomes into bounded minute buckets", async () => {
    const store = new MetricsStore(fakeKv());
    for (let i = 0; i < 2_000; i++) await store.record("busy", 1, i % 10 !== 0);

    const internal = await store.get("busy");
    expect(internal?.recentBuckets).toHaveLength(1);
    expect(internal?.recentCalls).toBeUndefined();
    const visible = (await store.getAll()).find((entry) => entry.functionId === "busy");
    expect(visible?.recentCallCount).toBe(2_000);
    expect(visible?.recentFailureRate).toBe(0.1);
  });

  it("reuses the current minute bucket after the clock moves backward", async () => {
    const store = new MetricsStore(fakeKv());
    const older = 1_800_000_000_000;
    const newer = older + 60_000;
    const clock = vi.spyOn(Date, "now");

    clock.mockReturnValue(newer);
    await store.record("rollback", 1, true);
    clock.mockReturnValue(older);
    await store.record("rollback", 1, true);
    await store.record("rollback", 1, false);

    const buckets = (await store.get("rollback"))?.recentBuckets ?? [];
    expect(buckets).toHaveLength(2);
    expect(buckets.find((bucket) => bucket.t === older)).toMatchObject({
      success: 1,
      failure: 1,
    });
    clock.mockRestore();
  });

  it("getAll ignores failures older than the 24h window", async () => {
    // Simulate a counter polluted by a long-fixed bug: 256 old failures,
    // one outcome ring entry outside the window.
    const kvStore = new Map<string, FunctionMetrics>([
      [
        "f",
        {
          functionId: "f",
          totalCalls: 500,
          successCount: 244,
          failureCount: 256,
          avgLatencyMs: 1,
          avgQualityScore: 100,
          recentCalls: [{ t: Date.now() - 48 * 60 * 60 * 1000, ok: false }],
        },
      ],
    ]);
    const store = new MetricsStore(fakeKv(kvStore));
    await store.record("f", 1, true);
    const f = (await store.getAll()).find((m) => m.functionId === "f");
    expect(f?.failureCount).toBe(256); // cumulative history kept
    expect(f?.recentCallCount).toBe(1); // only the fresh call
    expect(f?.recentFailureRate).toBe(0); // stale failures excluded
    expect(f?.recentCalls).toBeUndefined(); // ring not exposed in health
  });

  it("getAll excludes the boundary minute that straddles the 24h cutoff", async () => {
    const now = 1_800_000_000_000 + 59_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const cutoff = now - 24 * 60 * 60 * 1000;
    const boundary = Math.floor(cutoff / 60_000) * 60_000;
    const inside = boundary + 60_000;
    const kvStore = new Map<string, FunctionMetrics>([
      [
        "edge",
        {
          functionId: "edge",
          totalCalls: 2,
          successCount: 1,
          failureCount: 1,
          avgLatencyMs: 1,
          avgQualityScore: 100,
          recentBuckets: [
            { t: boundary, success: 0, failure: 1 },
            { t: inside, success: 1, failure: 0 },
          ],
        },
      ],
    ]);
    const store = new MetricsStore(fakeKv(kvStore));
    const edge = (await store.getAll()).find((m) => m.functionId === "edge");
    expect(edge?.recentCallCount).toBe(1);
    expect(edge?.recentFailureRate).toBe(0);
    clock.mockRestore();
  });

  it("getAll reports a live rate for mixed recent outcomes", async () => {
    const store = new MetricsStore(fakeKv());
    await store.record("g", 1, true);
    await store.record("g", 1, false);
    const g = (await store.getAll()).find((m) => m.functionId === "g");
    expect(g?.recentFailureRate).toBe(0.5);
    expect(g?.failureCount).toBe(1);
  });
});
