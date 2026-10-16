"""Nombres curados: un Excel viejo re-subido no debe revertir renombres manuales.

`CURATED_NAMES`: nombre entrante (tal cual viene en el Excel) -> nombre oficial.
Se aplica en TODOS los caminos de entrada (bulk_direct, imports legacy, CRUD)
ANTES de slugificar, asi el slug resultante ya es el curado y el upsert
hace match con la fila renombrada en vez de crear un duplicado.

`curate_names.py` aplica estos mismos renombres a filas ya existentes.
"""
import unicodedata

# clave = como viene en el Excel · valor = nombre oficial en la DB
CURATED_NAMES: dict[str, str] = {
    "1, 2, 3, 4, 5, 6, 7, 8, 9, 0": "Números 0-9",
    "A,B, C, D, E, F": "Letras A-F",
}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return " ".join(s.lower().split())


_NORM_MAP = {_norm(k): v for k, v in CURATED_NAMES.items()}


def curate_name(name) -> str:
    """Devuelve el nombre oficial si el entrante es un alias conocido."""
    if name is None:
        return name
    return _NORM_MAP.get(_norm(name), name)
