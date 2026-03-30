import { useEffect, useState } from "react";
import type { MetricsSnapshot } from "./types";

export interface ChartRow {
  t: string;
  requests_per_s: number;
  error_rate: number;
  latency_p99: number;
  availability: number;
}

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/metrics`;
}

export function useMetricsWs() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [series, setSeries] = useState<ChartRow[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      ws = new WebSocket(wsUrl());
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) setTimeout(connect, 900);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as MetricsSnapshot;
          if (typeof data.ts !== "number") return;
          if (!data.database) {
            data.database = {
              configured: false,
              insert_attempts: 0,
              insert_errors: 0,
              error_rate: 0,
              latency_ms: { p99: 0 },
            };
          }
          setMetrics(data);
          setSeries((prev) => {
            const row: ChartRow = {
              t: new Date(data.ts * 1000).toLocaleTimeString(),
              requests_per_s: data.requests_per_s,
              error_rate: data.error_rate * 100,
              latency_p99: data.latency_ms.p99,
              availability: data.availability * 100,
            };
            const next = [...prev, row];
            return next.slice(-90);
          });
        } catch {
          /* ping / non-json */
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      ws?.close();
    };
  }, []);

  return { metrics, connected, series };
}
