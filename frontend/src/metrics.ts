import type { AlertRule, BaselineSnapshot, MetricsSnapshot, MetricKey } from "./types";

export function pickMetric(m: MetricsSnapshot, key: MetricKey): number {
  switch (key) {
    case "requests_per_s":
      return m.requests_per_s;
    case "error_rate":
      return m.error_rate;
    case "write_fail_rate":
      return m.write_fail_rate;
    case "latency_p99":
      return m.latency_ms.p99;
    case "latency_p95":
      return m.latency_ms.p95;
    case "availability":
      return m.availability;
    case "db_error_rate":
      return m.database?.error_rate ?? 0;
  }
}

export function metricLabel(key: MetricKey): string {
  switch (key) {
    case "requests_per_s":
      return "Requests / s";
    case "error_rate":
      return "Error rate";
    case "write_fail_rate":
      return "Write failure rate";
    case "latency_p99":
      return "Latency p99 (ms)";
    case "latency_p95":
      return "Latency p95 (ms)";
    case "availability":
      return "Availability";
    case "db_error_rate":
      return "DB insert error rate";
  }
}

export function alertFires(rule: AlertRule, m: MetricsSnapshot): boolean {
  if (!rule.enabled) return false;
  const v = pickMetric(m, rule.metric);
  return rule.op === "gt" ? v > rule.threshold : v < rule.threshold;
}

export function baselineFromMetrics(m: MetricsSnapshot): BaselineSnapshot {
  return {
    capturedAt: m.ts,
    requests_per_s: m.requests_per_s,
    error_rate: m.error_rate,
    write_fail_rate: m.write_fail_rate,
    latency_p99: m.latency_ms.p99,
    latency_p95: m.latency_ms.p95,
    availability: m.availability,
    db_error_rate: m.database?.error_rate,
  };
}
