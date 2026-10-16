"""Persistencia Supabase real (secret en servidor) con fallback a memoria local.

Tablas: users > collections > miniatures + visual_metadata + lore + tags +
miniature_tags + rpg_profile. Lee api/.env (SUPABASE_URL + SUPABASE_SECRET_KEY).
Si Supabase no responde o no hay colección bootstrap, usa DEMO_STORE local.
"""
import os
import pathlib

SUPABASE_URL = ""
SUPABASE_SECRET = ""

def _load_env():
  global SUPABASE_URL, SUPABASE_SECRET
  p = pathlib.Path(__file__).parent.parent / ".env"
  if p.exists():
    for line in p.read_text(encoding="utf-8").splitlines():
      line = line.strip()
      if not line or line.startswith("#") or "=" not in line:
        continue
      k, v = line.split("=", 1)
      k, v = k.strip(), v.strip()
      if k == "SUPABASE_URL":
        SUPABASE_URL = v
      elif k in ("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_KEY"):
        if v and not SUPABASE_SECRET:
          SUPABASE_SECRET = v
  SUPABASE_URL = os.getenv("SUPABASE_URL", SUPABASE_URL)
  SUPABASE_SECRET = os.getenv("SUPABASE_SECRET_KEY",
                      os.getenv("SUPABASE_SERVICE_KEY", SUPABASE_SECRET))

_load_env()

def is_configured() -> bool:
  """Hay claves (sin red). Barato: no hace requests."""
  return bool(SUPABASE_URL and SUPABASE_SECRET)

def client():
  """Cliente service FRESCO por llamada (evita 'Server disconnected' por keepalive).

  None si no hay claves/librería."""
  if not is_configured():
    return None
  try:
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_SECRET)
  except Exception as e:
    print(f"[db] sin supabase: {e}")
    return None

def _with_retry(fn, tries: int = 3):
  """Reintenta la operación Supabase (la red a veces corta la conexión)."""
  last = None
  for i in range(tries):
    try:
      return fn(client())
    except Exception as e:
      last = e
      print(f"[db] intento {i + 1}/{tries} falló: {e}")
  raise last

def is_live() -> bool:
  try:
    if not is_configured():
      return False
    _with_retry(lambda c: c.table("collections").select("id").limit(1).execute(), tries=2)
    return True
  except Exception as e:
    print(f"[db] no live: {e}")
    return False

def user_id_from_token(token: str) -> str:
  """Valida el JWT del frontend contra Supabase Auth. Lanza si inválido."""
  sb = client()
  assert sb is not None
  res = sb.auth.get_user(token)
  u = res.user if hasattr(res, "user") else res.get("user")
  uid = getattr(u, "id", None) or (u.get("id") if isinstance(u, dict) else None)
  assert uid, "token inválido"
  return uid

def get_user_collection(user_id: str):
  """Colección del usuario (crea 'Mi colección' si es su primer login)."""
  def _op(sb):
    r = sb.table("collections").select("id,user_id").eq("user_id", user_id).limit(1).execute()
    rows = r.data or []
    if rows:
      return rows[0]["id"], rows[0]["user_id"]
    ins = sb.table("collections").insert({
      "user_id": user_id, "name": "Mi colección",
      "description": "Colección principal MiniBase Web"}).execute()
    return ins.data[0]["id"], user_id
  return _with_retry(_op)

def get_default_collection():
  """Devuelve (collection_id, user_id) de la primera colección, o (None, None)."""
  if not is_configured():
    return None, None
  try:
    def _op(sb):
      r = sb.table("collections").select("id,user_id").limit(1).execute()
      rows = r.data or []
      if rows:
        return rows[0]["id"], rows[0]["user_id"]
      return None, None
    return _with_retry(_op)
  except Exception as e:
    print(f"[db] get_default_collection: {e}")
    return None, None

