# Observability Lab — User Guide

This project is a **learning sandbox** for observability: a running app stack, a live dashboard, **Prometheus** metrics, optional **Grafana** views, and a **chaos** panel you can use to stress the system and see how metrics and alerts respond compared to a baseline.

---

## What you get

| Piece | Role |
|--------|------|
| **Web UI** | Live KPIs, charts, baselines, alert rules, chaos sliders |
| **API** | Simulated traffic, chaos knobs, JSON metrics API, **`/metrics`** for Prometheus |
| **Postgres** | Real `INSERT` workload (when running under Docker Compose) |
| **Redis** | Job queue feeding the worker |
| **Worker** | Consumes queue jobs; exposes **`:9101/metrics`** |
| **Prometheus** | Scrapes API and worker |
| **Grafana** | Pre-provisioned dashboard on Prometheus data |

---

## Prerequisites

- **Docker Desktop** (or compatible engine) with Compose v2
- A machine with enough resources for Postgres, Redis, Prometheus, Grafana, and three app containers

---

## Quick start (full stack)

From the project root:

```bash
docker compose up --build
```

Wait until all services are healthy. Then open:

| What | URL | Notes |
|------|-----|--------|
| **Lab dashboard** | [http://localhost:8080](http://localhost:8080) | Main UI (nginx → API + static) |
| **API (direct)** | [http://localhost:8000](http://localhost:8000) | Health: `/health`, readiness: `/api/ready`, Prometheus: `/metrics` |
| **Prometheus** | [http://localhost:9090](http://localhost:9090) | Targets: `lab_api`, `lab_worker` |
| **Grafana** | [http://localhost:3000](http://localhost:3000) | User **`admin`**, password **`admin`** (change in production) |
| **Worker metrics** | [http://localhost:9101/metrics](http://localhost:9101/metrics) | Raw exposition format |

In the UI, use **Prometheus stack** links for quick access to Prometheus, Grafana, and raw metric endpoints.

---

## How to use the dashboard

### 1. Confirm the live stream

The header shows **Live stream** when the browser is connected over WebSockets. Charts and KPIs update continuously (about five times per second). If you see **Reconnecting…**, check that the API is up and that you are using the same host/port as the UI (or fix proxies/firewall).

### 2. Capture a baseline

1. Set chaos sliders to **calm** values (or click **Reset to calm defaults** in the chaos panel).
2. Let the system settle for a short time.
3. Click **Capture baseline**.

Baseline deltas (% vs baseline) appear next to several KPIs so you can see drift at a glance. Baselines are stored in the browser (**localStorage**); they are not shared across devices or browsers.

### 3. Define alerts

Under **Alerts**, add rules such as:

- **Latency p99** greater than a threshold (e.g. 400 ms) — good for “slow path” exploration.
- **Error rate** greater than a threshold — tracks synthetic error fraction.
- **DB insert error rate** — useful when Postgres-backed workload is enabled (Docker Compose).

Use **On / Off** to disable a rule without deleting it. **Firing now** summarizes which enabled rules match the **current** metrics.

Alert definitions are also stored in **localStorage**.

### 4. Use the chaos panel

Open **Chaos controls** (or **Chaos** on small screens). The sliders drive the **same chaos API** the simulator and (when enabled) the DB workload use:

| Control | Effect |
|---------|--------|
| **Server online** | Near **0%** → hard outage (health fails, synthetic requests error). Middle values → flakier readiness-style behavior. |
| **Traffic intensity** | More synthetic load and (with Compose) more DB inserts and Redis jobs. |
| **Database latency** | Extra delay (aligned with “slow DB” behavior on inserts and synthetic path). |
| **Random 5xx / app errors** | Increases fraction of failed synthetic requests. |
| **Storage full (write failures)** | Simulated write rejections before commit (and synthetic write failures). |
| **CPU / queue pressure** | Extra processing delay. |
| **Network jitter** | Variable extra delay per request. |

Changes are sent to the API quickly (debounced), so the dashboard and Prometheus counters should move in **near real time**.

### 5. Optional: Prometheus and Grafana

- In **Prometheus** → **Status → Targets**, confirm `lab_api` and `lab_worker` are **UP**.
- In **Grafana**, open the **Observability Lab** dashboard (auto-provisioned). You will see panels for synthetic RPS, DB insert latency, worker throughput, and HTTP latency — useful alongside the lab UI when you run the scenarios below.

---

## Scenarios to try

Work through these in order or pick what matches what you want to teach or learn.

### Scenario A — “Where does latency break first?”

1. Capture a **baseline** with chaos low.
2. Add an alert: **Latency p99** **greater than** ~300–500 ms (tune to your taste).
3. Slowly increase **Database latency** and/or **Network jitter** until the alert **fires**.
4. Compare Grafana’s **DB insert duration** / **HTTP p99** panels with the in-app chart.

**Learning goal:** tie a **threshold alert** to a **slow dependency** knob and see lag show up in both the product UI and Prometheus-backed dashboards.

### Scenario B — “Outage and recovery”

1. Baseline with **Server online** at 100%.
2. Add an alert on **Availability** **less than** e.g. **95%** (values are probe-style fractions in the app).
3. Drag **Server online** to **0%**. Watch errors spike, availability drop, and **Firing now**.
4. Restore **Server online** to 100% and watch recovery.

**Learning goal:** practice correlating **health**, **availability**, and **error rate** during a controlled outage.

### Scenario C — “Traffic storm”

1. Baseline with moderate **Traffic intensity**.
2. Add an alert on **Requests / s** **greater than** a value just above your baseline (requires tuning).
3. Raise **Traffic intensity** toward maximum. Watch RPS, latency percentiles, and worker-related metrics (queue + consumer) in Grafana.
4. Optionally add **CPU / queue pressure** to amplify queueing behavior.

**Learning goal:** see how **load** propagates to **latency** and **downstream consumers** (worker job rate).

### Scenario D — “Errors without touching traffic much”

1. Keep traffic moderate.
2. Add an alert: **Error rate** **greater than** e.g. **0.05–0.10** (rates are 0–1 in metric logic).
3. Increase **Random 5xx / app errors** until the alert fires.
4. Observe that you can break **SLO-style error budgets** even when “servers are up.”

**Learning goal:** separate **availability** from **correctness** / error ratio.

### Scenario E — “Storage / write path”

(Relevant when **Postgres** is running — full Docker stack.)

1. Capture baseline with **Storage full** at 0%.
2. Add an alert on **DB insert error rate** **greater than** e.g. **0.05**.
3. Raise **Storage full** until DB insert failures rise and the alert fires.
4. Cross-check **`lab_db_insert_failures_total`** / histogram in Prometheus or Grafana.

**Learning goal:** connect **write failures** to concrete metrics and alerts, similar to disk or quota incidents.

### Scenario F — “Compound incident”

Combine **partial server online**, **high traffic**, **DB latency**, and **error rate** at low levels simultaneously. Capture baseline **before** the mix, then ramp multiple sliders slowly.

**Learning goal:** see **multi-signal** alerting and how **baselines** help spot “everything is a little wrong” vs one dominant failure mode.

---

## Local development (without Docker)

You can run the API and UI on the host for UI work:

- **API:** install Python dependencies from `backend/requirements.txt`, then run Uvicorn on `app.main:app` (see project layout). Without `DATABASE_URL` / `REDIS_URL`, the **physical DB and queue path are off**; the simulator and WebSocket UI still work.
- **UI:** in `frontend`, `npm install` and `npm run dev` — Vite proxies `/api` and `/ws` to `127.0.0.1:8000`.

For the **full** experience (real inserts, worker, Prometheus, Grafana), use **Docker Compose** as above.

---

## Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| UI stuck on **Reconnecting…** | API running? Same host as UI? Port `8080` nginx → API. Try [http://localhost:8000/api/ready](http://localhost:8000/api/ready). |
| No DB KPI strip | Only shown when the API was started **with** `DATABASE_URL` (Compose provides this). |
| Prometheus target **DOWN** | Container name/port: API `:8000`, worker `:9101`. Wait for `api` healthcheck after Postgres is ready. |
| Grafana shows no data | Time range (last 15–30 min), Prometheus datasource URL inside Grafana, targets UP. |
| **health** returns 503 | Expected when **Server online** chaos is near zero — that simulates outage. Use **`/api/ready`** for liveness that ignores chaos. |

---

## Security note

Default Grafana credentials and open CORS are intended for **local learning only**. Do not expose this stack to the public internet without hardening, secrets management, and authentication.
