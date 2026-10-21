# DEV DAIRY — MiniBase Web (rama `minibase-web`)

Diario de todo lo realizado en esta sesión: objetivos, decisiones, qué se resolvió,
qué quedó pendiente y por qué la carga masiva fue lenta. Para retomar con contexto fresco.

---

## 1. Objetivo general del usuario

Convertir **MiniBase** (app desktop Python + Tkinter + SQLite) en plataforma web en la nube que sirva
como **base de datos central del inventario real de miniaturas** para un futuro sistema de IA agéntica:
DM automático, reconocimiento por webcam (CV), tablero proyectado con máquina de estados.
Requisitos: stack gratuito, datos privados (auth), fotos controladas (Cloudinary ya en uso + Drive),
carga por lotes desde su Excel real (~600 filas), y poder completar miles de campos faltantes poco a poco.

## 2. Stack congelado (decisión)

- **Frontend:** Next.js 14 + TS + Tailwind + dark (`web/`, deploy futuro Vercel).
- **Backend:** FastAPI + Pandas/OpenPyXL (`api/`, deploy futuro Render/Fly).
- **DB:** Supabase Postgres + Auth + RLS + pgvector.
  - Proyecto: `https://kxhxzxvxgufwfkzccsak.supabase.co` (ref `kxhxzxvxgufwfkzccsak`).
  - Claves nuevas (publishable/secret, no legacy anon/service_role) guardadas en
    `web/.env.local` y `api/.env` (gitignored, nunca commitear).
- **Fotos (decisión híbrida):** Cloudinary = tier caliente (galería/CV/proyector, derivados WebP vía eager).
  Cloud name `dgff8o52c` + API key/secret en `api/.env`. Drive = bóveda fría (originales + respaldo).
- **Rama:** todo en `minibase-web` (salida de `master`).

## 3. Lo resuelto (verificado funcionando)

1. **Scaffold P1–P3**: CRUD completo (crear/editar/borrar/buscar/detalle), import Excel, API agent-ready
   (`/api/agent/search`, `/api/table/state`, `/api/openapi_mcp.json`).
2. **Bug heredado corregido**: `creation_module.py` insertaba `name[0]` (1 letra); documentado.
3. **Migración 001**: 17 tablas (`collections`, `miniatures` con `type` mini|scenery|token|tile|prop,
   `visual_metadata`, `images`, `lore`, `tags`, `rpg_profile`, `gameplay_usage`, `imports`,
   `missing_fields`, `surveys`, `agent_tasks`, `table_state`) + RLS por usuario + pgvector.
   Fallo inicial del seed (tags sin usuario) corregido; `002_enable_rls.sql` como parche.
4. **Auth solo-usuario**: landing de login a pantalla completa (sin sesión no se ve nada),
   email+password por REST directo (el wrapper GoTrue de supabase-js 2.117 rompía `fetch`;
   se pineó `2.44.4` + login manual). Cuenta: `miniaturesab@gmail.com` / `prueba123`.
   Registro bloqueado en UI (falta 1 clic servidor: Auth → Providers → Email → Allow new signups OFF).
   API exige JWT en CRUD (`401` sin login, `403` si no es tuyo); cada login crea su `Mi colección`.
5. **Mapeo Excel real** (`ALL MINIS DB Online.xlsx`, hoja `Miniatures Data`, 625 filas / 595 válidas):
   20/21 columnas mapeadas ES/EN con tildes, decimales con coma, tags con `, ; |`.
   Hallazgos: columna `ID` trae basura (`son 2`, `x2`, `??`) → se ignora; la referencia real era
   `code_or_referene` (typo) → alias agregado y guardado.
6. **Upsert idempotente por slug**: re-subir jamás duplica; lo entrante no-vacío pisa, lo vacío conserva.
7. **Plan 2 rendimiento**: lista en joins embebidos + total, paginación 24/50/100, búsqueda con debounce,
   filtros por tipo + chips de tags con conteos (`/facets/tags` → 16 tags). Medido: 24 filas ~2s.
8. **Galería por roles**: fotos (entrenan, badge `CV-ready` con 3+) vs `render_3d`/`concept_art`/
   `paint_reference` (referencia, NO entrenan). Regla: sintéticas etiquetadas NO se suben aquí.
   Firma Cloudinary real verificada. Requiere correr `003_paquete_editor.sql` (pendiente por el usuario).
9. **Inbox de completitud** (`/inbox`): ~3000 faltantes listados por campo, edición inline que actualiza
   mini + completitud + cierra el faltante.
10. **Limpieza**: se comprobó que los 7291 `missing_fields` eran legítimos (0 duplicados reales).

## 4. Estado de datos al cierre

- **~590/595 minis en Supabase** (colección `75c08f62…`, usuario `miniaturesab@gmail.com`).
  Faltan ~5 filas finales (chunks 19–24 quedaron a medias al detener el proceso).
- Script de carga detenido a petición (`import_full.py`, job `full-f7b1ecbd` en estado `running`;
  reanudar = mismo job_token; re-subir el archivo = bloqueado por hash como `already`).

## 5. Pendientes

1. Reanudar/finalizar ~5 filas restantes (o cargarlas a mano, a elección).
2. Correr `supabase/migrations/003_paquete_editor.sql` en SQL Editor (roles de imagen, índices
   pg_trgm, columnas ledger, índice único de faltantes).
