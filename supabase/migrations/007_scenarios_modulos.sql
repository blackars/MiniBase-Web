-- 007_scenarios_modulos.sql - Fases 2-6 Escenarios: partes, tiles, montajes,
-- iluminacion, audio + assets (fotos Cloudinary hot + backup Drive cold).
-- Pegar en SQL Editor -> Run. Idempotente. ASCII puro a proposito.

-- Assets del escenario (fotos/locaciones; Cloudinary hot + Drive backup)
create table if not exists public.scn_assets (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.scn_scenarios(id) on delete cascade,
  kind text not null default 'cover'
    check (kind in ('cover','part','montaje','light','art','render_3d','audio_cover','other')),
  label text,
  cloudinary_public_id text,
  secure_url text not null,
  backup_url text,
  mime_type text, file_size int, width int, height int,
  created_at timestamptz default now()
);
create index if not exists idx_scn_assets_scn on public.scn_assets(scenario_id, kind);

-- Partes reutilizables del escenario
create table if not exists public.scn_parts (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.scn_scenarios(id) on delete cascade,
  name text not null,
  kind text not null default 'suelo',
  w_tiles numeric, d_tiles numeric,
  colors text[] default '{}',
  texture text,
  asset_id uuid references public.scn_assets(id) on delete set null,
  notes text,
  created_at timestamptz default now(),
  unique(scenario_id, name)
);
create index if not exists idx_scn_parts_scn on public.scn_parts(scenario_id);

-- Presets del editor tile (grid JSONB versionado)
create table if not exists public.scn_tile_presets (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.scn_scenarios(id) on delete cascade,
  name text not null,
  cols int not null default 12,
  rows int not null default 8,
  grid jsonb not null default '[]'::jsonb,
  schema_version int not null default 1,
  created_at timestamptz default now(),
  unique(scenario_id, name)
);

-- Montajes: escenario + escenografia de tu base + minis
create table if not exists public.scn_mounts (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.scn_scenarios(id) on delete cascade,
  name text not null,
  notes text,
  composed_url text,
  created_at timestamptz default now(),
  unique(scenario_id, name)
);
create table if not exists public.scn_mount_items (
  id uuid primary key default gen_random_uuid(),
  mount_id uuid not null references public.scn_mounts(id) on delete cascade,
  kind text not null default 'mini' check (kind in ('mini','scenery','part')),
  ref_id uuid,
  x numeric default 0, y numeric default 0, z numeric default 0, rot numeric default 0
);
create index if not exists idx_scn_mount_items on public.scn_mount_items(mount_id);

-- Iluminacion (presets + payload para proyector/tablero)
create table if not exists public.scn_lightings (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.scn_scenarios(id) on delete cascade,
  name text not null,
  mood text not null default 'dia' check (mood in ('dia','atardecer','noche','niebla','custom')),
  params jsonb default '{}'::jsonb,
  projector_payload jsonb default '{}'::jsonb,
  asset_id uuid references public.scn_assets(id) on delete set null,
  unique(scenario_id, name)
);

-- Audio: solo metadatos + URL (binario en Cloudinary/Drive, nunca en Postgres)
create table if not exists public.scn_audios (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.scn_scenarios(id) on delete cascade,
  kind text not null default 'soundtrack' check (kind in ('soundtrack','sfx')),
  genre text, zone text, title text not null,
  url text, duration_s numeric
);
create index if not exists idx_scn_audios_scn on public.scn_audios(scenario_id, kind);

-- RLS espejo (dueno via collections)
alter table public.scn_assets enable row level security;
alter table public.scn_parts enable row level security;
alter table public.scn_tile_presets enable row level security;
alter table public.scn_mounts enable row level security;
alter table public.scn_mount_items enable row level security;
alter table public.scn_lightings enable row level security;
alter table public.scn_audios enable row level security;

drop policy if exists "own scn_assets" on public.scn_assets;
create policy "own scn_assets" on public.scn_assets for all using (
  exists (select 1 from public.scn_scenarios s join public.collections c on c.id = s.collection_id
          where s.id = scenario_id and c.user_id = auth.uid()));
drop policy if exists "own scn_parts" on public.scn_parts;
create policy "own scn_parts" on public.scn_parts for all using (
  exists (select 1 from public.scn_scenarios s join public.collections c on c.id = s.collection_id
          where s.id = scenario_id and c.user_id = auth.uid()));
drop policy if exists "own scn_tiles" on public.scn_tile_presets;
create policy "own scn_tiles" on public.scn_tile_presets for all using (
  exists (select 1 from public.scn_scenarios s join public.collections c on c.id = s.collection_id
          where s.id = scenario_id and c.user_id = auth.uid()));
drop policy if exists "own scn_mounts" on public.scn_mounts;
create policy "own scn_mounts" on public.scn_mounts for all using (
  exists (select 1 from public.scn_scenarios s join public.collections c on c.id = s.collection_id
          where s.id = scenario_id and c.user_id = auth.uid()));
drop policy if exists "own scn_mount_items" on public.scn_mount_items;
create policy "own scn_mount_items" on public.scn_mount_items for all using (
  exists (select 1 from public.scn_mounts m join public.scn_scenarios s on s.id = m.scenario_id
          join public.collections c on c.id = s.collection_id
          where m.id = mount_id and c.user_id = auth.uid()));
drop policy if exists "own scn_lightings" on public.scn_lightings;
create policy "own scn_lightings" on public.scn_lightings for all using (
  exists (select 1 from public.scn_scenarios s join public.collections c on c.id = s.collection_id
          where s.id = scenario_id and c.user_id = auth.uid()));
drop policy if exists "own scn_audios" on public.scn_audios;
create policy "own scn_audios" on public.scn_audios for all using (
  exists (select 1 from public.scn_scenarios s join public.collections c on c.id = s.collection_id
          where s.id = scenario_id and c.user_id = auth.uid()));
