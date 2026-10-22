#!/usr/bin/env python3
"""Indica si el USDT/ARS está en all time high en Binance.

Todo sale de la API pública de datos de mercado de Binance (sin API key),
así que el precio actual y el histórico son de la misma fuente:
- Precio actual: último trade del par USDTARS.
- Histórico: velas diarias (en hora Argentina) desde que existe el par
  (abr-2023). El all time high es el máximo (high) de esas velas.
- Gráfico: velas de 2 horas de los últimos 7 días, dibujadas en ASCII.
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
CHART_DAYS = 7
CHART_INTERVAL = "2h"  # 12 columnas por día: 84 en total
CHART_HEIGHT = 12


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


def get_recent_closes():
    """Devuelve [(momento, cierre)] de las velas de los últimos CHART_DAYS días."""
    start = datetime.now(timezone.utc) - timedelta(days=CHART_DAYS)
    klines = fetch_json(
        f"{API_URL}/klines?symbol={SYMBOL}&interval={CHART_INTERVAL}"
        f"&startTime={int(start.timestamp() * 1000)}&limit={KLINES_LIMIT}"
    )
    return [(to_argentina(k[0]), float(k[4])) for k in klines]


def ascii_chart(points):
    """Dibuja los cierres como una línea, con eje de precios y de días."""
    closes = [price for _, price in points]
    low, high = min(closes), max(closes)
    span = (high - low) or 1
    rows = [int(round((p - low) / span * (CHART_HEIGHT - 1))) for p in closes]

    grid = [[" "] * len(rows) for _ in range(CHART_HEIGHT)]
    for x, row in enumerate(rows):
        # Une cada punto con el anterior con un trazo vertical.
        prev = rows[x - 1] if x else row
        for r in range(min(prev, row) + 1, max(prev, row)):
            grid[r][x] = "│"
        grid[row][x] = "•"

    labels = [format_ars(low + span * r / (CHART_HEIGHT - 1)) for r in range(CHART_HEIGHT)]
    width = max(len(label) for label in labels)
    lines = []
    for r in reversed(range(CHART_HEIGHT)):
        # Etiqueta solo en los extremos y el medio, para no saturar el eje.
        label = labels[r] if r in (0, CHART_HEIGHT // 2, CHART_HEIGHT - 1) else ""
        lines.append(f"{label:>{width}} ┤" + "".join(grid[r]))
    lines.append(" " * width + " └" + "─" * len(rows))

    # Fecha debajo de la primera vela de cada día.
    axis = [" "] * (len(rows) + 5)
    last_day = None
    for x, (moment, _) in enumerate(points):
        if moment.date() != last_day and axis[x] == " " and (x == 0 or axis[x - 1] == " "):
            axis[x:x + 5] = f"{moment:%d/%m}"
        last_day = moment.date()
    lines.append(" " * (width + 2) + "".join(axis).rstrip())
    return "\n".join(lines)


def format_ars(value):
    # Formato argentino: punto de miles, coma decimal.
    return "$" + f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def main():
    try:
        current, updated_at = get_current_price()
        ath, ath_date = get_history_ath()
        recent = get_recent_closes()
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
    print()
    print(f"Cotización de los últimos {CHART_DAYS} días (cierres cada {CHART_INTERVAL}):")
    print(ascii_chart(recent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
