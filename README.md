# MiniBase Web — v2.0

Inventario en la nube para colecciones de miniaturas, diseñado desde el inicio como
**base de datos central para sistemas de IA**: un Dungeon Master agéntico que narra con
inventario real, reconocimiento visual por webcam y tablero proyectado con máquina de estados.

v2.0 web de [MINIBASE v1.0.0](../MINIBASE) (app desktop Python + Tkinter + SQLite, solo local).
Esta versión conserva el modelo de datos de v1 y lo lleva a la nube con un esquema
Postgres preparado para IA, visión por computador y juego de mesa proyectado.

## Qué es y qué alcance tiene

MiniBase Web es la colección viva del usuario: cada miniatura guarda datos físicos,
fotos multi-vista, lore narrativo, perfil RPG y trazabilidad de importación. Todo el
sistema está construido para que esos datos **alimenten modelos y agentes de IA**:

- **DM agéntico**: la API expone el inventario como herramientas (`list_miniatures`,
  `search_semantic`, `get_dataset`, `spawn_scenario`) vía `GET /api/openapi_mcp.json`,
  para que un narrador automático use solo miniaturas que existen de verdad.
- **Búsqueda semántica**: columna `embedding vector(512)` + pgvector en
  `GET /api/agent/search` (p. ej. `?query=dragon`).
- **Dataset para visión por computador**: `GET /api/minis/{id}/dataset` devuelve
  multi-vista + `phash` + embedding por miniatura; el endpoint `POST /vision/match`
  (roadmap) reconocerá minis desde la webcam del tablero.
- **Tablero proyectado**: `table_state` (`phase`, `grid_visible`, `tokens`) es la
  máquina de estados que el proyector lee; la rejilla solo se dibuja en fase
  `movement`, a tamaño físico real calibrado.
- **Agente de completitud**: `missing_fields` + `surveys` + `agent_tasks` detectan
  datos faltantes y los convierten en preguntas editables en el Inbox.

## Capturas

> Placeholder: las capturas web aún no se toman. Guarda cada PNG en `screenshots/`
> con el nombre indicado y aparecerá aquí automáticamente.

### Catálogo

> Placeholder: `screenshots/web-catalogo.png` — grid oscuro, buscador con debounce,
> filtros por tipo y chips de tags con conteos.

![Catálogo](screenshots/web-catalogo.png)

### Detalle de miniatura

> Placeholder: `screenshots/web-detalle.png` — galería Cloudinary por vistas,
> lore, barra de completitud y portada.

![Detalle](screenshots/web-detalle.png)

### Importación desde Excel

> Placeholder: `screenshots/web-imports.png` — subida única, preview de columnas,
> mapeo ES/EN y reporte nuevas/actualizadas/idénticas/versiones.

![Importación](screenshots/web-imports.png)

### Inbox de completitud

> Placeholder: `screenshots/web-inbox.png` — faltantes por campo con edición inline.

![Inbox](screenshots/web-inbox.png)

### Escenarios

> Placeholder: `screenshots/web-escenarios.png` — ficha, partes, editor tile,
> montajes con PNG combinado, iluminación y audio.

![Escenarios](screenshots/web-escenarios.png)

### Proyector

> Placeholder: `screenshots/web-proyector.png` — imagen + rejilla a tamaño real,
> segunda pantalla y tecla G.

![Proyector](screenshots/web-proyector.png)

### v1 desktop (referencia histórica)

![v1 home](screenshots/home_screen.png)

## Stack técnico

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | Next.js 14 App Router + TypeScript + Tailwind, dark | `web/`, despliegue Vercel |
| Backend | FastAPI + Pydantic + Pandas/OpenPyXL | `api/`, despliegue Render/Fly |
| Base de datos | Supabase Postgres 15 + Auth + RLS + pgvector | Esquema en `supabase/migrations/` |
| Fotos (caliente) | Cloudinary, upload firmado, derivados WebP 800px + thumb 200px, EXIF strip | Ruta `minibase/{user}/{collection}/{slug}/{view}` |
| Respaldo (frío) | `backups/` en este repo (Excel + CSV cada 3 días) + Drive/R2 opcional | Ver Backups |
| Auth | Supabase Auth email+password, cada colección exige login, RLS por `auth.uid()` | Registro bloqueado en UI |

