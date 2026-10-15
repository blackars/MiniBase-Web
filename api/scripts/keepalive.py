"""Keepalive Supabase Free: evita la pausa por inactividad.

Supabase pausa los proyectos sin actividad (~7 dias). Este script hace
2 queries baratas (SELECT + heartbeat) para registrar actividad.
Se ejecuta solo via GitHub Actions cada 2 dias (ver .github/workflows/keepalive.yml).

Uso local:
  python api/scripts/keepalive.py
  python api/scripts/keepalive.py --verbose

Requiere: SUPABASE_URL + SUPABASE_SECRET_KEY (env o api/.env).
Sale con codigo 0 si hubo actividad, 1 si fallo (el workflow te avisa).
"""
import argparse
import datetime
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()

    from services import db

    if not db.is_configured():
        print("[keepalive] FAIL: sin SUPABASE_URL / SUPABASE_SECRET_KEY "
              "(pon secrets en GitHub o api/.env)")
        return 1

    try:
        sb = db.client()
        assert sb is not None, "sin cliente supabase"

        # 1. Lectura barata: cuenta como actividad y verifica conexion.
        r = sb.table("collections").select("id").limit(1).execute()
        n_col = len(r.data or [])
        if a.verbose:
            print(f"[keepalive] collections OK (muestra={n_col})")

        # 2. Escritura minima en heartbeat (si existe la tabla 008_keepalive).
        # Si la tabla no existe aun, el SELECT anterior ya evito la pausa.
        try:
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()
            sb.table("keepalive_heartbeat").upsert(
                {"id": 1, "last_ping": now,
                 "note": "github-actions-keepalive"},
                on_conflict="id").execute()
            if a.verbose:
                print(f"[keepalive] heartbeat upsert OK {now}")
        except Exception as e:
            # No fatal: la tabla es opcional, el SELECT ya cuenta como actividad.
            print(f"[keepalive] heartbeat skip (aplica migracion 008): {e}")

        print(f"[keepalive] OK {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M UTC} "
              f"collections_muestra={n_col}")
        return 0
    except Exception as e:
        print(f"[keepalive] FAIL: {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