def _ensure_tags(sb, user_id: str, names: list[str]) -> list[str]:
  from services.tags import canon_tag, is_junk
  ids = []
  canon: list[str] = []
  for raw in names:
    if is_junk(raw):
      continue
    c = canon_tag(raw)
    if c and c not in canon:
      canon.append(c)
  for n in canon:
    ex = sb.table("tags").select("id").eq("user_id", user_id).eq("name", n).limit(1).execute()
    if ex.data:
      ids.append(ex.data[0]["id"])
    else:
      ins = sb.table("tags").insert(
        {"user_id": user_id, "name": n, "category": "general"}).execute()
      if ins.data:
        ids.append(ins.data[0]["id"])
  return ids

def _resolve_scope(user_id: str | None):
  """(collection_id, owner_id): del usuario logueado o la default bootstrap."""
  if user_id:
    return get_user_collection(user_id)
  return get_default_collection()

def sb_create_mini(payload: dict, user_id: str | None = None) -> dict:
  def _op(sb):
    col_id, owner_id = _resolve_scope(user_id)
    assert col_id, "sin colección: entra a la web una vez para crearla"
    tags = payload.get("tags") or []
    m = sb.table("miniatures").insert({
      "collection_id": col_id, "name": payload["name"], "slug": payload["slug"],
      "type": payload.get("type", "mini"), "quantity": payload.get("quantity", 1),
      "completeness_score": payload.get("completeness_score", 0),
      "size_category": payload.get("size_category"),
      "paint_status": payload.get("paint_status"),
      "aliases": payload.get("aliases") or [],
      "grid_cells": payload.get("grid_cells") or 1}).execute().data[0]
    mid = m["id"]
    sb.table("visual_metadata").upsert({
      "miniature_id": mid, "shape": payload.get("shape"), "bioform": payload.get("bioform"),
      "material": payload.get("material"), "main_color": payload.get("main_color"),
      "secondary_color": payload.get("secondary_color"), "weight_g": payload.get("weight_g"),
      "height_mm": payload.get("height_mm"), "radius_of_base_mm": payload.get("radius_of_base_mm"),
      "diameter_mm": payload.get("diameter_mm"),
      "scale": payload.get("scale", "28mm")}, on_conflict="miniature_id").execute()
    sb.table("lore").upsert({
      "miniature_id": mid, "designer": payload.get("designer"),
      "painted_by": payload.get("painted_by"), "label": payload.get("label"),
      "lore_is_canon": payload.get("lore_is_canon"),
      "character_origin": payload.get("character_origin"),
      "story": payload.get("story"), "comment": payload.get("comment"), "year": payload.get("year"),
      "code_or_reference": payload.get("code_or_reference"),
      "url": payload.get("url")}, on_conflict="miniature_id").execute()
    if payload.get("system") or payload.get("faction") or payload.get("role"):
      sb.table("rpg_profile").upsert({
        "miniature_id": mid, "system": payload.get("system"),
        "faction": payload.get("faction"),
        "role": payload.get("role")}, on_conflict="miniature_id").execute()
    sb.table("gameplay_usage").upsert({
      "miniature_id": mid,
      "play_count": payload.get("play_count") or 0,
      "is_favorite": bool(payload.get("is_favorite"))},
      on_conflict="miniature_id").execute()
    for tid in _ensure_tags(sb, owner_id, tags):
      try:
        sb.table("miniature_tags").insert(
          {"miniature_id": mid, "tag_id": tid}).execute()
      except Exception:
        pass
    return mid
  mid = _with_retry(_op)
  return sb_get_mini(mid, user_id)