3. Supabase → Auth → Email → Allow new signups OFF (bloqueo total de registro).
4. Cambiar password `prueba123` por definitiva.
5. Deploy Vercel (web) + Render (API) con envs (guía en `GUIA_PASO_A_PASO.md`).
6. Backup Drive automático (endpoint `POST /api/images/backup` existe; falta OAuth Drive).
7. Dataset CV/entrenamiento ( embeddings `pgvector`, `cv_ready`).

## 6. Por qué la carga fue lenta (explicación pedida, sin más chunks)

- **Causa raíz, no es la base de datos**: Postgres haría 595 filas en segundos. El problema fue mi
  diseño: cada operación abría una **conexión HTTPS nueva desde cero** (~300–500 ms) vía
  `supabase-py` con cliente fresco por llamada, y hacía **10–17 llamadas secuenciales por fila**
  (mini + visual + lore + tags uno por uno + faltantes uno por uno). 595 × ~12 llamadas ≈ 7000
  handshakes TLS. Horas en vez de segundos.
- **Agravantes**: reintentos ×3 ante microcortes ("Server disconnected") que triplicaban picos;
  token JWT de 1h que mataba el script a mitad; mis propios reinicios de API (6+) que abortaban
  el chunk en curso; el endpoint de lista colgado porque uvicorn de 1 worker estaba ocupado
  con el lote (por eso el frontend se veía vacío).
- **Cómo hacerlo bien (sin chunks lentos)**:
  a) **Reutilizar una sola conexión HTTPS** (cliente httpx persistente) → baja latencia 5–10x.
  b) **Bulk real**: 1 insert por tabla por lote (ya implementado en `_bulk_create`, ~6 queries/chunk).
  c) **Conexión directa Postgres** (pooler Supabase puerto 6543 + password del proyecto):
     `executemany` server-side, 595 filas en segundos. Requiere la DB password
     (Supabase → Settings → Database). Es la opción correcta para cargas masivas futuras.
  d) Separar **carga masiva** (job directo a Postgres) de **API transaccional** (REST por fila,
     perfecto para CRUD del día a día).
  e) `pg_trgm` + índices de `003` para que búsqueda/filtros vuelen con miles de filas.

## 7. Archivos clave (rama `minibase-web`)

- `00_SYSTEM_PROMPT.md` — pack anti-pérdida de contexto + 5 prompts por módulo.
- `EMPEZAR_HOY.md`, `GUIA_PASO_A_PASO.md` — guías.
- `api/main.py`, `api/routers/{minis,imports,agent,table,media}.py`, `api/services/db.py`.
- `api/scripts/{migrate_sqlite,bootstrap_supabase}.py`.
- `web/app/page.tsx`, `web/app/{imports,inbox}/page.tsx`, `web/lib/supabase.ts`.
- `supabase/migrations/{001_init,002_enable_rls,003_paquete_editor}.sql`.
- `api_INICIAR.bat`, `web_INICIAR.bat` — re-encender local (API :8000, web :3000).
- Credenciales solo en `api/.env` y `web/.env.local` (gitignored).

## 8. Lecciones de esta sesión

- Probar el camino feliz completo con 5 filas antes de lanzar 600.
- Un job largo necesita: ledger + hash anti-duplicado + token auto-renovable + proceso separado
  (todo eso quedó implementado, pero tarde).
- No reiniciar el servidor con trabajo en curso; 1 worker = 1 tarea pesada bloquea lecturas.
- Preguntar el formato real del Excel ANTES (typo `code_or_referene`, columna `ID` basura).

---

## 9. Sesión 2026-09-30 — carga masiva directa + filtros + tags (rama `minibase-web`)

### 9.1 Password DB y conexión directa (usuario la reseteó y entregó)
- Guardada solo en `api/.env` como `SUPABASE_DB_PASSWORD` (gitignored, verificado
  con `git check-ignore`). Documentada en `api/.env.example` sin secretos.
- Pooler verificado: `aws-0-sa-east-1.pooler.supabase.com:6543`, usuario
  `postgres.<ref>`. Resetear el DB password NO rompe nada actual (el app usa
  `SUPABASE_URL` + `PUBLISHABLE/SECRET` por PostgREST, no el password).
- `psycopg2-binary` agregado a `api/requirements.txt`.

### 9.2 Camino bulk directo (nuevo, ~8 queries / 1 transacción)
- `supabase/migrations/004_bulk_keys.sql` (APLICADA): `miniatures.external_key`
  (clave estable = `code_or_reference` normalizado; los slugs cambian siempre) +
  `miniatures.row_hash` (sha256 del payload entrante no-vacío: hash igual =
  idéntico = 0 writes) + índices. Backfill solo con códigos ÚNICOS por colección
  (los duplicados reales como `F` quedan en NULL y usan slug).
- `api/services/pg.py`: 1 conexión pooler por job bulk (nunca 1 por fila).
- `api/services/bulk_direct.py`: `bulk_upsert()` — 1 SELECT liviano
  (id+slug+key+hash), detalle SOLO de modificadas, writes con `executemany` en
  1 transacción. Regla no-vacío pisa. Tags en 3 queries. `missing_fields` en
  1 delete + 1 insert. Historial `imports` en savepoint (si falta `003`, el fallo
  no revierte los datos — bug real encontrado y corregido).
- `api/scripts/bulk_upsert_excel.py`: CLI semanal (`--dry-run` / real).
- `api/routers/imports_direct.py` + registro en `api/main.py`:
  `POST /api/imports/excel/direct` (multipart 1 upload, `mapping` JSON opcional).
- `web/app/imports/page.tsx`: reescrito a upload único directo (adiós 12 chunks
  de 50 + `jobToken` nuevo por clic). Muestra nuevas/actualizadas/idénticas/
  versiones + banner verde `✓ Carga completada <fecha/hora>` en carga real.
