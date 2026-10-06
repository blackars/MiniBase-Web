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
