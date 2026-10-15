"""Carga masiva directa a Postgres (pooler) — 1 transacción, ~8 queries.

Resuelve los 3 problemas del camino REST:
1. Clave estable: external_key = code_or_reference normalizado (los nombres/slugs
   cambian siempre). Renombrar actualiza name/slug, no duplica.
2. Autodetección: row_hash = sha256 del payload entrante no-vacío.
   hash igual -> idéntico -> 0 writes. Solo new+modified tocan la DB.
3. Bulk real: 1 SELECT liviano + writes con executemany en 1 transacción.
   500 filas en segundos, no horas. Regla no-vacío pisa conservada.

row_hash guarda el hash del último payload aplicado (no de la fila completa),
así lo enriquecido a mano/agente no se borra ni provoca rewrites.
"""
import hashlib
import io
import json
import time

from . import pg as _pg
from psycopg2.extras import execute_values


def norm_key(code) -> str | None:
    if code is None:
        return None
    s = str(code).strip().lower()
    return s or None


def payload_hash(rec: dict, canon: list[str]) -> str:
    parts: dict = {}
    for c in canon:
        v = rec.get(c)
        if v in (None, "", []):
            continue
        if c == "tags":
            parts[c] = sorted({str(t).strip() for t in v if str(t).strip()})
        elif isinstance(v, float):
            parts[c] = repr(v)
        else:
            parts[c] = str(v).strip()
    raw = json.dumps(parts, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _clean_row(row: dict, inv: dict, cleaners: dict) -> dict:
    rec: dict = {}
    for ecol, canon in inv.items():
        v = row.get(ecol)
        fn = cleaners.get(canon)
        val = fn(v) if fn else (str(v).strip() or None)
        if val not in (None, "", []):
            # varias columnas al mismo campo: primera no-vacía gana
            rec.setdefault(canon, val)
    return rec


# Presets por hoja (TABLETOP ITEMS etc.): fuerzan tipo y remapean columnas
# que el mapeo genérico no puede (Type de tokens -> tags, no a `type`).
SHEET_PRESETS = {
  "tokens": {"force_type": "token",
             "field_map": {"Token": "name", "Type": "tags", "Diameter": "diameter_mm"}},
  "scenography": {"force_type": "scenery",
                  "field_map": {"Total Weight (g)": "weight_g"},
                  "unit_weight_from": "Total Weight (g)"},
}
KNOWN_TYPES = ("mini", "scenery", "token", "tile", "prop")


def preset_for_sheet(sname: str | None) -> dict | None:
    k = (sname or "").casefold()
    for name, p in SHEET_PRESETS.items():
        if name in k:
            return p
    return None


def parse_workbook(file_bytes: bytes, filename: str, sheet: str | None = None,
                   mapping: dict | None = None):
    """Lee xlsx/csv -> (sname, rows, inv, preset). Reusa limpieza de routers.imports."""
    import pandas as pd
    from routers import imports as _imp

    name = (filename or "").lower()
    if name.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(file_bytes), dtype=str, keep_default_na=False)
        sheets = {"csv": df}
    else:
        x = pd.ExcelFile(io.BytesIO(file_bytes))
        sname = sheet or x.sheet_names[0]
        df = pd.read_excel(x, sheet_name=sname, dtype=str, keep_default_na=False)
        sheets = {sname: df}
    sname, df = next(iter(sheets.items()))
    df.columns = [str(c).strip() for c in df.columns]
    # Igual que preview: conserva columnas vacías pero mapeadas
    # (ej. code_or_reference aún sin datos) para futuras cargas.
    df = df.loc[~(df == "").all(axis=1)]
    drop = [c for c in df.columns
            if (df[c] == "").all() and not _imp.suggest_mapping([c])[c]["canon"]]
    df = df.drop(columns=drop)
    if mapping:
        inv = {c: m for c, m in mapping.items() if m in _imp.CANON}
    else:
        sug = _imp.suggest_mapping(df.columns.tolist())
        inv = {c: v["canon"] for c, v in sug.items() if v["canon"]}
    preset = preset_for_sheet(sname)
    if preset:
        for ecol, canon in preset.get("field_map", {}).items():
            if ecol in df.columns and canon in _imp.CANON:
                inv[ecol] = canon
    cleaners = {
        "tags": _imp.clean_tags, "weight_g": _imp.clean_num,
        "height_mm": _imp.clean_num, "radius_of_base_mm": _imp.clean_num,
        "diameter_mm": _imp.clean_num,
        "quantity": (lambda v: _imp.clean_int(v) or 1),
        "lore_is_canon": _imp.clean_bool,
    }
    rows = df.to_dict(orient="records")
    return sname, rows, inv, preset


