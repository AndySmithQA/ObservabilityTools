from __future__ import annotations

import asyncio
import random
import time

import redis.asyncio as aioredis

from app.chaos import ChaosConfig, SimulatorState, get_chaos
from app.db import Event
from app.db_session import engine_ready, session_scope
from app.prom_metrics import (
    observe_db_insert,
    redis_enqueue_failed,
    redis_enqueued,
)

JOB_QUEUE = "obs_jobs"


async def db_workload_loop(
    state: SimulatorState, redis_url: str | None = None
) -> None:
    redis_client: aioredis.Redis | None = None
    if redis_url:
        try:
            redis_client = aioredis.from_url(redis_url, decode_responses=True)
        except Exception:  # noqa: BLE001
            redis_client = None

    await asyncio.sleep(0.4)
    while True:
        if not engine_ready():
            await asyncio.sleep(1.0)
            continue

        cfg = await get_chaos(state)
        if cfg.server_online < 0.03:
            await asyncio.sleep(0.2)
            continue

        n_batch = max(1, int(2 + cfg.traffic_level * 18))
        for _ in range(n_batch):
            await _one_db_op(state, cfg, redis_client)
        await asyncio.sleep(0.1)


async def _one_db_op(
    state: SimulatorState,
    cfg: ChaosConfig,
    redis_client: aioredis.Redis | None,
) -> None:
    async with state.lock:
        state.db_window_attempts += 1

    t0 = time.perf_counter()
    ok = False
    try:
        await asyncio.sleep(cfg.db_latency_ms / 1000.0)
        await asyncio.sleep(cfg.cpu_throttle * 0.04 * random.random())

        if random.random() < cfg.storage_pressure:
            raise RuntimeError("simulated_disk_full")

        async with session_scope() as session:
            session.add(Event(source="api"))
        ok = True

        if redis_client and random.random() < 0.7:
            try:
                await redis_client.lpush(JOB_QUEUE, f"{time.time():.6f}")
                redis_enqueued()
            except Exception:  # noqa: BLE001
                redis_enqueue_failed()
    except Exception:  # noqa: BLE001
        async with state.lock:
            state.db_window_errors += 1
    finally:
        elapsed = time.perf_counter() - t0
        async with state.lock:
            state.db_ring.push(elapsed * 1000.0)
        observe_db_insert(ok, elapsed)
