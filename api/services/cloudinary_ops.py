"""Cleanup real en Cloudinary al borrar piezas/escenarios/assets.

destroy_asset borra el asset original Y todos sus derivados (eager, thumbs,
crops). Si CLOUDINARY_* no está configurado en api/.env, no rompe el flujo:
solo devuelve "skipped" y la UI lo puede avisar.
"""
import os


def destroy_asset(public_id: str | None, resource_type: str = "image") -> str:
  """Borra 1 asset de Cloudinary. Devuelve 'ok' | 'not found' | 'skipped' | 'error'."""
  if not public_id:
    return "skipped"
  cloud = os.getenv("CLOUDINARY_CLOUD_NAME", "")
  key = os.getenv("CLOUDINARY_API_KEY", "")
  secret = os.getenv("CLOUDINARY_API_SECRET", "")
  if not (cloud and key and secret):
    return "skipped"
  try:
    import cloudinary
    import cloudinary.uploader
    cloudinary.config(cloud_name=cloud, api_key=key, api_secret=secret)
    res = cloudinary.uploader.destroy(
      public_id, resource_type=resource_type, invalidate=True)
    return str(res.get("result", "error"))
  except Exception as e:
    print(f"[cloudinary_ops] destroy {public_id}: {e}")
    return "error"


def cleanup_assets(public_ids, resource_type: str = "image") -> int:
  """Borra una lista de assets; devuelve cuántos se limpiaron de verdad."""
  ok = 0
  for pid in public_ids or []:
    if destroy_asset(pid, resource_type) in ("ok", "not found"):
      ok += 1
  return ok