- Medido contra DB real: dry-run 500 filas 3.2s; 3 nuevas 7.1s; re-subida
  idéntica 3.3s con 0 escrituras; renombre con mismo código = 1 update, 0 dupes.
- Real 595 filas dry-run: 2.9s → 11 nuevas (versiones), 584 actualizarían
  (estampado único de hashes), 0 errores.

### 9.3 Migración 003 aplicada (estaba pendiente)
- `supabase/migrations/003_paquete_editor.sql` (APLICADA): hubo que agregar
  deduplicación previa de `missing_fields` (el camino REST viejo dejó duplicados
  que bloqueaban el índice `uq_missing_open`).

### 9.4 Versionado mismo-nombre-datos-distintos (corrige "duplicados" falsos)
- Antes (viejo y bulk inicial): 2ª aparición del nombre = "duplicado en el
  archivo", se perdía. Ej. `Star Vampire` ×3 (12.4g/84mm, 12.7g/65mm, 12.1g/57mm).
- Ahora: hash distinto → `slug-v2`, `slug-v3`…; hash idéntico → duplicado exacto
  (se omite, no es error). Reporte `versions[]` visible en UI.
- Regla: el orden del Excel define v1/v2 — no reordenar versiones; blindaje real =
  llenar `code_or_reference` (`external_key`, identidad a prueba de reorden/renombre).
- Archivo real: 11 versiones detectadas (Star Vampire v2/v3, Hombre Lobo v2/v3…).

### 9.5 `code_or_reference` retenido + `label` persistido
- Preview y bulk ELIMINABAN columnas totalmente vacías → `code_or_referene`
  (0/595 con dato) jamás aparecía en el mapeo. Ahora se retienen columnas vacías
  pero mapeadas (`imports.py`, `bulk_direct.py`).
- `label`/`lore_is_canon` existían en DB pero NINGÚN camino los guardaba
  (tampoco el CRUD). Agregados a `MiniIn`, `sb_create/get/list/update`, bulk y
  formulario web (Marca/sello + Lore canon). Backfill quirúrgico aplicado:
  346 labels + 2 canon desde el Excel real (dry-run previo, 0 sin match).
- UI: detalle ya mostraba `Ref:`; crear/editar ya tenía Año/Ref; sumado Marca/sello.

### 9.6 Filtros por 11 campos + X en búsqueda
- Backend: `sb_list_minis(..., filters)` (visual_metadata + lore, 1 query de mids
  + 1-2 a hijas + IN; numéricos por `eq` exacto), `sb_field_facets()` (valores +
  conteos, 3 queries), `GET /api/minis/facets/fields`, params en `list_minis`
  (con fallback demo-local). Verificado: `material=PLA → 125`,
  `PLA+criatura → 26`, imposible → 0, `altura=34 → 40`.
- Frontend: panel Filtros con 11 selects (conteos), contador + Limpiar filtros,
  X para limpiar búsqueda, facetas recargadas tras guardar/borrar.

### 9.7 Tags: convención Capitalizado + lógica O
- `api/services/tags.py`: `canon_tag()` (Fantasy, General Culture, Sci-Fi;
  siglas ≤4 intactas: AB!, D&D), `key_tag()`, `is_junk()` (bloquea `N/A`→`N`/`A`
  y letras sueltas en los 3 caminos). Aplicado en `clean_tags`, `_ensure_tags`,
  bulk y formulario web (canonicaliza al guardar).
- Fusionado `General culture`(1) → `General Culture`(14) con re-apunte de links
  (dry-run previo). 0 duplicados casefold restantes. Huérfanos sin minis
  (`D&D`, `Horda`, `TestBench` de pruebas) se van con el reseteo.
- Filtro de tags Y→O: `Fantasy(128)+Terror(63) → 191`. Chips etiquetados
  "cualquiera". Fallback demo también en O.

### 9.8 Operativa
- uvicorn sin `--reload`: CADA cambio de código exige matar proceso y re-arrancar
  (`taskkill /PID …` + `api_INICIAR.bat`; el PID viejo sin ventana retiene `:8000`
  → error 10048). Web en dev recarga sola con `Ctrl+Shift+R`.
- Inventario verificado en 590 tras cada prueba (limpieza `slug like 'zzz-%'`).
- +2 minis tras carga real del usuario: candidatas = filas `-v2/-v3` creadas a
  propósito + pares mismo-slug (`Dracula`/`Drácula`) antes colapsados; pendiente
  de verificación del usuario; se normaliza con el reseteo desde cero acordado.

### 9.9 Maqueta Escenarios + migración del trabajo a repo MiniBase-Web
- El proyecto vigente es `blackars/MiniBase-Web` (repo propio, rama `main`), no la rama
  `minibase-web` del repo `MiniBase`. Se clonó local y se portó: página
  `web/app/escenarios/`, migración `005_scenarios_fase1.sql`, router
  `api/routers/scn_scenarios.py`, registro en `api/main.py`, botón `◈ Escenarios`
  en dashboard. La `003` del repo nuevo se dejó intacta (equivalente funcional).
- Maqueta: gate de login, 7 pestañas (Ficha funcional desde §10.5; resto mock con
  placeholders + contador "próximamente"), canvas tile 12×8, catálogo API futura.
- Reglas: `render_3d` (cualquier color); sintéticas etiquetadas NO se suben aquí
  (solo fotos, arte y 1 render de referencia); roles photo (entrena) vs
  reference/video (no entrenan).

