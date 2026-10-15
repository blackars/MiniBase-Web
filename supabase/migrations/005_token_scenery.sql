-- 005_token_scenery.sql — Dimensiones para tokens/escenografía.
-- Idempotente. diameter_mm en visual_metadata (tokens traen Diameter 16-25).
alter table public.visual_metadata add column if not exists diameter_mm numeric;
