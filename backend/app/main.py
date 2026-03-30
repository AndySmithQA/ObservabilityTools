from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.chaos import (
    ChaosConfig,
    SimulatorState,
    build_metrics_snapshot,
    get_chaos,
    set_chaos,
    simulation_tick,
    window_reset_loop,
)
from app.config import Settings
from app.db_session import configure_engine, create_tables
from app.db_workload import db_workload_loop
from app.prom_metrics import (
    metrics_response,
    observe_sim_tick,
    prometheus_http_middleware,
)

sim_state = SimulatorState()


async def _metrics_pump(ws: WebSocket, physical_db: bool) -> None:
    while True:
        await ws.send_json(build_metrics_snapshot(sim_state, physical_db=physical_db))
        await asyncio.sleep(0.2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings()
    app.state.physical_db = False
    tasks: list[asyncio.Task[None]] = []

    if settings.database_url:
        configure_engine(settings.database_url)
        await create_tables()
        app.state.physical_db = True
        tasks.append(
            asyncio.create_task(db_workload_loop(sim_state, settings.redis_url))
        )

    async def run_sim():
        while True:
            n_req, n_err = await simulation_tick(sim_state)
            observe_sim_tick(n_req, n_err)
            await asyncio.sleep(0.08)

    tasks.append(asyncio.create_task(run_sim()))
    tasks.append(asyncio.create_task(window_reset_loop(sim_state, 5.0)))
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Observability Lab API", lifespan=lifespan)
app.state.physical_db = False

@app.middleware("http")
async def _prometheus_http_middleware(request, call_next):
    return await prometheus_http_middleware(request, call_next)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/ready")
async def ready():
    """Liveness for orchestration — independent of simulated outages."""
    return {"ready": True}


@app.get("/health")
async def health():
    async with sim_state.lock:
        online = sim_state.chaos.server_online
    if online < 0.03:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=503,
            content={"status": "down", "server_online": online},
        )
    return {"status": "ok", "server_online": online}


@app.get("/api/chaos", response_model=ChaosConfig)
async def api_get_chaos():
    return await get_chaos(sim_state)


@app.put("/api/chaos", response_model=ChaosConfig)
async def api_put_chaos(cfg: ChaosConfig):
    return await set_chaos(sim_state, cfg)


@app.get("/api/metrics")
async def api_metrics():
    return build_metrics_snapshot(sim_state, physical_db=app.state.physical_db)


@app.get("/metrics")
async def prometheus_metrics():
    return metrics_response()


@app.websocket("/ws/metrics")
async def ws_metrics(ws: WebSocket):
    await ws.accept()
    physical_db: bool = app.state.physical_db
    pump = asyncio.create_task(_metrics_pump(ws, physical_db))
    try:
        while True:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=120.0)
            except asyncio.TimeoutError:
                await ws.send_text(json.dumps({"type": "ping"}))
                continue
            if raw in ("ping", '{"type":"ping"}'):
                await ws.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        pump.cancel()


def main():
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":
    main()
