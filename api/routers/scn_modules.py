"""Fases 2-6 Escenarios: partes, tiles, montajes (+combine PNG), luz, audio, assets.

Assets: Cloudinary hot (fotos/locaciones) + backup_url Drive cold (manual hasta OAuth).
Combine: Pillow compone capas en un PNG -> se sube a Cloudinary (server-side) ->
se guarda como asset kind=montaje + composed_url. Requiere migracion 007.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
import os
import time

router = APIRouter()

def _uid(request: Request) -> str:
  from routers.minis import _require_uid
  return _require_uid(request)

def _sb():
  from services import db as _db
  sb = _db.client()
  if sb is None:
    raise HTTPException(500, "Supabase no configurado")
  return sb

def _col(sb, uid: str) -> str:
  col = sb.table("collections").select("id").eq("user_id", uid).limit(1).execute().data
  if not col:
    raise HTTPException(409, "sin coleccion")
  return col[0]["id"]

_HAS007: dict = {"ok": None}

def _need007(sb):
  """Verifica migracion 007 una vez por proceso; si falta, 409 con guia."""
  if _HAS007["ok"]:
    return
  try:
    sb.table("scn_assets").select("id").limit(0).execute()
    _HAS007["ok"] = True
  except Exception:
    raise HTTPException(409, "Corre supabase/migrations/007_scenarios_modulos.sql")

def _own(sb, uid: str, sid: str) -> dict:
  try:
    rows = sb.table("scn_scenarios").select("id,collection_id,slug,name").eq("id", sid) \
      .eq("collection_id", _col(sb, uid)).limit(1).execute().data
  except Exception as e:
    msg = str(e).lower()
    if "scn_scenarios" in msg or "relation" in msg or "schema cache" in msg:
      raise HTTPException(409, "Corre supabase/migrations/007_scenarios_modulos.sql")
    if "uuid" in msg or "syntax" in msg:
      raise HTTPException(404, "escenario no existe o no es tuyo")
    raise
  if not rows:
    raise HTTPException(404, "escenario no existe o no es tuyo")
  _need007(sb)
  return rows[0]

def _table_missing(e: Exception) -> bool:
  m = str(e).lower()
  return ("scn_" in m and ("relation" in m or "schema cache" in m)) or "007_scenarios" in str(e)

def _child(sb, uid: str, table: str, rid: str, idcol: str = "id") -> dict:
  rows = sb.table(table).select("*").eq(idcol, rid).limit(1).execute().data
  if not rows:
    raise HTTPException(404, "no existe")
  # verifica escenario dueno (tablas con scenario_id directo)
  if "scenario_id" in rows[0]:
    _own(sb, uid, rows[0]["scenario_id"])
  return rows[0]

# ---------- assets (fotos Cloudinary + backup Drive) ----------
class AssetSign(BaseModel):
  scenario_id: str
  kind: str = "cover"
  label: str = "img"

@router.post("/assets/sign")
def asset_sign(a: AssetSign, request: Request):
  uid = _uid(request)
  sb = _sb()
  scn = _own(sb, uid, a.scenario_id)
  try:
    import cloudinary.utils
  except ImportError:
    raise HTTPException(500, "cloudinary no instalado en API")
  cloud = os.getenv("CLOUDINARY_CLOUD_NAME", "")
  if not cloud or not os.getenv("CLOUDINARY_API_SECRET"):
    raise HTTPException(500, "CLOUDINARY_* sin configurar en api/.env")
  public_id = f"minibase/{uid[:8]}/scn/{scn['slug']}/{a.kind}/{a.label}"
  # OJO: firmar EXACTAMENTE lo que el navegador envia (sin exif) o Cloudinary rechaza
  # transformation = conversion de ENTRADA: guarda el original ya convertido a
  # WebP q90 en el cloud, independiente de lo que envie el navegador.
  params = {"timestamp": int(time.time()), "public_id": public_id,
            "eager": "f_webp,q_auto:good,w_1200,c_limit|f_webp,q_auto:eco,w_400,c_thumb",
            "transformation": "f_webp,q_90",
            "folder": f"minibase/{uid[:8]}/scn/{scn['slug']}/{a.kind}"}
  sig = cloudinary.utils.api_sign_request(params, os.getenv("CLOUDINARY_API_SECRET", ""))
  return {**params, "signature": sig, "api_key": os.getenv("CLOUDINARY_API_KEY", ""),
          "cloud_name": cloud,
          "upload_url": f"https://api.cloudinary.com/v1_1/{cloud}/image/upload"}

class AssetComplete(BaseModel):
  scenario_id: str
  kind: str = "cover"
  label: Optional[str] = None
  cloudinary_public_id: str
  secure_url: str
  backup_url: Optional[str] = None
  mime_type: Optional[str] = None
  file_size: Optional[int] = None
  width: Optional[int] = None
  height: Optional[int] = None

@router.post("/assets/complete")
def asset_complete(a: AssetComplete, request: Request):
  uid = _uid(request)
  sb = _sb()
  _own(sb, uid, a.scenario_id)
  try:
    row = sb.table("scn_assets").insert({
      "scenario_id": a.scenario_id, "kind": a.kind, "label": a.label,
      "cloudinary_public_id": a.cloudinary_public_id, "secure_url": a.secure_url,
      "backup_url": a.backup_url, "mime_type": a.mime_type or "image/webp",
      "file_size": a.file_size, "width": a.width, "height": a.height}).execute().data[0]
  except Exception as e:
    if "scn_assets" in str(e) or "relation" in str(e):
      raise HTTPException(409, "Corre supabase/migrations/007_scenarios_modulos.sql")
    raise HTTPException(500, f"no se pudo guardar: {e}")
  return row

@router.get("/assets")
def asset_list(request: Request, scenario_id: str = "", kind: str = ""):
  uid = _uid(request)
  sb = _sb()
  _need007(sb)
  q = sb.table("scn_assets").select("*")
  if scenario_id:
    _own(sb, uid, scenario_id)
    q = q.eq("scenario_id", scenario_id)
  else:
    # solo mis escenarios
    sids = [r["id"] for r in sb.table("scn_scenarios").select("id")
            .eq("collection_id", _col(sb, uid)).execute().data or []]
    if not sids:
      return {"items": []}
    q = q.in_("scenario_id", sids)
  if kind:
    q = q.eq("kind", kind)
  try:
    rows = q.order("created_at").execute().data or []
  except Exception as e:
    if "scn_assets" in str(e) or "relation" in str(e):
      raise HTTPException(409, "Corre supabase/migrations/007_scenarios_modulos.sql")
    raise
  return {"items": rows}

@router.delete("/assets/{aid}")
def asset_delete(aid: str, request: Request):
  uid = _uid(request)
  sb = _sb()
  row = _child(sb, uid, "scn_assets", aid)  # select * -> incluye cloudinary_public_id
  sb.table("scn_assets").delete().eq("id", aid).execute()
  from services.cloudinary_ops import destroy_asset
  ok = destroy_asset(row.get("cloudinary_public_id"))
  return {"deleted": aid, "cloudinary_deleted": ok}

class BackupIn(BaseModel):
  image_id: str
  backup_url: str

@router.post("/assets/backup")
def asset_backup(b: BackupIn, request: Request):
  uid = _uid(request)
  sb = _sb()
  _child(sb, uid, "scn_assets", b.image_id)
  sb.table("scn_assets").update({"backup_url": b.backup_url}).eq("id", b.image_id).execute()
  return {"image_id": b.image_id, "backup_url": b.backup_url}

# ---------- minis/escenografia para montajes ----------
@router.get("/minis")
def scn_minis(request: Request, q: str = "", type: str = "", limit: int = 50):
  from services import db as _db
  uid = _uid(request)
  sb = _db.client()
  col_id = _col(sb, uid)
  query = sb.table("miniatures").select("id,name,type").eq("collection_id", col_id).order("name")
  if type:
    query = query.eq("type", type)
  if q:
    query = query.ilike("name", f"%{q}%")
  return {"items": query.limit(min(limit, 100)).execute().data or []}

# ---------- partes ----------
class PartIn(BaseModel):
  scenario_id: str
  name: str
  kind: str = "suelo"
  w_tiles: Optional[float] = None
  d_tiles: Optional[float] = None
  colors: list[str] = []
  texture: Optional[str] = None
  asset_id: Optional[str] = None
  notes: Optional[str] = None

@router.get("/parts")
def parts_list(request: Request, scenario_id: str = ""):
  uid = _uid(request)
  sb = _sb()
  _need007(sb)
  q = sb.table("scn_parts").select("*")
  if scenario_id:
    _own(sb, uid, scenario_id)
    q = q.eq("scenario_id", scenario_id)
  else:
    sids = [r["id"] for r in sb.table("scn_scenarios").select("id")
            .eq("collection_id", _col(sb, uid)).execute().data or []]
    if not sids:
      return {"items": []}
    q = q.in_("scenario_id", sids)
  return {"items": q.order("name").execute().data or []}

@router.post("/parts")
def part_create(p: PartIn, request: Request):
  uid = _uid(request)
  sb = _sb()
  _own(sb, uid, p.scenario_id)
  if not p.name.strip():
    raise HTTPException(400, "name requerido")
  try:
    return sb.table("scn_parts").insert({
      "scenario_id": p.scenario_id, "name": p.name.strip(), "kind": p.kind,
      "w_tiles": p.w_tiles, "d_tiles": p.d_tiles, "colors": p.colors,
      "texture": p.texture, "asset_id": p.asset_id, "notes": p.notes}).execute().data[0]
  except Exception as e:
    if "duplicate" in str(e).lower() or "unique" in str(e).lower():
      raise HTTPException(409, "ya existe esa parte")
    raise HTTPException(500, f"no se pudo crear: {e}")

@router.delete("/parts/{pid}")
def part_delete(pid: str, request: Request):
  uid = _uid(request)
  sb = _sb()
  _child(sb, uid, "scn_parts", pid)
  sb.table("scn_parts").delete().eq("id", pid).execute()
  return {"deleted": pid}

# ---------- tile presets ----------
class TileIn(BaseModel):
  scenario_id: str
  name: str
  cols: int = 12
  rows: int = 8
  grid: list = []
  schema_version: int = 1

@router.get("/tiles")
def tiles_list(request: Request, scenario_id: str = ""):
  uid = _uid(request)
  sb = _sb()
  if not scenario_id:
    raise HTTPException(400, "scenario_id requerido")
  _own(sb, uid, scenario_id)
  return {"items": sb.table("scn_tile_presets").select("*").eq("scenario_id", scenario_id)
          .order("name").execute().data or []}

@router.post("/tiles")
def tile_create(t: TileIn, request: Request):
  uid = _uid(request)
  sb = _sb()
  _own(sb, uid, t.scenario_id)
  try:
    return sb.table("scn_tile_presets").insert({
      "scenario_id": t.scenario_id, "name": t.name.strip(), "cols": t.cols,
      "rows": t.rows, "grid": t.grid, "schema_version": t.schema_version}).execute().data[0]
  except Exception as e:
    if "duplicate" in str(e).lower() or "unique" in str(e).lower():
      raise HTTPException(409, "ya existe ese preset")
    raise HTTPException(500, f"no se pudo guardar: {e}")

@router.delete("/tiles/{tid}")
def tile_delete(tid: str, request: Request):
  uid = _uid(request)
  sb = _sb()
  _child(sb, uid, "scn_tile_presets", tid)
  sb.table("scn_tile_presets").delete().eq("id", tid).execute()
  return {"deleted": tid}

# ---------- montajes ----------
class MountIn(BaseModel):
  scenario_id: str
  name: str
  notes: Optional[str] = None

class MountItemIn(BaseModel):
  kind: str = "mini"
  ref_id: Optional[str] = None
  x: float = 0
  y: float = 0
  z: float = 0
  rot: float = 0

@router.get("/mounts")
def mounts_list(request: Request, scenario_id: str = ""):
  uid = _uid(request)
  sb = _sb()
  if not scenario_id:
    raise HTTPException(400, "scenario_id requerido")
  _own(sb, uid, scenario_id)
  mounts = sb.table("scn_mounts").select("*").eq("scenario_id", scenario_id) \
    .order("name").execute().data or []
  for m in mounts:
    m["items"] = sb.table("scn_mount_items").select("*").eq("mount_id", m["id"]) \
      .execute().data or []
  return {"items": mounts}

@router.post("/mounts")
def mount_create(m: MountIn, request: Request):
  uid = _uid(request)
  sb = _sb()
  _own(sb, uid, m.scenario_id)
  return sb.table("scn_mounts").insert(
    {"scenario_id": m.scenario_id, "name": m.name.strip(), "notes": m.notes}) \
    .execute().data[0]

@router.delete("/mounts/{mid}")
def mount_delete(mid: str, request: Request):
  uid = _uid(request)
  sb = _sb()
  r = _child(sb, uid, "scn_mounts", mid)
  _own(sb, uid, r["scenario_id"])
  sb.table("scn_mounts").delete().eq("id", mid).execute()
  return {"deleted": mid}

@router.post("/mounts/{mid}/items")
def mount_item_add(mid: str, it: MountItemIn, request: Request):
  uid = _uid(request)
  sb = _sb()
  r = _child(sb, uid, "scn_mounts", mid)
  _own(sb, uid, r["scenario_id"])
  if it.kind not in ("mini", "scenery", "part"):
    raise HTTPException(400, "kind: mini|scenery|part")
  return sb.table("scn_mount_items").insert(
    {"mount_id": mid, "kind": it.kind, "ref_id": it.ref_id, "x": it.x,
     "y": it.y, "z": it.z, "rot": it.rot}).execute().data[0]

@router.delete("/mounts/items/{iid}")
def mount_item_del(iid: str, request: Request):
  uid = _uid(request)
  sb = _sb()
  it = sb.table("scn_mount_items").select("*").eq("id", iid).limit(1).execute().data
  if not it:
    raise HTTPException(404, "no existe")
  m = _child(sb, uid, "scn_mounts", it[0]["mount_id"])
  _own(sb, uid, m["scenario_id"])
  sb.table("scn_mount_items").delete().eq("id", iid).execute()
  return {"deleted": iid}

@router.post("/mounts/{mid}/combine")
def mount_combine(mid: str, request: Request):
  """Compone PNG por capas (base + assets de partes en grilla) -> Cloudinary."""
  uid = _uid(request)
  sb = _sb()
  m = _child(sb, uid, "scn_mounts", mid)
  scn = _own(sb, uid, m["scenario_id"])
  try:
    from PIL import Image
    import io as _io
    import urllib.request as _url
    import cloudinary.uploader
  except ImportError:
    raise HTTPException(500, "falta Pillow/cloudinary en API (pip install pillow cloudinary)")
  items = sb.table("scn_mount_items").select("*").eq("mount_id", mid).execute().data or []
  W, H = 1200, 800
  canvas = Image.new("RGB", (W, H), (10, 10, 12))
  # capas: assets de partes referenciadas, en grilla 4 cols
  thumbs = []
  for it in items:
    if it["kind"] == "part" and it.get("ref_id"):
      p = sb.table("scn_parts").select("asset_id").eq("id", it["ref_id"]).limit(1).execute().data
      if p and p[0].get("asset_id"):
        a = sb.table("scn_assets").select("secure_url").eq("id", p[0]["asset_id"]).limit(1).execute().data
        if a:
          thumbs.append(a[0]["secure_url"])
  import math
  cols = max(1, math.ceil(math.sqrt(max(1, len(thumbs)))))
  cw = W // max(1, cols)
  for i, u in enumerate(thumbs[:16]):
    try:
      im = Image.open(_url.urlopen(u, timeout=20)).convert("RGB")
      im.thumbnail((cw, H // max(1, math.ceil(len(thumbs) / cols))))
      canvas.paste(im, ((i % cols) * cw, (i // cols) * (H // max(1, math.ceil(len(thumbs) / cols)))))
    except Exception:
      continue
  buf = _io.BytesIO()
  canvas.save(buf, format="PNG")
  buf.seek(0)
  cloudinary.config(cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
                    api_key=os.getenv("CLOUDINARY_API_KEY"),
                    api_secret=os.getenv("CLOUDINARY_API_SECRET"))
  up = cloudinary.uploader.upload(
    buf, public_id=f"minibase/{uid[:8]}/scn/{scn['slug']}/montaje/{m['name'][:40]}",
    resource_type="image", format="webp")
  webp = up.get("secure_url", "")
  sb.table("scn_mounts").update({"composed_url": webp}).eq("id", mid).execute()
  sb.table("scn_assets").insert({
    "scenario_id": scn["id"], "kind": "montaje",
    "label": m["name"], "cloudinary_public_id": up.get("public_id"),
    "secure_url": webp, "mime_type": "image/webp"}).execute()
  return {"composed_url": webp}

# ---------- iluminacion ----------
class LightIn(BaseModel):
  scenario_id: str
  name: str
  mood: str = "dia"
  params: dict = {}
  projector_payload: dict = {}
  asset_id: Optional[str] = None

@router.get("/lighting")
def light_list(request: Request, scenario_id: str = ""):
  uid = _uid(request)
  sb = _sb()
  if not scenario_id:
    raise HTTPException(400, "scenario_id requerido")
  _own(sb, uid, scenario_id)
  return {"items": sb.table("scn_lightings").select("*").eq("scenario_id", scenario_id)
          .order("name").execute().data or []}

@router.post("/lighting")
def light_create(p: LightIn, request: Request):
  uid = _uid(request)
  sb = _sb()
  _own(sb, uid, p.scenario_id)
  if p.mood not in ("dia", "atardecer", "noche", "niebla", "custom"):
    raise HTTPException(400, "mood invalido")
  return sb.table("scn_lightings").insert({
    "scenario_id": p.scenario_id, "name": p.name.strip(), "mood": p.mood,
    "params": p.params, "projector_payload": p.projector_payload,
    "asset_id": p.asset_id}).execute().data[0]

@router.delete("/lighting/{lid}")
def light_delete(lid: str, request: Request):
  uid = _uid(request)
  sb = _sb()
  _child(sb, uid, "scn_lightings", lid)
  sb.table("scn_lightings").delete().eq("id", lid).execute()
  return {"deleted": lid}

# ---------- audio ----------
class AudioIn(BaseModel):
  scenario_id: str
  kind: str = "soundtrack"
  genre: Optional[str] = None
  zone: Optional[str] = None
  title: str = ""
  url: Optional[str] = None
  duration_s: Optional[float] = None

@router.get("/audios")
def audio_list(request: Request, scenario_id: str = ""):
  uid = _uid(request)
  sb = _sb()
  if not scenario_id:
    raise HTTPException(400, "scenario_id requerido")
  _own(sb, uid, scenario_id)
  return {"items": sb.table("scn_audios").select("*").eq("scenario_id", scenario_id)
          .order("title").execute().data or []}

@router.post("/audios")
def audio_create(a: AudioIn, request: Request):
  uid = _uid(request)
  sb = _sb()
  _own(sb, uid, a.scenario_id)
  if a.kind not in ("soundtrack", "sfx"):
    raise HTTPException(400, "kind: soundtrack|sfx")
  if not a.title.strip():
    raise HTTPException(400, "title requerido")
  return sb.table("scn_audios").insert({
    "scenario_id": a.scenario_id, "kind": a.kind, "genre": a.genre, "zone": a.zone,
    "title": a.title.strip(), "url": a.url, "duration_s": a.duration_s}).execute().data[0]

@router.delete("/audios/{aid}")
def audio_delete(aid: str, request: Request):
  uid = _uid(request)
  sb = _sb()
  _child(sb, uid, "scn_audios", aid)
  sb.table("scn_audios").delete().eq("id", aid).execute()
  return {"deleted": aid}