## 10. Plan: módulo Escenarios dentro de la DB MiniBase (mismo proyecto Supabase)

Decisión: **mismo proyecto/supabase, esquema separado por prefijo `scn_` + `collection_id`
como frontera**. Nada de segundo proyecto ni microservicios físicos por ahora; cada tarjeta
de la maqueta = un router FastAPI + tablas propias (modularidad lógica, monolito desplegable).

### 10.1 Dónde vive cada cosa (separado de la colección de miniaturas)
- Minis por `collections.id` del usuario; escenarios en paralelo con
  `scn_scenarios.collection_id` (mismo dueño, **cero mezcla**; correlación solo por IDs
  en tablas puente).
- Imágenes de escenarios en `scn_assets` futura (misma convención Cloudinary
  `minibase/{user}/scn/{slug}/{vista}`); audio solo metadatos + URL.

### 10.2 Tablas (migración `005_scenarios.sql` y siguientes)
- `scn_scenarios` (fase 1, creada en §10.5): ficha completa + RLS espejo.
- `scn_parts` + `scn_part_variants`, `scn_tile_presets` (grid JSONB + `schema_version`),
  `scn_mounts` + `scn_mount_items(kind=scenery|mini|part, ref_id, x,y,z,rot)` (sin FK
  dura cruzada), `scn_lightings` (+`projector_payload` para `/table/state`),
  `scn_audios` (solo metadatos).

### 10.3 API por módulos (`api/routers/scn_*.py`)
- Ficha CRUD + `GET /dataset` (contexto narrador/DM); partes; tile presets + validate;
  montajes + `combine-png`; `project` al tablero; todo con idempotencia del ledger.

### 10.4 Orden: 1 ficha ✓ (§10.5) → 2 partes → 3 tile → 4 montajes+PNG →
5 iluminación+proyector → 6 audio → 7 correlador minis↔escenarios.

### 10.5 Fase 1 ejecutada (ficha funcional)
- Migración `supabase/migrations/005_scenarios_fase1.sql` (solo `scn_scenarios` + RLS).
- `api/routers/scn_scenarios.py` (`/api/scenarios` CRUD + `GET /{id}/dataset`;
  dataset = ficha + arrays vacíos hasta fases 2-6). Requiere correr `003` + `005`
  en SQL Editor (sin eso, 409 con la instrucción).
- Web: pestaña Ficha funcional (lista + formulario 13 campos + borrar).

### 10.6 Rejilla proyectada de tamaño real (fase 1b, repo MiniBase-Web)
- Regla: escenarios SIN rejilla horneada; el sistema la dibuja encima solo on-demand.
- Migración `006_scenario_grid.sql`: `grid_cell_cm` (decimales), `grid_color`,
  `grid_opacity` en `scn_scenarios`. API acepta los 3 (409 guía a 006 si falta).
- Ficha: `Tile cm` rotulado como cantidad con decimales + inputs celda/color/opacidad
  (defaults 2.5cm, verde, 0.6).
- Página `/proyector`: selector de escenario (hereda celda/color), carga de imagen
  local, toggle rejilla ON/OFF, zoom 0.25–4x, calibración por ancho físico del monitor
  (px/cm medido = ancho_px / ancho_cm × zoom; se guarda en localStorage), overlay SVG
  que recalcula con resize. Segunda pantalla: `getScreenDetails` (Chrome/Edge) abre
  `/proyector?pop=1` en el otro monitor; fallback a fullscreen local.
- PENDIENTE usuario: correr `006` en SQL Editor (crear con rejilla da 409 hasta entonces).
- Mudanza a repo vigente: servidores dev ahora corren desde `MiniBase-Web`
  (`.env` copiados, gitignored); árbol viejo queda congelado.
- Fix rejilla invisible: era `cellPx = 0` sin calibrar (GridOverlay retorna null).
  Ahora estima 96dpi CSS hasta calibrar; tecla **G** alterna rejilla (solo movimiento);
  ventana pop sincronizada por localStorage (`mb_proj`: imagen dataURL, grid, zoom,
  celda, baseEff + ancho pantalla para re-calibrar tamaño real en el 2do monitor).
- Rejilla congelada a 1.0x (zoom solo a imagen) + arrastre del fondo (mouse/táctil,
  con recentrar; pan sincronizado al pop).
- Servidores dev mudados al árbol `MiniBase-Web` (api :8000 + web :3000 con sus `.env`).

### 10.7 Fases 2-6 ejecutadas (módulos escenarios con fotos)
- Migración `007_scenarios_modulos.sql`: `scn_assets` (Cloudinary hot + backup Drive cold),
  `scn_parts`, `scn_tile_presets` (grid JSONB), `scn_mounts` + `scn_mount_items`,
  `scn_lightings` (+`projector_payload`), `scn_audios` (solo metadatos). RLS espejo en todas.
- API `api/routers/scn_modules.py` (`/api/scn/...`, login + propiedad por colección):
  assets sign/complete/list/delete/backup, minis lookup (para montajes con tu base),
  parts CRUD, tiles CRUD, mounts CRUD + items + `combine` (Pillow compone PNG por capas
  y lo sube a Cloudinary como WebP + asset kind=montaje), lighting CRUD, audios CRUD.
  Sin `007`: 409 con la guía (verificado en 5 endpoints; `_need007` central en `_own`).
- Web `/escenarios` funcional por pestaña con selector de escenario: Partes (+fotos
  part/art/render_3d), Editor Tile (pintar canvas, guardar/cargar presets),
  Montajes (buscar minis/escenografía de tu base, agregar piezas, combinar PNGs),
  Iluminación (presets día/atardecer/noche/niebla + fotos), Audio (soundtracks + sfx
  con player, URLs Drive/Cloudinary), API (documenta endpoints activos).
