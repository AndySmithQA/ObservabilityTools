from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field


class ChaosConfig(BaseModel):
    """Dashboard-driven chaos knobs."""

    server_online: float = Field(1.0, ge=0.0, le=1.0, description="1 = up, 0 = hard down")
    traffic_level: float = Field(0.35, ge=0.0, le=1.0, description="Synthetic load")
    db_latency_ms: float = Field(0.0, ge=0.0, le=5000.0)
    error_rate: float = Field(0.02, ge=0.0, le=1.0)
    storage_pressure: float = Field(
        0.0, ge=0.0, le=1.0, description="Probability write fails (disk full)"
    )
    cpu_throttle: float = Field(0.0, ge=0.0, le=1.0, description="Extra CPU / queue delay")
    network_jitter_ms: float = Field(0.0, ge=0.0, le=500.0)


@dataclass
class MetricRing:
    max_samples: int = 300
    latencies_ms: list[float] = field(default_factory=list)

    def push(self, value: float) -> None:
        self.latencies_ms.append(value)
        if len(self.latencies_ms) > self.max_samples:
            self.latencies_ms.pop(0)

    def percentile(self, p: float) -> float:
        if not self.latencies_ms:
            return 0.0
        s = sorted(self.latencies_ms)
        k = min(len(s) - 1, max(0, int(round((p / 100) * (len(s) - 1)))))
        return s[k]


@dataclass
class SimulatorState:
    chaos: ChaosConfig = field(default_factory=ChaosConfig)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    window_requests: int = 0
    window_errors: int = 0
    window_writes: int = 0
    window_write_failures: int = 0
    uptime_checks_ok: int = 0
    uptime_checks_fail: int = 0
    ring: MetricRing = field(default_factory=lambda: MetricRing(400))
    last_tick: float = field(default_factory=time.monotonic)
    # Real DB path (rolling window, reset with window_reset_loop)
    db_window_attempts: int = 0
    db_window_errors: int = 0
    db_ring: MetricRing = field(default_factory=lambda: MetricRing(250))


async def get_chaos(state: SimulatorState) -> ChaosConfig:
    async with state.lock:
        return state.chaos.model_copy()


async def set_chaos(state: SimulatorState, cfg: ChaosConfig) -> ChaosConfig:
    async with state.lock:
        state.chaos = cfg
        return state.chaos.model_copy()


@dataclass
class RateTracker:
    points: list[tuple[float, float]] = field(default_factory=list)
    max_age_s: float = 60.0

    def record(self, value: float) -> None:
        self.points.append((time.time(), value))
        cutoff = time.time() - self.max_age_s
        self.points = [(t, v) for t, v in self.points if t >= cutoff]

    def rate_per_s(self, window_s: float = 5.0) -> float:
        now = time.time()
        recent = [(t, v) for t, v in self.points if now - t <= window_s]
        if len(recent) < 2:
            return sum(v for _, v in recent) / window_s if recent else 0.0
        dt = max(recent[-1][0] - recent[0][0], 0.001)
        return sum(v for _, v in recent) / dt


rate_tracker = RateTracker()


def build_metrics_snapshot(
    state: SimulatorState, *, physical_db: bool = False
) -> dict[str, Any]:
    chaos = state.chaos
    n = len(state.ring.latencies_ms)
    p50 = state.ring.percentile(50) if n else 0.0
    p95 = state.ring.percentile(95) if n else 0.0
    p99 = state.ring.percentile(99) if n else 0.0
    wr = max(state.window_requests, 1)
    err_rate = state.window_errors / wr
    write_fail_rate = (
        state.window_write_failures / state.window_writes if state.window_writes else 0.0
    )
    uc = state.uptime_checks_ok + state.uptime_checks_fail
    avail = state.uptime_checks_ok / uc if uc else 1.0

    rps = rate_tracker.rate_per_s(5.0)

    dba = state.db_window_attempts
    dbe = state.db_window_errors
    dwr = max(dba, 1)
    db_err_rate = dbe / dwr if dba else 0.0
    dn = len(state.db_ring.latencies_ms)
    db_p99 = state.db_ring.percentile(99) if dn else 0.0

    return {
        "ts": time.time(),
        "chaos": chaos.model_dump(),
        "requests_per_s": round(rps, 2),
        "error_rate": round(err_rate, 4),
        "write_fail_rate": round(write_fail_rate, 4),
        "latency_ms": {
            "p50": round(p50, 2),
            "p95": round(p95, 2),
            "p99": round(p99, 2),
        },
        "availability": round(avail, 4),
        "window": {
            "requests": state.window_requests,
            "errors": state.window_errors,
            "writes": state.window_writes,
            "write_failures": state.window_write_failures,
        },
        "database": {
            "configured": physical_db,
            "insert_attempts": dba,
            "insert_errors": dbe,
            "error_rate": round(db_err_rate, 4),
            "latency_ms": {"p99": round(db_p99, 2)},
        },
    }


def _poisson(lam: float) -> int:
    if lam <= 0:
        return 0
    L = 2.718281828459045 ** (-lam)
    k = 0
    p = 1.0
    while p > L:
        k += 1
        p *= random.random()
    return max(0, k - 1)


async def simulation_tick(state: SimulatorState) -> tuple[int, int]:
    async with state.lock:
        cfg = state.chaos.model_copy()

    now = time.monotonic()
    dt = max(now - state.last_tick, 0.001)
    state.last_tick = now

    base_rps = 35.0 + cfg.traffic_level * 380.0
    lam = base_rps * dt
    n_req = min(8000, _poisson(lam))

    # Slider at ~0 => drained / off; partial values simulate flaky readiness
    hard_down = cfg.server_online < 0.03
    flaky = not hard_down and cfg.server_online < 0.85

    n_err = 0
    for _ in range(n_req):
        state.window_requests += 1
        if hard_down:
            state.window_errors += 1
            n_err += 1
            state.ring.push(8.0)
            continue

        if random.random() < 0.1:
            if flaky and random.random() > cfg.server_online:
                state.uptime_checks_fail += 1
            else:
                state.uptime_checks_ok += 1

        latency = float(cfg.db_latency_ms)
        latency += cfg.network_jitter_ms * random.random()
        latency += cfg.cpu_throttle * 200.0 * random.random()

        is_write = random.random() < 0.38
        if is_write:
            state.window_writes += 1
            if random.random() < cfg.storage_pressure:
                state.window_write_failures += 1
                state.window_errors += 1
                n_err += 1
                state.ring.push(min(latency + 80.0, 8000.0))
                continue

        if random.random() < cfg.error_rate:
            state.window_errors += 1
            n_err += 1
            state.ring.push(latency * 0.35 + random.uniform(5.0, 120.0))
            continue

        state.ring.push(latency + random.expovariate(1 / 14.0))

    rate_tracker.record(n_req / dt)
    return n_req, n_err


async def window_reset_loop(state: SimulatorState, interval_s: float = 5.0) -> None:
    while True:
        await asyncio.sleep(interval_s)
        async with state.lock:
            state.window_requests = 0
            state.window_errors = 0
            state.window_writes = 0
            state.window_write_failures = 0
            state.db_window_attempts = 0
            state.db_window_errors = 0
            state.db_ring.latencies_ms.clear()