def sb_get_mini(mid: str, user_id: str | None = None) -> dict:
  def _op(sb):
    rows = sb.table("miniatures").select("*").eq("id", mid).limit(1).execute().data
    assert rows, "no existe"
    m = rows[0]
    if user_id:
      col_id, _ = get_user_collection(user_id)
      assert m["collection_id"] == col_id, "no es tuya"
    out = dict(m)
    v = sb.table("visual_metadata").select("*").eq("miniature_id", mid).limit(1).execute().data
    if v:
      out.update({k: v[0].get(k) for k in
        ("shape", "bioform", "material", "main_color", "secondary_color",
         "weight_g", "height_mm", "radius_of_base_mm", "diameter_mm", "scale") if v[0].get(k) is not None})
    lo = sb.table("lore").select("*").eq("miniature_id", mid).limit(1).execute().data
    if lo:
      out.update({k: lo[0].get(k) for k in
        ("designer", "painted_by", "label", "lore_is_canon", "character_origin", "story", "comment", "year",
         "code_or_reference", "url") if lo[0].get(k) is not None})
    rp = sb.table("rpg_profile").select("system,faction,role").eq("miniature_id", mid).limit(1).execute().data
    if rp:
      out["system"] = rp[0].get("system")
      out["faction"] = rp[0].get("faction")
      out["role"] = rp[0].get("role")
    gu = sb.table("gameplay_usage").select("play_count,is_favorite").eq("miniature_id", mid).limit(1).execute().data
    if gu:
      out["play_count"] = gu[0].get("play_count") or 0
      out["is_favorite"] = bool(gu[0].get("is_favorite"))
    mt = sb.table("miniature_tags").select("tag_id").eq("miniature_id", mid).execute().data or []
    names = []
    for row in mt:
      t = sb.table("tags").select("name").eq("id", row["tag_id"]).limit(1).execute().data
      if t:
        names.append(t[0]["name"])
    out["tags"] = names
    return out
  return _with_retry(_op)

def sb_tag_facets(user_id: str | None = None, ftype: str = "") -> list[dict]:
  """Tags con conteos para filtros. Si ftype viene, solo tags presentes en ese tipo."""
  def _op(sb):
    col_id, owner = _resolve_scope(user_id)
    if not col_id:
      return []
    mids = set()
    off = 0
    while True:
      qm = sb.table("miniatures").select("id").eq("collection_id", col_id)
      if ftype:
        qm = qm.eq("type", ftype)
      page = qm.order("id").range(off, off + 999).execute().data or []
      if not page:
        break
      off += len(page)
      mids.update(r["id"] for r in page)
    if not mids:
      return []
    counts: dict[str, int] = {}
    names: dict[str, str] = {}
    tids: set[str] = set()
    mids = list(mids)
    for i in range(0, len(mids), 200):
      mt = sb.table("miniature_tags").select("tag_id,miniature_id") \
        .in_("miniature_id", mids[i:i + 200]).execute().data or []
      for row in mt:
        tids.add(row["tag_id"])
    tids = list(tids)
    tag_minis: dict[str, set] = {}
    for i in range(0, len(mids), 200):
      mt = sb.table("miniature_tags").select("tag_id,miniature_id") \
        .in_("miniature_id", mids[i:i + 200]).execute().data or []
      for row in mt:
        tag_minis.setdefault(row["tag_id"], set()).add(row["miniature_id"])
    for i in range(0, max(1, len(tids)), 200):
      tt = sb.table("tags").select("id,name").in_("id", tids[i:i + 200] or ["00000000-0000-0000-0000-000000000000"]) \
        .execute().data or []
      for t in tt:
        names[t["id"]] = t["name"]
        counts[t["name"]] = len(tag_minis.get(t["id"], ()))
    return sorted([{"name": n, "count": c} for n, c in counts.items()],
                  key=lambda x: -x["count"])
  return _with_retry(_op)

FIELD_FACETS_VISUAL = ["main_color", "secondary_color", "bioform", "material",
                       "height_mm", "radius_of_base_mm", "diameter_mm"]
FIELD_FACETS_LORE = ["designer", "painted_by", "label", "character_origin", "year"]