- PENDIENTE usuario: correr `007_scenarios_modulos.sql` en SQL Editor.
- Fotos por vistas en editar ficha: `Gallery` (13 vistas esquema + referencia) ahora
  vive también dentro del formulario de edición (antes solo en el modal detalle);
  en creación pide guardar primero. Portadas del grid: `POST /api/images/covers`
  (1 query, frontal > render_3d > concept_art > 1ra foto) + portada grande en detalle.
- Ficha de escenario con locaciones: `AssetStrip cover/art/render_3d` + backup Drive.
- Fix `Invalid Signature` Cloudinary: se firmaba `exif=false` pero el navegador no lo
  enviaba (Cloudinary firma EXACTAMENTE lo enviado). Quitado de `scn/assets/sign`
  (el de minis ya estaba bien). Firma re-verificada localmente: match True.

---

## 11. Sesión 2026-10-15 — keepalive anti-pausa + backups Excel cada 3 días

Motivo: Supabase Free pausa el proyecto sin actividad (~7 días) y todos los datos
vivían solo en Supabase, sin clon consultable.

### 11.1 Keepalive (anti-pausa)
- `api/scripts/keepalive.py` (nuevo): `SELECT` barato a `collections` + `upsert` a
  `keepalive_heartbeat`. Sale 0 si hubo actividad, 1 si falló. Lee `SUPABASE_URL` +
  `SUPABASE_SECRET_KEY` de env o `api/.env` (vía `services.db`).
- `supabase/migrations/008_keepalive.sql` (nueva, APLICADA por el usuario en SQL Editor):
  tabla `public.keepalive_heartbeat(id, last_ping, note)` + RLS con solo lectura.
- `.github/workflows/keepalive.yml` (nuevo): cron `17 8 */2 * *` (cada 2 días) +
  `workflow_dispatch`. Instala `supabase` y corre el script con secrets.
- Verificado local: `collections_muestra=1` OK; heartbeat dio `PGRST205` antes de
  aplicar la 008 (esperado, el SELECT ya evitaba la pausa).

### 11.2 Backups Excel/CSV al repo (clon consultable)
- `api/scripts/export_backup.py` (nuevo): exporta las 17 tablas con paginado
  `range()` (PostgREST limita a 1000) a `backups/MiniBase_YYYY-MM-DD.xlsx`
  (multi-hoja + `_INDICE`) + `backups/MiniBase_latest.xlsx` (link estable) +
  `backups/csv/<tabla>.csv` + `backups/manifest.json`. `miniatures.embedding`
  (vector 512) se excluye a propósito; JSONB se serializa a texto.
- `.github/workflows/backup-excel.yml` (nuevo): cron `23 7 */3 * *` (cada 3 días) +
  manual; instala `supabase+pandas+openpyxl`, exporta y commitea solo
  `backups/MiniBase_*.xlsx + csv/*.csv + manifest.json` como
  `minibase-backup-bot` (`[skip ci]`).
- Verificado local contra DB real: 709 miniatures, 709 visual/lore, 643 links,
  7400 missing_fields, 10.217 filas totales, xlsx 657 KB. Test en
  `Temp/opencode/minibase_backup_test` (no se commiteó).
- Sheets en vivo (sin código): `=IMPORTDATA("https://raw.githubusercontent.com/blackars/MiniBase-Web/main/backups/csv/miniatures.csv")`.
- OJO: repo público = backups públicos. Si hay datos sensibles, pasar repo a
  privado o migrar a variante Drive con service account.

### 11.3 Pasos manuales (hechos por el usuario) + push
- Corrió `008_keepalive.sql` en SQL Editor.
- Agregó secrets `SUPABASE_URL` + `SUPABASE_SECRET_KEY` en GitHub Actions.
- Este commit pushea: `.github/`, `api/scripts/{keepalive,export_backup}.py`,
  `008_keepalive.sql`, `backups/.gitkeep`, `backups/csv/.gitkeep` + este dairy.
- Pendiente: `Run workflow` manual en `keepalive-supabase` y `backup-excel` para
  verificar el primer backup commiteado; comprobar que `MiniBase_latest.xlsx`
  abre en preview web.

---

## 12. Sesión 2026-10-16 — conteo por tipos + campos IA para el DM (plan aprobado)

Decisión del usuario: el conteo principal son **tipos únicos** (709), no piezas
(972). Sin la palabra "mini" en la UI. `626 & 624` (Lilo & Stitch) y `R2D2`
(Star Wars) son nombres reales: se quedan.

### 12.1 Limpieza (EJECUTADA en Supabase)
- `api/services/curate.py` (nuevo): `CURATED_NAMES` + `curate_name()` — mapa
  nombre-Excel → nombre oficial, aplicado ANTES de slugificar en los 2 caminos
  de importación (`bulk_direct` y legacy `imports.py`), así un Excel viejo
  re-subido hace match con la fila curada en vez de duplicar/revertir.
- `api/scripts/curate_names.py` (nuevo, idempotente, verifica slugs libres).
  Ejecutado: `1, 2, 3…9, 0` → `Números 0-9` (`numeros-0-9`, token ×10);
  `A,B, C, D, E, F` → `Letras A-F` (`letras-a-f`, token ×6).
- Duplicados revisados: los 10 grupos ya están bien versionados v2/v3
  (Star Vampire ×3, Hombre Lobo ×3, etc.), 0 acciones. Par Dracula/Drácula por
  tilde ya resuelto como `dracula` + `dracula-v2`.