Todo gratuito en tier free. Sin `.env` commiteado: `api/.env` y `web/.env.local`
están en `.gitignore`; los ejemplos están en `api/.env.example` y `web/.env.example`.

## Modelo de datos

`users > collections > miniatures (type: mini|scenery|token|tile|prop, quantity,
slug, completeness_score, embedding vector(512)) > visual_metadata > images
(cloudinary_public_id, secure_url, backup_url, phash, 13 vistas canónicas) >
tags + miniature_tags > lore > rpg_profile (stats JSONB, movement, range) >
gameplay_usage > data_sources + imports > missing_fields > surveys >
agent_tasks > table_state` + módulos `scn_*` (escenarios) + `keepalive_heartbeat`.

- `external_key` (de `code_or_reference`) = identidad estable entre importaciones;
  `row_hash` (sha256) detecta filas idénticas para no reescribir.
- Mismo nombre con datos distintos genera versiones `slug-v2`, `slug-v3` en vez de
  perderse como "duplicado".
- 13 vistas canónicas: `frontal, black_background, white_background, lateral_1/2,
  back_view, top_view, bottom_view, close_up, isometric, model_3d, video_gif, other`.

## Funcionalidades

- **Catálogo**: grid oscuro, búsqueda con debounce, paginación 24/50/100, filtros
  por tipo, 11 campos (color, bioforma, material, medidas, diseñador…) y tags en
  lógica O, con facetas y conteos (`/facets/tags`, `/facets/fields`).
- **CRUD + fotos por roles**: `photo` entrena (badge `CV-ready` con 3+ vistas),
  `render_3d`/`concept_art`/`paint_reference` son referencia y no entrenan.
- **Importación Excel**: subida única directa a Postgres (pooler 6543, 1 transacción,
  ~3 s por 500 filas), upsert idempotente por slug, lo entrante no-vacío pisa.
- **Inbox**: miles de `missing_fields` listados por campo, edición inline que
  actualiza mini + completitud + cierra el faltante.
- **Escenarios** (`/escenarios`): ficha, partes con fotos, editor tile por canvas,
  montajes (búsqueda en tu base + PNG combinado vía Pillow a Cloudinary),
  iluminación con payload de proyector, audio por URLs, covers automáticos.
- **Proyector** (`/proyector`): overlay de rejilla a tamaño físico real (calibración
  por ancho de monitor, 96 dpi estimado hasta calibrar), zoom solo a imagen,
  arrastre, tecla G, ventana pop sincronizada por localStorage para 2do monitor.
- **Keepalive + backups automáticos** (GitHub Actions, ver abajo).

## Estructura del repo

```text
MiniBase-Web/
├── web/                 # Next.js 14 (app/, lib/, public/)
├── api/                 # FastAPI (main.py, routers/, services/, scripts/)
│   └── scripts/         # keepalive.py, export_backup.py, bulk_upsert_excel.py, ...
├── supabase/migrations/ # 001_init … 008_keepalive (aplicar en orden en SQL Editor)
├── backups/             # Excel + CSV + manifest.json (generado por Actions)
├── .github/workflows/   # keepalive.yml (cada 2 días), backup-excel.yml (cada 3 días)
├── src/                 # v1 desktop congelada (referencia + migración SQLite)
├── screenshots/         # capturas v1 + placeholders web
├── docs/PROGRESS.md     # checklist por módulo
├── dev_dairy.md         # diario de sesiones
├── 00_SYSTEM_PROMPT.md  # pack anti-pérdida de contexto + prompts P1–P5
└── template.xlsx        # plantilla de importación
```

## Puesta en marcha local

Requisitos: Python 3.11+, Node 18+, proyecto Supabase Free, cuenta Cloudinary.

1. Claves (nunca commitear):
   - Copia `api/.env.example` → `api/.env`: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
     (`sb_secret_…`, solo servidor), Cloudinary, opcional `SUPABASE_DB_PASSWORD`
     (pooler, para cargas masivas) y `CORS_ORIGINS`.
   - Copia `web/.env.example` → `web/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`), `NEXT_PUBLIC_API_URL`.
