"""Redis queue consumer with Prometheus metrics (second scrape target)."""

from __future__ import annotations

import asyncio
import os
import random
import time

import redis.asyncio as redis
from prometheus_client import Counter, Histogram, start_http_server

JOB_QUEUE = "obs_jobs"

JOBS = Counter("lab_worker_jobs_total", "Jobs completed")
JOB_ERR = Counter("lab_worker_job_errors_total", "Job processing failures")
JOB_LAT = Histogram(
    "lab_worker_job_duration_seconds",
    "Simulated work duration",
    buckets=(0.01, 0.03, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0),
)


async def run() -> None:
    start_http_server(9101, addr="0.0.0.0")
    url = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
    client = redis.from_url(url, decode_responses=True)
    while True:
        try:
            item = await client.brpop([JOB_QUEUE], timeout=3)
            if item is None:
                continue
            _key, _payload = item
            t0 = time.perf_counter()
            await asyncio.sleep(0.015 + random.random() * 0.12)
            JOB_LAT.observe(time.perf_counter() - t0)
            JOBS.inc()
        except asyncio.CancelledError:
            raise
        except Exception:
            JOB_ERR.inc()
            await asyncio.sleep(0.3)


if __name__ == "__main__":
    asyncio.run(run())