### 12.2 Migración 009 (CREADA, pendiente correr en SQL Editor)
- `supabase/migrations/009_campos_ia.sql`: `miniatures.size_category`
  (tiny…gargantuan), `paint_status` (sin_pintar/base/avanzado/terminada),
  `aliases text[]`, `grid_cells` (1–10); `rpg_profile.role`;
  `gameplay_usage.play_count/is_favorite/last_used_at` + 2 índices.
- `ubicación física` descartada a petición (varía mucho en el apartamento).
- Todo nullable/opcional: 0 riesgo para las 709 filas.

### 12.3 API (código listo, exige 009 aplicada)
- `MiniIn` + `sb_create/get/update/list` con los 7 campos; `rpg_profile.role`;
  `gameplay_usage` con upsert; `GET /api/minis/stats` → `sb_stats()`
  (verificado: 709 tipos, 972 piezas: 596+197+179).
- `list_minis`: filtros directos `size_category/paint_status/grid_cells` (+ demo).
- `GET /{id}/dataset` deja de ser stub: ficha + bloque `ia` + vistas + embedding.
- `imports.py`: grupo `ia` en CANON + 20 alias ES/EN + `clean_list()` (alias sin
  canonicalizar); cleaners int/bool para grid/play/favorito en ambos caminos.
- `bulk_direct.py`: conserva nuevos campos en merge, los escribe en
  insert/update, y ahora SÍ guarda `rpg_profile` + `gameplay_usage` en bulk
  (antes los ignoraba). `export_backup.py` incluye las 4 columnas nuevas.
- OJO: hasta correr 009, no re-correr bulk ni export (SELECT con columnas
  inexistentes falla). El backup de Actions en main sigue con código viejo:
  funciona igual hasta pushear esto + aplicar 009.

### 12.4 Web (código listo)
- `page.tsx`: header `{tipos} tipos · {piezas} piezas` vía `/stats` (carga en
  login/restaurar/guardar/borrar); `+ Nuevo tipo`; paginación en tipos;
  formulario con Tamaño/Pintado/Alias/Casillas/Rol/Partidas/Favorita;
  filtros Tamaño + Pintado (13 campos); detalle muestra bloque IA + alias.
- `inbox`: "actualiza el tipo"; `minis/[id]`: "Tipo {id}".
- Verificado: `py_compile` OK (9 archivos), `tsc --noEmit` limpio.

### 12.5 Backfill (script listo, correr DESPUÉS de 009)
- `api/scripts/backfill_ia.py [--dry-run]`: tamaño por bandas de altura
  (tiny<15, small<28, medium<55, large<110, huge<220, si no gargantuan);
  grid por diámetro/peana (≤32→1, ≤60→2, ≤120→3, si no 4);
  facción NO se infiere (texto libre por sistema) → va al Inbox.
  Regenera `missing_fields` abiertos de los 4 campos para curado manual.
- Siguiente: usuario corre 009 → yo corro backfill + prueba end-to-end
  (reiniciar API, header, filtros, dataset) → commit/push.

### 12.6 Backfill + end-to-end EJECUTADOS (009 aplicada por el usuario)
- `backfill_ia.py` falló 2 veces antes del OK, ambas corregidas en el script:
  1) medidas en `visual_metadata` (no en `miniatures`) → JOIN agregado;
  2) ~900 UPDATEs secuenciales superaban 120 s → `execute_values` en batch;
  3) `uuid = text` → cast `::uuid` + UUIDs nativos en missing.
  Resultado: 517 `size_category`, 359 `grid_cells`>1, 2319 faltantes nuevos
  (medium) al Inbox. Facción no inferida (texto libre por sistema).
- Export con columnas nuevas OK: 827 KB, 12.537 filas (verificado en temp,
  no commiteado).
- API: había un uvicorn VIEJO (PID 14732, del 15/10) ocupando :8000 — el primer
  test dio código viejo. Kill + arranque desde `MiniBase-Web/api`.
  **Hallazgo: `api_INICIAR.bat` apunta al árbol viejo (`MINIBASE\MiniBase\api`);
  hay que actualizarlo o seguirá levantando código obsoleto.**
- End-to-end autenticado OK: `/stats` → 709 tipos / 972 piezas;
  filtro `size_category=medium` → 430; `dataset` con bloque `ia` completo;
  CREATE con los 7 campos → GET los devuelve → facetas IA presentes →
  DELETE limpió la fila de prueba. Guardias 401 sin token OK.
- `sb_field_facets` extendido a `size_category/paint_status` (si no, los
  selects Tamaño/Pintado salían vacíos); API reiniciada (nuevo PID).
- Pendiente: probar en navegador (header tipos/piezas, formulario, filtros),
  actualizar `api_INICIAR.bat`, commit/push.

### 12.7 Servidores apuntaban al árbol viejo (CORREGIDO)
- Causa del reporte "no salen las opciones / header viejo": la web en :3000
  corría desde `MINIBASE\MiniBase\web` (PIDs 7276/4496, del 15/10), igual que
  había pasado con la API. Ambos `.bat` apuntaban al árbol viejo.
- `api_INICIAR.bat` y `web_INICIAR.bat` corregidos a `MiniBase-Web/...`.
- Procesos viejos matados; web nueva levantada desde `MiniBase-Web\web`
  (verificado: :3000 responde, página compila). API :8000 OK.
- OJO navegador: hacer Ctrl+Shift+R (caché) para ver "709 tipos · 972 piezas".

