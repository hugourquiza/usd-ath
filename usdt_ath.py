#!/usr/bin/env python3
"""Indica si el USDT/ARS está en all time high en Binance.

Todo sale de la API pública de datos de mercado de Binance (sin API key),
así que el precio actual y el histórico son de la misma fuente:
- Precio actual: último trade del par USDTARS.
- Histórico: velas diarias (en hora Argentina) desde que existe el par
  (abr-2023). El all time high es el máximo (high) de esas velas.
"""

import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

# Espejo de solo lectura de api.binance.com, que bloquea algunas regiones.
API_URL = "https://data-api.binance.vision/api/v3"
SYMBOL = "USDTARS"
KLINES_LIMIT = 1000  # máximo que permite Binance por pedido
# Argentina no tiene horario de verano: siempre UTC-3.
ARGENTINA_TZ = timezone(timedelta(hours=-3))


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "usdt-ath/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def to_argentina(ms):
    return datetime.fromtimestamp(ms / 1000, ARGENTINA_TZ)


def get_current_price():
    """Devuelve (precio, momento) del último trade."""
    trade = fetch_json(f"{API_URL}/trades?symbol={SYMBOL}&limit=1")[0]
    return float(trade["price"]), to_argentina(trade["time"])


def get_history_ath():
    """Devuelve (precio, fecha) del máximo histórico, incluyendo el día de hoy."""
    klines = []
    start = 0
    while True:
        page = fetch_json(
            f"{API_URL}/klines?symbol={SYMBOL}&interval=1d&timeZone=-3:00"
            f"&startTime={start}&limit={KLINES_LIMIT}"
        )
        klines.extend(page)
        if len(page) < KLINES_LIMIT:
            break
        start = page[-1][0] + 1

    # Cada vela: [open_time, open, high, low, close, ...]
    best = max(klines, key=lambda k: float(k[2]))
    return float(best[2]), to_argentina(best[0]).date()


def format_ars(value):
    # Formato argentino: punto de miles, coma decimal.
    return "$" + f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def main():
    try:
        current, updated_at = get_current_price()
        ath, ath_date = get_history_ath()
    except Exception as exc:  # red caída, JSON inválido, etc.
        print(f"Error consultando la API de Binance: {exc}", file=sys.stderr)
        return 1

    print(f"USDT/ARS actual (Binance): {format_ars(current)}")
    print(f"Última actualización: {updated_at:%d/%m/%Y %H:%M:%S} (hora Argentina)")
    if current >= ath:
        print("¡Está en all time high!")
    else:
        print(
            f"No está en all time high. El último all time high fue de "
            f"{format_ars(ath)} el {ath_date:%d/%m/%Y}."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
