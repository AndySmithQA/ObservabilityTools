import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  alertFires,
  baselineFromMetrics,
  metricLabel,
  pickMetric,
} from "./metrics";
import type { AlertRule, BaselineSnapshot, ChaosConfig, MetricKey } from "./types";
import { useMetricsWs } from "./useMetricsWs";

const defaultChaos: ChaosConfig = {
  server_online: 1,
  traffic_level: 0.35,
  db_latency_ms: 0,
  error_rate: 0.02,
  storage_pressure: 0,
  cpu_throttle: 0,
  network_jitter_ms: 0,
};

const STORAGE_BASELINE = "obs-lab-baseline";
const STORAGE_ALERTS = "obs-lab-alerts";

function loadBaseline(): BaselineSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_BASELINE);
    return raw ? (JSON.parse(raw) as BaselineSnapshot) : null;
  } catch {
    return null;
  }
}

function loadAlerts(): AlertRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_ALERTS);
    return raw ? (JSON.parse(raw) as AlertRule[]) : [];
  } catch {
    return [];
  }
}

function SliderRow(props: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const { label, hint, min, max, step, value, onChange, format } = props;
  const show = format ? format(value) : String(value);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-3 text-sm">
        <div>
          <div className="font-medium text-slate-100">{label}</div>
          <div className="text-xs text-slate-500">{hint}</div>
        </div>
        <div className="font-mono text-xs text-accent-muted tabular-nums">{show}</div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </div>
  );
}

function useStackLinks() {
  const [host, setHost] = useState(() =>
    typeof window !== "undefined" ? window.location.hostname : "localhost"
  );
  useEffect(() => {
    setHost(window.location.hostname);
  }, []);
  return useMemo(
    () => ({
      prometheus: `http://${host}:9090`,
      grafana: `http://${host}:3000`,
      apiMetrics: `http://${host}:8000/metrics`,
      workerMetrics: `http://${host}:9101/metrics`,
    }),
    [host]
  );
}

