(() => {
  const TZ = "America/Detroit";
  const DATA_URL = "data.json";
  const REFRESH_MS = 20_000;
  const STALE_MS = 3 * 60_000;
  const DEX_EVERY_MS = 4_000;
  const OHLCV_EVERY_MS = 30_000;
  const $ = (id) => document.getElementById(id);

  function money(n, digits = 2) {
    if (n == null || !Number.isFinite(n)) return "—";
    const sign = n < 0 ? "-" : "";
    return sign + "$" + Math.abs(n).toFixed(digits);
  }
  function formatMcap(n) {
    if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return "—";
    const v = Number(n);
    const trim = (x) => String(x.toFixed(1)).replace(/\.0$/, "");
    if (v >= 1e9) return "$" + trim(v / 1e9) + "B";
    if (v >= 1e6) return "$" + trim(v / 1e6) + "M";
    if (v >= 1e3) return "$" + trim(v / 1e3) + "k";
    return "$" + String(Math.round(v));
  }
  function pnlClass(n) {
    if (n == null || !Number.isFinite(n) || Math.abs(n) < 0.005) return "neu";
    return n > 0 ? "pos" : "neg";
  }
  function signedMoney(n, digits = 2) {
    if (n == null || !Number.isFinite(n)) return "—";
    const sign = n > 0 ? "+" : n < 0 ? "-" : "";
    return sign + "$" + Math.abs(n).toFixed(digits);
  }
  function pnlPct(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    const v = n * 100;
    const sign = v > 0 ? "+" : "";
    return sign + v.toFixed(2) + "%";
  }
  function rate(n) {
    if (n == null) return "—";
    return (n * 100).toFixed(0) + "%";
  }
  function fmtEt(iso, withSec = false) {
    if (!iso) return "—";
    const opt = {
      timeZone: TZ, month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    };
    if (withSec) opt.second = "2-digit";
    return new Intl.DateTimeFormat("en-US", opt).format(new Date(iso)) + " ET";
  }
  function ago(iso) {
    if (!iso) return "";
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 5) return "just now";
    if (s < 60) return s + "s ago";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m " + (s % 60) + "s ago";
    const h = Math.floor(m / 60);
    return h + "h " + (m % 60) + "m ago";
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    }[c]));
  }
  function safeLink(u, hosts) {
    if (!u) return null;
    try {
      const x = new URL(u, location.href);
      if (x.protocol !== "https:") return null;
      const ok = hosts.some((h) => x.hostname === h || x.hostname.endsWith("." + h));
      return ok ? x.href : null;
    } catch {
      return null;
    }
  }

  const linePlugin = {
    id: "hlines",
    afterDraw(chart, _args, opts) {
      const lines = (opts && opts.lines) || [];
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.y) return;
      for (const line of lines) {
        if (line.y == null) continue;
        const y = scales.y.getPixelForValue(line.y);
        if (y < chartArea.top || y > chartArea.bottom) continue;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash(line.dash || [5, 4]);
        ctx.strokeStyle = line.color || "#8b9bb4";
        ctx.lineWidth = 1;
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();
        if (line.label) {
          ctx.fillStyle = line.color || "#8b9bb4";
          ctx.font = "11px system-ui, sans-serif";
          ctx.fillText(line.label, chartArea.left + 6, y - 4);
        }
        ctx.restore();
      }
    }
  };
  const vlinePlugin = {
    id: "vlines",
    afterDraw(chart, _args, opts) {
      const lines = (opts && opts.lines) || [];
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.x) return;
      for (const line of lines) {
        if (line.x == null) continue;
        const x = scales.x.getPixelForValue(line.x);
        if (x < chartArea.left || x > chartArea.right) continue;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash(line.dash || [4, 3]);
        ctx.strokeStyle = line.color || "#f5c14a";
        ctx.lineWidth = 1;
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        if (line.label) {
          ctx.fillStyle = line.color || "#f5c14a";
          ctx.font = "10px system-ui, sans-serif";
          const ty = chartArea.top + (line.yOff || 12);
          const tx = Math.min(Math.max(x + 5, chartArea.left + 4), chartArea.right - 80);
          ctx.fillText(line.label, tx, ty);
        }
        ctx.restore();
      }
    }
  };
  Chart.register(linePlugin, vlinePlugin);
  Chart.defaults.font.family = "system-ui, sans-serif";

  function seriesToXY(points, field) {
    return (points || []).map((p) => ({ x: Date.parse(p.t), y: p[field] }));
  }

  const linearTime = {
    type: "linear",
    ticks: {
      color: "#6a7a90", maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 10 },
      callback(v) {
        return new Intl.DateTimeFormat("en-US", {
          timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        }).format(new Date(v));
      }
    },
    grid: { color: "rgba(42,53,69,.45)" },
    border: { color: "#2a3545" },
  };

  const commonOpts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => items[0] ? fmtEt(items[0].raw.x, true) : "",
          label: (item) => " " + money(item.parsed.y),
        }
      }
    },
    scales: {
      x: linearTime,
      y: {
        ticks: { color: "#6a7a90", font: { size: 10 }, callback: (v) => "$" + Number(v).toFixed(0) },
        grid: { color: "rgba(42,53,69,.45)" },
        border: { color: "#2a3545" },
      }
    }
  };

  let bankChart, pnlChart;
  function ensureCharts() {
    if (bankChart) return;
    const yTicks = {
      color: "#6a7a90", font: { size: 10 },
      callback: (v) => "$" + Number(v).toFixed(v >= 100 || v <= -10 ? 0 : 2)
    };
    bankChart = new Chart($("bankChart"), {
      type: "line",
      data: { datasets: [{
        data: [],
        borderColor: "#6cb3ff",
        backgroundColor: "rgba(108,179,255,.12)",
        fill: true, borderWidth: 1.7, pointRadius: 0, pointHoverRadius: 3, tension: 0.15,
      }]},
      options: {
        ...commonOpts,
        scales: { x: linearTime, y: { ...commonOpts.scales.y, ticks: yTicks } },
        plugins: { ...commonOpts.plugins, hlines: { lines: [] }, vlines: { lines: [] } },
      }
    });
    pnlChart = new Chart($("pnlChart"), {
      type: "line",
      data: { datasets: [{
        data: [],
        borderColor: "#3ddc97",
        backgroundColor: "rgba(61,220,151,.10)",
        fill: true, borderWidth: 1.7, pointRadius: 0, pointHoverRadius: 3, tension: 0.15,
      }]},
      options: {
        ...commonOpts,
        scales: { x: linearTime, y: { ...commonOpts.scales.y, ticks: yTicks } },
        plugins: {
          ...commonOpts.plugins,
          hlines: { lines: [{ y: 0, color: "#6a7a90", dash: [4, 4], label: "break even" }] },
          vlines: { lines: [] },
        },
      }
    });
  }

  function updateCharts(s) {
    ensureCharts();
    bankChart.data.datasets[0].data = seriesToXY(s.bankSeries, "bank");
    bankChart.options.plugins.hlines.lines = [
      { y: s.baseline, color: "#c4a574", dash: [5, 4], label: "start $" + Number(s.baseline).toFixed(2) },
      { y: s.floor, color: "#ff5d6c", dash: [4, 3], label: "floor $" + Number(s.floor).toFixed(2) },
    ];
    const vlines = (s.capitalEvents || []).map((ev, i) => ({
      x: Date.parse(ev.t),
      color: ev.kind === "deposit" ? "#f5c14a" : ev.kind === "reconcile" ? "#c4a574" : "#8b9bb4",
      dash: ev.kind === "deposit" ? [5, 3] : [3, 3],
      label: ev.kind === "deposit" && ev.amount != null
        ? "Deposit +$" + Math.abs(ev.amount).toFixed(0)
        : ev.kind === "reconcile" && ev.amount != null
          ? "Write-off −$" + Math.abs(ev.amount).toFixed(0)
          : (ev.label || ev.kind),
      yOff: ev.kind === "deposit" ? 12 : 30 + (i % 2) * 4,
    }));
    bankChart.options.plugins.vlines.lines = vlines;
    bankChart.update("none");
    const bankHint = $("bankChartHint");
    if (bankHint) {
      const bits = (s.capitalEvents || []).map((ev) => ev.label);
      bankHint.textContent = bits.length ? bits.join(" · ") : "";
    }

    const pnlData = seriesToXY(s.pnlSeries, "pnl");
    pnlChart.data.datasets[0].data = pnlData;
    const last = pnlData.length ? pnlData[pnlData.length - 1].y : 0;
    pnlChart.data.datasets[0].borderColor = last >= 0 ? "#3ddc97" : "#ff5d6c";
    pnlChart.data.datasets[0].backgroundColor = last >= 0 ? "rgba(61,220,151,.10)" : "rgba(255,93,108,.10)";
    pnlChart.options.plugins.vlines.lines = vlines;
    pnlChart.update("none");
    const pnlHint = $("pnlChartHint");
    if (pnlHint) {
      const core = s.realizedPnl;
      const copy = s.copyRealizedPnl;
      const parts = [];
      if (core != null) parts.push("core " + signedMoney(core));
      if (copy != null) parts.push("copy " + signedMoney(copy));
      if (s.tradingRealizedPnl != null) parts.push("combined " + signedMoney(s.tradingRealizedPnl));
      pnlHint.textContent = (parts.length ? parts.join(" · ") + " · " : "") + "realized trades only, deposits and write-offs excluded";
    }
  }

  const posCharts = new Map();

  function posKey(p) {
    return (p.mode === "copy" || p.mode === "aggro" ? p.mode : "core") + ":" + p.mint;
  }
  function posMode(p) {
    return p.mode === "copy" || p.mode === "aggro" ? p.mode : "core";
  }
  function supplyOf(p, rec) {
    if (p.entryMcap > 0 && p.entry > 0) return p.entryMcap / p.entry;
    const liveM = rec?.mcap || rec?.fdv;
    const liveP = rec?.livePrice;
    if (liveM > 0 && liveP > 0) return liveM / liveP;
    if (p.markMcap > 0 && p.price > 0) return p.markMcap / p.price;
    return null;
  }
  function asMcap(price, supply, fallback) {
    if (supply > 0 && Number.isFinite(Number(price))) return Number(price) * supply;
    return Number.isFinite(Number(fallback)) && Number(fallback) > 0 ? Number(fallback) : null;
  }
  function posDomId(key) {
    return "pos-" + String(key).replace(/[^A-Za-z0-9_-]/g, "_");
  }
  function priceLabel(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1) return "$" + n.toFixed(4);
    return "$" + n.toPrecision(4);
  }
  function chartPoints(p) {
    const raw = (p.chart && p.chart.points && p.chart.points.length)
      ? p.chart.points
      : (p.sparkline || []);
    return raw
      .map((x) => ({ x: Date.parse(x.t), y: Number(x.mcap ?? x.y ?? x.price) }))
      .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y) && pt.y > 0);
  }
  function destroyPosChart(key) {
    const ch = posCharts.get(key);
    if (ch) {
      try { ch.destroy(); } catch {}
      posCharts.delete(key);
    }
  }
  function ensurePosChart(canvas, p) {
    const key = posKey(p);
    if (posCharts.has(key)) return posCharts.get(key);
    const ch = new Chart(canvas, {
      type: "line",
      data: { datasets: [{
        data: [],
        borderColor: "#6cb3ff",
        backgroundColor: "rgba(108,179,255,.12)",
        fill: true, borderWidth: 1.6, pointRadius: 0, pointHoverRadius: 3, tension: 0.15,
      }]},
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items[0] ? fmtEt(items[0].raw.x, true) : "",
              label: (item) => " " + formatMcap(item.parsed.y),
            }
          },
          hlines: { lines: [] },
        },
        scales: {
          x: {
            type: "linear",
            ticks: {
              color: "#6a7a90", maxRotation: 0, autoSkip: true, maxTicksLimit: 5, font: { size: 10 },
              callback(v) {
                return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(v));
              }
            },
            grid: { color: "rgba(42,53,69,.45)" },
            border: { color: "#2a3545" },
          },
          y: {
            ticks: { color: "#6a7a90", font: { size: 10 }, maxTicksLimit: 5, callback: (v) => formatMcap(Number(v)) },
            grid: { color: "rgba(42,53,69,.45)" },
            border: { color: "#2a3545" },
          }
        }
      }
    });
    posCharts.set(key, ch);
    return ch;
  }
  function updatePosChart(p) {
    const key = posKey(p);
    const card = document.getElementById(posDomId(key));
    if (!card) return;
    const canvas = card.querySelector("canvas");
    const wait = card.querySelector(".pos-wait");
    const data = chartPoints(p);
    if (wait) wait.classList.toggle("hidden", data.length >= 1);
    if (!canvas || data.length < 1) return;
    const ch = ensurePosChart(canvas, p);
    const up = (p.pnlPct != null && p.pnlPct >= 0);
    ch.data.datasets[0].data = data;
    ch.data.datasets[0].borderColor = up ? "#3ddc97" : "#ff5d6c";
    ch.data.datasets[0].backgroundColor = up ? "rgba(61,220,151,.12)" : "rgba(255,93,108,.12)";
    const lines = [];
    if (p.entryMcap > 0) lines.push({ y: p.entryMcap, color: "#c4a574", dash: [5, 4], label: "entry " + formatMcap(p.entryMcap) });
    if (p.tp1Mcap > 0) lines.push({ y: p.tp1Mcap, color: "#3ddc97", dash: [4, 3], label: "TP " + formatMcap(p.tp1Mcap) });
    if (p.tp2Mcap > 0) lines.push({ y: p.tp2Mcap, color: "#6cb3ff", dash: [3, 3], label: "TP2 " + formatMcap(p.tp2Mcap) });
    if (p.stopMcap > 0) lines.push({ y: p.stopMcap, color: "#ff5d6c", dash: [4, 3], label: "stop " + formatMcap(p.stopMcap) });
    ch.options.plugins.hlines.lines = lines;
    const ys = data.map((d) => d.y);
    for (const ln of lines) ys.push(ln.y);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.04 || 1e-9;
    ch.options.scales.y.min = lo - pad;
    ch.options.scales.y.max = hi + pad;
    ch.update("none");
  }
  function renderPosCard(p) {
    const pnlUsd = (p.markUsd != null && p.usd != null) ? p.markUsd - p.usd : null;
    const tags = [];
    if (p.mode === "copy") tags.push('<span class="tag live">copy</span>');
    if (p.mode === "aggro") tags.push('<span class="tag live">aggro</span>');
    if (p.moonBag) tags.push('<span class="tag moon">moon</span>');
    if (p.tpStage) tags.push(`<span class="tag">tp${esc(p.tpStage)}</span>`);
    const href = safeLink((p.chart && p.chart.url) || p.dexscreener, ["dexscreener.com"]);
    const link = href
      ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">DexScreener</a>`
      : "";
    const nowMcap = p.markMcap > 0 ? p.markMcap : (p.chart && p.chart.markMcap);
    return `<div class="pos-head">
        <div>
          <div class="pos-title"><span class="sym">${esc(p.symbol)}</span>${tags.join("")}</div>
          <div class="pos-meta">Bought at ${formatMcap(p.entryMcap)} · now ${formatMcap(nowMcap)}</div>
          <div class="pos-meta">${p.entryTime ? "Opened " + fmtEt(p.entryTime, true) : ""}${link ? (p.entryTime ? " · " : "") + link : ""}</div>
        </div>
        <div class="pos-side">
          <div class="pos-pnl ${pnlClass(p.pnlPct)}">${pnlPct(p.pnlPct)}</div>
          <div class="pos-meta ${pnlClass(pnlUsd)}">${signedMoney(pnlUsd)}${p.usd != null ? " on " + money(p.usd) : ""}</div>
        </div>
      </div>
      <div class="pos-chart"><canvas></canvas><div class="pos-wait">Waiting for market cap data…</div></div>`;
  }
  function renderPositions(s) {
    const el = $("posTable");
    const list = s.positions || [];
    if (!list.length) {
      for (const key of [...posCharts.keys()]) destroyPosChart(key);
      el.innerHTML = `<div class="empty">No open positions</div>`;
      return;
    }
    let grid = $("posGrid");
    if (!grid || grid.parentElement !== el) {
      el.innerHTML = `<div class="pos-grid" id="posGrid"></div>`;
      grid = $("posGrid");
    }
    const seen = new Set();
    for (const p of list) {
      if (!p.mint) continue;
      const key = posKey(p);
      seen.add(key);
      const id = posDomId(key);
      let card = document.getElementById(id);
      if (!card) {
        card = document.createElement("div");
        card.className = "pos-card";
        card.id = id;
        card.setAttribute("data-mint", p.mint);
        card.setAttribute("data-mode", posMode(p));
        grid.appendChild(card);
      }
      const live = card.querySelector("canvas");
      if (!live) {
        card.innerHTML = renderPosCard(p);
      } else {
        const tmp = document.createElement("div");
        tmp.innerHTML = renderPosCard(p);
        const newHead = tmp.querySelector(".pos-head");
        const oldHead = card.querySelector(".pos-head");
        if (newHead && oldHead) oldHead.replaceWith(newHead);
      }
      updatePosChart(p);
    }
    for (const card of [...grid.querySelectorAll(".pos-card")]) {
      const mode = card.getAttribute("data-mode") || "core";
      const mint = card.getAttribute("data-mint");
      const key = mode + ":" + mint;
      if (!seen.has(key)) {
        destroyPosChart(key);
        card.remove();
      }
    }
  }

  function renderStats(s) {
    const st = s.stats || {};
    const today = st.today || {};
    const all = st.allTime || {};
    const best = st.best, worst = st.worst;
    const cards = [
      { label: "Per-buy win rate", val: rate(st.winRate), hint: `${st.wins || 0} wins / ${st.closedTrades || 0} closed`, cls: "" },
      { label: "Today", val: `${today.buys || 0} buys`, hint: `${today.wins || 0}W / ${today.losses || 0}L · ${signedMoney(today.pnl)}`, cls: pnlClass(today.pnl) },
      { label: "All-time trades", val: String(all.buys || 0), hint: `${all.closed || 0} closed · ${signedMoney(all.pnl)}`, cls: pnlClass(all.pnl) },
      { label: "Best / worst", val: best ? `${esc(best.symbol)} ${signedMoney(best.pnl)}` : "—", hint: worst ? `worst ${esc(worst.symbol)} ${signedMoney(worst.pnl)}` : "", cls: "" },
    ];
    $("statsRow").innerHTML = cards.map((c) =>
      `<div class="kpi"><div class="label">${c.label}</div><div class="val ${c.cls}">${c.val}</div><div class="hint">${c.hint}</div></div>`
    ).join("");
  }

  function renderModes(s) {
    const modes = s.modes || {};
    const stats = (s.stats && s.stats.byMode) || {};
    const keys = Object.keys(modes);
    if (!keys.length) { $("modes").innerHTML = `<div class="empty">No mode data</div>`; return; }
    $("modes").innerHTML = keys.map((k) => {
      const st = stats[k] || stats[k.replace(/-/g, "_")] || null;
      const live = modes[k];
      const hint = st
        ? `${st.wins || 0}/${st.closed || 0} wins · ${signedMoney(st.pnl)}`
        : "no closed trades yet";
      return `<div class="mode"><div class="name">${esc(k)}</div><div><span class="tag ${esc(live)}">${esc(live)}</span></div><div class="hint" style="color:var(--faint);font-size:.72rem;margin-top:4px">${hint}</div></div>`;
    }).join("");
  }

  function renderSleeve(s) {
    const c = s.copySleeve;
    if (!c) { $("sleeveRow").innerHTML = `<div class="empty">Copy sleeve not started</div>`; $("sleeveHint").textContent = ""; return; }
    const cards = [
      { label: "Sleeve value", val: money(c.equityUsd), hint: `budget ${money(c.budgetUsd)}${c.budgetSol != null ? " (" + Number(c.budgetSol).toFixed(4) + " SOL)" : ""}`, cls: pnlClass((c.pnlUsd ?? 0)) },
      { label: "Sleeve P&L", val: signedMoney(c.pnlUsd), hint: `realized ${signedMoney(c.realizedUsd)} · open ${signedMoney(c.unrealizedUsd)}`, cls: pnlClass(c.pnlUsd) },
      { label: "Copies", val: `${c.wins || 0}W / ${c.losses || 0}L`, hint: `${c.buys || 0} buys · ${c.openCount || (c.positions || []).length} open`, cls: "" },
      { label: "Free to copy", val: money(c.freeUsd), hint: c.live ? "live" : "paused", cls: "" },
    ];
    $("sleeveRow").innerHTML = cards.map((x) =>
      `<div class="kpi"><div class="label">${x.label}</div><div class="val ${x.cls}">${x.val}</div><div class="hint">${x.hint}</div></div>`
    ).join("");
    const w = c.watcher || {};
    $("sleeveHint").textContent = `Watching ${w.walletCount ?? 0} wallets · last poll ${w.lastPollAt ? ago(w.lastPollAt) : "—"} · last leader swap ${w.lastLeaderSwapAt ? fmtEt(w.lastLeaderSwapAt, true) : "none yet"}`;
  }

  function renderFeed(s) {
    const list = s.trades || [];
    if (!list.length) { $("feed").innerHTML = `<div class="empty">No trades yet</div>`; return; }
    const rows = list.map((t) => {
      const links = [];
      const dex = safeLink(t.dexscreener, ["dexscreener.com"]);
      const scan = safeLink(t.solscan, ["solscan.io"]);
      if (dex) links.push(`<a href="${esc(dex)}" target="_blank" rel="noopener noreferrer">DexScreener</a>`);
      if (scan) links.push(`<a href="${esc(scan)}" target="_blank" rel="noopener noreferrer">Solscan</a>`);
      return `<tr>
        <td>${esc(t.timeEt || fmtEt(t.time, true))}</td>
        <td><span class="tag ${esc(t.side)}">${esc(t.side)}</span></td>
        <td><span class="sym">${esc(t.symbol)}</span>${t.mode && t.mode !== "core" ? ` <span class="tag">${esc(t.mode)}</span>` : ""}</td>
        <td>${formatMcap(t.entryMcap)}</td>
        <td>${t.usd != null ? money(t.usd) : "—"}</td>
        <td class="${t.side === "sell" ? pnlClass(t.pnl) : ""}">${t.side === "sell" ? signedMoney(t.pnl) : "—"}</td>
        <td>${t.reason ? esc(t.reason) : "—"}</td>
        <td>${t.bank != null ? money(t.bank) : (t.sleeve != null ? "sleeve " + money(t.sleeve) : "—")}</td>
        <td class="links">${links.join("")}</td>
      </tr>`;
    }).join("");
    $("feed").innerHTML = `<table><thead><tr>
      <th>Time (ET)</th><th></th><th>Coin</th><th>Mcap at buy</th><th>USD</th><th>P&amp;L</th><th>Reason</th><th>Bank</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  }

  function dataAgeMs(s) {
    const t = Date.parse(s && (s.generatedAt || s.healthAt));
    return Number.isFinite(t) ? Date.now() - t : null;
  }

  function applyStale(s) {
    const age = dataAgeMs(s);
    const stale = age == null || age > STALE_MS;
    const banner = $("staleBanner");
    const clock = $("clockBox");
    if (banner) banner.classList.toggle("show", stale);
    if (clock) clock.classList.toggle("stale", stale);
    return { age, stale };
  }

  function renderHeader(s) {
    const { stale } = applyStale(s);
    const pill = $("statusPill");
    const st = stale ? "stale" : (s.status || "stalled");
    pill.className = "pill " + st;
    $("statusText").textContent = stale ? "stale" : String(st).replace(/_/g, " ");
    $("modeLine").textContent = s.mode
      ? ("· " + s.mode + (s.pauseGuard && s.pauseGuard.enabled ? (s.pauseGuard.active ? " · pause guard ON" : " · pause guard ready") : ""))
      : "";
    $("lastUpdate").textContent = s.generatedAtEt || fmtEt(s.generatedAt, true) || s.healthAtEt || "—";
    const src = s.generatedAt || s.healthAt;
    $("lastAgo").textContent = src ? ago(src) : "no update yet";

    $("kpiBank").textContent = money(s.bank);
    $("kpiBank").className = "val " + pnlClass((s.bank ?? 0) - (s.baseline ?? 0));
    if ($("kpiBankHint")) $("kpiBankHint").textContent = "core start $" + Number(s.baseline).toFixed(2);

    $("kpiReal").textContent = signedMoney(s.realizedPnl);
    $("kpiReal").className = "val " + pnlClass(s.realizedPnl);

    $("kpiUnreal").textContent = signedMoney(s.unrealized);
    $("kpiUnreal").className = "val " + pnlClass(s.unrealized);
    $("kpiOpenHint").textContent = (s.openCount || 0) + " open position" + (s.openCount === 1 ? "" : "s");

    $("kpiVs").textContent = signedMoney(s.pnlVsBaseline);
    $("kpiVs").className = "val " + pnlClass(s.pnlVsBaseline);
    if ($("kpiVsHint")) $("kpiVsHint").textContent = "bank − start $" + Number(s.baseline).toFixed(2);

    $("kpiFloor").textContent = s.toFloor == null ? "—" : signedMoney(s.toFloor);
    $("kpiFloor").className = "val " + (s.toFloor != null && s.toFloor < 0 ? "neg" : "pos");
    if ($("kpiFloorHint")) $("kpiFloorHint").textContent = "20% floor $" + Number(s.floor).toFixed(2);

    $("kpiSol").textContent = s.sol != null ? Number(s.sol).toFixed(4) : "—";
    $("kpiSolHint").textContent = s.solUsd != null ? money(s.solUsd) + " @ " + money(s.solPrice) : "—";
  }

  function render(s) {
    if (!s) return;
    window.__snap = s;
    renderHeader(s);
    updateCharts(s);
    renderStats(s);
    renderPositions(s);
    renderModes(s);
    try { renderSleeve(s); } catch (e) { console.warn(e); }
    renderFeed(s);
  }

  // Client-side DexScreener + GeckoTerminal charts for open position mints only.
  const chartCache = new Map();

  async function fetchJson(url, timeoutMs = 8000) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ac.signal, cache: "no-store" });
      if (!res.ok) throw new Error("http " + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  function pickPair(dexJson, preferred) {
    const pairs = Array.isArray(dexJson?.pairs) ? dexJson.pairs : [];
    const sol = pairs.filter((p) => String(p.chainId || "").toLowerCase() === "solana");
    const list = sol.length ? sol : pairs;
    if (preferred) {
      const want = String(preferred).toLowerCase();
      const hit = list.find((p) => String(p.pairAddress || "").toLowerCase() === want);
      if (hit) return hit;
    }
    return list.slice().sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0] || null;
  }

  function pushLive(rec, price, tIso, mcap) {
    if (!Number.isFinite(price)) return;
    const last = rec.live[rec.live.length - 1];
    const t = tIso || new Date().toISOString();
    if (last && last.price === price && Math.abs(Date.parse(t) - Date.parse(last.t)) < 10_000) {
      if (mcap > 0) last.mcap = mcap;
      return;
    }
    rec.live.push({ t, price, mcap: mcap > 0 ? mcap : undefined });
    if (rec.live.length > 240) rec.live = rec.live.slice(-240);
  }

  function mergePricePoints(...series) {
    const byT = new Map();
    for (const pts of series) {
      for (const p of pts || []) {
        const tMs = typeof p.t === "number" ? p.t : Date.parse(p.t);
        const price = Number(p.price);
        if (!Number.isFinite(tMs) || !Number.isFinite(price)) continue;
        byT.set(Math.round(tMs / 1000), { t: new Date(tMs).toISOString(), price });
      }
    }
    return [...byT.values()].sort((a, b) => Date.parse(a.t) - Date.parse(b.t)).slice(-300);
  }

  async function refreshOne(p) {
    const now = Date.now();
    let rec = chartCache.get(p.mint);
    if (!rec) {
      rec = {
        mint: p.mint, pair: p.pairAddress || null, url: p.dexscreener || null,
        ohlcv: [], live: [], lastDexAt: 0, lastOhlcvAt: 0, source: null, lastError: null,
      };
      chartCache.set(p.mint, rec);
    } else {
      if (p.pairAddress && !rec.pair) rec.pair = p.pairAddress;
      if (p.dexscreener && !rec.url) rec.url = p.dexscreener;
    }

    if (now - rec.lastDexAt >= DEX_EVERY_MS - 200) {
      try {
        const j = await fetchJson("https://api.dexscreener.com/latest/dex/tokens/" + encodeURIComponent(p.mint));
        const pair = pickPair(j, rec.pair || p.pairAddress);
        if (pair) {
          rec.pair = pair.pairAddress || rec.pair;
          rec.url = pair.url || rec.url;
          rec.source = rec.source ? rec.source : "dexscreener";
          if (!String(rec.source).includes("dexscreener")) rec.source = "dexscreener+" + rec.source;
          const px = Number(pair.priceUsd);
          const cap = Number(pair.marketCap || pair.fdv || 0);
          if (cap > 0) { rec.mcap = cap; rec.fdv = Number(pair.fdv || cap); }
          if (px > 0) rec.livePrice = px;
          pushLive(rec, px, new Date().toISOString(), cap);
        }
        rec.lastDexAt = now;
        rec.lastError = pair ? null : (rec.lastError || "no_dex_pair");
      } catch (err) {
        rec.lastDexAt = now;
        rec.lastError = String(err?.message || err);
      }
    }

    if (!rec.pair && p.mint && (rec.lastPoolAt == null || now - rec.lastPoolAt >= OHLCV_EVERY_MS)) {
      rec.lastPoolAt = now;
      try {
        const j = await fetchJson("https://api.geckoterminal.com/api/v2/networks/solana/tokens/" + encodeURIComponent(p.mint) + "/pools?page=1");
        const addr = j?.data?.[0]?.attributes?.address;
        if (addr) rec.pair = addr;
      } catch {}
    }

    const pair = rec.pair || p.pairAddress;
    if (pair && (rec.ohlcv.length === 0 || now - rec.lastOhlcvAt >= OHLCV_EVERY_MS)) {
      try {
        const j = await fetchJson(
          "https://api.geckoterminal.com/api/v2/networks/solana/pools/" +
          encodeURIComponent(pair) + "/ohlcv/minute?aggregate=1&limit=120"
        );
        const list = j?.data?.attributes?.ohlcv_list || [];
        rec.ohlcv = list
          .map((row) => {
            const ts = Number(row?.[0]);
            const close = Number(row?.[4]);
            if (!Number.isFinite(ts) || !Number.isFinite(close)) return null;
            const ms = ts < 1e12 ? ts * 1000 : ts;
            return { t: new Date(ms).toISOString(), price: close };
          })
          .filter(Boolean)
          .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
        rec.lastOhlcvAt = now;
        if (rec.ohlcv.length) {
          rec.source = rec.source && rec.source.includes("dexscreener")
            ? "dexscreener+geckoterminal"
            : "geckoterminal";
        }
      } catch (err) {
        rec.lastOhlcvAt = now;
        rec.lastError = rec.lastError || String(err?.message || err);
      }
    }
  }

  function attachClientCharts(positions) {
    return (positions || []).map((p) => {
      const rec = chartCache.get(p.mint);
      const extras = [
        ...(p.sparkline || []).map((x) => ({ t: x.t, price: x.price })),
        ...(p.price != null ? [{ t: new Date().toISOString(), price: p.price }] : []),
      ];
      const merged = mergePricePoints(rec?.ohlcv || [], rec?.live || [], extras);
      const supply = supplyOf(p, rec);
      const points = merged.map((pt) => {
        const liveCap = rec?.live?.find((x) => x.t === pt.t)?.mcap;
        return { t: pt.t, price: pt.price, mcap: asMcap(pt.price, supply, liveCap || rec?.mcap) };
      }).filter((pt) => pt.mcap > 0);
      const chart = {
        points,
        pairAddress: rec?.pair || p.pairAddress || null,
        url: rec?.url || p.dexscreener || null,
        source: rec?.source || (points.length ? "marks" : null),
        lastError: rec?.lastError || null,
        markMcap: rec?.mcap || (points.length ? points[points.length - 1].mcap : null),
      };
      const next = { ...p, chart };
      if (rec?.live?.length) {
        const last = rec.live[rec.live.length - 1];
        if (Number.isFinite(last.price)) {
          next.price = last.price;
          if (next.entry) next.pnlPct = (last.price - next.entry) / next.entry;
          if (next.tokens != null) next.markUsd = last.price * next.tokens;
        }
      }
      if (chart.markMcap > 0) next.markMcap = chart.markMcap;
      else if (supply && next.price) next.markMcap = next.price * supply;
      return next;
    });
  }

  let chartsBusy = false;
  async function refreshOpenCharts() {
    const s = window.__snap;
    if (!s || chartsBusy) return;
    const list = (s.positions || []).filter((p) => p && p.mint);
    const open = new Set(list.map((p) => p.mint));
    for (const mint of [...chartCache.keys()]) {
      if (!open.has(mint)) chartCache.delete(mint);
    }
    if (!list.length) return;
    chartsBusy = true;
    try {
      await Promise.allSettled(list.map((p) => refreshOne(p)));
      if (window.__snap) {
        window.__snap.positions = attachClientCharts(window.__snap.positions);
        renderPositions(window.__snap);
      }
    } finally {
      chartsBusy = false;
    }
  }

  async function loadData() {
    const res = await fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("data.json " + res.status);
    return res.json();
  }

  let loading = false;
  async function tick(initial) {
    if (loading) return;
    loading = true;
    try {
      const s = await loadData();
      $("conn").className = "conn ok";
      $("conn").textContent = "live";
      // Preserve in-memory live marks across data.json refreshes.
      if (window.__snap && Array.isArray(s.positions)) {
        s.positions = attachClientCharts(s.positions);
      }
      render(s);
      if (initial) refreshOpenCharts();
    } catch (err) {
      $("conn").className = "conn bad";
      $("conn").textContent = initial ? "failed to load data.json" : "retrying…";
      if (window.__snap) applyStale(window.__snap);
    } finally {
      loading = false;
    }
  }

  tick(true);
  setInterval(() => tick(false), REFRESH_MS);
  setInterval(refreshOpenCharts, DEX_EVERY_MS);
  setInterval(() => {
    const s = window.__snap;
    if (!s) return;
    const { stale } = applyStale(s);
    const src = s.generatedAt || s.healthAt;
    if (src) $("lastAgo").textContent = ago(src);
    if (stale) {
      $("statusPill").className = "pill stale";
      $("statusText").textContent = "stale";
      if ($("conn").className.includes("ok")) $("conn").textContent = "stale (box paused)";
    }
  }, 1000);
})();
