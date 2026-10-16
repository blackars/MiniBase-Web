"""Backfill de campos IA (009) con lo inferible + faltantes al Inbox.

- size_category desde height_mm (bandas para escala ~28mm).
- grid_cells desde diameter_mm (tokens) o radio de peana x2.
- facción NO se infiere (texto libre por sistema: D&D/Warhammer no comparten
  vocabulario); va al Inbox como faltante para curado manual.
- Crea missing_fields abiertos para size_category/paint_status/aliases/role
  donde falten, para completar poco a poco desde /inbox.

Uso: python api/scripts/backfill_ia.py [--dry-run]   (después de correr 009)
Requiere api/.env con SUPABASE_DB_PASSWORD (pooler). Idempotente.
"""
import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))


def size_band(h) -> str | None:
    if h is None:
        return None
    try:
        h = float(h)
    except (TypeError, ValueError):
        return None
    if h < 15:
        return "tiny"
    if h < 28:
        return "small"
    if h < 55:
        return "medium"
    if h < 110:
        return "large"
    if h < 220:
        return "huge"
    return "gargantuan"


def grid_from(diameter, radius) -> int:
    d = None
    for v in (diameter, radius * 2 if radius else None):
        try:
            if v is not None and float(v) > 0:
                d = float(v)
                break
        except (TypeError, ValueError):
            continue
    if d is None:
        return 1
    if d <= 32:
        return 1
    if d <= 60:
        return 2
    if d <= 120:
        return 3
    return 4


NEW_FIELDS = ("size_category", "paint_status", "aliases", "role")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    from services import pg as _pg
    from psycopg2.extras import execute_values

    conn = _pg.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("select m.id, v.height_mm, v.diameter_mm, v.radius_of_base_mm,"
                        " m.size_category, m.paint_status, m.aliases"
                        " from public.miniatures m"
                        " left join public.visual_metadata v on v.miniature_id = m.id")
            rows = cur.fetchall()
            print(f"[backfill] filas: {len(rows)}", flush=True)
            size_vals = []
            grid_vals = []
            for mid, h, dia, rad, sz, paint, aliases in rows:
                want_size = size_band(h)
                if want_size and not sz:
                    size_vals.append((want_size, mid))
                want_grid = grid_from(dia, rad)
                if want_grid != 1:
                    grid_vals.append((want_grid, mid))
            print(f"[backfill] size_category inferidos: {len(size_vals)}",
                  flush=True)
            print(f"[backfill] grid_cells >1: {len(grid_vals)}", flush=True)
            if not a.dry_run:
                if size_vals:
                    execute_values(cur,
                        "update public.miniatures as m set size_category = v.s,"
                        " updated_at = now() from (values %s) as v(s, id)"
                        " where m.id = v.id::uuid",
                        [(s, str(m)) for s, m in size_vals])
                if grid_vals:
                    execute_values(cur,
                        "update public.miniatures as m set grid_cells = v.g,"
                        " updated_at = now() from (values %s) as v(g, id)"
                        " where m.id = v.id::uuid",
                        [(g, str(m)) for g, m in grid_vals])
            # Faltantes al Inbox para lo no inferible (reemplaza abiertos viejos)
            cur.execute("select id, name, size_category, paint_status, aliases"
                        " from public.miniatures")
            miss = []
            for mid, name, sz, paint, aliases in cur.fetchall():
                if not sz:
                    miss.append((mid, "size_category",
                                 f"Tamaño D&D de '{name}' (tiny…gargantuan)"))
                if not paint:
                    miss.append((mid, "paint_status",
                                 f"Estado de pintado de '{name}'"))
                if not aliases:
                    miss.append((mid, "aliases",
                                 f"Otros nombres de '{name}' (alias, separados por coma)"))
            # role vive en rpg_profile: los que no tengan fila o role null
            cur.execute("select m.id, m.name from public.miniatures m"
                        " left join public.rpg_profile r on r.miniature_id = m.id"
                        " where r.miniature_id is null or r.role is null")
            for mid, name in cur.fetchall():
                miss.append((mid, "role", f"Rol en escena de '{name}'"))
            print(f"[backfill] faltantes nuevos: {len(miss)}", flush=True)
            if not a.dry_run:
                cur.execute("delete from public.missing_fields"
                            " where status = 'open' and field_name = any(%s)",
                            (list(NEW_FIELDS),))
                if miss:
                    execute_values(cur,
                        "insert into public.missing_fields (miniature_id, field_name,"
                        " severity, suggested_question, status)"
                        " values %s",
                        [(m, c, "medium", q, "open") for m, c, q in miss])
                conn.commit()
                print("[backfill] OK (commit)", flush=True)
            else:
                print("[backfill] dry-run, sin cambios")
            return 0
    except Exception as e:
        conn.rollback()
        print(f"[backfill] FAIL: {e}")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