def resolve_collection(conn, user_id: str | None = None):
    with conn.cursor() as cur:
        if user_id:
            cur.execute("select id, user_id from public.collections "
                        "where user_id = %s order by created_at limit 1", (user_id,))
            r = cur.fetchone()
            if r:
                return r[0], r[1]
            cur.execute("insert into public.collections (user_id, name, description) "
                        "values (%s, 'Mi colección', 'Colección principal MiniBase Web') "
                        "returning id, user_id", (user_id,))
            return cur.fetchone()
        cur.execute("select c.id, c.user_id, count(m.id) from public.collections c "
                    "left join public.miniatures m on m.collection_id = c.id "
                    "group by c.id order by count(m.id) desc limit 1")
        r = cur.fetchone()
        assert r, "sin colecciones: entra a la web una vez para crearla"
        return r[0], r[1]


def bulk_upsert(file_bytes: bytes, filename: str, sheet: str | None = None,
                mapping: dict | None = None, user_id: str | None = None,
                dry_run: bool = False) -> dict:
    """1 transacción. Devuelve {new, updated, skipped_identical, skipped, errors, elapsed_s}."""
    t0 = time.time()
    from routers import imports as _imp
    from routers.minis import MiniIn, completeness
    try:
        from slugify import slugify
    except ImportError:
        import re, unicodedata

        def slugify(s: str) -> str:
            s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
            return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

    sname, rows, inv, preset = parse_workbook(file_bytes, filename, sheet, mapping)
    file_hash = hashlib.sha256(file_bytes).hexdigest()
    force_type = (preset or {}).get("force_type")
    if force_type not in KNOWN_TYPES:
        force_type = None
    unit_from = (preset or {}).get("unit_weight_from")

    # 1. Construir payloads + hash (en memoria, sin DB)
    payloads: list = []  # (key, slug, rec, hash, name, excel_i)
    skipped = 0
    errors: list = []
    for i, row in enumerate(rows, start=2):
        try:
            rec = _clean_row(row, inv, {
                "tags": _imp.clean_tags, "weight_g": _imp.clean_num,
                "height_mm": _imp.clean_num, "radius_of_base_mm": _imp.clean_num,
                "diameter_mm": _imp.clean_num,
                "quantity": (lambda v: _imp.clean_int(v) or 1),
                "lore_is_canon": _imp.clean_bool,
            })
            # defaults de limpieza para el resto de campos texto
            for ecol, canon in inv.items():
                if canon not in rec and canon not in (
                        "tags", "weight_g", "height_mm", "radius_of_base_mm",
                        "diameter_mm", "quantity", "lore_is_canon"):
                    v = _imp.clean_str(row.get(ecol))
                    if v not in (None, "", []):
                        rec.setdefault(canon, v)
            if force_type:
                rec["type"] = force_type
            if unit_from and rec.get("weight_g") is not None:
                # la hoja trae peso TOTAL: unitario = total / cantidad
                try:
                    q = float(rec.get("quantity") or 1) or 1
                    rec["weight_g"] = round(float(rec["weight_g"]) / q, 2)
                except (TypeError, ValueError):
                    pass
            name = rec.get("name")
            if not name:
                skipped += 1
                continue
            slug = slugify(name)
            key = norm_key(rec.get("code_or_reference"))
            # NOTA: sin dedup aquí; el paso de versionado decide:
            # hash idéntico = duplicado exacto (omite), hash distinto = v2, v3…
            h = payload_hash(rec, _imp.CANON)
            payloads.append((key, slug, rec, h, name, i))
        except Exception as e:
            errors.append(f"fila {i}: {e}")

    # Versionado: mismo nombre + datos DISTINTOS = minis distintas (v2, v3...).
    # Mismo nombre + datos IDÉNTICOS = duplicado exacto (se omite, no es error).
    # El orden del Excel define v1, v2...: no reordenes versiones del mismo nombre;
    # para identidad a prueba de reordenes usa code_or_reference.
    versioned: list = []
    seen_hashes: dict[str, list] = {}
    used_keys: set = set()
    versions: list = []
    for key, slug, rec, h, name, i in payloads:
        hashes = seen_hashes.setdefault(slug, [])
        if h in hashes:
            skipped += 1
            errors.append(f"fila {i}: duplicado exacto en el archivo ({name}), se omite")
            continue
        k = key
        if k and k in used_keys:
            versions.append(f"fila {i}: '{name}' repite codigo '{k}' -> se guarda sin codigo")
            k = None
        eff = slug if not hashes else f"{slug}-v{len(hashes) + 1}"
        if hashes:
            versions.append(f"fila {i}: '{name}' con datos distintos -> se guarda como '{eff}'")
        hashes.append(h)
        if k:
            used_keys.add(k)
        versioned.append((k, eff, rec, h, name, i))
    payloads = versioned

    conn = _pg.get_conn()
    try:
        with conn.cursor() as cur:
            col_id, owner_id = resolve_collection(conn, user_id)
            # 2. Existentes: 1 query liviana (id+slug+key+hash)
            cur.execute("select id, slug, external_key, row_hash from public.miniatures "
                        "where collection_id = %s", (col_id,))
            by_key: dict = {}
            by_slug: dict = {}
            for mid, slug, ekey, rh in cur.fetchall():
                if ekey:
                    by_key[ekey] = (mid, slug, rh)
                by_slug[slug] = (mid, ekey, rh)

            new: list = []
            modified: list = []  # (mid, key, slug, rec, hash, name)
            identical = 0
            for key, slug, rec, h, name, _i in payloads:
                mid = None
                rh = None
                if key and key in by_key:
                    mid, _, rh = by_key[key]
                elif slug in by_slug:
                    mid, _, rh = by_slug[slug]
                if mid is None:
                    new.append((key, slug, rec, h, name))
                elif rh == h:
                    identical += 1
                else:
                    modified.append((mid, key, slug, rec, h, name))

            if dry_run:
                return {"sheet": sname, "file_hash": file_hash,
                        "new": len(new), "updated": len(modified),
                        "skipped_identical": identical, "skipped": skipped,
                        "errors": errors[:20], "n_errors": len(errors),
                        "versions": versions[:20], "n_versions": len(versions),
                        "elapsed_s": round(time.time() - t0, 1), "mode": "dry_run"}

            # 3. Traer detalle SOLO de modified para merge no-vacío pisa (1 query)
            current: dict = {}
            if modified:
                mids = [m[0] for m in modified]
                cur.execute(
                    "select m.id, m.name, m.slug, m.type, m.quantity, m.external_key,"
                    " v.shape, v.bioform, v.material, v.main_color, v.secondary_color,"
                    " v.weight_g, v.height_mm, v.radius_of_base_mm, v.diameter_mm, v.scale,"
                    " l.designer, l.painted_by, l.label, l.lore_is_canon,"
                    " l.character_origin, l.story, l.comment, l.year,"
                    " l.code_or_reference, l.url,"
                    " coalesce((select array_agg(t.name) from public.miniature_tags mt "
                    " join public.tags t on t.id = mt.tag_id where mt.miniature_id = m.id), '{}') as tags"
                    " from public.miniatures m"
                    " left join public.visual_metadata v on v.miniature_id = m.id"
                    " left join public.lore l on l.miniature_id = m.id"
                    " where m.id = any(%s::uuid[])", (mids,))
                cols = [d[0] for d in cur.description]
                for r in cur.fetchall():
                    current[r[0]] = dict(zip(cols, r))

            def merged(mid, rec):
                base = current.get(mid, {}) or {}
                out = {
                    "name": base.get("name"), "type": base.get("type") or "mini",
                    "quantity": base.get("quantity") or 1, "scale": base.get("scale") or "28mm",
                    "shape": base.get("shape"), "bioform": base.get("bioform"),
                    "material": base.get("material"), "main_color": base.get("main_color"),
                    "secondary_color": base.get("secondary_color"),
                    "weight_g": base.get("weight_g"), "height_mm": base.get("height_mm"),
                    "radius_of_base_mm": base.get("radius_of_base_mm"),
                    "diameter_mm": base.get("diameter_mm"),
                    "designer": base.get("designer"), "painted_by": base.get("painted_by"),
                    "label": base.get("label"), "lore_is_canon": base.get("lore_is_canon"),
                    "character_origin": base.get("character_origin"),
                    "story": base.get("story"), "comment": base.get("comment"),
                    "year": base.get("year"),
                    "code_or_reference": base.get("code_or_reference"),
                    "url": base.get("url"), "tags": list(base.get("tags") or []),
                    "stats": {},
                }
                for k, v in rec.items():
                    if v not in (None, "", []):
                        out[k] = v
                return out

            # 4. Writes en la misma transacción
            all_rows: list = []  # (mid|None, key, slug, final, hash, name, is_new)
            for key, slug, rec, h, name in new:
                final = {"type": "mini", "quantity": 1, "scale": "28mm", "tags": [], "stats": {}}
                final.update(rec)
                all_rows.append((None, key, slug, final, h, name, True))
            for mid, key, slug, rec, h, name in modified:
                all_rows.append((mid, key, slug, merged(mid, rec), h, name, False))

            from services.tags import canon_tag
            for _mid, _k, _s, final, _h, _n, _isnew in all_rows:
                fields = {k: final.get(k) for k in MiniIn.model_fields if k != "collection_id"}
                mini = MiniIn(**fields, collection_id=str(col_id))
                final["_score"] = completeness(mini)
                seen_t: list = []
                for t in (final.get("tags") or []):
                    c = canon_tag(t)
                    if c and c not in seen_t:
                        seen_t.append(c)
                final["_tags"] = seen_t

            new_ids: dict = {}
            if [r for r in all_rows if r[6]]:
                vals = [(str(col_id), r[5], r[2],
                         str(r[3].get("type") or "mini"), int(r[3].get("quantity") or 1),
                         int(r[3].get("_score") or 0), r[1], r[4])
                        for r in all_rows if r[6]]
                execute_values(cur,
                    "insert into public.miniatures "
                    "(collection_id, name, slug, type, quantity, completeness_score,"
                    " external_key, row_hash) values %s "
                    "on conflict (collection_id, slug) do update set name = excluded.name,"
                    " type = excluded.type, quantity = excluded.quantity,"
                    " completeness_score = excluded.completeness_score,"
                    " external_key = coalesce(excluded.external_key, public.miniatures.external_key),"
                    " row_hash = excluded.row_hash returning id, slug",
                    vals)
                for mid, slug in cur.fetchall():
                    new_ids[slug] = mid

            for mid, key, slug, final, h, name, is_new in all_rows:
                if is_new:
                    continue
                cur.execute(
                    "update public.miniatures set name=%s, slug=%s, type=%s, quantity=%s,"
                    " completeness_score=%s, external_key=coalesce(%s, external_key),"
                    " row_hash=%s, updated_at=now() where id=%s",
                    (final.get("name"), slug, str(final.get("type") or "mini"),
                     int(final.get("quantity") or 1), int(final.get("_score") or 0),
                     key, h, mid))

            id_by_row: dict = {}
            for idx, (mid, key, slug, final, h, name, is_new) in enumerate(all_rows):
                id_by_row[idx] = new_ids.get(slug) if is_new else mid
            # guarda external_key/hash también en los insertados por conflicto de slug
            for idx, (mid, key, slug, final, h, name, is_new) in enumerate(all_rows):
                if is_new and slug not in new_ids:
                    continue
                if is_new:
                    cur.execute("update public.miniatures set external_key=coalesce(%s, external_key),"
                                " row_hash=%s where id=%s", (key, h, id_by_row[idx]))

            mids_all = list(id_by_row.values())
            if mids_all:
                v_vals = [(m, r[3].get("shape"), r[3].get("bioform"), r[3].get("material"),
                           r[3].get("main_color"), r[3].get("secondary_color"),
                           r[3].get("weight_g"), r[3].get("height_mm"),
                           r[3].get("radius_of_base_mm"), r[3].get("diameter_mm"),
                           str(r[3].get("scale") or "28mm"))
                          for idx, r in enumerate(all_rows) for m in [id_by_row[idx]]]
                execute_values(cur,
                    "insert into public.visual_metadata (miniature_id, shape, bioform, material,"
                    " main_color, secondary_color, weight_g, height_mm, radius_of_base_mm,"
                    " diameter_mm, scale)"
                    " values %s on conflict (miniature_id) do update set shape=excluded.shape,"
                    " bioform=excluded.bioform, material=excluded.material,"
                    " main_color=excluded.main_color, secondary_color=excluded.secondary_color,"
                    " weight_g=excluded.weight_g, height_mm=excluded.height_mm,"
                    " radius_of_base_mm=excluded.radius_of_base_mm,"
                    " diameter_mm=excluded.diameter_mm, scale=excluded.scale",
                    v_vals)
                l_vals = [(m, r[3].get("designer"), r[3].get("painted_by"),
                           r[3].get("label"), r[3].get("lore_is_canon"),
                           r[3].get("character_origin"), r[3].get("story"),
                           r[3].get("comment"),
                           r[3].get("year"), r[3].get("code_or_reference"), r[3].get("url"))
                          for idx, r in enumerate(all_rows) for m in [id_by_row[idx]]]
                execute_values(cur,
                    "insert into public.lore (miniature_id, designer, painted_by, label,"
                    " lore_is_canon, character_origin, story, comment, year, code_or_reference, url)"
                    " values %s"
                    " on conflict (miniature_id) do update set designer=excluded.designer,"
                    " painted_by=excluded.painted_by, label=excluded.label,"
                    " lore_is_canon=excluded.lore_is_canon,"
                    " character_origin=excluded.character_origin,"
                    " story=excluded.story, comment=excluded.comment, year=excluded.year,"
                    " code_or_reference=excluded.code_or_reference, url=excluded.url",
                    l_vals)
                # tags: preload + faltantes + links (3 queries, no loops)
                cur.execute("select id, name from public.tags where user_id = %s", (owner_id,))
                tid_by_name = {n: i for i, n in cur.fetchall()}
                want = sorted({t for _, _, _, f, _, _, _ in all_rows for t in f["_tags"]})
                missing = [t for t in want if t not in tid_by_name]
                if missing:
                    execute_values(cur,
                        "insert into public.tags (user_id, name, category) values %s"
                        " on conflict (user_id, name) do nothing",
                        [(str(owner_id), t, "general") for t in missing])
                    cur.execute("select id, name from public.tags where user_id = %s", (owner_id,))
                    tid_by_name = {n: i for i, n in cur.fetchall()}
                mod_mids = [id_by_row[i] for i, r in enumerate(all_rows) if not r[6]]
                if mod_mids:
                    cur.execute("delete from public.miniature_tags where miniature_id = any(%s::uuid[])",
                                (mod_mids,))
                pairs = [(id_by_row[i], tid_by_name[t])
                         for i, (_, _, _, f, _, _, _) in enumerate(all_rows)
                         for t in f["_tags"] if t in tid_by_name]
                if pairs:
                    execute_values(cur,
                        "insert into public.miniature_tags (miniature_id, tag_id) values %s"
                        " on conflict do nothing", pairs)
                # faltantes: 1 delete + 1 insert
                cur.execute("delete from public.missing_fields where miniature_id = any(%s::uuid[])"
                            " and status = 'open'", (mids_all,))
                miss = [(id_by_row[i], c, f"Completar '{c}' de '{r[5]}'")
                        for i, r in enumerate(all_rows)
                        for c in _imp.CANON
                        if c != "name" and r[3].get(c) in (None, "", [])]
                if miss:
                    execute_values(cur,
                        "insert into public.missing_fields (miniature_id, field_name, severity,"
                        " suggested_question) values %s",
                        [(m, c, "low", q) for m, c, q in miss])
            # Historial en savepoint: si la tabla imports no tiene las columnas
            # de la migración 003, el fallo NO debe revertir los datos.
            try:
                cur.execute("SAVEPOINT ledger")
                try:
                    cur.execute(
                        "insert into public.imports (collection_id, status, rows_detected,"
                        " rows_imported, rows_updated, rows_skipped, errors, filename, file_hash,"
                        " finished_at) values (%s,'done',%s,%s,%s,%s,%s,%s,%s,now())",
                        (str(col_id), len(payloads), len(new), len(modified),
                         identical + skipped, json.dumps(errors[:50], ensure_ascii=False),
                         filename, file_hash))
                except Exception:
                    cur.execute("ROLLBACK TO SAVEPOINT ledger")
                    cur.execute(
                        "insert into public.imports (collection_id, status, rows_detected,"
                        " rows_imported, rows_updated, rows_skipped, errors,"
                        " finished_at) values (%s,'done',%s,%s,%s,%s,%s,now())",
                        (str(col_id), len(payloads), len(new), len(modified),
                         identical + skipped, json.dumps(errors[:50], ensure_ascii=False)))
                cur.execute("RELEASE SAVEPOINT ledger")
            except Exception:
                pass
            conn.commit()
            return {"sheet": sname, "file_hash": file_hash, "mode": "supabase-direct",
                    "new": len(new), "updated": len(modified),
                    "skipped_identical": identical, "skipped": skipped,
                    "errors": errors[:20], "n_errors": len(errors),
                    "versions": versions[:20], "n_versions": len(versions),
                    "elapsed_s": round(time.time() - t0, 1)}
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()
