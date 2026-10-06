"""Fase 1 Escenarios: CRUD ficha + dataset para narrador/DM.

Frontera: todo cuelga de LA colección del usuario (igual que minis).
Requiere migración 005_scenarios_fase1.sql.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
import unicodedata
import re

router = APIRouter()

def _slug(s: str) -> str:
  s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
  return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

def _uid(request: Request) -> str:
  from routers.minis import _require_uid
  return _require_uid(request)

class ScenarioIn(BaseModel):
  name: str
  kind: str = "fisico"
  width_cm: Optional[float] = None
  depth_cm: Optional[float] = None
  height_cm: Optional[float] = None
  tile_cm: Optional[float] = None
  palette: list[str] = []
  texture: Optional[str] = None
  uses: list[str] = []
  description: Optional[str] = None
  comments: Optional[str] = None
  url: Optional[str] = None
  genre: Optional[str] = None
  visibility: str = "private"

def _col(sb, uid: str) -> str:
  col = sb.table("collections").select("id").eq("user_id", uid).limit(1).execute().data
  if not col:
    raise HTTPException(409, "sin colección: entra a la web una vez para crearla")
  return col[0]["id"]

@router.get("")
def list_scenarios(request: Request):
  from services import db as _db
  uid = _uid(request)
  sb = _db.client()
  try:
    rows = sb.table("scn_scenarios").select("*").eq("collection_id", _col(sb, uid)) \
      .order("name").execute().data or []
  except Exception as e:
    if "scn_scenarios" in str(e) or "relation" in str(e):
      raise HTTPException(409, "Corre la migración supabase/migrations/005_scenarios_fase1.sql")
    raise
  return {"items": rows, "total": len(rows)}

@router.post("")
def create_scenario(s: ScenarioIn, request: Request):
  from services import db as _db
  uid = _uid(request)
  if not s.name.strip():
    raise HTTPException(400, "name requerido")
  if s.kind not in ("fisico", "digital", "hibrido"):
    raise HTTPException(400, "kind: fisico|digital|hibrido")
  sb = _db.client()
  col_id = _col(sb, uid)
  try:
    row = sb.table("scn_scenarios").insert({
      "collection_id": col_id, "name": s.name.strip(), "slug": _slug(s.name),
      "kind": s.kind, "width_cm": s.width_cm, "depth_cm": s.depth_cm,
      "height_cm": s.height_cm, "tile_cm": s.tile_cm, "palette": s.palette,
      "texture": s.texture, "uses": s.uses, "description": s.description,
      "comments": s.comments, "url": s.url, "genre": s.genre,
      "visibility": s.visibility}).execute().data[0]
  except Exception as e:
    msg = str(e)
    if "scn_scenarios" in msg or "relation" in msg:
      raise HTTPException(409, "Corre la migración supabase/migrations/005_scenarios_fase1.sql")
    if "duplicate" in msg.lower() or "unique" in msg.lower():
      raise HTTPException(409, "ya existe un escenario con ese nombre")
    raise HTTPException(500, f"no se pudo crear: {e}")
  return row

@router.get("/{sid}")
def get_scenario(sid: str, request: Request):
  from services import db as _db
  uid = _uid(request)
  sb = _db.client()
  rows = sb.table("scn_scenarios").select("*").eq("id", sid) \
    .eq("collection_id", _col(sb, uid)).limit(1).execute().data
  if not rows:
    raise HTTPException(404, "no existe")
  return rows[0]

@router.put("/{sid}")
def update_scenario(sid: str, s: ScenarioIn, request: Request):
  from services import db as _db
  uid = _uid(request)
  sb = _db.client()
  col_id = _col(sb, uid)
  if not sb.table("scn_scenarios").select("id").eq("id", sid) \
      .eq("collection_id", col_id).limit(1).execute().data:
    raise HTTPException(404, "no existe")
  row = sb.table("scn_scenarios").update({
    "name": s.name.strip(), "slug": _slug(s.name), "kind": s.kind,
    "width_cm": s.width_cm, "depth_cm": s.depth_cm, "height_cm": s.height_cm,
    "tile_cm": s.tile_cm, "palette": s.palette, "texture": s.texture,
    "uses": s.uses, "description": s.description, "comments": s.comments,
    "url": s.url, "genre": s.genre, "visibility": s.visibility}) \
    .eq("id", sid).execute().data[0]
  return row

@router.delete("/{sid}")
def delete_scenario(sid: str, request: Request):
  from services import db as _db
  uid = _uid(request)
  sb = _db.client()
  if not sb.table("scn_scenarios").select("id").eq("id", sid) \
      .eq("collection_id", _col(sb, uid)).limit(1).execute().data:
    raise HTTPException(404, "no existe")
  sb.table("scn_scenarios").delete().eq("id", sid).execute()
  return {"deleted": sid}

@router.get("/{sid}/dataset")
def scenario_dataset(sid: str, request: Request):
  """Contexto para el narrador/DM: ficha + contadores de módulos (partes,
  montajes y audio llegan en fases 2-6; hoy responde la ficha + ceros)."""
  scn = get_scenario(sid, request)
  return {"scenario": scn, "parts": [], "tile_presets": [], "mounts": [],
          "lightings": [], "audios": [],
          "note": "fases 2-6 agregan partes, presets, montajes, luz y audio"}