### 12.8 Fixes foto + guardado
- Subida Cloudinary 403 `missing permissions (create)`: la key tenía rol
  Media Library User. Usuario la pasó a Master Admin → upload+destroy de
  prueba OK. Añadido hint en la UI cuando salga ese error.
- `Error al guardar: [object Object]`: era un 422 Pydantic
  (`body.is_favorite: Input should be a valid boolean`) — el form envía
  `is_favorite: null` con el select en "—" y `MiniIn` lo exigía `bool`.
  Fix: `Optional[bool]`. Además `errText()` formatea detail (string, lista
  de validación o JSON) para que ningún error vuelva a verse como objeto.
  Verificado: mismo payload que fallaba ahora PUT 200. API reiniciada.

---

## 13. Sesión 2026-10-18 — optimización WebP previa a carga + limpieza real en Cloudinary al borrar

### 13.1 Conversión automática a WebP antes de subir (calidad q90, pérdida <10%)
**Problema:** la subida va directo navegador → Cloudinary (la API solo firma), así que
si el paso cliente no llegaba a ejecutarse, Cloudinary guardaba el JPG/PNG original sin comprimir.
Nuevo archivo `web/lib/optimize.ts` con `toWebP(file)`: Canvas `createImageBitmap`
(`imageOrientation: "from-image"` para respetar EXIF) con calidad `WEBP_QUALITY = 0.9`.
- Fallback seguro: devuelve el archivo original si no se puede decodificar (HEIC),
  navegador sin encoder WebP, es GIF animado, ya es WebP (evita pérdida acumulada)
  o el WebP pesa igual/más que el original.
Integra en ambos puntos de subida: `web/app/page.tsx` (`Gallery.upload`, fotos de minis)
y `web/app/escenarios/page.tsx` (`uploadAsset`, cover/part/art/render_3d/light/montaje).
Mensaje UI: `"Optimizing to WebP…"`; `file_size` registrado refleja el WebP.

### 13.2 Garantía en el cloud (transformación de entrada firmada)
La capa cliente es un intento; la garantía definitiva es servidor. `api/routers/minis.py`
y `api/routers/scn_modules.py` firman ahora `transformation=f_webp,q_90` junto al `eager`,
por lo que Cloudinary convierte y almacena el original como WebP calidad 90 **siempre**,
independiente de lo que envíe el navegador. Los derivados eager (detalle + thumb) se
generan desde el WebP normalizado y siguen como URL canónica. El frontend envía
`transformation` solo si la API la firma (compatibilidad con API vieja, sin "Invalid Signature").

### 13.3 Limpieza real al borrar (no dejaba huérfanos en Cloudinary)
Nuevo servicio `api/services/cloudinary_ops.py` (`destroy_asset` + `cleanup_assets` con
`invalidate=True`, borra original y todos sus derivados). Si `CLOUDINARY_*` no está en
`.env`, devuelve `skipped` sin romper el flujo.
Conectado en los 5 caminos de borrado:
- `DELETE /api/images/{image_id}` (`media.py`) — fila + archivo de esa foto.
- `DELETE /api/minis/{id}` (`minis.py`) — captura los `cloudinary_public_id` de sus fotos
  **antes** del cascade de Supabase y destruye cada una; devuelve conteo `cloudinary_deleted/expected`.
- `DELETE /api/scn/assets/{aid}` (`scn_modules.py`) — fila + asset.
- `DELETE /api/scenarios/{id}` (`scn_scenarios.py`) — fila + todos sus assets del escenario.
- Si Cloudinary no responde, el delete no explota: la UI avisa con `cloudinary_deleted`
  distinto de `ok`/`not found` (imagen/asset), o alerta `deleted / X/Y` en minis/escenario.

### 13.4 Verificación
- `py_compile` OK en los 5 routers de API + `cloudinary_ops.py`.
- `npx tsc --noEmit --skipLibCheck` en `web/` limpio.
- `next build` compila (8 páginas, 0 errores).
- Pendiente usuario: reiniciar ambos servidores (`api_INICIAR.bat`, `web_INICIAR.bat`) y
  `Ctrl+Shift+R` en el navegador (caché). Los JPGs ya subidos antes de este cambio siguen
  pesados en la cuenta de Cloudinary (la transformation aplica solo a subidas nuevas).

---

## 14. Sesión 2026-10-16 — UI completa al inglés (decisión permanente)

Decisión del usuario: **de ahora en más toda la UI es en inglés**.
El código/comentarios pueden seguir en español; los valores guardados en DB
NO se tocan. Solo se tradujo lo visible en `web/app/`.

### 13.1 Alcance (7 archivos, solo strings visibles)
- `web/app/layout.tsx`: `lang="es"` → `"en"`, meta description → inglés.
- `web/app/page.tsx` (dashboard): login, header (types/pieces, Sign in/out),
  buscador, filtros (13 labels), tags, paginación, tarjetas, modal detalle,
  formulario completo (30+ labels/placeholders), galería (Photos/Reference,
  Upload photo, Signing/Uploading/Saving, hints Cloudinary en inglés),
  confirms/alerts (`Delete …?`, `Name is required`, `Error saving/deleting`).
- `web/app/imports/page.tsx`: flujo 1-2-3, dry-run, reporte
  (new/updated/skipped/identical, versions, fill-rate, missing).
- `web/app/inbox/page.tsx`: título, contador, Field/all, missing, Save,
  completeness.
