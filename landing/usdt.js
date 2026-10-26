// Port a JS de usdt_ath.py: misma fuente (API pública de Binance), mismos
// datos y mismo mensaje. Lo comparten las dos versiones de la landing, que
// muestran el dólar de la tab elegida: cripto (Binance) o CCL.
(function () {
  // Espejo de solo lectura de api.binance.com, que bloquea algunas regiones.
  // Los pedidos salen siempre del navegador de quien visita la página.
  const API_URL = "https://data-api.binance.vision/api/v3";
  const SYMBOL = "USDTARS";
  const KLINES_LIMIT = 1000; // máximo que permite Binance por pedido
  const CHART_DAYS = 7;
  const CHART_INTERVAL = "2h"; // 12 velas por día: 84 en total
  const CHART_HEIGHT = 12;

  // CCL: precio en vivo de DolarApi e historial diario (desde 2013) de ArgentinaDatos.
  const CCL_CURRENT_URL = "https://dolarapi.com/v1/dolares/contadoconliqui";
  const CCL_HISTORY_URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoconliqui";
  // Riesgo país de Ámbito, se muestra en las dos tabs con su crédito.
  const RIESGO_PAIS_URL = "https://mercados.ambito.com//riesgopais/variacion";

  async function getJson(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  function fetchJson(path) {
    return getJson(API_URL + path);
  }

  // Argentina no tiene horario de verano: siempre UTC-3.
  const dateFmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const dayMonthFmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit",
  });

  function formatDate(ms) { return dateFmt.format(ms); }
  function formatTime(ms) { return timeFmt.format(ms).replace(",", ""); }
  function formatDayMonth(ms) { return dayMonthFmt.format(ms); }

  // Formato argentino: punto de miles, coma decimal.
  function formatArs(value) {
    return "$" + value.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Devuelve {price, time} del último trade. */
  async function getCurrentPrice() {
    const [trade] = await fetchJson(`/trades?symbol=${SYMBOL}&limit=1`);
    return { price: parseFloat(trade.price), time: trade.time };
  }

  /**
   * Devuelve {price, time} del máximo histórico, incluyendo el día de hoy.
   * Se pide una sola vez por carga: la usan la elección de versión y la página.
   */
  let athPromise = null;
  function getHistoryAth() {
    athPromise ??= fetchHistoryAth().catch((exc) => { athPromise = null; throw exc; });
    return athPromise;
  }

  async function fetchHistoryAth() {
    const klines = [];
    let start = 0;
    while (true) {
      const page = await fetchJson(
        `/klines?symbol=${SYMBOL}&interval=1d&timeZone=-3:00` +
        `&startTime=${start}&limit=${KLINES_LIMIT}`
      );
      klines.push(...page);
      if (page.length < KLINES_LIMIT) break;
      start = page[page.length - 1][0] + 1;
    }
    // Cada vela: [open_time, open, high, low, close, ...]
    const best = klines.reduce((a, b) => (parseFloat(b[2]) > parseFloat(a[2]) ? b : a));
    return { price: parseFloat(best[2]), time: best[0] };
  }

  /**
   * Devuelve [{time, close}] de las velas de los últimos `days` días (null:
   * desde que existe el par). Alcanza con un pedido mientras el intervalo
   * elegido no dé más de KLINES_LIMIT velas.
   */
  async function getCloses(days, interval) {
    const start = days == null ? 0 : Date.now() - days * 24 * 3600 * 1000;
    const klines = await fetchJson(
      `/klines?symbol=${SYMBOL}&interval=${interval}` +
      `&startTime=${start}&limit=${KLINES_LIMIT}`
    );
    return klines.map((k) => ({ time: k[0], close: parseFloat(k[4]) }));
  }

  /** Variación porcentual de las últimas 24 horas. */
  async function get24hChange() {
    const ticker = await fetchJson(`/ticker/24hr?symbol=${SYMBOL}`);
    return parseFloat(ticker.priceChangePercent);
  }

  // --- CCL ---

  /** Medianoche de Argentina del día de `ms`. */
  function dayStart(ms) {
    return Math.floor((ms - AR_OFFSET) / 86400000) * 86400000 + AR_OFFSET;
  }

  /** Devuelve {price, time} del CCL en vivo (precio de venta). */
  async function getCclCurrent() {
    const ccl = await getJson(CCL_CURRENT_URL);
    return { price: ccl.venta, time: Date.parse(ccl.fechaActualizacion) };
  }

  /**
   * Devuelve [{time, close}] con la venta de cada día desde 2013. Se pide una
   * sola vez por carga: ArgentinaDatos se actualiza una vez por día.
   */
  let cclHistoryPromise = null;
  function getCclHistory() {
    cclHistoryPromise ??= getJson(CCL_HISTORY_URL)
      .then((days) => days.map((d) => ({ time: Date.parse(`${d.fecha}T00:00:00-03:00`), close: d.venta })))
      .catch((exc) => { cclHistoryPromise = null; throw exc; });
    return cclHistoryPromise;
  }

  /** Devuelve {price, time} del máximo histórico del CCL. */
  async function getCclHistoryAth() {
    const best = (await getCclHistory()).reduce((a, b) => (b.close > a.close ? b : a));
    return { price: best.close, time: best.time };
  }

  /**
   * Cierres diarios de los últimos `days` días (null: todos). ArgentinaDatos
   * va atrasado y a veces repite el día anterior, así que el día de hoy sale
   * del precio en vivo.
   */
  async function getCclCloses(days) {
    const [history, current] = await Promise.all([getCclHistory(), getCclCurrent()]);
    const today = dayStart(current.time);
    const start = days == null ? 0 : Date.now() - days * 86400000;
    return [...history.filter((p) => p.time >= start && p.time < today), { time: today, close: current.price }];
  }

  /** Variación porcentual contra el cierre del día anterior. */
  async function getCclChange() {
    const [history, current] = await Promise.all([getCclHistory(), getCclCurrent()]);
    const prev = history.filter((p) => p.time < dayStart(current.time)).pop();
    return (current.price / prev.close - 1) * 100;
  }

  /** "1.234,5" -> 1234.5 */
  function parseArNumber(text) {
    return parseFloat(text.replace(/\./g, "").replace(",", "."));
  }

  /**
   * Devuelve {value, change, time}: el último riesgo país en puntos básicos y
   * la variación porcentual del día.
   */
  async function getRiesgoPais() {
    // {"ultimo": "765", "fecha": "26-10-2026", "variacion": "8,20%", ...}
    const rp = await getJson(RIESGO_PAIS_URL);
    const [d, m, y] = rp.fecha.split("-");
    return {
      value: parseArNumber(rp.ultimo), change: parseArNumber(rp.variacion),
      time: Date.parse(`${y}-${m}-${d}T00:00:00-03:00`),
    };
  }

  /** "765 pb (+8,20%)" */
  function formatRiesgoPais({ value, change }) {
    const sign = change > 0 ? "+" : change < 0 ? "−" : "±";
    const pct = Math.abs(change).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${value.toLocaleString("es-AR")} pb (${sign}${pct}%)`;
  }

  // --- Tabs: cada una es un dólar con sus fuentes ---

  const SOURCES = {
    cripto: {
      tab: "Dólar cripto", href: "./", name: "USDT/ARS en Binance", provider: "Binance",
      kicker: "Arde el dólar cripto", credit: "Datos públicos de Binance, precio cada 10 segundos",
      chartNote: `cierres cada ${CHART_INTERVAL}, últimos ${CHART_DAYS} días`, changeLabel: "en 24 h",
      daily: false, refreshMs: 10000,
      getCurrentPrice, getHistoryAth, getCloses, get24hChange,
      getRecentCloses: () => getCloses(CHART_DAYS, CHART_INTERVAL),
      ranges: [
        { key: "24h", label: "24 h", title: "Últimas 24 horas", days: 1, interval: "15m" },
        { key: "7d", label: "7 d", title: "Últimos 7 días", days: 7, interval: "2h" },
        { key: "30d", label: "30 d", title: "Últimos 30 días", days: 30, interval: "8h" },
        { key: "1a", label: "1 año", title: "Último año", days: 365, interval: "1d" },
        { key: "todo", label: "Todo", title: "Desde abril de 2023", days: null, interval: "3d" },
      ],
    },
    ccl: {
      tab: "CCL", href: "./?dolar=ccl", name: "Contado con liqui", provider: "DolarApi y ArgentinaDatos",
      kicker: "Arde el contado con liqui", credit: "Precio de DolarApi cada minuto e historial diario de ArgentinaDatos",
      chartNote: `cierres diarios, últimos ${CHART_DAYS} días`, changeLabel: "vs. día anterior",
      daily: true, refreshMs: 60000,
      getCurrentPrice: getCclCurrent, getHistoryAth: getCclHistoryAth, getCloses: getCclCloses, get24hChange: getCclChange,
      getRecentCloses: () => getCclCloses(CHART_DAYS),
      ranges: [
        { key: "7d", label: "7 d", title: "Últimos 7 días", days: 7 },
        { key: "30d", label: "30 d", title: "Últimos 30 días", days: 30 },
        { key: "1a", label: "1 año", title: "Último año", days: 365 },
        { key: "todo", label: "Todo", title: "Desde 2013", days: null },
      ],
    },
  };
  const source = new URLSearchParams(location.search).get("dolar") === "ccl" ? SOURCES.ccl : SOURCES.cripto;

  /** Links de las tabs, con aria-current en la activa. */
  function tabLinks() {
    return Object.values(SOURCES).map((s) =>
      `<a href="${s.href}"${s === source ? ' aria-current="page"' : ""}>${s.tab}</a>`).join("");
  }

  // Por encima de este valor del devaluómetro se muestra la versión fuego.
  const FIRE_THRESHOLD = 0.509;

  /**
   * Devaluómetro: dónde está el precio entre el mínimo de `recent` (0) y el
   * all time high (1).
   */
  function devaluometro(current, ath, recent) {
    const low = Math.min(...recent.map((p) => p.close));
    return Math.max(0, Math.min(1, (current - low) / (ath - low || 1)));
  }

  /** "fuego" o "moderno", según el devaluómetro. */
  function pickVersion(heat) {
    return heat > FIRE_THRESHOLD ? "fuego" : "moderno";
  }

  /**
   * Si la versión montada (`name`) ya no es la que corresponde, recarga la
   * página, que vuelve a elegir. Como mucho una vez por minuto, para que no
   * salte a cada rato si el devaluómetro queda oscilando sobre el umbral.
   */
  function stayOnVersion(name, heat) {
    if (pickVersion(heat) === name) return;
    try {
      const last = Number(sessionStorage.getItem("usdt-reload") || 0);
      if (Date.now() - last < 60 * 1000) return;
      sessionStorage.setItem("usdt-reload", String(Date.now()));
    } catch (e) { /* sin sessionStorage, recarga igual */ }
    location.reload();
  }

  /** Mismo texto que imprime el script. */
  function athMessage(current, ath) {
    if (current >= ath.price) return { isAth: true, text: "¡Está en all time high!" };
    return {
      isAth: false,
      text: `No está en all time high. El último all time high fue de ` +
            `${formatArs(ath.price)} el ${formatDate(ath.time)}.`,
    };
  }

  /** Igual que ascii_chart() del script: línea de cierres con ejes. */
  function asciiChart(points) {
    const closes = points.map((p) => p.close);
    const low = Math.min(...closes), high = Math.max(...closes);
    const span = high - low || 1;
    const rows = closes.map((p) => Math.round((p - low) / span * (CHART_HEIGHT - 1)));

    const grid = Array.from({ length: CHART_HEIGHT }, () => Array(rows.length).fill(" "));
    rows.forEach((row, x) => {
      // Une cada punto con el anterior con un trazo vertical.
      const prev = x ? rows[x - 1] : row;
      for (let r = Math.min(prev, row) + 1; r < Math.max(prev, row); r++) grid[r][x] = "│";
      grid[row][x] = "•";
    });

    const labels = [];
    for (let r = 0; r < CHART_HEIGHT; r++) labels.push(formatArs(low + span * r / (CHART_HEIGHT - 1)));
    const width = Math.max(...labels.map((l) => l.length));
    const lines = [];
    for (let r = CHART_HEIGHT - 1; r >= 0; r--) {
      // Etiqueta solo en los extremos y el medio, para no saturar el eje.
      const show = r === 0 || r === Math.floor(CHART_HEIGHT / 2) || r === CHART_HEIGHT - 1;
      lines.push((show ? labels[r] : "").padStart(width) + " ┤" + grid[r].join(""));
    }
    lines.push(" ".repeat(width) + " └" + "─".repeat(rows.length));

    // Fecha debajo de la primera vela de cada día.
    const axis = Array(rows.length + 5).fill(" ");
    let lastDay = null;
    points.forEach((p, x) => {
      const day = formatDate(p.time);
      if (day !== lastDay && axis[x] === " " && (x === 0 || axis[x - 1] === " ")) {
        axis.splice(x, 5, ...formatDayMonth(p.time));
      }
      lastDay = day;
    });
    lines.push(" ".repeat(width + 2) + axis.join("").trimEnd());
    return lines.join("\n");
  }

  /**
   * Gráfico de línea en SVG (sin dependencias). Devuelve el markup; cada
   * página lo estiliza con las clases .grid, .tick, .area, .line, .dot y
   * .ath-line/.ath-label, y el degradé #usdt-area con .stop-top/.stop-bottom.
   */
  /** Escalas del gráfico: las comparten svgChart y attachHover. */
  function chartScale(points, { width = 800, height = 260, ath = null } = {}) {
    const pad = { top: 16, right: 12, bottom: 28, left: 72 };
    const w = width - pad.left - pad.right, h = height - pad.top - pad.bottom;
    const closes = points.map((p) => p.close);
    let low = Math.min(...closes), high = Math.max(...closes);
    if (ath && ath - high < (high - low) * 0.5) high = Math.max(high, ath);
    const span = high - low || 1;
    const x = (i) => pad.left + (i / (points.length - 1)) * w;
    const y = (v) => pad.top + h - ((v - low) / span) * h;
    return { pad, w, h, low, high, span, x, y };
  }

  // Argentina es siempre UTC-3: corrido así, el día y la hora salen en UTC.
  const AR_OFFSET = 3 * 3600 * 1000;
  const hourFmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const monthFmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", month: "short", year: "2-digit",
  });

  /**
   * Índices y textos de las etiquetas del eje X: cada 4 horas si el rango es
   * de un par de días, por día hasta 3 meses y por mes más allá. Si quedan
   * más de 8, se saltean de manera pareja.
   */
  function xTicks(points) {
    const spanDays = (points[points.length - 1].time - points[0].time) / 86400000;
    let key, label;
    if (spanDays <= 2) {
      key = (t) => Math.floor((t - AR_OFFSET) / (4 * 3600000));
      label = (t) => hourFmt.format(t);
    } else if (spanDays <= 90) {
      key = (t) => Math.floor((t - AR_OFFSET) / 86400000);
      label = formatDayMonth;
    } else {
      key = (t) => monthFmt.format(t);
      label = (t) => monthFmt.format(t);
    }
    const ticks = [];
    points.forEach((p, i) => {
      if (i > 0 && key(p.time) !== key(points[i - 1].time)) ticks.push({ i, text: label(p.time) });
    });
    const step = Math.ceil(ticks.length / 8);
    return ticks.filter((_, n) => n % step === 0);
  }

  function svgChart(points, { width = 800, height = 260, area = true, ath = null } = {}) {
    const { pad, h, low, high, span, x, y } = chartScale(points, { width, height, ath });

    const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join("");
    const fill = `${line}L${x(points.length - 1)},${pad.top + h}L${x(0)},${pad.top + h}Z`;

    let grid = "";
    for (let t = 0; t <= 3; t++) {
      const v = low + (span * t) / 3, yy = y(v).toFixed(1);
      grid += `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}"/>` +
              `<text class="tick" x="${pad.left - 8}" y="${yy}" dy="0.32em" text-anchor="end">${formatArs(v)}</text>`;
    }
    for (const { i, text } of xTicks(points)) {
      grid += `<text class="tick" x="${x(i).toFixed(1)}" y="${height - 8}" text-anchor="middle">${text}</text>`;
    }
    if (ath && ath <= high) {
      const yy = y(ath).toFixed(1);
      grid += `<line class="ath-line" x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}" stroke-dasharray="4 4"/>` +
              `<text class="ath-label" x="${width - pad.right}" y="${yy}" dy="-0.4em" text-anchor="end">ATH ${formatArs(ath)}</text>`;
    }
    const last = points[points.length - 1];
    return `<svg class="usdt-chart" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Cotización ${source.name}">` +
      `<defs><linearGradient id="usdt-area" x1="0" y1="0" x2="0" y2="1">` +
      `<stop class="stop-top" offset="0"/><stop class="stop-bottom" offset="1"/></linearGradient></defs>` +
      grid +
      (area ? `<path class="area" d="${fill}"/>` : "") +
      `<path class="line" d="${line}" fill="none" stroke-linejoin="round"/>` +
      `<circle class="dot" cx="${x(points.length - 1)}" cy="${y(last.close)}" r="4"/>` +
      `</svg>`;
  }

  /**
   * Agrega a un gráfico de svgChart (dentro de `container`) una mira que
   * sigue al mouse o al dedo y un tooltip .chart-tip con `formatTip(punto)`.
   * Se estilizan con .hover-line, .hover-dot y .chart-tip.
   */
  function attachHover(container, points, opts, formatTip) {
    const svg = container.querySelector("svg");
    const { width = 800 } = opts;
    const { pad, h, x, y } = chartScale(points, opts);
    const ns = "http://www.w3.org/2000/svg";
    const lineEl = document.createElementNS(ns, "line");
    lineEl.setAttribute("class", "hover-line");
    lineEl.setAttribute("y1", pad.top);
    lineEl.setAttribute("y2", pad.top + h);
    const dotEl = document.createElementNS(ns, "circle");
    dotEl.setAttribute("class", "hover-dot");
    dotEl.setAttribute("r", 5);
    svg.append(lineEl, dotEl);
    const tip = document.createElement("div");
    tip.className = "chart-tip";
    container.append(tip);
    container.style.position = "relative";

    function show(clientX) {
      const rect = svg.getBoundingClientRect();
      const vx = ((clientX - rect.left) / rect.width) * width;
      const i = Math.max(0, Math.min(points.length - 1,
        Math.round(((vx - pad.left) / (x(points.length - 1) - pad.left)) * (points.length - 1))));
      const px = x(i), py = y(points[i].close);
      lineEl.setAttribute("x1", px);
      lineEl.setAttribute("x2", px);
      dotEl.setAttribute("cx", px);
      dotEl.setAttribute("cy", py);
      tip.innerHTML = formatTip(points[i]);
      const left = (px / width) * rect.width;
      tip.style.left = `${Math.max(tip.offsetWidth / 2, Math.min(rect.width - tip.offsetWidth / 2, left))}px`;
      tip.style.top = `${(py / (opts.height || 260)) * rect.height}px`;
      container.classList.add("hovering");
    }
    const hide = () => container.classList.remove("hovering");
    svg.addEventListener("pointermove", (e) => show(e.clientX));
    svg.addEventListener("pointerdown", (e) => show(e.clientX));
    svg.addEventListener("pointerleave", hide);
  }

  /**
   * Carga todo y llama a render({current, ath, recent, message}). Después
   * refresca el precio cada `refreshMs` y el gráfico cada 5 minutos.
   */
  async function start(render, onError, refreshMs = source.refreshMs) {
    let ath, recent;
    try {
      const [current, a, r] = await Promise.all([source.getCurrentPrice(), source.getHistoryAth(), source.getRecentCloses()]);
      ath = a; recent = r;
      update(current);
    } catch (exc) {
      onError(exc);
      return;
    }

    function update(current) {
      // Si el precio en vivo supera el ATH, pasa a ser el nuevo ATH.
      const message = athMessage(current.price, ath);
      if (current.price > ath.price) ath = { price: current.price, time: current.time };
      render({ current, ath, recent, message });
    }

    setInterval(async () => {
      try { update(await source.getCurrentPrice()); } catch (exc) { /* reintenta en el próximo tick */ }
    }, refreshMs);
    setInterval(async () => {
      try { recent = await source.getRecentCloses(); } catch (exc) { /* idem */ }
    }, 5 * 60 * 1000);
  }

  // getCurrentPrice, getCloses, etc. son los de la tab elegida.
  window.USDT = {
    source, tabLinks,
    getRiesgoPais, formatRiesgoPais, formatDayMonth,
    formatArs, formatDate, formatTime, athMessage, asciiChart, svgChart, attachHover, start,
    getCurrentPrice: source.getCurrentPrice, getHistoryAth: source.getHistoryAth,
    getRecentCloses: source.getRecentCloses, getCloses: source.getCloses, get24hChange: source.get24hChange,
    FIRE_THRESHOLD, devaluometro, pickVersion, stayOnVersion,
  };
})();
