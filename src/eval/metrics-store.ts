import type { FunctionMetrics } from "../types.js";
import type { StateKV } from "../state/kv.js";
import { KV } from "../state/schema.js";

/** Window for the recent failure rate surfaced in health output. */
const METRICS_WINDOW_MS = 24 * 60 * 60 * 1000;
const METRICS_BUCKET_MS = 60 * 1000;

export class MetricsStore {
  private cache = new Map<string, FunctionMetrics>();
  private qualityCallCounts = new Map<string, number>();

  constructor(private kv: StateKV) {}

  async record(
    functionId: string,
    latencyMs: number,
    success: boolean,
    qualityScore?: number,
  ): Promise<void> {
    let m = this.cache.get(functionId);
    if (!m) {
      m = (await this.kv.get<FunctionMetrics>(KV.metrics, functionId)) ?? {
        functionId,
        totalCalls: 0,
        successCount: 0,
        failureCount: 0,
        avgLatencyMs: 0,
        avgQualityScore: 0,
      };
    }

    const prev = m.totalCalls;
    const now = Date.now();
    m.totalCalls += 1;
    m.avgLatencyMs = (m.avgLatencyMs * prev + latencyMs) / m.totalCalls;
    if (success) {
      m.successCount += 1;
    } else {
      m.failureCount += 1;
      m.lastFailureAt = now;
    }
    const cutoffBucket =
      Math.floor((now - METRICS_WINDOW_MS) / METRICS_BUCKET_MS) * METRICS_BUCKET_MS;
    const buckets = (m.recentBuckets ?? []).filter(
      (bucket) => bucket.t >= cutoffBucket,
    );
    for (const call of m.recentCalls ?? []) {
      if (call.t < now - METRICS_WINDOW_MS) continue;
      const t = Math.floor(call.t / METRICS_BUCKET_MS) * METRICS_BUCKET_MS;
      let bucket = buckets.find((candidate) => candidate.t === t);
      if (!bucket) {
        bucket = { t, success: 0, failure: 0 };
        buckets.push(bucket);
      }
      bucket[call.ok ? "success" : "failure"] += 1;
    }
    delete m.recentCalls;

    const currentBucket = Math.floor(now / METRICS_BUCKET_MS) * METRICS_BUCKET_MS;
    let bucket = buckets.find((candidate) => candidate.t === currentBucket);
    if (!bucket) {
      bucket = { t: currentBucket, success: 0, failure: 0 };
      buckets.push(bucket);
    }
    bucket[success ? "success" : "failure"] += 1;
    buckets.sort((a, b) => a.t - b.t);
    m.recentBuckets = buckets;
    if (qualityScore !== undefined) {
      const prevQualityCalls = this.qualityCallCounts.get(functionId) || 0;
      m.avgQualityScore =
        (m.avgQualityScore * prevQualityCalls + qualityScore) /
        (prevQualityCalls + 1);
      this.qualityCallCounts.set(functionId, prevQualityCalls + 1);
    }

    this.cache.set(functionId, m);
    await this.kv.set(KV.metrics, functionId, m).catch(() => {});
  }

  async get(functionId: string): Promise<FunctionMetrics | null> {
    return (
      this.cache.get(functionId) ??
      (await this.kv.get<FunctionMetrics>(KV.metrics, functionId))
    );
  }

  async getAll(): Promise<FunctionMetrics[]> {
    const kvMetrics = await this.kv
      .list<FunctionMetrics>(KV.metrics)
      .catch(() => []);
    const merged = new Map<string, FunctionMetrics>();
    for (const m of kvMetrics) merged.set(m.functionId, m);
    for (const [id, m] of this.cache) merged.set(id, m);
    const now = Date.now();
    return Array.from(merged.values()).map((m) => {
      const legacyRecent = (m.recentCalls ?? []).filter(
        (c) => now - c.t <= METRICS_WINDOW_MS,
      );
      const cutoffBucket =
        Math.floor((now - METRICS_WINDOW_MS) / METRICS_BUCKET_MS) * METRICS_BUCKET_MS;
      const recentBuckets = (m.recentBuckets ?? []).filter(
        (bucket) => bucket.t >= cutoffBucket,
      );
      const bucketCalls = recentBuckets.reduce(
        (sum, bucket) => sum + bucket.success + bucket.failure,
        0,
      );
      const failures = recentBuckets.reduce(
        (sum, bucket) => sum + bucket.failure,
        legacyRecent.filter((call) => !call.ok).length,
      );
      const recentCallCount = bucketCalls + legacyRecent.length;
      const { recentCalls: _calls, recentBuckets: _buckets, ...rest } = m;
      return {
        ...rest,
        recentCallCount,
        recentFailureRate: recentCallCount ? failures / recentCallCount : 0,
      };
    });
  }
}
