-- 008_keepalive.sql — tabla heartbeat para el keepalive (opcional pero recomendada).
-- El workflow .github/workflows/keepalive.yml hace SELECT + upsert aqui cada 2 dias.
-- Sin RLS restrictivo: solo service_role escribe (el script usa SECRET_KEY en servidor).

create table if not exists public.keepalive_heartbeat (
  id int primary key,
  last_ping timestamptz default now(),
  note text
);

alter table public.keepalive_heartbeat enable row level security;

-- Lectura publica autenticada (para dashboard futuro), escritura solo service_role.
-- Con service_role el RLS se salta, asi que no hace falta policy de escritura.
drop policy if exists "read heartbeat" on public.keepalive_heartbeat;
create policy "read heartbeat" on public.keepalive_heartbeat
  for select using (true);

insert into public.keepalive_heartbeat (id, last_ping, note)
values (1, now(), 'init')
on conflict (id) do nothing;
