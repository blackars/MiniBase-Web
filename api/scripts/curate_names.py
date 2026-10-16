"""Aplica los renombres de services.curate a filas ya existentes en Supabase.

Uso: python api/scripts/curate_names.py [--dry-run]
Requiere api/.env (SUPABASE_URL + SECRET o DB password via services.pg).
Idempotente: si la fila ya tiene el nombre oficial, no hace nada.
"""
import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    from services import curate as _cur
    from services import pg as _pg

    conn = _pg.get_conn()
    try:
        with conn.cursor() as cur:
            for raw, official in _cur.CURATED_NAMES.items():
                cur.execute(
                    "select id, name, slug from public.miniatures "
                    "where name = %s", (raw,))
                rows = cur.fetchall()
                if not rows:
                    print(f"[curate] sin fila con nombre {raw!r} "
                          f"(ya curada o no existe)")
                    continue
                # slug esperado del nombre oficial (misma regla que la API)
                try:
                    from slugify import slugify
                except ImportError:
                    import re
                    import unicodedata

                    def slugify(s: str) -> str:
                        s = unicodedata.normalize(
                            "NFKD", s).encode("ascii", "ignore").decode()
                        return re.sub(
                            r"[^a-z0-9]+", "-", s.lower()).strip("-")

                new_slug = slugify(official)
                for mid, old_name, old_slug in rows:
                    cur.execute(
                        "select 1 from public.miniatures "
                        "where slug = %s and id <> %s limit 1",
                        (new_slug, mid))
                    assert not cur.fetchone(), \
                        f"slug {new_slug!r} ya ocupado: renombre manual requerido"
                    print(f"[curate] {old_slug!r} -> {new_slug!r} "
                          f"({old_name!r} -> {official!r})")
                    if not a.dry_run:
                        cur.execute(
                            "update public.miniatures set name = %s, slug = %s,"
                            " updated_at = now() where id = %s",
                            (official, new_slug, mid))
            if not a.dry_run:
                conn.commit()
                print("[curate] OK (commit)")
            else:
                print("[curate] dry-run, sin cambios")
            return 0
    except Exception as e:
        conn.rollback()
        print(f"[curate] FAIL: {e}")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
