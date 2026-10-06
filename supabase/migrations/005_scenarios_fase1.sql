-- 005_scenarios_fase1.sql - Modulo Escenarios, fase 1: ficha.
-- Pegar en SQL Editor -> Run. Idempotente.
-- NOTA: archivo en ASCII puro a proposito (tildes/utf8 rompen el pegado).
-- Frontera: collection_id del dueno; ningun query de minis toca scn_* y viceversa.

create table if not exists public.scn_scenarios (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  name text not null,
  slug text not null,
  kind text not null default 'fisico' check (kind in ('fisico','digital','hibrido')),
  width_cm numeric, depth_cm numeric, height_cm numeric, tile_cm numeric,
  palette text[] default '{}',
  texture text,
  uses jsonb default '[]'::jsonb,
  description text,
  comments text,
  url text,
  genre text,
  visibility text not null default 'private' check (visibility in ('private','shared')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(collection_id, slug)
);
create index if not exists idx_scn_collection on public.scn_scenarios(collection_id);
create index if not exists idx_scn_genre on public.scn_scenarios(genre);

alter table public.scn_scenarios enable row level security;
drop policy if exists "own scenarios" on public.scn_scenarios;
create policy "own scenarios" on public.scn_scenarios for all using (
  exists (select 1 from public.collections c
          where c.id = collection_id and c.user_id = auth.uid()));
