# MiniBase Web API — FastAPI + Supabase + Cloudinary + R2
# P1 CRUD, P2 imports, P3 agent/table. Agent-ready: OpenAPI -> MCP.
import os
import pathlib

# Carga api/.env (uvicorn no lo hace solo). Necesario para Cloudinary + Supabase.
try:
  _env = pathlib.Path(__file__).parent / ".env"
  if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
      _line = _line.strip()
      if _line and not _line.startswith("#") and "=" in _line:
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip())
except Exception:
  pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import minis, imports, imports_direct, agent, table, media, scn_scenarios

app = FastAPI(title="MiniBase Web API", version="0.3.0",
  description="Inventario real de miniaturas para IA agentica, CV y tablero proyectado.")

app.add_middleware(CORSMiddleware,
  allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
  allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

app.include_router(minis.router, prefix="/api/minis", tags=["minis"])
app.include_router(imports.router, prefix="/api/imports", tags=["imports"])
app.include_router(imports_direct.router, prefix="/api/imports", tags=["imports-direct"])
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])
app.include_router(table.router, prefix="/api/table", tags=["table"])
app.include_router(media.router, prefix="/api/images", tags=["images"])
app.include_router(scn_scenarios.router, prefix="/api/scenarios", tags=["scenarios"])

@app.get("/health")
def health(): return {"ok": True, "version": "0.3.0"}

@app.get("/api/openapi_mcp.json")
def mcp_manifest():
  # Manifest mínimo para exponer tools al DM / agentes futuros
  return {"name": "minibase", "version": "0.3.0",
    "tools": ["list_miniatures","search_semantic","get_dataset","spawn_scenario",
              "sync_drive_file","detect_duplicates","calculate_completeness"]}