2. Migraciones en Supabase → SQL Editor, en orden: `001_init.sql`,
   `002_enable_rls.sql`, `003_paquete_editor.sql`, `004_bulk_keys.sql`,
   `005_token_scenery.sql` (o `005_scenarios_fase1.sql` según rama),
   `006_scenario_grid.sql`, `007_scenarios_modulos.sql`, `008_keepalive.sql`.
3. Bootstrap (crea usuario auth + `public.users` + `Mi colección`):
   `python api/scripts/bootstrap_supabase.py tu@email.com`
4. Carga masiva del Excel real: `python api/scripts/bulk_upsert_excel.py archivo.xlsx`
   (`--dry-run` primero, `--sheet` si aplica).
5. Encender: `api_INICIAR.bat` (API :8000, sin `--reload`: cada cambio de código
   exige reiniciar) y `web_INICIAR.bat` (web :3000).
6. Verificar: `http://127.0.0.1:8000/health` → `{"ok":true}`;
   Swagger en `http://127.0.0.1:8000/docs`.

## Backups y anti-pausa (GitHub Actions)

Supabase Free pausa el proyecto tras ~7 días sin actividad; además los datos no
pueden vivir solo en la nube sin clon consultable. Dos workflows lo resuelven:

- **keepalive** (`keepalive.yml`, cada 2 días): `api/scripts/keepalive.py` hace un
  `SELECT` + `upsert` al heartbeat. Requiere secrets `SUPABASE_URL`,
  `SUPABASE_SECRET_KEY`.
- **backup-excel** (`backup-excel.yml`, cada 3 días): `api/scripts/export_backup.py`
  exporta las 17 tablas a `backups/MiniBase_YYYY-MM-DD.xlsx` (multi-hoja + `_INDICE`),
  `backups/MiniBase_latest.xlsx` (link estable), `backups/csv/<tabla>.csv` y
  `backups/manifest.json`, y lo commitea como `minibase-backup-bot`.
  El xlsx se previsualiza en la web de GitHub; los CSV se importan a Google Sheets
  (`Archivo > Importar`) o en vivo con
  `=IMPORTDATA("https://raw.githubusercontent.com/<user>/MiniBase-Web/main/backups/csv/miniatures.csv")`.
  `miniatures.embedding` se excluye a propósito (vector 512).

Nota: si el repo es público, los backups son públicos. Para datos sensibles usa
repo privado o la variante Drive con service account.

## API (resumen)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/minis` | Lista con `q, type, tag/tags, page, page_size` + 11 filtros |
| POST / PUT / DELETE | `/api/minis`, `/api/minis/{id}` | CRUD (JWT requerido, 401 sin login, 403 si no es tuya) |
| GET | `/api/minis/facets/tags`, `/api/minis/facets/fields` | Facetas con conteos |
| GET | `/api/minis/{id}/dataset` | Multi-vista + phash + embedding (dataset CV/DM) |
| POST | `/api/minis/{id}/images/sign` | Firma Cloudinary (`public_id` esperado) |
| POST | `/api/imports/excel/direct` | Carga masiva directa (multipart + `mapping` JSON) |
| GET | `/api/agent/search?query=` | Búsqueda semántica pgvector + filtros |
| GET/POST | `/api/table/state` | Máquina de estados del proyector |
| GET | `/api/openapi_mcp.json` | Manifiesto de tools para DM agéntico |
| GET | `/health` | `{"ok":true}` |

Swagger local: `http://127.0.0.1:8000/docs`.

## Despliegue

- **Web → Vercel**: importa `web/`, envs `NEXT_PUBLIC_*`.
- **API → Render/Fly**: comando `uvicorn main:app`, envs de `api/.env`
  (incluye `SUPABASE_SECRET_KEY`, jamás al frontend).
- **Supabase**: Auth → Providers → Email → desactiva registros públicos si la
  colección es solo tuya; cambia la password temporal tras el primer login.

## Roadmap

- [ ] `002_vector.sql` + `POST /vision/match` (foto webcam → top-5, umbral 0.85)
- [ ] Embeddings CLIP + `phash` al subir imagen (`vision.py`)
- [ ] Backup frío Drive/R2 automático (`backup_url` + `pg_dump` semanal)
- [ ] `spawn_scenario` correlador minis ↔ escenarios para el DM
- [ ] Deploy productivo Vercel + Render

## Licencia

MIT — ver `LICENSE`.
