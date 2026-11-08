"use strict";
/* Mortality Atlas — vanilla JS, no dependencies.
   Data: data/data.json (fallback data/data.js on file://), data/provinces.json (fallback .js).
   Year record format: [maleDeaths[22], femaleDeaths[22], malePop[22], femalePop[22]] persons. */

const AGE_LABELS = ["0","1-4","5-9","10-14","15-19","20-24","25-29","30-34","35-39","40-44","45-49","50-54","55-59","60-64","65-69","70-74","75-79","80-84","85-89","90-94","95-99","100+"];
const AGE_START = [0,1,5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100];
const AGE_SPAN  = [1,4,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5]; // 100+ treated as 5 for median interpolation
const YEARS = []; for (let y = 1950; y <= 2025; y++) YEARS.push(y);
const PROV_YEARS = [2000, 2010];

const state = {
  mode: "country",          // country | province
  region: "WLD",            // region code or province name
  metric: "count",          // count | share | rate
  year: 2000,
  playing: false,
  speed: 1,                 // years per second
  timer: null,
  data: null,               // data.json payload
  prov: null,               // provinces.json payload
  scaleMax: { count: 1, share: 1, rate: 1 },
};

const $ = (s) => document.querySelector(s);
const fmtInt = (n) => Math.round(n).toLocaleString("en-US");
const fmtPct = (n) => n.toFixed(2);
const fmtRate = (n) => n.toFixed(1);

/* ---------- data loading (fetch, file:// fallback via script tag) ---------- */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
async function loadJSON(jsonUrl, jsUrl, globalName) {
  try {
    const r = await fetch(jsonUrl);
    if (!r.ok) throw new Error("http " + r.status);
    return await r.json();
  } catch (e) {
    await loadScript(jsUrl);
    if (!window[globalName]) throw new Error("fallback failed: " + jsonUrl);
    return window[globalName];
  }
}

/* ---------- current record access ---------- */
function regionObj() {
  return state.data.regions.find((r) => r.code === state.region);
}
function currentArrays() {
  // returns {m, f, pm, pf} — pm/pf null in province mode
  if (state.mode === "province") {
    const byYear = state.prov.provinces[state.region];
    const d = byYear[String(state.year)] || byYear["2010"];
    return { m: d.m, f: d.f, pm: null, pf: null };
  }
  const rec = regionObj().years[String(state.year)];
  return { m: rec[0], f: rec[1], pm: rec[2], pf: rec[3] };
}
function metricValue(arrs, sex, i) {
  const deaths = sex === "m" ? arrs.m[i] : arrs.f[i];
  if (state.metric === "count") return deaths;
  if (state.metric === "share") {
    const total = arrs.m.reduce((a, b) => a + b, 0) + arrs.f.reduce((a, b) => a + b, 0);
    return total ? (deaths / total) * 100 : 0;
  }
  // rate per mille
  const pop = sex === "m" ? arrs.pm[i] : arrs.pf[i];
  return pop ? (deaths / pop) * 1000 : 0;
}
function computeScale() {
  // fixed scale per region+mode across all its years, so animation is comparable
  for (const metric of ["count", "share", "rate"]) {
    let mx = 0;
    const saved = state.metric; state.metric = metric;
    if (state.mode === "province") {
      if (metric === "rate") { state.scaleMax[metric] = 1; state.metric = saved; continue; }
      for (const y of PROV_YEARS) {
        const d = state.prov.provinces[state.region][String(y)];
        const arrs = { m: d.m, f: d.f, pm: null, pf: null };
        for (let i = 0; i < 22; i++) mx = Math.max(mx, metricValue(arrs, "m", i), metricValue(arrs, "f", i));
      }
    } else {
      const reg = regionObj();
      for (const y of YEARS) {
        const rec = reg.years[String(y)];
        const arrs = { m: rec[0], f: rec[1], pm: rec[2], pf: rec[3] };
        for (let i = 0; i < 22; i++) mx = Math.max(mx, metricValue(arrs, "m", i), metricValue(arrs, "f", i));
      }
    }
    state.scaleMax[metric] = mx || 1;
    state.metric = saved;
  }
}

