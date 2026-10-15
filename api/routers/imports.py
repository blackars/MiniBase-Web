"""P2: carga por lotes desde Excel/CSV con el formato real del usuario.

- Acepta template.xlsx (21 cols) + `tags`, con alias ES/EN y tildes.
- Tolera campos faltantes, decimales con coma, tags con , ; |.
- Upsert por slug en LA colección del usuario logueado (nunca mezcla usuarios).
- Merge inteligente: lo entrante no-vacío pisa, lo vacío conserva (no borra
  lo enriquecido por el agente ni ediciones manuales).
- Reporta faltantes por campo (compatibilidad del formato) y los guarda en
  missing_fields para el agente de curación.
"""
from fastapi import APIRouter, UploadFile, HTTPException, Request
import pandas as pd
import io
import re
import unicodedata

try:
  from slugify import slugify
except ImportError:
  import re
  def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

router = APIRouter()

# Clasificación oficial de campos (para la UI y el agente)
GROUPS = {
  "identidad": ["name", "type", "quantity", "code_or_reference", "year", "url"],
  "fisico": ["shape", "bioform", "material", "main_color", "secondary_color",
             "weight_g", "height_mm", "radius_of_base_mm", "diameter_mm", "scale"],
  "narrativa": ["designer", "painted_by", "label", "lore_is_canon",
                "character_origin", "story", "comment"],
  "clasificacion": ["tags"],
  # agente (NO vienen de Excel: se calculan/generan):
  # completeness_score, embedding, rpg_profile, missing_fields, table_state
}
CANON = [c for g in GROUPS.values() for c in g]

def _norm(s: str) -> str:
  s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
  return "".join(ch for ch in s.lower() if ch.isalnum())

# alias normalizado -> canónico (ES/EN, con/sin tildes, singular/plural)
ALIASES = {
  "name": "name", "nombre": "name", "nombreminiatura": "name", "miniatura": "name",
  "mini": "name", "title": "name", "titulo": "name", "nombremodelo": "name",
  "token": "name",
  "type": "type", "tipo": "type", "tipopieza": "type", "categoria": "type",
  "category": "type", "clase": "type",
  "quantity": "quantity", "cantidad": "quantity", "qty": "quantity",
  "stock": "quantity", "unidades": "quantity",
  "maincolor": "main_color", "color": "main_color", "colorprincipal": "main_color",
  "colour": "main_color", "color1": "main_color", "colorprimario": "main_color",
  "secondarycolor": "secondary_color", "colorsecundario": "secondary_color",
  "colour2": "secondary_color", "color2": "secondary_color",
  "shape": "shape", "forma": "shape",
  "bioform": "bioform", "bioforma": "bioform", "especie": "bioform",
  "species": "bioform", "raza": "bioform",
  "material": "material",
  "weight": "weight_g", "weightg": "weight_g", "peso": "weight_g",
  "pesog": "weight_g", "grams": "weight_g", "gramos": "weight_g",
  "height": "height_mm", "heightmm": "height_mm", "altura": "height_mm",
  "alturamm": "height_mm", "alto": "height_mm",
  "radiusofbase": "radius_of_base_mm", "radius": "radius_of_base_mm",
  "radiusbase": "radius_of_base_mm", "radiusofbasemm": "radius_of_base_mm",
  "base": "radius_of_base_mm", "peana": "radius_of_base_mm",
  "basediameter": "radius_of_base_mm", "diametrobase": "radius_of_base_mm",
  "diameter": "diameter_mm", "diametro": "diameter_mm",
  "scale": "scale", "escala": "scale",
  "tags": "tags", "tag": "tags", "etiquetas": "tags", "etiqueta": "tags",
  "themes": "tags", "tematica": "tags", "universo": "tags", "faccion": "tags",
  "designer": "designer", "disenador": "designer", "autor": "designer",
  "sculptor": "designer", "escultor": "designer", "creador": "designer",
  "paintedby": "painted_by", "pintor": "painted_by", "pintado": "painted_by",
  "painter": "painted_by", "pintadopor": "painted_by",
  "label": "label", "marca": "label", "brand": "label", "sello": "label",
  "loreiscanon": "lore_is_canon", "canon": "lore_is_canon",
  "canonico": "lore_is_canon", "canonica": "lore_is_canon", "oficial": "lore_is_canon",
  "characterorigin": "character_origin", "origin": "character_origin",
  "origen": "character_origin", "origenpersonaje": "character_origin",
  "procedencia": "character_origin",
  "story": "story", "historia": "story", "lore": "story", "trasfondo": "story",
  "relato": "story", "descripcion": "story", "description": "story", "background": "story",
  "comment": "comment", "comentario": "comment", "comentarios": "comment",
  "notas": "comment", "notes": "comment", "observaciones": "comment",
  "year": "year", "ano": "year", "fecha": "year",
  "codeorreference": "code_or_reference", "code": "code_or_reference",
  "reference": "code_or_reference", "ref": "code_or_reference",
  "referencia": "code_or_reference", "codigo": "code_or_reference",
  "codeorreferene": "code_or_reference",
  "sku": "code_or_reference",
  "url": "url", "link": "url", "enlace": "url", "vinculo": "url",
}
GROUP_OF = {c: g for g, cols in GROUPS.items() for c in cols}