- `web/app/minis/[id]/page.tsx`: placeholder → inglés.
- `web/app/escenarios/page.tsx`: tabs renombradas
  `Ficha/Partes/Editor Tile/Montajes/Iluminación` →
  `Sheet/Parts/Tile Editor/Mounts/Lighting` (API/Audio iguales);
  **OJO: se actualizaron los 5 comparadores `tab === …`, el default
  `useState("Sheet")` y el gate `tab !== "Sheet"`** — dejar uno en español
  deja la pestaña en blanco.
- `web/app/proyector/page.tsx`: Projector, Detected screens, Scenario,
  Grid cell, Scenario zoom, Grid ON/OFF, Send to 2nd screen, calibración,
  Drag to explore · recenter, mensajes pop/fullscreen.

### 13.2 Reglas de traducción (para futuros cambios)
- **Valores DB intactos**: `type` (mini/scenery/token/tile/prop),
  `size_category`, `paint_status` (`sin_pintar/base/avanzado/terminada`),
  `kind` escenario (`fisico/digital/hibrido`), `kind` parte
  (`suelo/rio/puente/…`), `mood` luz (`dia/atardecer/noche/niebla/custom`)
  se GUARDAN igual; solo el `<option>` muestra inglés
  (ej. `value="sin_pintar">unpainted`, `value="suelo">floor`,
  `value="dia">day`). Si agregas un enum nuevo, mantén `value` español/actual
  y traduce solo la etiqueta.
- `stats.tipos/stats.piezas` son nombres de campo de la API: NO renombrar,
  solo las etiquetas que los rodean (`types/pieces`).
- Todo string nuevo visible va en inglés desde ahora. Comentarios de código
  pueden seguir en español.

### 13.3 Verificación
- `npx tsc --noEmit` en `web/` limpio tras el cambio.
- Incidente en el proceso: un reemplazo no-op sobre
  `{msg && <p …>{msg}</p>}` comió el `}` final en 6 líneas de
  `escenarios/page.tsx` (tsc lo delató); restaurado y re-verificado.
- Pendiente usuario: `Ctrl+Shift+R` en el navegador para ver la UI en inglés;
  commit/push de los 7 archivos.

---

## 15. Sesión 2026-10-21 — acceso de invitado (solo lectura) + Sign in en el header

### 15.1 Comportamiento
- La app abre directo como **invitado** sin pedir login: galería con buscador,
  filtros (tipo, tags, 13 campos) y paginación sobre la colección default.
- Invitado = solo lectura: sin `+ New type`, Import Excel, Complete, Scenarios,
  sin botones Edit/Delete ni subida de fotos ni backup Drive. El modal de detalle
  y la galería funcionan en modo lectura.
- Caja superior derecha: si no hay sesión muestra **Sign in** (abre modal);
  si hay sesión mantiene `Signed in as … / Sign out`. El modal solo permite
  iniciar sesión, no crear cuentas. Al cerrar sesión vuelve a invitado y recarga.

### 15.2 API — lectura pública, escritura protegida
- `routers/minis.py`: nuevo `_optional_uid()` (None sin token).
  GET públicos: `/facets/tags`, `/stats`, `/facets/fields`, `/`, `/{id}`, `/{id}/dataset`.
  POST/PUT/DELETE siguen con `_require_uid()` → 401.
- `routers/media.py`: `_optional_uid()`; GET `/by-mini/{id}` y POST `/covers`
  públicos (comprueban propiedad solo si hay token). `/complete`, `/backup`,
  `DELETE /{id}` siguen protegidos.
- Sin token, la API resuelve la colección bootstrap (`get_default_collection`),
  así el invitado ve los datos reales sin exponer escritura.
- Fix: se restauró el decorador `@router.post("/{mini_id}/images/sign")` que se
  había perdido en una edición de `get_dataset` (la ruta de subida daba 404).
- Fix: indentación inválida en `get_dataset` (except del try interno) que impedía
  compilar `minis.py`.

### 15.3 Web
- `web/app/page.tsx`: se eliminó la "PUERTA TOTAL"; el `useEffect` inicial intenta
  restaurar sesión y, si no hay, entra como invitado y carga todo sin token.
- Header: bloque Sign in / Signed in + Sign out; modal `showLogin` (email+password,
  sin registro) con Enter para enviar.
- Acciones de escritura y botones Edit/Delete ocultos con `user &&`; `Gallery`
  recibe `canUpload`/`canDelete` y oculta upload, selector de vista y backup Drive
  en invitado.
- `loadCovers`, `loadFacets`, `loadFieldFacets`, `loadStats` omiten el header
  Authorization si no hay token; el debounce del buscador ya corre en invitado.
- `/imports`, `/inbox`, `/escenarios`, `/proyector` siguen redirigiendo a `/`
  cuando no hay sesión.

### 15.4 Verificación
- `py_compile` OK en `minis.py` y `media.py`.
- `npx tsc --noEmit --skipLibCheck` limpio; `next build` OK (8 páginas).
- TestClient sin Authorization: `/api/minis` 200 (709 tipos), `/stats` 200
  (709/972), facetas 200, `/covers` 200, `/by-mini` 200.
- Guardias: POST `/api/minis` 401, POST `/images/complete` 401, sign 401,
  DELETE mini 401, GET `/api/scenarios` 401.
- API reiniciada en vivo (uvicorn :8000) y verificada sin Authorization:
  `/stats` 200 (709/972), `/api/minis` 200 (709), tags 22, `/api/scenarios` 401.
- `next dev` reiniciado tras el `next build` (el build pisó `.next` y provocó un
  500 temporal en :3000); la home responde 200.
- Pendiente usuario: `Ctrl+Shift+R` en el navegador para ver el modo invitado.