def sb_field_facets(user_id: str | None = None) -> dict:
  """Valores distintos + conteos por campo para los filtros. 3 queries."""
  def _op(sb):
    col_id, _ = _resolve_scope(user_id)
    if not col_id:
      return {}
    mids: list = []
    off = 0
    while True:
      pg = sb.table("miniatures").select("id").eq("collection_id", col_id) \
        .order("id").range(off, off + 999).execute().data or []
      if not pg:
        break
      off += len(pg)
      mids += [r["id"] for r in pg]
    if not mids:
      return {}
    counts: dict[str, dict] = {}
    for i in range(0, len(mids), 500):
      chunk = mids[i:i + 500]
      vrows = sb.table("visual_metadata").select(
        "miniature_id," + ",".join(FIELD_FACETS_VISUAL)).in_("miniature_id", chunk) \
        .execute().data or []
      lrows = sb.table("lore").select(
        "miniature_id," + ",".join(FIELD_FACETS_LORE)).in_("miniature_id", chunk) \
        .execute().data or []
      # Campos IA de la tabla principal (tamaño/pintado para filtros del DM)
      mrows = sb.table("miniatures").select("id,size_category,paint_status") \
        .in_("id", chunk).execute().data or []
      for r in vrows + lrows:
        for k, v in r.items():
          if k == "miniature_id" or v in (None, ""):
            continue
          key = str(v)
          counts.setdefault(k, {}).setdefault(key, 0)
          counts[k][key] += 1
      for r in mrows:
        for k in ("size_category", "paint_status"):
          v = r.get(k)
          if v in (None, ""):
            continue
          counts.setdefault(k, {}).setdefault(str(v), 0)
          counts[k][str(v)] += 1
    out = {}
    for k, vals in counts.items():
      items = sorted([{"value": v, "count": c} for v, c in vals.items()],
                     key=lambda x: (-x["count"], x["value"]))[:200]
      out[k] = items
    return out
  return _with_retry(_op)