EMPTY_TOKENS = {"", "nan", "none", "null", "n/a", "na", "-", "--", "sin dato",
                "sindato", "unknown", "desconocido", "pendiente"}

def clean_str(v) -> str | None:
  if v is None:
    return None
  s = str(v).strip()
  if not s or _norm(s) in EMPTY_TOKENS:
    return None
  return s

def clean_num(v) -> float | None:
  s = clean_str(v)
  if s is None:
    return None
  s = s.replace(",", ".")
  import re
  m = re.search(r"-?\d+(\.\d+)?", s)
  return float(m.group(0)) if m else None

def clean_int(v) -> int | None:
  n = clean_num(v)
  return int(n) if n is not None else None

def clean_bool(v) -> bool | None:
  s = clean_str(v)
  if s is None:
    return None
  t = _norm(s)
  if t in ("1", "si", "yes", "true", "verdadero", "canon", "oficial", "y", "s"):
    return True
  if t in ("0", "no", "false", "falso", "n"):
    return False
  return None

def clean_tags(v) -> list[str]:
  from services.tags import canon_tag, is_junk
  s = clean_str(v)
  if s is None:
    return []
  import re
  parts = re.split(r"[,;|/]", s)
  out = []
  for p in parts:
    if is_junk(p):
      continue  # 'N/A'->'N','A', 'sin dato', letras sueltas…
    c = canon_tag(p)
    if c and c not in out:
      out.append(c)
  return out

def suggest_mapping(columns: list[str]) -> dict:
  """{col_original: {canon, confidence, group}} — confidence alta si alias exacto."""
  out = {}
  for c in columns:
    n = _norm(c)
    if n in ALIASES:
      canon = ALIASES[n]
      out[c] = {"canon": canon, "confidence": "high", "group": GROUP_OF[canon]}
    else:
      out[c] = {"canon": None, "confidence": "none", "group": None}
  return out

def _read_file(filename: str, raw: bytes):
  name = (filename or "").lower()
  if name.endswith(".csv"):
    return {"csv": pd.read_csv(io.BytesIO(raw), dtype=str, keep_default_na=False)}
  x = pd.ExcelFile(io.BytesIO(raw))
  return {s: pd.read_excel(x, sheet_name=s, dtype=str, keep_default_na=False)
          for s in x.sheet_names}

@router.post("/excel/preview")
async def preview(file: UploadFile):
  if not (file.filename or "").lower().endswith((".xlsx", ".xls", ".csv")):
    raise HTTPException(400, "solo .xlsx / .xls / .csv")
  raw = await file.read()
  try:
    sheets = _read_file(file.filename, raw)
  except Exception as e:
    raise HTTPException(400, f"no se pudo leer: {e}")
  import hashlib
  file_hash = hashlib.sha256(raw).hexdigest()
  out = {"filename": file.filename, "file_hash": file_hash, "sheets": {}}
  for sname, df in sheets.items():
    df.columns = [str(c).strip() for c in df.columns]
    # ignora filas totalmente vacías y columnas vacías SIN mapeo.
    # Las columnas vacías pero mapeadas (ej. code_or_reference aún sin datos)
    # se conservan para que aparezcan en el mapeo y en futuras cargas.
    df = df.loc[~(df == "").all(axis=1)]
    drop = [c for c in df.columns
            if (df[c] == "").all() and not suggest_mapping([c])[c]["canon"]]
    df = df.drop(columns=drop)
    out["sheets"][sname] = {
      "columns": df.columns.tolist(),
      "rows_detected": len(df),
      "mapping": suggest_mapping(df.columns.tolist()),
      "sample": df.head(5).to_dict(orient="records"),
    }
  out["canon_groups"] = GROUPS
  return out

