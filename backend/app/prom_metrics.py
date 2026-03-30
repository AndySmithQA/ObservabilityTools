from __future__ import annotations

import time

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from starlette.requests import Request
from starlette.responses import Response

HTTP_REQUESTS = Counter(
    "lab_http_requests_total",
    "HTTP requests",
    ("method", "path_group", "status"),
)
HTTP_LATENCY = Histogram(
    "lab_http_request_duration_seconds",
    "HTTP request latency",
    ("path_group",),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

SIM_REQUESTS = Counter("lab_sim_requests_total", "Synthetic requests (simulator ticks)")
SIM_ERRORS = Counter("lab_sim_errors_total", "Synthetic failed requests")
DB_INSERTS = Counter("lab_db_inserts_total", "Successful INSERTs to Postgres")
DB_INSERT_FAIL = Counter("lab_db_insert_failures_total", "Failed INSERT attempts")
DB_INSERT_LATENCY = Histogram(
    "lab_db_insert_duration_seconds",
    "Wall time per INSERT including chaos delay",
    buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 15.0),
)

REDIS_ENQUEUE = Counter("lab_redis_jobs_enqueued_total", "Jobs pushed to Redis for worker")
REDIS_ENQUEUE_FAIL = Counter("lab_redis_enqueue_errors_total", "Redis enqueue failures")


def path_group(path: str) -> str:
    if path.startswith("/ws"):
        return "/ws"
    if path.startswith("/api/chaos"):
        return "/api/chaos"
    if path.startswith("/api/metrics"):
        return "/api/metrics"
    if path == "/metrics" or path.startswith("/metrics"):
        return "/metrics"
    if path.startswith("/api/"):
        return "/api/*"
    if path.startswith("/health"):
        return "/health"
    if path.startswith("/api/ready"):
        return "/api/ready"
    return path.rstrip("/")[:32] or "/"


async def prometheus_http_middleware(request: Request, call_next):
    if request.url.path == "/metrics":
        return await call_next(request)
    t0 = time.perf_counter()
    response = await call_next(request)
    dur = time.perf_counter() - t0
    pg = path_group(request.url.path)
    HTTP_REQUESTS.labels(
        request.method, pg, str(response.status_code)
    ).inc()
    HTTP_LATENCY.labels(pg).observe(dur)
    return response


def metrics_response() -> Response:
    data = generate_latest()
    return Response(content=data, media_type=CONTENT_TYPE_LATEST)


def observe_sim_tick(n_req: int, n_errors: int) -> None:
    if n_req:
        SIM_REQUESTS.inc(n_req)
    if n_errors:
        SIM_ERRORS.inc(n_errors)


def observe_db_insert(ok: bool, seconds: float) -> None:
    DB_INSERT_LATENCY.observe(seconds)
    if ok:
        DB_INSERTS.inc()
    else:
        DB_INSERT_FAIL.inc()


def redis_enqueued() -> None:
    REDIS_ENQUEUE.inc()


def redis_enqueue_failed() -> None:
    REDIS_ENQUEUE_FAIL.inc()