export default function App() {
  const { metrics, connected, series } = useMetricsWs();
  const stack = useStackLinks();
  const [chaos, setChaos] = useState<ChaosConfig>(defaultChaos);
  const [chaosOpen, setChaosOpen] = useState(true);
  const [baseline, setBaseline] = useState<BaselineSnapshot | null>(loadBaseline);
  const [alerts, setAlerts] = useState<AlertRule[]>(() => {
    const a = loadAlerts();
    return a.length
      ? a
      : [
          {
            id: "a1",
            label: "High p99 latency",
            metric: "latency_p99",
            op: "gt",
            threshold: 400,
            enabled: true,
          },
          {
            id: "a2",
            label: "Elevated errors",
            metric: "error_rate",
            op: "gt",
            threshold: 0.08,
            enabled: true,
          },
        ];
  });

  const putTimer = useRef<number>(0);
  const pushChaos = useCallback((next: ChaosConfig) => {
    setChaos(next);
    window.clearTimeout(putTimer.current);
    putTimer.current = window.setTimeout(() => {
      fetch("/api/chaos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).catch(() => {});
    }, 70);
  }, []);

  useEffect(() => {
    fetch("/api/chaos")
      .then((r) => r.json())
      .then((j) => setChaos(j as ChaosConfig))
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_ALERTS, JSON.stringify(alerts));
  }, [alerts]);

  const fired = useMemo(() => {
    if (!metrics) return [];
    return alerts.filter((a) => alertFires(a, metrics));
  }, [alerts, metrics]);

  const captureBaseline = () => {
    if (!metrics) return;
    const b = baselineFromMetrics(metrics);
    setBaseline(b);
    localStorage.setItem(STORAGE_BASELINE, JSON.stringify(b));
  };

  const clearBaseline = () => {
    setBaseline(null);
    localStorage.removeItem(STORAGE_BASELINE);
  };

  const [draftMetric, setDraftMetric] = useState<MetricKey>("latency_p99");
  const [draftOp, setDraftOp] = useState<"gt" | "lt">("gt");
  const [draftThresh, setDraftThresh] = useState(250);

  const addAlert = () => {
    const id = crypto.randomUUID();
    setAlerts((a) => [
      ...a,
      {
        id,
        label: `${metricLabel(draftMetric)} ${draftOp === "gt" ? ">" : "<"} ${draftThresh}`,
        metric: draftMetric,
        op: draftOp,
        threshold: draftThresh,
        enabled: true,
      },
    ]);
  };

  const diffBadge = (key: keyof BaselineSnapshot, cur: number | undefined) => {
    if (baseline == null || cur === undefined) return null;
    const b = baseline[key];
    if (typeof b !== "number") return null;
    const d = cur - b;
    const pct = b !== 0 ? (d / b) * 100 : 0;
    const up = d > 0;
    const cls =
      Math.abs(pct) < 3 ? "text-slate-500" : up ? "text-amber-400" : "text-emerald-400";
    return (
      <span className={`ml-2 text-xs font-mono ${cls}`}>
        {up ? "+" : ""}
        {pct.toFixed(0)}% vs baseline
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-surface-border bg-surface-raised/80 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">
              Observability Lab
            </h1>
            <p className="text-sm text-slate-500">
              Baselines, alerts, and live chaos — watch breaking points emerge in real time.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                connected
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-rose-500/15 text-rose-400"
              }`}
            >
              {connected ? "Live stream" : "Reconnecting…"}
            </span>
            <button
              type="button"
              onClick={() => setChaosOpen((o) => !o)}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-lg shadow-accent/20 hover:bg-accent/90"
            >
              {chaosOpen ? "Hide chaos" : "Chaos controls"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Requests / s"
              value={metrics?.requests_per_s}
              fmt={(n) => n.toFixed(1)}
              delta={diffBadge("requests_per_s", metrics?.requests_per_s)}
            />
            <Kpi
              label="Error rate"
              value={metrics != null ? metrics.error_rate * 100 : undefined}
              fmt={(n) => `${n.toFixed(2)}%`}
              delta={diffBadge("error_rate", metrics?.error_rate)}
            />
            <Kpi
              label="p99 latency"
              value={metrics?.latency_ms.p99}
              fmt={(n) => `${n.toFixed(0)} ms`}
              delta={diffBadge("latency_p99", metrics?.latency_ms.p99)}
            />
            <Kpi
              label="Availability (probes)"
              value={metrics != null ? metrics.availability * 100 : undefined}
              fmt={(n) => `${n.toFixed(1)}%`}
              delta={diffBadge("availability", metrics?.availability)}
            />
          </section>

          {metrics?.database?.configured ? (
            <section className="grid gap-3 sm:grid-cols-3">
              <Kpi
                label="DB inserts (window)"
                value={metrics.database.insert_attempts}
                fmt={(n) => n.toFixed(0)}
                delta={null}
              />
              <Kpi
                label="DB insert error rate"
                value={metrics != null ? metrics.database.error_rate * 100 : undefined}
                fmt={(n) => `${n.toFixed(2)}%`}
                delta={
                  baseline?.db_error_rate != null && metrics
                    ? diffBadge("db_error_rate", metrics.database.error_rate)
                    : null
                }
              />
              <Kpi
                label="DB insert p99"
                value={metrics.database.latency_ms.p99}
                fmt={(n) => `${n.toFixed(0)} ms`}
                delta={null}
              />
            </section>
          ) : (
            <section className="rounded-xl border border-dashed border-surface-border bg-surface-raised/40 px-4 py-3 text-sm text-slate-500">
              Physical Postgres + Redis targets are idle. Run{" "}
              <span className="font-mono text-slate-400">docker compose up</span> to enable real
              inserts, queue fan-out, and Prometheus scrape labels on the API and worker.
            </section>
          )}

          <section className="rounded-xl border border-surface-border bg-surface-raised p-4">
            <h2 className="text-sm font-semibold text-slate-100">Prometheus stack</h2>
            <p className="mt-1 text-xs text-slate-500">
              Standard scrape targets: <span className="font-mono text-slate-400">lab_api</span>{" "}
              (FastAPI <span className="font-mono">/metrics</span>),{" "}
              <span className="font-mono text-slate-400">lab_worker</span> (:9101). Log into Grafana
              as <span className="font-mono">admin / admin</span> and open the{" "}
              <em>Observability Lab</em> dashboard.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={stack.prometheus}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-surface-border bg-surface px-3 py-1.5 text-xs font-medium text-accent-muted hover:border-accent/40"
              >
                Prometheus
              </a>
              <a
                href={stack.grafana}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-surface-border bg-surface px-3 py-1.5 text-xs font-medium text-accent-muted hover:border-accent/40"
              >
                Grafana
              </a>
              <a
                href={stack.apiMetrics}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-surface-border bg-surface px-3 py-1.5 text-xs text-slate-400 hover:border-slate-500"
              >
                API metrics
              </a>
              <a
                href={stack.workerMetrics}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-surface-border bg-surface px-3 py-1.5 text-xs text-slate-400 hover:border-slate-500"
              >
                Worker metrics
              </a>
            </div>
          </section>

          <section className="rounded-xl border border-surface-border bg-surface-raised p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-100">Live signals</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={captureBaseline}
                  className="rounded-md border border-surface-border bg-surface px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500"
                >
                  Capture baseline
                </button>
                {baseline && (
                  <button
                    type="button"
                    onClick={clearBaseline}
                    className="rounded-md px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2836" />
                  <XAxis dataKey="t" tick={false} stroke="#64748b" />
                  <YAxis yAxisId="left" stroke="#64748b" width={44} />
                  <YAxis yAxisId="right" orientation="right" stroke="#64748b" width={44} />
                  <Tooltip
                    contentStyle={{
                      background: "#131820",
                      border: "1px solid #1e2836",
                      borderRadius: 8,
                    }}
                  />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="requests_per_s"
                    name="RPS"
                    stroke="#60a5fa"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="latency_p99"
                    name="p99 ms"
                    stroke="#f472b6"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="error_rate"
                    name="Errors %"
                    stroke="#fb923c"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-xl border border-surface-border bg-surface-raised p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Alerts</h2>
            {fired.length > 0 && (
              <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                <span className="font-medium">Firing now: </span>
                {fired.map((f) => f.label).join(" · ")}
              </div>
            )}
            <ul className="space-y-2 text-sm">
              {alerts.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-border px-3 py-2"
                >
                  <span className={a.enabled ? "text-slate-200" : "text-slate-500"}>
                    {a.label}
                  </span>
                  <div className="flex items-center gap-2">
                    {metrics && (
                      <span
                        className={`font-mono text-xs ${
                          alertFires(a, metrics) ? "text-rose-400" : "text-slate-500"
                        }`}
                      >
                        now{" "}
                        {pickMetric(metrics, a.metric).toFixed(
                          a.metric === "error_rate" || a.metric === "db_error_rate"
                            ? 4
                            : 2
                        )}
                      </span>
                    )}
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-slate-300"
                      onClick={() =>
                        setAlerts((x) => x.filter((z) => z.id !== a.id))
                      }
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-slate-300"
                      onClick={() =>
                        setAlerts((x) =>
                          x.map((z) =>
                            z.id === a.id ? { ...z, enabled: !z.enabled } : z
                          )
                        )
                      }
                    >
                      {a.enabled ? "Off" : "On"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-surface-border pt-4">
              <label className="text-xs text-slate-500">
                Metric
                <select
                  className="ml-1 mt-1 block rounded-md border border-surface-border bg-surface px-2 py-1 text-slate-200"
                  value={draftMetric}
                  onChange={(e) => setDraftMetric(e.target.value as MetricKey)}
                >
                  {(
                    [
                      "requests_per_s",
                      "error_rate",
                      "write_fail_rate",
                      "latency_p99",
                      "latency_p95",
                      "availability",
                      "db_error_rate",
                    ] as const
                  ).map((k) => (
                    <option key={k} value={k}>
                      {metricLabel(k)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Condition
                <select
                  className="ml-1 mt-1 block rounded-md border border-surface-border bg-surface px-2 py-1 text-slate-200"
                  value={draftOp}
                  onChange={(e) => setDraftOp(e.target.value as "gt" | "lt")}
                >
                  <option value="gt">greater than</option>
                  <option value="lt">less than</option>
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Threshold
                <input
                  type="number"
                  className="ml-1 mt-1 block w-28 rounded-md border border-surface-border bg-surface px-2 py-1 font-mono text-slate-200"
                  value={draftThresh}
                  onChange={(e) => setDraftThresh(Number(e.target.value))}
                />
              </label>
              <button
                type="button"
                onClick={addAlert}
                className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600"
              >
                Add alert
              </button>
            </div>
          </section>
        </div>

        <aside
          className={`fixed inset-y-0 right-0 z-40 w-full max-w-md transform border-l border-surface-border bg-surface-raised shadow-2xl transition-transform duration-200 lg:relative lg:z-0 lg:max-w-none lg:border lg:rounded-xl lg:shadow-none ${
            chaosOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 lg:h-auto lg:max-h-[calc(100vh-5rem)]">
            <div className="flex items-center justify-between lg:hidden">
              <h2 className="text-sm font-semibold text-white">Chaos</h2>
              <button
                type="button"
                className="text-slate-400"
                onClick={() => setChaosOpen(false)}
              >
                Close
              </button>
            </div>
            <h2 className="hidden text-sm font-semibold text-white lg:block">
              Chaos & adverse conditions
            </h2>
            <p className="text-xs text-slate-500">
              Adjust sliders to stress the synthetic workload. The dashboard and alerts react
              immediately so you can compare against your captured baseline.
            </p>
            <SliderRow
              label="Server online"
              hint="Slide to zero to kill the service (hard down)."
              min={0}
              max={1}
              step={0.01}
              value={chaos.server_online}
              onChange={(v) => pushChaos({ ...chaos, server_online: v })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <SliderRow
              label="Traffic intensity"
              hint="Simulates bursty request pressure."
              min={0}
              max={1}
              step={0.01}
              value={chaos.traffic_level}
              onChange={(v) => pushChaos({ ...chaos, traffic_level: v })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <SliderRow
              label="Database latency"
              hint="Adds slow-query style delay before responses."
              min={0}
              max={5000}
              step={10}
              value={chaos.db_latency_ms}
              onChange={(v) => pushChaos({ ...chaos, db_latency_ms: v })}
              format={(v) => `${v.toFixed(0)} ms`}
            />
            <SliderRow
              label="Random 5xx / app errors"
              hint="Fraction of requests that fail after latency."
              min={0}
              max={1}
              step={0.01}
              value={chaos.error_rate}
              onChange={(v) => pushChaos({ ...chaos, error_rate: v })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <SliderRow
              label="Storage full (write failures)"
              hint="Write path rejections as if the disk filled."
              min={0}
              max={1}
              step={0.01}
              value={chaos.storage_pressure}
              onChange={(v) => pushChaos({ ...chaos, storage_pressure: v })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <SliderRow
              label="CPU / queue pressure"
              hint="Extra processing delay (noisy neighbor style)."
              min={0}
              max={1}
              step={0.01}
              value={chaos.cpu_throttle}
              onChange={(v) => pushChaos({ ...chaos, cpu_throttle: v })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <SliderRow
              label="Network jitter"
              hint="Variable extra RTT on each request."
              min={0}
              max={500}
              step={5}
              value={chaos.network_jitter_ms}
              onChange={(v) => pushChaos({ ...chaos, network_jitter_ms: v })}
              format={(v) => `${v.toFixed(0)} ms`}
            />
            <button
              type="button"
              className="mt-2 rounded-lg border border-surface-border py-2 text-sm text-slate-300 hover:bg-surface"
              onClick={() => pushChaos(defaultChaos)}
            >
              Reset to calm defaults
            </button>
          </div>
        </aside>
      </main>

      {!chaosOpen && (
        <button
          type="button"
          className="fixed bottom-3 right-3 z-50 rounded-full bg-accent px-4 py-3 text-sm font-medium text-white shadow-xl lg:hidden"
          onClick={() => setChaosOpen(true)}
        >
          Chaos
        </button>
      )}
    </div>
  );
}

function Kpi(props: {
  label: string;
  value: number | undefined;
  fmt: (n: number) => string;
  delta: ReactNode;
}) {
  const { label, value, fmt, delta } = props;
  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-1">
        <span className="font-mono text-2xl font-semibold text-white">
          {value === undefined ? "—" : fmt(value)}
        </span>
        {delta}
      </div>
    </div>
  );
}
