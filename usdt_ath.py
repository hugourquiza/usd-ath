#!/usr/bin/env python3
"""Indica si el USDT/ARS está en all time high.

Fuentes (públicas, sin API key):
- Precio actual: CriptoYa, en tiempo real. Se toma la mediana del precio de
  venta (ask) de todos los exchanges, que no se mueve por un exchange
  con precio disparatado.
- Histórico diario: ArgentinaDatos, serie "dólar cripto" (desde feb-2023).

Se compara el precio de venta.
"""

import json
import statistics
import sys
import time
import urllib.request
from datetime import date

CURRENT_URL = "https://criptoya.com/api/usdt/ars/1"
HISTORY_URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/cripto"
# Se ignoran cotizaciones de exchanges que no actualizaron en este tiempo.
MAX_QUOTE_AGE_SECONDS = 600


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "usdt-ath/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def get_current_price():
    data = fetch_json(CURRENT_URL)
    now = time.time()
    asks = [
        float(quote["ask"])
        for quote in data.values()
        if quote.get("ask") and now - quote["time"] <= MAX_QUOTE_AGE_SECONDS
    ]
    if not asks:
        raise ValueError("ningún exchange tiene cotización reciente")
    return statistics.median(asks)


def get_history_ath():
    """Devuelve (precio, fecha) del máximo histórico de cierre diario."""
    history = fetch_json(HISTORY_URL)
    best = max(history, key=lambda row: float(row["venta"]))
    return float(best["venta"]), best["fecha"]


def format_ars(value):
    # Formato argentino: punto de miles, coma decimal.
    return "$" + f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def format_date(iso):
    return date.fromisoformat(iso).strftime("%d/%m/%Y")


def main():
    try:
        current = get_current_price()
        ath, ath_date = get_history_ath()
    except Exception as exc:  # red caída, JSON inválido, etc.
        print(f"Error consultando las APIs: {exc}", file=sys.stderr)
        return 1

    print(f"USDT/ARS actual: {format_ars(current)}")
    if current >= ath:
        print("¡Está en all time high!")
    else:
        print(
            f"No está en all time high. El último all time high fue de "
            f"{format_ars(ath)} el {format_date(ath_date)}."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