def sb_list_minis(q: str = "", ftype: str = "", tags: list | None = None,
                  page: int = 1, page_size: int = 24,
                  user_id: str | None = None,
                  filters: dict | None = None,
                  direct: dict | None = None) -> dict:
  """Lista en 2-3 queries con joins embebidos + total. q busca en nombre y story.
  direct = filtros eq sobre columnas de miniatures (size_category...)."""
  wanted = list(tags or [])
  extra = {k: v for k, v in (filters or {}).items() if v not in (None, "")}

  def _op(sb):
    col_id, _ = _resolve_scope(user_id)
    if not col_id:
      return {"items": [], "total": 0}
    sel = ("*,visual_metadata(*),lore(*),rpg_profile(system,faction),"
           "miniature_tags(tags(name))")
    query = sb.table("miniatures").select(sel, count="exact") \
      .eq("collection_id", col_id).order("name")
    if ftype:
      query = query.eq("type", ftype)
    for k, v in (direct or {}).items():
      if v not in (None, ""):
        query = query.eq(k, v)
    if q:
      query = query.or_(f"name.ilike.%{q}%,slug.ilike.%{q}%")
    if wanted:
      # Lógica O: minis que tengan CUALQUIERA de los tags marcados.
      from services.tags import canon_tag
      canon_wanted = []
      for t in wanted:
        c = canon_tag(t)
        if c and c not in canon_wanted:
          canon_wanted.append(c)
      tr = sb.table("tags").select("id").in_("name", canon_wanted or [""]).execute().data or []
      tids = [r["id"] for r in tr]
      if not tids:
        return {"items": [], "total": 0}
      mids: set = set()
      for i in range(0, len(tids), 200):
        off = 0
        while True:
          mt = sb.table("miniature_tags").select("miniature_id").in_("tag_id", tids[i:i + 200]) \
            .order("miniature_id").range(off, off + 999).execute().data or []
          if not mt:
            break
          off += len(mt)
          mids.update(r["miniature_id"] for r in mt)
      if not mids:
        return {"items": [], "total": 0}
      query = query.in_("id", list(mids))
    if extra:
      # Filtros por campos de tablas hijas (visual_metadata / lore).
      # 1 query liviana de mids + 1-2 queries a hijas, luego IN en la principal.
      visual_keys = ("main_color", "secondary_color", "bioform", "material",
                     "height_mm", "radius_of_base_mm", "diameter_mm")
      lore_keys = ("designer", "painted_by", "label", "character_origin", "year")
      vf = {k: extra[k] for k in visual_keys if k in extra}
      lf = {k: extra[k] for k in lore_keys if k in extra}
      col_mids: list = []
      off = 0
      while True:
        pg = sb.table("miniatures").select("id").eq("collection_id", col_id) \
          .order("id").range(off, off + 999).execute().data or []
        if not pg:
          break
        off += len(pg)
        col_mids += [r["id"] for r in pg]
      if not col_mids:
        return {"items": [], "total": 0}
      keep_sets: list = []
      if vf:
        sel = "miniature_id," + ",".join(vf.keys())
        acc: set = set()
        for i in range(0, len(col_mids), 500):
          qq = sb.table("visual_metadata").select(sel).in_("miniature_id", col_mids[i:i + 500])
          for k, v in vf.items():
            qq = qq.eq(k, float(v) if k in ("height_mm", "radius_of_base_mm", "diameter_mm") else v)
          acc.update(r["miniature_id"] for r in (qq.execute().data or []))
        keep_sets.append(acc)
      if lf:
        acc2: set = set()
        for i in range(0, len(col_mids), 500):
          qq = sb.table("lore").select("miniature_id").in_("miniature_id", col_mids[i:i + 500])
          for k, v in lf.items():
            qq = qq.eq(k, v)
          acc2.update(r["miniature_id"] for r in (qq.execute().data or []))
        keep_sets.append(acc2)
      keep_f = set.intersection(*keep_sets) if keep_sets else set()
      if not keep_f:
        return {"items": [], "total": 0}
      query = query.in_("id", list(keep_f))
    lo = (page - 1) * page_size
    res = query.range(lo, lo + page_size - 1).execute()
    total = res.count or 0
    items = []
    for r in res.data or []:
      m = {k: v for k, v in r.items()
           if k not in ("visual_metadata", "lore", "rpg_profile", "miniature_tags")}
      v = r.get("visual_metadata")
      if isinstance(v, list):
        v = v[0] if v else None
      if v:
        m.update({k: v.get(k) for k in
          ("shape", "bioform", "material", "main_color", "secondary_color",
           "weight_g", "height_mm", "radius_of_base_mm", "diameter_mm", "scale") if v.get(k) is not None})
      lo_ = r.get("lore")
      if isinstance(lo_, list):
        lo_ = lo_[0] if lo_ else None
      if lo_:
        m.update({k: lo_.get(k) for k in
          ("designer", "painted_by", "label", "lore_is_canon", "character_origin", "story", "comment", "year",
           "code_or_reference", "url") if lo_.get(k) is not None})
      rp = r.get("rpg_profile")
      if isinstance(rp, list):
        rp = rp[0] if rp else None
      if rp:
        m["system"] = rp.get("system")
        m["faction"] = rp.get("faction")
      m["tags"] = [t.get("tags", {}).get("name")
                   for t in (r.get("miniature_tags") or []) if t.get("tags")]
      items.append(m)
    return {"items": items, "total": total}
  return _with_retry(_op)

