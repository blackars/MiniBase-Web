"""Backup Supabase -> Excel + CSV commiteado al repo (cada 3 dias via Actions).

Que genera (en --out, default <repo>/backups):
  MiniBase_YYYY-MM-DD.xlsx   (multi-hoja, una por tabla — se abre en GitHub web y en Sheets)
  MiniBase_latest.xlsx       (copia del ultimo, link estable)
  csv/<tabla>.csv            (uno por tabla — IMPORTDATA en Google Sheets)
  manifest.json              (fecha, conteos por tabla)

Uso local:
  python api/scripts/export_backup.py
  python api/scripts/export_backup.py --out backups --verbose

En GitHub Actions usa secrets SUPABASE_URL + SUPABASE_SECRET_KEY.
Local usa api/.env (mismo loader que services.db).

Google Sheets en vivo (opcional, sin codigo extra):
  =IMPORTDATA("https://raw.githubusercontent.com/<user>/MiniBase-Web/main/backups/csv/miniatures.csv")
  Se actualiza solo cada ~1h. El xlsx es el historico, el CSV es el "casi tiempo real".

Tablas que NO se exportan tal cual:
  - miniatures.embedding (vector 512) se excluye del Excel (rompe openpyxl);
    queda constancia en manifest.json como embedding_excluido=N.
"""
import argparse
import datetime
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

TABLES = [
    "collections",
    "miniatures",
    "visual_metadata",
    "images",
    "lore",
    "tags",
    "miniature_tags",
    "rpg_profile",
    "gameplay_usage",
    "data_sources",
    "imports",
    "missing_fields",
    "surveys",
    "survey_questions",
    "agent_tasks",
    "table_state",
    "keepalive_heartbeat",
]

PAGE = 1000


def fetch_table(sb, table: str, verbose: bool = False) -> list[dict]:
    """Pagina con range() porque PostgREST limita a 1000 filas por request."""
    rows: list[dict] = []
    off = 0
    while True:
        try:
            # embedding se excluye aqui mismo si existe (evita payload gigante)
            if table == "miniatures":
                sel = ("id,collection_id,name,slug,type,status,quantity,source,"
                       "external_id,completeness_score,size_category,paint_status,"
                       "aliases,grid_cells,created_at,updated_at")
                page = sb.table(table).select(sel).order("created_at").range(off, off + PAGE - 1).execute()
            else:
                page = sb.table(table).select("*").range(off, off + PAGE - 1).execute()
        except Exception as e:
            # Tabla puede no existir (migracion no aplicada) -> hoja vacia con aviso
            print(f"[backup] {table}: skip ({e})")
            return []
        data = page.data or []
        rows.extend(data)
        if verbose:
            print(f"[backup] {table} +{len(data)} (total {len(rows)})")
        if len(data) < PAGE:
            break
        off += PAGE
    return rows


def sanitize(rows: list[dict]) -> list[dict]:
    """JSONB/dicts a texto para que openpyxl y CSV no fallen."""
    out = []
    for r in rows:
        nr = {}
        for k, v in r.items():
            if isinstance(v, (dict, list)):
                nr[k] = json.dumps(v, ensure_ascii=False)
            else:
                nr[k] = v
        out.append(nr)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="",
                    help="carpeta destino (default: <repo>/backups)")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()

    try:
        import pandas as pd  # noqa: F401
    except ImportError:
        print("[backup] FAIL: pip install pandas openpyxl supabase")
        return 1

    from services import db

    if not db.is_configured():
        print("[backup] FAIL: sin SUPABASE_URL / SUPABASE_SECRET_KEY")
        return 1

    repo = pathlib.Path(__file__).resolve().parent.parent.parent
    out = pathlib.Path(a.out) if a.out else (repo / "backups")
    csv_dir = out / "csv"
    out.mkdir(parents=True, exist_ok=True)
    csv_dir.mkdir(parents=True, exist_ok=True)

    sb = db.client()
    assert sb is not None, "sin cliente supabase"

    day = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    frames: dict[str, list[dict]] = {}
    counts: dict[str, int] = {}
    for t in TABLES:
        try:
            rows = fetch_table(sb, t, verbose=a.verbose)
        except Exception as e:
            print(f"[backup] {t}: ERROR {e}")
            rows = []
        rows = sanitize(rows)
        frames[t] = rows
        counts[t] = len(rows)

    # --- Excel multi-hoja ---
    xlsx = out / f"MiniBase_{day}.xlsx"
    latest = out / "MiniBase_latest.xlsx"
    try:
        import pandas as pd

        with pd.ExcelWriter(xlsx, engine="openpyxl") as w:
            for t, rows in frames.items():
                sheet = t[:31]  # limite Excel
                if rows:
                    pd.DataFrame(rows).to_excel(w, sheet_name=sheet, index=False)
                else:
                    pd.DataFrame([{"_nota": "tabla vacia o no existe aun"}]).to_excel(
                        w, sheet_name=sheet, index=False)
            # Hoja indice primero (openpyxl la deja al final; la movemos al inicio)
            idx = pd.DataFrame(
                [{"tabla": t, "filas": counts[t]} for t in TABLES])
            idx.to_excel(w, sheet_name="_INDICE", index=False)
            ws = w.book["_INDICE"]
            w.book.move_sheet("_INDICE", offset=-len(w.book.sheetnames) + 1)
            for col in ws.columns:
                ws.column_dimensions[col[0].column_letter].width = 28
        # copia estable para link fijo
        latest.write_bytes(xlsx.read_bytes())
        print(f"[backup] xlsx OK: {xlsx.name} ({xlsx.stat().st_size // 1024} KB)")
    except Exception as e:
        print(f"[backup] FAIL escribiendo xlsx: {e}")
        return 1

    # --- CSV por tabla (para IMPORTDATA en Sheets) ---
    try:
        import pandas as pd

        for t, rows in frames.items():
            fp = csv_dir / f"{t}.csv"
            if rows:
                pd.DataFrame(rows).to_csv(fp, index=False)
            else:
                fp.write_text("_nota\ntabla vacia o no existe aun\n", encoding="utf-8")
        print(f"[backup] csv OK: {len(frames)} archivos en csv/")
    except Exception as e:
        print(f"[backup] WARN csv: {e}")

    manifest = {
        "fecha_utc": day,
        "generado_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "tablas": counts,
        "total_filas": sum(counts.values()),
        "nota_embedding": "miniatures.embedding excluido a proposito (vector 512)",
        "xlsx": xlsx.name,
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[backup] OK total_filas={manifest['total_filas']} -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