/* ---------- stats ---------- */
function medianAgeOfDeath(m, f) {
  const tot = m.map((v, i) => v + f[i]);
  const N = tot.reduce((a, b) => a + b, 0);
  if (!N) return 0;
  let cum = 0;
  for (let i = 0; i < 22; i++) {
    if (cum + tot[i] >= N / 2) {
      return AGE_START[i] + ((N / 2 - cum) / tot[i]) * AGE_SPAN[i];
    }
    cum += tot[i];
  }
  return 100;
}
function renderStats() {
  const { m, f } = currentArrays();
  const tm = m.reduce((a, b) => a + b, 0), tf = f.reduce((a, b) => a + b, 0);
  const total = tm + tf;
  const old = m.slice(14).reduce((a, b) => a + b, 0) + f.slice(14).reduce((a, b) => a + b, 0);
  const med = medianAgeOfDeath(m, f);
  const cards = [
    ["当年总死亡", fmtInt(total), "人"],
    ["男性死亡", fmtInt(tm), total ? fmtPct((tm / total) * 100) + " %" : ""],
    ["女性死亡", fmtInt(tf), total ? fmtPct((tf / total) * 100) + " %" : ""],
    ["死亡中位年龄", med.toFixed(1), "岁（分布插值）"],
    ["65 岁以上占比", total ? fmtPct((old / total) * 100) + " %" : "—", fmtInt(old) + " 人"],
    ["0 岁占比", total ? fmtPct(((m[0] + f[0]) / total) * 100) + " %" : "—", fmtInt(m[0] + f[0]) + " 人"],
  ];
  $("#stats").innerHTML = cards.map(([k, v, s]) =>
    `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");
}

/* ---------- pyramid ---------- */
function buildPyramid() {
  const box = $("#pyramid");
  box.innerHTML = "";
  for (let i = 21; i >= 0; i--) {
    const row = document.createElement("div");
    row.className = "prow";
    row.innerHTML =
      `<div class="bar-wrap"><div class="bar m"></div><span class="val m"></span></div>` +
      `<div class="age">${AGE_LABELS[i]}</div>` +
      `<div class="bar-wrap"><div class="bar f"></div><span class="val f"></span></div>`;
    box.appendChild(row);
  }
}
function fmtVal(v) {
  if (state.metric === "count") return fmtInt(v);
  if (state.metric === "share") return fmtPct(v) + "%";
  return fmtRate(v) + "‰";
}
function renderPyramid() {
  const arrs = currentArrays();
  const max = state.scaleMax[state.metric];
  const rows = $("#pyramid").children;
  for (let r = 0; r < 22; r++) {
    const i = 21 - r;
    const vm = metricValue(arrs, "m", i), vf = metricValue(arrs, "f", i);
    const row = rows[r];
    const bm = row.querySelector(".bar.m"), bf = row.querySelector(".bar.f");
    bm.style.width = (vm / max) * 100 + "%";
    bf.style.width = (vf / max) * 100 + "%";
    const lm = row.querySelector(".val.m"), lf = row.querySelector(".val.f");
    lm.textContent = vm > 0 ? fmtVal(vm) : "";
    lf.textContent = vf > 0 ? fmtVal(vf) : "";
    // hide side labels when the bar is nearly full-width to avoid overflow
    lm.style.visibility = vm / max > 0.82 ? "hidden" : "visible";
    lf.style.visibility = vf / max > 0.82 ? "hidden" : "visible";
  }
  const unit = state.metric === "count" ? "人" : state.metric === "share" ? "%（占当年总死亡）" : "‰（每千名同组人口）";
  $("#scaleNote").textContent = `横轴满格 = ${fmtVal(max)} ${state.metric === "count" ? unit : ""} · 尺度在同一地区内跨年份固定，可直接比较年份变化`;
}

/* ---------- table ---------- */
function renderTable() {
  const arrs = currentArrays();
  const { m, f, pm, pf } = arrs;
  const tm = m.reduce((a, b) => a + b, 0), tf = f.reduce((a, b) => a + b, 0), total = tm + tf;
  const hasPop = !!pm;
  const rate = (d, p) => (p ? (d / p) * 1000 : null);
  let html = "";
  for (let i = 0; i < 22; i++) {
    const t = m[i] + f[i];
    const rm = rate(m[i], hasPop ? pm[i] : null), rf = rate(f[i], hasPop ? pf[i] : null);
    const rt = hasPop ? rate(t, pm[i] + pf[i]) : null;
    const cell = (v, cls) => `<td class="num ${cls}">${v}</td>`;
    html += `<tr><td>${AGE_LABELS[i]}</td>` +
      cell(fmtInt(m[i]), "col-count") + cell(fmtInt(f[i]), "col-count") + cell(fmtInt(t), "col-count") +
      cell(total ? fmtPct((m[i] / total) * 100) : "—", "col-share") +
      cell(total ? fmtPct((f[i] / total) * 100) : "—", "col-share") +
      cell(total ? fmtPct((t / total) * 100) : "—", "col-share") +
      cell(rm == null ? "—" : fmtRate(rm), "col-rate") +
      cell(rf == null ? "—" : fmtRate(rf), "col-rate") +
      cell(rt == null ? "—" : fmtRate(rt), "col-rate") + `</tr>`;
  }
  $("#detailTable tbody").innerHTML = html;
  const rtAll = hasPop ? rate(total, pm.reduce((a, b) => a + b, 0) + pf.reduce((a, b) => a + b, 0)) : null;
  $("#detailTable tfoot").innerHTML =
    `<tr><td>合计</td><td class="num">${fmtInt(tm)}</td><td class="num">${fmtInt(tf)}</td><td class="num">${fmtInt(total)}</td>` +
    `<td class="num">${total ? fmtPct((tm / total) * 100) : "—"}</td><td class="num">${total ? fmtPct((tf / total) * 100) : "—"}</td><td class="num">100.00</td>` +
    `<td class="num">${hasPop ? fmtRate(rate(tm, pm.reduce((a, b) => a + b, 0))) : "—"}</td>` +
    `<td class="num">${hasPop ? fmtRate(rate(tf, pf.reduce((a, b) => a + b, 0))) : "—"}</td>` +
    `<td class="num">${rtAll == null ? "—" : fmtRate(rtAll)}</td></tr>`;
  for (const cls of ["count", "share", "rate"]) {
    document.querySelectorAll(".col-" + cls).forEach((el) => el.classList.toggle("hl", state.metric === cls));
  }
  const place = state.mode === "province" ? state.region : regionObj().zh;
  $("#detailTitle").textContent = `${place} · ${state.year} 年`;
  $("#tableNote").textContent = state.mode === "province"
    ? "省级：普查登记期（上年 11.1–当年 10.31）实测死亡数；无分年龄人口，死亡率列为空。"
    : (state.year >= 2024 ? "国家级：UN WPP2024 中位预测值。" : "国家级：UN WPP2024 估计值，与各国登记终值略有差异（见页脚）。");
}
function downloadCSV() {
  const arrs = currentArrays();
  const { m, f, pm, pf } = arrs;
  const total = m.reduce((a, b) => a + b, 0) + f.reduce((a, b) => a + b, 0);
  const lines = [["age_group", "male_deaths", "female_deaths", "total_deaths", "male_share_pct", "female_share_pct", "total_share_pct", "male_rate_per_mille", "female_rate_per_mille", "total_rate_per_mille"].join(",")];
  for (let i = 0; i < 22; i++) {
    const t = m[i] + f[i];
    const r = (d, p) => (p ? ((d / p) * 1000).toFixed(2) : "");
    lines.push([AGE_LABELS[i], m[i], f[i], t,
      total ? ((m[i] / total) * 100).toFixed(2) : "", total ? ((f[i] / total) * 100).toFixed(2) : "", total ? ((t / total) * 100).toFixed(2) : "",
      pm ? r(m[i], pm[i]) : "", pm ? r(f[i], pf[i]) : "", pm ? r(t, pm[i] + pf[i]) : ""].join(","));
  }
  const name = state.mode === "province" ? state.region : regionObj().code;
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mortality_${name}_${state.year}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- trend charts ---------- */
function drawTrend(canvas, series, color, fmt) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const vals = series.map((s) => s.v);
  let mn = Math.min(...vals), mx = Math.max(...vals);
  if (mx === mn) mx = mn + 1;
  const pad = (mx - mn) * 0.12; mx += pad; mn -= pad;
  const X = (yr) => (8 + ((yr - 1950) / 75) * (W - 16));
  const Y = (v) => (6 + (1 - (v - mn) / (mx - mn)) * (H - 26));
  ctx.strokeStyle = "#e3e7ec"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(8, Y(vals[0])); ctx.lineTo(W - 8, Y(vals[0])); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
  series.forEach((s, i) => { const x = X(s.y), y = Y(s.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  const cx = X(state.year);
  ctx.strokeStyle = "#c0392b"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(cx, 4); ctx.lineTo(cx, H - 18); ctx.stroke(); ctx.setLineDash([]);
  const cur = series.find((s) => s.y === state.year);
  if (cur) { ctx.fillStyle = "#c0392b"; ctx.beginPath(); ctx.arc(cx, Y(cur.v), 3, 0, 7); ctx.fill(); }
  ctx.fillStyle = "#66707d"; ctx.font = "10px " + getComputedStyle(document.body).getPropertyValue("--mono");
  ctx.fillText(fmt(mn + pad), 8, H - 5);
  ctx.fillText(fmt(mx - pad), 8, 12);
  ctx.fillText(String(state.year), Math.min(Math.max(cx - 14, 8), W - 40), H - 5);
  canvas.onclick = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const yr = Math.round(1950 + ((ev.clientX - rect.left - 8) / (W - 16)) * 75);
    setYear(Math.min(2025, Math.max(1950, yr)));
  };
}
function renderTrends() {
  const card = $("#trendCard");
  if (state.mode === "province") { card.style.display = "none"; return; }
  card.style.display = "";
  const reg = regionObj();
  const tot = [], old = [];
  for (const y of YEARS) {
    const rec = reg.years[String(y)];
    const t = rec[0].reduce((a, b) => a + b, 0) + rec[1].reduce((a, b) => a + b, 0);
    const o = rec[0].slice(14).reduce((a, b) => a + b, 0) + rec[1].slice(14).reduce((a, b) => a + b, 0);
    tot.push({ y, v: t }); old.push({ y, v: t ? (o / t) * 100 : 0 });
  }
  drawTrend($("#trendTotal"), tot, "#2f6db3", (v) => (v / 10000).toFixed(0) + "万");
  drawTrend($("#trendOld"), old, "#bf4d68", (v) => v.toFixed(0) + "%");
}

/* ---------- render orchestration ---------- */
const METRIC_DEFS = {
  count: "死亡人数：该年龄组在当年的死亡人数（人）。金字塔横轴为人数。",
  share: "死亡占比：该年龄组死亡数 ÷ 当年总死亡数（%）。它表示「当年死亡者中死于该年龄的比例」，约等于死亡概率的直观近似，并非出生队列的严格死亡概率。",
  rate: "死亡率：该年龄组死亡数 ÷ 同年龄组年中人口 ×1000（‰），即年龄别死亡率。省级普查数据无分年龄人口，此指标在省级模式下不可用。",
};
function renderAll() {
  $("#yearBig").textContent = state.year;
  const badge = $("#yearBadge");
  if (state.mode === "province") { badge.textContent = "普查实测"; badge.className = "badge"; }
  else if (state.year >= 2024) { badge.textContent = "UN 预测"; badge.className = "badge proj"; }
  else { badge.textContent = "UN 估计"; badge.className = "badge"; }
  const slider = $("#yearSlider");
  if (document.activeElement !== slider) slider.value = state.year;
  $("#metricDef").textContent = METRIC_DEFS[state.metric];
  renderStats(); renderPyramid(); renderTable(); renderTrends();
}
function setYear(y, fromSlider) {
  if (state.mode === "province") {
    // snap to nearest census year
    y = PROV_YEARS.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
  }
  state.year = Math.min(2025, Math.max(1950, y));
  if (!fromSlider) $("#yearSlider").value = state.year; else $("#yearSlider").value = state.year;
  renderAll();
}
function stopPlay() {
  state.playing = false;
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  $("#playBtn").textContent = "▶ 播放";
}
function startPlay() {
  stopPlay();
  if (state.mode === "country" && state.year >= 2025) setYear(1950);
  if (state.mode === "province" && state.year >= PROV_YEARS[PROV_YEARS.length - 1]) setYear(PROV_YEARS[0]);
  state.playing = true;
  $("#playBtn").textContent = "⏸ 暂停";
  const stepMs = 1000 / state.speed;
  state.timer = setInterval(() => {
    if (state.mode === "province") {
      const idx = PROV_YEARS.indexOf(state.year);
      if (idx >= PROV_YEARS.length - 1) { stopPlay(); return; }
      setYear(PROV_YEARS[idx + 1]);
    } else {
      if (state.year >= 2025) { stopPlay(); return; }
      setYear(state.year + 1);
    }
  }, state.mode === "province" ? Math.max(stepMs, 900) : stepMs);
}

/* ---------- controls wiring ---------- */
function fillRegions() {
  const sel = $("#regionSel");
  sel.innerHTML = "";
  if (state.mode === "country") {
    for (const r of state.data.regions) {
      const o = document.createElement("option");
      o.value = r.code; o.textContent = `${r.zh} ${r.en}`;
      sel.appendChild(o);
    }
    sel.value = state.region;
  } else {
    for (const p of Object.keys(state.prov.provinces)) {
      const o = document.createElement("option");
      o.value = p; o.textContent = p + "（2000 / 2010 普查）";
      sel.appendChild(o);
    }
    sel.value = state.region;
  }
}
function setMode(mode) {
  stopPlay();
  state.mode = mode;
  document.querySelectorAll("#modeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  const rateBtn = document.querySelector('#metricSeg button[data-metric="rate"]');
  if (mode === "province") {
    state.region = "上海";
    state.year = 2010; // must be a census year BEFORE any render (province has no other years)
    $("#yearSlider").value = state.year;
    if (state.metric === "rate") setMetric("count");
    rateBtn.disabled = true; rateBtn.title = "省级普查无分年龄人口，无法计算死亡率";
  } else {
    state.region = "WLD";
    rateBtn.disabled = false; rateBtn.title = "";
  }
  fillRegions();
  computeScale();
  renderAll();
}
function setMetric(metric) {
  state.metric = metric;
  document.querySelectorAll("#metricSeg button").forEach((b) => b.classList.toggle("on", b.dataset.metric === metric));
  renderAll();
}
function wire() {
  $("#modeSeg").addEventListener("click", (e) => { if (e.target.dataset.mode) setMode(e.target.dataset.mode); });
  $("#metricSeg").addEventListener("click", (e) => { if (e.target.dataset.metric && !e.target.disabled) setMetric(e.target.dataset.metric); });
  $("#speedSeg").addEventListener("click", (e) => {
    if (!e.target.dataset.speed) return;
    state.speed = parseFloat(e.target.dataset.speed);
    document.querySelectorAll("#speedSeg button").forEach((b) => b.classList.toggle("on", b === e.target));
    if (state.playing) startPlay();
  });
  $("#regionSel").addEventListener("change", (e) => {
    stopPlay(); state.region = e.target.value; computeScale(); renderAll();
  });
  $("#yearSlider").addEventListener("input", (e) => { stopPlay(); setYear(parseInt(e.target.value, 10), true); });
  $("#playBtn").addEventListener("click", () => { state.playing ? stopPlay() : startPlay(); });
  $("#prevBtn").addEventListener("click", () => {
    stopPlay();
    if (state.mode === "province") { const i = PROV_YEARS.indexOf(state.year); if (i > 0) setYear(PROV_YEARS[i - 1]); }
    else setYear(state.year - 1);
  });
  $("#nextBtn").addEventListener("click", () => {
    stopPlay();
    if (state.mode === "province") { const i = PROV_YEARS.indexOf(state.year); if (i < PROV_YEARS.length - 1) setYear(PROV_YEARS[i + 1]); }
    else setYear(state.year + 1);
  });
  $("#csvBtn").addEventListener("click", downloadCSV);
  window.addEventListener("resize", () => renderTrends());
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); state.playing ? stopPlay() : startPlay(); }
    if (e.key === "ArrowLeft") $("#prevBtn").click();
    if (e.key === "ArrowRight") $("#nextBtn").click();
  });
}

/* ---------- boot ---------- */
(async function boot() {
  try {
    state.data = await loadJSON("data/data.json", "data/data.js", "MORTALITY_DATA");
    state.prov = await loadJSON("data/provinces.json", "data/provinces.js", "PROVINCES_DATA");
  } catch (e) {
    document.querySelector("main").insertAdjacentHTML("afterbegin",
      `<div class="err">数据加载失败：${e.message}。请通过 http(s) 访问本页（GitHub Pages），或确认 data/ 目录完整。</div>`);
    return;
  }
  buildPyramid();
  fillRegions();
  computeScale();
  wire();
  renderAll();
})();