def sb_update_mini(mid: str, payload: dict, user_id: str | None = None) -> dict:
  def _op(sb):
    if user_id:
      col_id, _ = get_user_collection(user_id)
      own = sb.table("miniatures").select("id").eq("id", mid).eq("collection_id", col_id).limit(1).execute().data
      assert own, "no es tuya"
    else:
      col_id, owner = _resolve_scope(None)
      owner = owner
    sb.table("miniatures").update({
      "name": payload["name"], "slug": payload["slug"], "type": payload.get("type", "mini"),
      "quantity": payload.get("quantity", 1),
      "completeness_score": payload.get("completeness_score", 0),
      "size_category": payload.get("size_category"),
      "paint_status": payload.get("paint_status"),
      "aliases": payload.get("aliases") or [],
      "grid_cells": payload.get("grid_cells") or 1}).eq("id", mid).execute()
    sb.table("visual_metadata").upsert({
      "miniature_id": mid, "shape": payload.get("shape"), "bioform": payload.get("bioform"),
      "material": payload.get("material"), "main_color": payload.get("main_color"),
      "secondary_color": payload.get("secondary_color"), "weight_g": payload.get("weight_g"),
      "height_mm": payload.get("height_mm"), "radius_of_base_mm": payload.get("radius_of_base_mm"),
      "diameter_mm": payload.get("diameter_mm"),
      "scale": payload.get("scale", "28mm")}, on_conflict="miniature_id").execute()
    sb.table("lore").upsert({
      "miniature_id": mid, "designer": payload.get("designer"),
      "painted_by": payload.get("painted_by"), "label": payload.get("label"),
      "lore_is_canon": payload.get("lore_is_canon"),
      "character_origin": payload.get("character_origin"),
      "story": payload.get("story"), "comment": payload.get("comment"), "year": payload.get("year"),
      "code_or_reference": payload.get("code_or_reference"),
      "url": payload.get("url")}, on_conflict="miniature_id").execute()
    if payload.get("system") or payload.get("faction") or payload.get("role"):
      sb.table("rpg_profile").upsert({
        "miniature_id": mid, "system": payload.get("system"),
        "faction": payload.get("faction"),
        "role": payload.get("role")}, on_conflict="miniature_id").execute()
    sb.table("gameplay_usage").upsert({
      "miniature_id": mid,
      "play_count": payload.get("play_count") or 0,
      "is_favorite": bool(payload.get("is_favorite"))},
      on_conflict="miniature_id").execute()
    if user_id:
      _, owner = get_user_collection(user_id)
    else:
      _, owner = get_default_collection()
    sb.table("miniature_tags").delete().eq("miniature_id", mid).execute()
    for tid in _ensure_tags(sb, owner, payload.get("tags") or []):
      try:
        sb.table("miniature_tags").insert(
          {"miniature_id": mid, "tag_id": tid}).execute()
      except Exception:
        pass
    return mid
  mid2 = _with_retry(_op)
  return sb_get_mini(mid2, user_id)

def sb_delete_mini(mid: str, user_id: str | None = None):
  def _op(sb):
    if user_id:
      col_id, _ = get_user_collection(user_id)
      own = sb.table("miniatures").select("id").eq("id", mid).eq("collection_id", col_id).limit(1).execute().data
      assert own, "no es tuya"
    sb.table("miniatures").delete().eq("id", mid).execute()
  return _with_retry(_op)

def sb_stats(user_id: str | None = None) -> dict:
  """Totales por TIPOS únicos + piezas (suma de quantity), global y por tipo.
  709 tipos != 972 piezas: el conteo principal es tipos, piezas es informativo."""
  def _op(sb):
    col_id, _ = _resolve_scope(user_id)
    if not col_id:
      return {"tipos": 0, "piezas": 0, "por_tipo": {}, "mode": "supabase"}
    tipos = 0
    piezas = 0
    por_tipo: dict = {}
    off = 0
    while True:
      page = sb.table("miniatures").select("type,quantity") \
        .eq("collection_id", col_id).order("id") \
        .range(off, off + 999).execute().data or []
      if not page:
        break
      off += len(page)
      for r in page:
        t = r.get("type") or "mini"
        try:
          qtd = int(r.get("quantity") or 1)
        except (TypeError, ValueError):
          qtd = 1
        tipos += 1
        piezas += qtd
        e = por_tipo.setdefault(t, {"tipos": 0, "piezas": 0})
        e["tipos"] += 1
        e["piezas"] += qtd
    return {"tipos": tipos, "piezas": piezas,
            "por_tipo": por_tipo, "mode": "supabase"}
  return _with_retry(_op)