@router.post("/excel/confirm")
async def confirm(payload: dict, request: Request):
  """Body: {sheet_rows: [...], mapping: {col_excel: canon}, dry_run: bool}.
  Requiere login (usa la colección del usuario)."""
  from services import db as _db
  from routers.minis import MiniIn, completeness
  if not _db.is_configured():
    raise HTTPException(500, "Supabase no configurado")
  auth = request.headers.get("authorization", "")
  if not auth.lower().startswith("bearer "):
    raise HTTPException(401, "login requerido")
  try:
    uid = _db.user_id_from_token(auth.split(" ", 1)[1].strip())
  except Exception:
    raise HTTPException(401, "token inválido")
  _db.get_user_collection(uid)  # crea 'Mi colección' al primer uso
  rows = payload.get("sheet_rows") or []
  mapping = payload.get("mapping") or {}
  dry_run = bool(payload.get("dry_run", False))
  file_hash = payload.get("file_hash") or ""
  job_token = payload.get("job_token") or ""
  filename = payload.get("filename") or ""
  chunk = payload.get("chunk") or {"index": 0, "total": 1}
  force = bool(payload.get("force", False))
  inv = {c: m for c, m in mapping.items() if m in CANON}

  col_id, _ = _db.get_user_collection(uid)
  sb = _db.client()

  def _jobs():
    q = sb.table("agent_tasks").select("*").eq("task_type", "import_excel") \
      .eq("collection_id", col_id).order("created_at", desc=True).limit(20).execute().data or []
    return q

  def _job_by_token():
    if not job_token:
      return None
    r = sb.table("agent_tasks").select("*").eq("task_type", "import_excel") \
      .eq("collection_id", col_id).execute().data or []
    for j in r:
      if (j.get("input") or {}).get("job_token") == job_token:
        return j
    return None

  # 1. Anti re-subida: mismo hash ya completado → devuelve resumen sin tocar nada
  if file_hash and not force and not dry_run:
    for j in _jobs():
      inp = j.get("input") or {}
      if inp.get("file_hash") == file_hash and j.get("status") == "done":
        out = j.get("output") or {}
        return {"already": True, "filename": inp.get("filename"),
                "finished_at": j.get("finished_at"), "summary": out.get("totals", {})}

  # 2. Ledger del job (chunks acumulan aquí; reanudable)
  job = _job_by_token()
  if not dry_run and not job:
    job = sb.table("agent_tasks").insert({
      "collection_id": col_id, "task_type": "import_excel", "status": "running",
      "input": {"file_hash": file_hash, "job_token": job_token, "filename": filename,
                "total_rows": payload.get("total_rows", len(rows))},
      "output": {"imported": 0, "updated": 0, "skipped": 0, "errors": [],
                 "missing_by_field": {}, "field_hits": {}, "n_valid": 0,
                 "seen_slugs": []}}).execute().data[0]
  acc = (job.get("output") or {}) if job else \
    {"imported": 0, "updated": 0, "skipped": 0, "errors": [],
     "missing_by_field": {}, "field_hits": {}, "n_valid": 0, "seen_slugs": []}
  seen_slugs = set(acc.get("seen_slugs", []))
  field_hits = {c: 0 for c in CANON}
  field_hits.update(acc.get("field_hits", {}) or {})
  n_valid = acc.get("n_valid", 0)
  # offset de filas: el frontend manda slices; i base = index*tamaño_slice
  base_i = chunk.get("index", 0) * len(rows) + 2 if chunk.get("total", 1) > 1 else 2

  report = {"imported": 0, "updated": 0, "skipped": 0, "errors": [],
            "missing_by_field": {}, "mode": "dry_run" if dry_run else "supabase"}

  # índice existentes por slug: query liviana (id+slug) + detalle solo si hace falta.
  # Paginado porque PostgREST limita a 1000 por request.
  existing: dict[str, dict] = {}
  if not dry_run:
    off = 0
    while True:
      page = sb.table("miniatures").select("id,slug").eq("collection_id", col_id) \
        .order("slug").range(off, off + 999).execute().data or []
      if not page:
        break
      off += len(page)
      for r in page:
        existing[r["slug"]] = {"id": r["id"], "_light": True}
    for s in seen_slugs:
      if s not in existing:
        try:
          r = sb.table("miniatures").select("id").eq("collection_id", col_id) \
            .eq("slug", s).limit(1).execute().data
          if r:
            existing[s] = {"id": r["id"], "_light": True}
        except Exception:
          pass

  def _full(slug: str) -> dict:
    """Detalle completo solo cuando se va a actualizar esa fila."""
    it = existing[slug]
    if it.get("_light"):
      it = _db.sb_get_mini(it["id"], user_id=uid)
      existing[slug] = it
    return it

  col_id, owner_id = _db.get_user_collection(uid)

  def _track_missing(sb, mid: str, rec: dict, name: str, report: dict):
    try:
      sb.table("missing_fields").delete().eq("miniature_id", mid).eq("status", "open").execute()
    except Exception:
      pass
    rows = [{"miniature_id": mid, "field_name": c, "severity": "low",
             "suggested_question": f"Completar '{c}' de '{name}'"}
            for c in CANON if c != "name" and rec.get(c) in (None, "", [])]
    for c in CANON:
      if c != "name" and rec.get(c) in (None, "", []):
        report["missing_by_field"][c] = report["missing_by_field"].get(c, 0) + 1
    if rows:
      try:
        sb.table("missing_fields").insert(rows).execute()
      except Exception:
        pass

  def _bulk_create(col_id: str, owner_id: str, pending: list, report: dict):
    sb = _db.client()
    minis_rows = [{"collection_id": col_id, "name": f["name"], "slug": f["slug"],
                   "type": f.get("type", "mini"), "quantity": f.get("quantity", 1),
                   "completeness_score": f.get("completeness_score", 0)} for f, _, _ in pending]
    ins = _db._with_retry(lambda s: s.table("miniatures").insert(minis_rows).execute())
    id_by_slug = {r["slug"]: r["id"] for r in (ins.data or [])}
    v_rows, l_rows, r_rows, miss_rows = [], [], [], []
    tag_names: set[str] = set()
    for full, rec, name in pending:
      mid = id_by_slug.get(full["slug"])
      if not mid:
        raise RuntimeError(f"sin id para {name}")
      full["_mid"] = mid
      v_rows.append({"miniature_id": mid, "shape": full.get("shape"),
                     "bioform": full.get("bioform"), "material": full.get("material"),
                     "main_color": full.get("main_color"),
                     "secondary_color": full.get("secondary_color"),
                     "weight_g": full.get("weight_g"), "height_mm": full.get("height_mm"),
                     "radius_of_base_mm": full.get("radius_of_base_mm"),
                     "scale": full.get("scale", "28mm")})
      l_rows.append({"miniature_id": mid, "designer": full.get("designer"),
                     "painted_by": full.get("painted_by"), "character_origin": full.get("character_origin"),
                     "story": full.get("story"), "year": full.get("year"),
                     "code_or_reference": full.get("code_or_reference"), "url": full.get("url")})
      if full.get("system") or full.get("faction"):
        r_rows.append({"miniature_id": mid, "system": full.get("system"),
                       "faction": full.get("faction")})
      tag_names.update(full.get("tags") or [])
      for c in CANON:
        if c != "name" and rec.get(c) in (None, "", []):
          report["missing_by_field"][c] = report["missing_by_field"].get(c, 0) + 1
          miss_rows.append({"miniature_id": mid, "field_name": c, "severity": "low",
                            "suggested_question": f"Completar '{c}' de '{name}'"})
    _db._with_retry(lambda s: s.table("visual_metadata").upsert(v_rows, on_conflict="miniature_id").execute())
    _db._with_retry(lambda s: s.table("lore").upsert(l_rows, on_conflict="miniature_id").execute())
    if r_rows:
      _db._with_retry(lambda s: s.table("rpg_profile").upsert(r_rows, on_conflict="miniature_id").execute())
    if tag_names:
      tid_by_name = {}
      for n in sorted(tag_names):
        ex = sb.table("tags").select("id").eq("user_id", owner_id).eq("name", n).limit(1).execute().data
        if ex:
          tid_by_name[n] = ex[0]["id"]
        else:
          ins_t = sb.table("tags").insert(
            {"user_id": owner_id, "name": n, "category": "general"}).execute()
          if ins_t.data:
            tid_by_name[n] = ins_t.data[0]["id"]
      pairs = [{"miniature_id": f["_mid"], "tag_id": tid_by_name[t]}
               for f, _, _ in pending for t in (f.get("tags") or []) if t in tid_by_name]
      if pairs:
        _db._with_retry(lambda s: s.table("miniature_tags").insert(pairs).execute())
    if miss_rows:
      mids = list({m for m, _, _ in [(f['_mid'], 0, 0) for f, _, _ in pending]})
      try:
        sb.table("missing_fields").delete().in_("miniature_id", mids).eq("status", "open").execute()
      except Exception:
        pass
      _db._with_retry(lambda s: s.table("missing_fields").insert(miss_rows).execute())
    report["imported"] += len(pending)

  def _bulk_update(col_id: str, owner_id: str, items: list, report: dict):
    sb = _db.client()
    mids = [mid for mid, _, _, _ in items]
    sel = ("*,visual_metadata(*),lore(*),rpg_profile(system,faction),"
           "miniature_tags(tags(name))")
    det = _db._with_retry(lambda s: s.table("miniatures").select(sel)
                          .in_("id", mids).execute()).data or []
    by_id = {r["id"]: r for r in det}
    m_rows, v_rows, l_rows, r_rows, miss_rows = [], [], [], [], []
    tag_names: set[str] = set()
    done = 0
    for mid, slug, rec, name in items:
      r = by_id.get(mid)
      if not r:
        continue
      m = {k: v for k, v in r.items()
           if k not in ("visual_metadata", "lore", "rpg_profile", "miniature_tags")}
      for sub, keys in (("visual_metadata",
                         ("shape", "bioform", "material", "main_color", "secondary_color",
                          "weight_g", "height_mm", "radius_of_base_mm", "scale")),
                        ("lore", ("designer", "painted_by", "character_origin", "story",
                                  "year", "code_or_reference", "url"))):
        v = r.get(sub)
        if isinstance(v, list):
          v = v[0] if v else None
        if v:
          m.update({k: v.get(k) for k in keys if v.get(k) is not None})
      rp = r.get("rpg_profile")
      if isinstance(rp, list):
        rp = rp[0] if rp else None
      if rp:
        m["system"] = rp.get("system")
        m["faction"] = rp.get("faction")
      m["tags"] = [t.get("tags", {}).get("name")
                   for t in (r.get("miniature_tags") or []) if t.get("tags")]
      for k, v in rec.items():
        if v not in (None, "", []):
          m[k] = v
      m["stats"] = m.get("stats") or {}
      mini = MiniIn(**{k: m.get(k) for k in MiniIn.model_fields})
      m["completeness_score"] = completeness(mini)
      m_rows.append({"id": mid, "name": m["name"], "slug": slug,
                     "type": m.get("type", "mini"), "quantity": m.get("quantity", 1),
                     "completeness_score": m["completeness_score"]})
      v_rows.append({"miniature_id": mid, "shape": m.get("shape"), "bioform": m.get("bioform"),
                     "material": m.get("material"), "main_color": m.get("main_color"),
                     "secondary_color": m.get("secondary_color"), "weight_g": m.get("weight_g"),
                     "height_mm": m.get("height_mm"),
                     "radius_of_base_mm": m.get("radius_of_base_mm"),
                     "scale": m.get("scale", "28mm")})
      l_rows.append({"miniature_id": mid, "designer": m.get("designer"),
                     "painted_by": m.get("painted_by"),
                     "character_origin": m.get("character_origin"), "story": m.get("story"),
                     "year": m.get("year"), "code_or_reference": m.get("code_or_reference"),
                     "url": m.get("url")})
      if m.get("system") or m.get("faction"):
        r_rows.append({"miniature_id": mid, "system": m.get("system"),
                       "faction": m.get("faction")})
      tag_names.update(m.get("tags") or [])
      for c in CANON:
        if c != "name" and rec.get(c) in (None, "", []):
          report["missing_by_field"][c] = report["missing_by_field"].get(c, 0) + 1
          miss_rows.append({"miniature_id": mid, "field_name": c, "severity": "low",
                            "suggested_question": f"Completar '{c}' de '{name}'"})
      done += 1
    if not m_rows:
      return
    _db._with_retry(lambda s: s.table("miniatures").upsert(m_rows, on_conflict="id").execute())
    _db._with_retry(lambda s: s.table("visual_metadata").upsert(v_rows, on_conflict="miniature_id").execute())
    _db._with_retry(lambda s: s.table("lore").upsert(l_rows, on_conflict="miniature_id").execute())
    if r_rows:
      _db._with_retry(lambda s: s.table("rpg_profile").upsert(r_rows, on_conflict="miniature_id").execute())
    tid_by_name = {}
    for n in sorted(tag_names):
      ex = sb.table("tags").select("id").eq("user_id", owner_id).eq("name", n).limit(1).execute().data
      if ex:
        tid_by_name[n] = ex[0]["id"]
      else:
        ins_t = sb.table("tags").insert(
          {"user_id": owner_id, "name": n, "category": "general"}).execute()
        if ins_t.data:
          tid_by_name[n] = ins_t.data[0]["id"]
    try:
      sb.table("miniature_tags").delete().in_("miniature_id", mids).execute()
    except Exception:
      pass
    # tags finales = los entrantes si vienen, si no los que ya tenía (igual que sb_update)
    pairs = []
    for mid, slug, rec, name in items:
      r = by_id.get(mid) or {}
      if rec.get("tags"):
        tnames = set(rec["tags"])
      else:
        tnames = set(t.get("tags", {}).get("name")
                     for t in (r.get("miniature_tags") or []) if t.get("tags"))
      for t in tnames:
        if t in tid_by_name:
          pairs.append({"miniature_id": mid, "tag_id": tid_by_name[t]})
    if pairs:
      _db._with_retry(lambda s: s.table("miniature_tags").insert(pairs).execute())
    try:
      sb.table("missing_fields").delete().in_("miniature_id", mids).eq("status", "open").execute()
    except Exception:
      pass
    if miss_rows:
      _db._with_retry(lambda s: s.table("missing_fields").insert(miss_rows).execute())
    report["updated"] += done

  pending: list = []  # filas nuevas para bulk insert (rápido)
  to_update: list = []  # (mid, slug, rec, name) para bulk update
  for off, row in enumerate(rows):  # i = nro. de fila Excel aprox.
    i = base_i + off
    try:
      rec = {}
      for ecol, canon in inv.items():
        v = row.get(ecol)
        if canon == "tags":
          val = clean_tags(v)
        elif canon in ("weight_g", "height_mm", "radius_of_base_mm"):
          val = clean_num(v)
        elif canon == "quantity":
          val = clean_int(v) or 1
        elif canon == "lore_is_canon":
          val = clean_bool(v)
        else:
          val = clean_str(v)
        # varias columnas pueden apuntar al mismo campo (weight + Peso):
        # la primera no-vacía gana, las vacías no pisan
        if val not in (None, "", []):
          rec[canon] = val
      name = rec.get("name")
      if not name:
        report["skipped"] += 1
        continue
      slug = slugify(name)
      if slug in seen_slugs:
        report["skipped"] += 1
        report["errors"].append(f"fila {i}: duplicado en el archivo ({name})")
        continue
      seen_slugs.add(slug)
      n_valid += 1
      for c in CANON:
        if rec.get(c) not in (None, "", []):
          field_hits[c] += 1
      if dry_run:
        report["imported" if slug not in existing else "updated"] += 1
        continue
      base = {"collection_id": "default", "type": "mini", "quantity": 1,
              "scale": "28mm", "tags": [], "stats": {}}
      if slug in existing:
        # merge diferido: se resuelve en bulk al final del chunk
        to_update.append((existing[slug]["id"] if isinstance(existing[slug], dict) and "id" in existing[slug] else None, slug, rec, name))
      else:
        # fila nueva: se acumula para inserción BULK al final del chunk
        full = dict(base)
        full.update({k: v for k, v in rec.items() if v not in (None, "", [])})
        mini = MiniIn(**{k: full.get(k) for k in MiniIn.model_fields})
        full["slug"] = slug
        full["completeness_score"] = completeness(mini)
        pending.append((full, rec, name))
    except HTTPException:
      raise
    except Exception as e:
      report["errors"].append(f"fila {i}: {e}")

  # 2b. Bulk update: 1 query con embeds trae detalles, upserts bulk escriben.
  if to_update and not dry_run:
    try:
      _bulk_update(col_id, owner_id, to_update, report)
    except Exception as e:
      print(f"[imports] bulk update falló, reintento fila por fila: {e}")
      for mid, slug, rec, name in to_update:
        try:
          merged = dict(_db.sb_get_mini(mid, user_id=uid))
          for k, v in rec.items():
            if v not in (None, "", []):
              merged[k] = v
          merged.update({"collection_id": "default", "stats": {}})
          mini = MiniIn(**{k: merged.get(k) for k in MiniIn.model_fields})
          merged["slug"] = slug
          merged["completeness_score"] = completeness(mini)
          _db.sb_update_mini(mid, merged, user_id=uid)
          report["updated"] += 1
          _track_missing(_db.client(), mid, rec, name, report)
        except Exception as e2:
          report["errors"].append(f"{name}: {e2}")

  # 2c. Bulk insert de filas nuevas: ~6 queries por CHUNK en vez de ~10 por fila
  if pending and not dry_run:
    try:
      _bulk_create(col_id, owner_id, pending, report)
    except Exception as e:
      print(f"[imports] bulk falló, reintento fila por fila: {e}")
      for full, rec, name in pending:
        try:
          created = _db.sb_create_mini(full, user_id=uid)
          report["imported"] += 1
          _track_missing(_db.client(), created["id"], rec, name, report)
        except Exception as e2:
          report["errors"].append(f"{name}: {e2}")

  # 3. Acumula en el ledger y responde progreso
  if not dry_run and job:
    acc["imported"] += report["imported"]
    acc["updated"] += report["updated"]
    acc["skipped"] += report["skipped"]
    acc["errors"] = (acc.get("errors", []) + report["errors"])[:200]
    for k, v in report["missing_by_field"].items():
      acc["missing_by_field"][k] = acc["missing_by_field"].get(k, 0) + v
    acc["field_hits"] = field_hits
    acc["n_valid"] = n_valid
    acc["seen_slugs"] = sorted(seen_slugs)
    from datetime import datetime, timezone
    done = chunk.get("index", 0) >= chunk.get("total", 1) - 1
    totals = {"imported": acc["imported"], "updated": acc["updated"],
              "skipped": acc["skipped"], "errors": acc["errors"][:20],
              "n_errors": len(acc["errors"]),
              "missing_by_field": acc["missing_by_field"]}
    if n_valid:
      totals["fill_rate"] = {c: round(100 * field_hits.get(c, 0) / n_valid)
                             for c in CANON if field_hits.get(c)}
    totals["mode"] = "supabase"
    now = datetime.now(timezone.utc).isoformat()
    sb.table("agent_tasks").update({
      "status": "done" if done else "running",
      "output": {**acc, "totals": totals},
      **({"finished_at": now} if done else {})}).eq("id", job["id"]).execute()
    if done:
      try:
        sb.table("imports").insert({
          "collection_id": col_id, "status": "done",
          "rows_detected": (job.get("input") or {}).get("total_rows", n_valid),
          "rows_imported": acc["imported"], "rows_updated": acc["updated"],
          "rows_skipped": acc["skipped"], "errors": acc["errors"][:50],
          "finished_at": now}).execute()
      except Exception as e:
        print(f"[imports] historial: {e}")
    return {"chunk": chunk, "chunk_report": report,
            "job": {"processed_chunks": chunk.get("index", 0) + 1,
                    "total_chunks": chunk.get("total", 1),
                    "done": done, "totals": totals}}

  if n_valid:
    report["fill_rate"] = {c: round(100 * field_hits.get(c, 0) / n_valid)
                           for c in CANON if field_hits.get(c)}
  return report
