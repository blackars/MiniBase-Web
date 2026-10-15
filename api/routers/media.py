"""③ Galería híbrida: Cloudinary (hot, WebP) + Drive (bóveda fría).

Roles: photo = entrenamiento CV / referencia = NO entrena (render_3d,
concept_art, paint_reference) / video. Las sintéticas etiquetadas NO se
suben aquí. Requiere login; propiedad verificada por colección.
Requiere migración 003 (role + nuevos view_type); sin ella, las vistas
nuevas devuelven 409 con instrucción.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

REFERENCE_VIEWS = {"render_3d", "concept_art", "paint_reference"}
VIDEO_VIEWS = {"video_gif", "model_3d"}

def _role_of(view_type: str) -> str:
  if view_type in VIDEO_VIEWS:
    return "video"
  if view_type in REFERENCE_VIEWS:
    return "reference"
  return "photo"

def _uid(request: Request) -> str:
  from services import db as _db
  auth = request.headers.get("authorization", "")
  if not auth.lower().startswith("bearer "):
    raise HTTPException(401, "login requerido")
  try:
    return _db.user_id_from_token(auth.split(" ", 1)[1].strip())
  except Exception:
    raise HTTPException(401, "token inválido")

def _own_mini(sb, uid: str, mid: str) -> dict:
  col_id, _ = sb_col(sb, uid)
  rows = sb.table("miniatures").select("id,collection_id,slug").eq("id", mid).limit(1).execute().data
  if not rows or rows[0]["collection_id"] != col_id:
    raise HTTPException(403, "no es tuya")
  return rows[0]

def sb_col(sb, uid: str):
  col = sb.table("collections").select("id").eq("user_id", uid).limit(1).execute().data
  assert col, "sin colección"
  return col[0]["id"], uid

class ImageComplete(BaseModel):
  miniature_id: str
  view_type: str = "frontal"
  cloudinary_public_id: str
  secure_url: str
  backup_url: Optional[str] = None
  mime_type: Optional[str] = None
  file_size: Optional[int] = None
  width: Optional[int] = None
  height: Optional[int] = None

@router.get("/by-mini/{mini_id}")
def list_images(mini_id: str, request: Request):
  from services import db as _db
  uid = _uid(request)
  sb = _db.client()
  _own_mini(sb, uid, mini_id)
  try:
    rows = sb.table("images").select("*").eq("miniature_id", mini_id) \
      .order("created_at").execute().data or []
  except Exception:
    rows = []
  photos = [r for r in rows if (r.get("role") or "photo") == "photo"]
  refs = [r for r in rows if (r.get("role") or "") == "reference"]
  videos = [r for r in rows if (r.get("role") or "") == "video"]
  return {"miniature_id": mini_id, "photos": photos, "references": refs,
          "videos": videos, "cv_ready": len(photos) >= 3}

class CoversIn(BaseModel):
  ids: list[str] = []

@router.post("/covers")
def covers(c: CoversIn, request: Request):
  """Portada por mini en 1 query: frontal > render_3d > concept_art > 1ra foto."""
  from services import db as _db
  uid = _uid(request)
  sb = _db.client()
  ids = (c.ids or [])[:200]
  if not ids:
    return {"covers": {}}
  col = sb.table("collections").select("id").eq("user_id", uid).limit(1).execute().data
  if not col:
    return {"covers": {}}
  col_id = col[0]["id"]
  mine = sb.table("miniatures").select("id").eq("collection_id", col_id) \
    .in_("id", ids).execute().data or []
  mine_ids = [r["id"] for r in mine]
  if not mine_ids:
    return {"covers": {}}
  rows = sb.table("images").select("miniature_id,view_type,secure_url,role") \
    .in_("miniature_id", mine_ids).order("created_at").execute().data or []
  order = {"frontal": 0, "render_3d": 1, "concept_art": 2}
  best: dict = {}
  for r in rows:
    mid = r["miniature_id"]
    rank = order.get(r.get("view_type"), 3)
    if mid not in best or rank < best[mid][0]:
      best[mid] = (rank, r["secure_url"])
  return {"covers": {mid: url for mid, (_, url) in best.items()}}

@router.post("/complete")
def complete_image(img: ImageComplete, request: Request):
  from services import db as _db
  uid = _uid(request)
  sb = _db.client()
  _own_mini(sb, uid, img.miniature_id)
  role = _role_of(img.view_type)
  # idempotente por (mini, vista, public_id): re-subir la misma vista la reemplaza
  try:
    sb.table("images").delete().eq("miniature_id", img.miniature_id) \
      .eq("view_type", img.view_type) \
      .eq("cloudinary_public_id", img.cloudinary_public_id).execute()
  except Exception:
    pass
  try:
    row = sb.table("images").insert({
      "miniature_id": img.miniature_id, "view_type": img.view_type, "role": role,
      "cloudinary_public_id": img.cloudinary_public_id, "secure_url": img.secure_url,
      "backup_url": img.backup_url, "mime_type": img.mime_type,
      "file_size": img.file_size, "width": img.width,
      "height": img.height}).execute().data[0]
  except Exception as e:
    msg = str(e)
    if "check" in msg.lower() or "view_type" in msg.lower() or "role" in msg.lower():
      raise HTTPException(409, "Corre la migración supabase/migrations/003_paquete_editor.sql en Supabase (vistas por roles)")
    raise HTTPException(500, f"no se pudo guardar: {e}")
  return row

@router.delete("/{image_id}")
def delete_image(image_id: str, request: Request):
  from services import db as _db
  uid = _uid(request)
  sb = _db.client()
  rows = sb.table("images").select("id,miniature_id").eq("id", image_id).limit(1).execute().data
  if not rows:
    raise HTTPException(404, "no existe")
  _own_mini(sb, uid, rows[0]["miniature_id"])
  sb.table("images").delete().eq("id", image_id).execute()
  return {"deleted": image_id}

class BackupAttach(BaseModel):
  image_id: str
  backup_url: str  # enlace Drive de la bóveda fría (manual hasta OAuth Drive)

@router.post("/backup")
def attach_backup(b: BackupAttach, request: Request):
  from services import db as _db
  uid = _uid(request)
  sb = _db.client()
  rows = sb.table("images").select("id,miniature_id").eq("id", b.image_id).limit(1).execute().data
  if not rows:
    raise HTTPException(404, "no existe")
  _own_mini(sb, uid, rows[0]["miniature_id"])
  sb.table("images").update({"backup_url": b.backup_url}).eq("id", b.image_id).execute()
  return {"image_id": b.image_id, "backup_url": b.backup_url}
