-- 009_campos_ia.sql — campos para el DM agéntico + conteo tipos/piezas.
-- Todo opcional/nullable: cero riesgo para las filas existentes.
-- Corre en Supabase → SQL Editor. Idempotente (IF NOT EXISTS).

-- 1. Categoría de tamaño estándar (encuentros y posicionamiento del DM)
alter table public.miniatures
  add column if not exists size_category text
  check (size_category in ('tiny','small','medium','large','huge','gargantuan'));

-- 2. Estado de pintado (el DM describe en escena lo presentable)
alter table public.miniatures
  add column if not exists paint_status text
  check (paint_status in ('sin_pintar','base','avanzado','terminada'));

-- 3. Alias / nombres alternativos (buscador y DM entienden apodos)
alter table public.miniatures
  add column if not exists aliases text[] not null default '{}';

-- 4. Ocupación en grid en casillas de lado (puente con el proyector)
alter table public.miniatures
  add column if not exists grid_cells int not null default 1
  check (grid_cells between 1 and 10);

-- 5. Rol en escena (rpg_profile ya tenía system/faction/stats)
alter table public.rpg_profile
  add column if not exists role text;

-- 6. Uso en mesa (el DM aprende las preferidas)
alter table public.gameplay_usage
  add column if not exists play_count int not null default 0,
  add column if not exists is_favorite boolean not null default false,
  add column if not exists last_used_at timestamptz;

-- Índices para filtros del catálogo
create index if not exists idx_minis_size on public.miniatures(size_category);
create index if not exists idx_minis_paint on public.miniatures(paint_status);
