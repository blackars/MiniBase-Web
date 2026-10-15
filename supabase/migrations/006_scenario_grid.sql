-- 006_scenario_grid.sql - Rejilla proyectada de tamano real (fase 1b).
-- Los escenarios NO llevan rejilla horneada: el sistema la dibuja encima
-- solo cuando se indica, con celdas de N cm con decimales, calibrada al
-- monitor y adaptada al zoom. Pegar en SQL Editor -> Run. Idempotente.
-- ASCII puro a proposito.

alter table public.scn_scenarios add column if not exists grid_cell_cm numeric;
alter table public.scn_scenarios add column if not exists grid_color text default '#22ff88';
alter table public.scn_scenarios add column if not exists grid_opacity numeric default 0.6;
