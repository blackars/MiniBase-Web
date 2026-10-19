"""P1: CRUD miniaturas + completeness + firma Cloudinary."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
try:
  from slugify import slugify
except ImportError:
  def slugify(s: str) -> str:
    import re, unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
import os, time, uuid
try:
  import cloudinary.utils
  HAS_CLOUDINARY = True
except ImportError:
  HAS_CLOUDINARY = False

router = APIRouter()

# Tienda local para probar HOY sin Supabase (persiste en demo_store.json).
# Luego se cambia por Supabase+RLS sin cambiar el frontend.
DEMO_STORE: dict = {}
try:
  import json, pathlib
  _p = pathlib.Path(__file__).parent.parent / "demo_store.json"
  if _p.exists():
    for _r in json.loads(_p.read_text(encoding="utf-8")):
      DEMO_STORE[_r["id"]] = _r
except Exception:
  pass

def _norm(s) -> str:
  import unicodedata
  return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()

class MiniIn(BaseModel):
  collection_id: str
  name: str
  type: str = "mini"  # mini|scenery|token|tile|prop
  quantity: int = 1
  shape: Optional[str] = None
  bioform: Optional[str] = None
  material: Optional[str] = None
  main_color: Optional[str] = None
  secondary_color: Optional[str] = None
  weight_g: Optional[float] = None
  height_mm: Optional[float] = None
  radius_of_base_mm: Optional[float] = None
  diameter_mm: Optional[float] = None
  scale: Optional[str] = "28mm"
  tags: list[str] = []
  designer: Optional[str] = None
  painted_by: Optional[str] = None
  label: Optional[str] = None
  lore_is_canon: Optional[bool] = None
  comment: Optional[str] = None
  story: Optional[str] = None
  character_origin: Optional[str] = None
  year: Optional[str] = None
  code_or_reference: Optional[str] = None
  url: Optional[str] = None
  system: Optional[str] = None
  faction: Optional[str] = None
  stats: dict = {}
  # Campos IA (009): DM agéntico + proyector. Todos opcionales.
  size_category: Optional[str] = None  # tiny|small|medium|large|huge|gargantuan
  paint_status: Optional[str] = None  # sin_pintar|base|avanzado|terminada
  aliases: list[str] = []
  grid_cells: int = 1
  role: Optional[str] = None
  play_count: int = 0
  is_favorite: Optional[bool] = None

SIZE_CATEGORIES = ["tiny", "small", "medium", "large", "huge", "gargantuan"]
PAINT_STATES = ["sin_pintar", "base", "avanzado", "terminada"]

def completeness(m: MiniIn) -> int:
  # Ponderación simple P1 (luego agent_tasks la recalcula)
  score, total = 0, 0
  weights = {"name":15,"tags":12,"bioform":8,"shape":6,"height_mm":6,"weight_g":6,
             "material":6,"main_color":6,"images":20,"story":8,"url":7}
  total = sum(weights.values())
  if m.name: score += weights["name"]
  if m.tags: score += weights["tags"]
  if m.bioform: score += weights["bioform"]
  if m.shape: score += weights["shape"]
  if m.height_mm: score += weights["height_mm"]
  if m.weight_g: score += weights["weight_g"]
  if m.material: score += weights["material"]
  if m.main_color: score += weights["main_color"]
  if m.story: score += weights["story"]
  if m.url: score += weights["url"]
  # images se suma en frontend tras upload; aquí 0
  return round(100*score/total)

def _use_sb() -> bool:
  try:
    from services import db as _db
    return _db.is_configured()
  except Exception:
    return False

def _caller_uid(request) -> str | None:
  """JWT del frontend. None = sin login (solo permitido sin Supabase configurado)."""
  try:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
      return None
    token = auth.split(" ", 1)[1].strip()
    if not token:
      return None
    from services import db as _db
    return _db.user_id_from_token(token)
  except Exception as e:
    print(f"[minis] token inválido: {e}")
    return None

def _require_uid(request) -> str:
  """Solo tú: con Supabase configurado, sin token válido → 401."""
  uid = _caller_uid(request)
  if _use_sb() and not uid:
    raise HTTPException(401, "login requerido")
  return uid

@router.get("/facets/tags")
def tag_facets(request: Request, type: str = ""):
  if _use_sb():
    uid = _require_uid(request)
    try:
      from services import db as _db
      return {"tags": _db.sb_tag_facets(user_id=uid, ftype=type)}
    except HTTPException:
      raise
    except Exception as e:
      raise HTTPException(500, f"facets falló: {e}")
  return {"tags": []}

FILTERABLE = ["main_color", "secondary_color", "bioform", "material", "height_mm",
              "radius_of_base_mm", "diameter_mm", "designer", "painted_by", "label",
              "character_origin", "year", "size_category", "paint_status"]

@router.get("/stats")
def collection_stats(request: Request):
  """Conteo principal por TIPOS únicos + total de piezas (suma quantity).
  La lista es paginada; este endpoint da los totales en vivo para el header."""
  if _use_sb():
    uid = _require_uid(request)
    try:
      from services import db as _db
      return _db.sb_stats(user_id=uid)
    except HTTPException:
      raise
    except Exception as e:
      raise HTTPException(500, f"stats falló: {e}")
  n = len(DEMO_STORE)
  piezas = sum(int((v.get("quantity") or 1)) for v in DEMO_STORE.values())
  return {"tipos": n, "piezas": piezas, "por_tipo": {}, "mode": "demo-local"}

@router.get("/facets/fields")
def field_facets(request: Request):
  if _use_sb():
    uid = _require_uid(request)
    try:
      from services import db as _db
      return {"fields": _db.sb_field_facets(user_id=uid)}
    except HTTPException:
      raise
    except Exception as e:
      raise HTTPException(500, f"field facets falló: {e}")
  return {"fields": {}}

@router.get("")
def list_minis(request: Request, collection_id: str = "default", q: str = "",
               type: str = "", tag: str = "", tags: str = "",
               page: int = 1, page_size: int = 24,
               main_color: str = "", secondary_color: str = "", bioform: str = "",
               material: str = "", height_mm: str = "", radius_of_base_mm: str = "",
               diameter_mm: str = "",
               designer: str = "", painted_by: str = "", label: str = "",
               character_origin: str = "", year: str = "",
               size_category: str = "", paint_status: str = "", grid_cells: str = ""):
  page = max(1, page)
  page_size = min(100, max(1, page_size))
  tag_list = [t.strip() for t in (tags.split(",") if tags else ([tag] if tag else [])) if t.strip()]
  filters = {k: v for k, v in {
    "main_color": main_color, "secondary_color": secondary_color, "bioform": bioform,
    "material": material, "height_mm": height_mm, "radius_of_base_mm": radius_of_base_mm,
    "diameter_mm": diameter_mm,
    "designer": designer, "painted_by": painted_by, "label": label,
    "character_origin": character_origin, "year": year}.items() if v}
  # Filtros directos sobre la tabla miniatures (no requieren joins).
  direct = {k: v for k, v in {
    "size_category": size_category, "paint_status": paint_status}.items() if v}
  if grid_cells:
    try:
      direct["grid_cells"] = int(grid_cells)
    except (TypeError, ValueError):
      pass
  if _use_sb():
    try:
      from services import db as _db
      uid = _require_uid(request)
      res = _db.sb_list_minis(q=q, ftype=type, tags=tag_list,
                              page=page, page_size=page_size, user_id=uid,
                              filters=filters, direct=direct)
      return {"collection_id": collection_id, "q": q, "items": res["items"],
              "total": res["total"], "page": page, "page_size": page_size,
              "mode": "supabase"}
    except HTTPException:
      raise
    except Exception as e:
      print(f"[minis] sb_list fallback: {e}")
  items = list(DEMO_STORE.values())
  if q:
    ql = _norm(q)
    items = [x for x in items if ql in _norm(x.get("name","")) or ql in _norm(x.get("tags",[])) or ql in _norm(x.get("story",""))]
  if type:
    items = [x for x in items if x.get("type") == type]
  if tag_list:
    items = [x for x in items if any(t in (x.get("tags") or []) for t in tag_list)]
  for k, v in filters.items():
    def _match(x, k=k, v=v):
      xv = x.get(k)
      if xv in (None, ""):
        return False
      try:
        return float(xv) == float(v)
      except (TypeError, ValueError):
        return str(xv) == v
    items = [x for x in items if _match(x)]
  for k, v in direct.items():
    items = [x for x in items if str(x.get(k) or "") == str(v)]
  total = len(items)
  return {"collection_id": collection_id, "q": q,
          "items": items[(page - 1) * page_size:page * page_size],
          "total": total, "page": page, "page_size": page_size, "mode": "demo-local"}

@router.post("")
def create_mini(m: MiniIn, request: Request):
  if not m.name.strip(): raise HTTPException(400, "name requerido")
  slug = slugify(m.name)
  payload = {"slug": slug, "completeness_score": completeness(m), **m.model_dump()}
  if _use_sb():
    uid = _require_uid(request)
    try:
      from services import db as _db
      return _db.sb_create_mini(payload, user_id=uid)
    except HTTPException:
      raise
    except Exception as e:
      print(f"[minis] sb_create error: {e}")
      raise HTTPException(500, f"Supabase falló tras 3 intentos: {e}")
  mid = str(uuid.uuid4())
  rec = {"id": mid, **payload}
  DEMO_STORE[mid] = rec
  try:
    import json, pathlib
    p = pathlib.Path(__file__).parent.parent / "demo_store.json"
    p.write_text(json.dumps(list(DEMO_STORE.values()), ensure_ascii=False, indent=2), encoding="utf-8")
  except Exception:
    pass
  return rec

@router.get("/{mini_id}")
def get_mini(mini_id: str, request: Request):
  if _use_sb():
    uid = _require_uid(request)
    try:
      from services import db as _db
      return _db.sb_get_mini(mini_id, user_id=uid)
    except HTTPException:
      raise
    except Exception as e:
      print(f"[minis] sb_get fallback: {e}")
  if mini_id in DEMO_STORE:
    return DEMO_STORE[mini_id]
  raise HTTPException(404, "no existe")

@router.put("/{mini_id}")
def update_mini(mini_id: str, m: MiniIn, request: Request):
  if not m.name.strip(): raise HTTPException(400, "name requerido")
  payload = {"slug": slugify(m.name), "completeness_score": completeness(m), **m.model_dump()}
  if _use_sb():
    uid = _require_uid(request)
    try:
      from services import db as _db
      return _db.sb_update_mini(mini_id, payload, user_id=uid)
    except HTTPException:
      raise
    except AssertionError as e:
      raise HTTPException(403, str(e))
    except Exception as e:
      print(f"[minis] sb_update error: {e}")
      raise HTTPException(500, f"Supabase falló tras 3 intentos: {e}")
  if mini_id not in DEMO_STORE:
    raise HTTPException(404, "no existe")
  rec = {"id": mini_id, **payload}
  DEMO_STORE[mini_id] = rec
  try:
    import json, pathlib
    p = pathlib.Path(__file__).parent.parent / "demo_store.json"
    p.write_text(json.dumps(list(DEMO_STORE.values()), ensure_ascii=False, indent=2), encoding="utf-8")
  except Exception:
    pass
  return rec

@router.delete("/{mini_id}")
def delete_mini(mini_id: str, request: Request):
  if _use_sb():
    uid = _require_uid(request)
    try:
      from services import db as _db
      from services.cloudinary_ops import cleanup_assets
      # captura los assets reales en Cloudinary ANTES del cascade de Supabase
      public_ids: list[str] = []
      try:
        sb = _db.client()
        rows = sb.table("images").select("cloudinary_public_id") \
          .eq("miniature_id", mini_id).execute().data or []
        public_ids = [r["cloudinary_public_id"] for r in rows
                      if r.get("cloudinary_public_id")]
      except Exception:
        pass
      _db.sb_delete_mini(mini_id, user_id=uid)
      # borra los archivos (y derivados) de Cloudinary, no solo las filas
      cleaned = cleanup_assets(public_ids)
      return {"deleted": mini_id, "mode": "supabase", "cloudinary_deleted": cleaned,
              "cloudinary_expected": len(public_ids)}
    except HTTPException:
      raise
    except AssertionError as e:
      raise HTTPException(403, str(e))
    except Exception as e:
      print(f"[minis] sb_delete error: {e}")
      raise HTTPException(500, f"Supabase falló: {e}")
  if mini_id in DEMO_STORE:
    del DEMO_STORE[mini_id]
    return {"deleted": mini_id}
  raise HTTPException(404, "no existe")

@router.get("/{mini_id}/dataset")
def get_dataset(mini_id: str, request: Request):
  """Dataset para el DM/CV: ficha + campos IA + vistas + embedding.
  El DM narra solo con lo que hay aquí (inventario real)."""
  if _use_sb():
    uid = _require_uid(request)
    try:
      from services import db as _db
      m = _db.sb_get_mini(mini_id, user_id=uid)
      sb = _db.client()
      views = []
      emb = None
      try:
        views = (sb.table("images").select(
          "view_type,secure_url,width,height,phash")
          .eq("miniature_id", mini_id).execute().data) or []
        erow = (sb.table("miniatures").select("embedding")
                .eq("id", mini_id).limit(1).execute().data or [{}])[0]
        emb = erow.get("embedding")
      except Exception as e:
        print(f"[dataset] views/embedding: {e}")
      return {"mini_id": mini_id, "ficha": m,
              "ia": {k: m.get(k) for k in
                     ("size_category", "paint_status", "aliases", "grid_cells",
                      "role", "system", "faction", "play_count", "is_favorite")},
              "views": views, "embedding": emb, "mode": "supabase"}
    except HTTPException:
      raise
    except Exception as e:
      raise HTTPException(500, f"dataset falló: {e}")
  if mini_id in DEMO_STORE:
    return {"mini_id": mini_id, "ficha": DEMO_STORE[mini_id],
            "views": [], "embedding": None, "mode": "demo-local"}
  raise HTTPException(404, "no existe")

@router.post("/{mini_id}/images/sign")
def sign_image(mini_id: str, request: Request, view_type: str = "frontal", collection: str = "default", slug: str = "mini", user: str = "demo"):
  if _use_sb():
    _require_uid(request)
  cloud = os.getenv("CLOUDINARY_CLOUD_NAME", "")
  if not cloud or not HAS_CLOUDINARY:
    # Modo demo: devuelve public_id esperado sin firmar, para probar flujo sin claves
    return {"mode": "demo-local", "demo": True,
            "public_id": f"minibase/{user}/{collection}/{slug}/{view_type}",
            "note": "Pon CLOUDINARY_* en api/.env para firma real"}
  public_id = f"minibase/{user}/{collection}/{slug}/{view_type}"
  # Pipeline WebP en 2 capas:
  #   1) transformation = conversión de ENTRADA firmada: cloudinary convierte y
  #      guarda el original como WebP calidad 90 (pérdida < 10%) SIEMPRE, sin
  #      depender de que el navegador haya convertido el archivo antes.
  #   2) eager = derivados de mostrar (detalle + thumb).
  # La web guarda la URL WebP del derivado como secure_url canónica.
  eager = ("f_webp,q_auto:good,w_800,c_limit|"
           "f_webp,q_auto:eco,w_200,c_thumb")
  params = {"timestamp": int(time.time()), "public_id": public_id,
            "eager": eager,
            "transformation": "f_webp,q_90",
            "folder": f"minibase/{user}/{collection}/{slug}"}
  # NOTA: no agregar params extra (ej. exif): Cloudinary los ignora al verificar
  # y la firma deja de coincidir -> "Invalid Signature".
  sig = cloudinary.utils.api_sign_request(params, os.getenv("CLOUDINARY_API_SECRET", ""))
  return {**params, "signature": sig,
          "api_key": os.getenv("CLOUDINARY_API_KEY", ""), "cloud_name": cloud,
          "upload_url": f"https://api.cloudinary.com/v1_1/{cloud}/image/upload"}
