export interface ChaosConfig {
  server_online: number;
  traffic_level: number;
  db_latency_ms: number;
  error_rate: number;
  storage_pressure: number;
  cpu_throttle: number;
  network_jitter_ms: number;
}

export interface DatabaseMetrics {
  configured: boolean;
  insert_attempts: number;
  insert_errors: number;
  error_rate: number;
  latency_ms: { p99: number };
}

export interface MetricsSnapshot {
  ts: number;
  chaos: ChaosConfig;
  requests_per_s: number;
  error_rate: number;
  write_fail_rate: number;
  latency_ms: { p50: number; p95: number; p99: number };
  availability: number;
  window: {
    requests: number;
    errors: number;
    writes: number;
    write_failures: number;
  };
  database: DatabaseMetrics;
}

export type MetricKey =
  | "requests_per_s"
  | "error_rate"
  | "write_fail_rate"
  | "latency_p99"
  | "latency_p95"
  | "availability"
  | "db_error_rate";

export interface AlertRule {
  id: string;
  label: string;
  metric: MetricKey;
  op: "gt" | "lt";
  threshold: number;
  enabled: boolean;
}

export interface BaselineSnapshot {
  capturedAt: number;
  requests_per_s: number;
  error_rate: number;
  write_fail_rate: number;
  latency_p99: number;
  latency_p95: number;
  availability: number;
  db_error_rate?: number;
}
