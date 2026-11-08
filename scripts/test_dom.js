/* DOM functional test for Mortality Atlas using jsdom.
   Run: node scripts/test_dom.js [baseURL]  (default http://127.0.0.1:8931/)
   Canvas 2D is stubbed (jsdom has no rasteriser); all other app logic runs for real.
   fetch() is absent in jsdom, so the app's file:// fallback path (script-tag data/*.js)
   is what actually loads the data here — which also verifies that fallback. */
const { JSDOM } = require("../downloads/node-test/node_modules/jsdom");

const BASE = process.argv[2] || "http://127.0.0.1:8931/";
const results = [];
function check(name, cond, extra) {
  results.push([name, !!cond, extra || ""]);
  console.log((cond ? "PASS" : "FAIL"), name, extra || "");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const errors = [];
  const dom = await JSDOM.fromURL(BASE + "index.html", {
    resources: "usable",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      const ctxStub = {
        canvas: null, scale() {}, clearRect() {}, beginPath() {}, moveTo() {},
        lineTo() {}, stroke() {}, arc() {}, fill() {}, fillText() {}, setLineDash() {},
      };
      window.HTMLCanvasElement.prototype.getContext = () => ctxStub;
      window.URL.createObjectURL = () => "blob:stub";
      window.URL.revokeObjectURL = () => {};
      window.addEventListener("error", (e) => errors.push(String(e.message || e.error)));
    },
  });
  const { window } = dom;
  const doc = window.document;
  await sleep(3500);

  check("pyramid rows = 22", doc.querySelectorAll(".prow").length === 22, "got " + doc.querySelectorAll(".prow").length);
  check("stat cards = 6", doc.querySelectorAll(".stat").length === 6);
  check("region options = 16", doc.querySelectorAll("#regionSel option").length === 16, "got " + doc.querySelectorAll("#regionSel option").length);
  check("default year 2000", doc.querySelector("#yearBig").textContent === "2000", doc.querySelector("#yearBig").textContent);
  check("default badge UN估计", doc.querySelector("#yearBadge").textContent.includes("估计"), doc.querySelector("#yearBadge").textContent);
  const total0 = doc.querySelectorAll(".stat .v")[0].textContent;
  check("WLD 2000 total = 52,240,368", total0 === "52,240,368", total0);
  check("table rows = 22", doc.querySelectorAll("#detailTable tbody tr").length === 22);
  check("no page error box", !doc.querySelector(".err"));
  const barW = doc.querySelector(".prow .bar.f").style.width;
  check("pyramid bars have width", barW !== "", barW);

  // year stepping + slider
  doc.querySelector("#nextBtn").click();
  check("next year -> 2001", doc.querySelector("#yearBig").textContent === "2001");
  const slider = doc.querySelector("#yearSlider");
  slider.value = "1950";
  slider.dispatchEvent(new window.Event("input", { bubbles: true }));
  check("slider -> 1950", doc.querySelector("#yearBig").textContent === "1950");
  check("WLD 1950 total = 48,486,892", doc.querySelectorAll(".stat .v")[0].textContent === "48,486,892",
    doc.querySelectorAll(".stat .v")[0].textContent);

  // metric switching
  doc.querySelector('#metricSeg button[data-metric="share"]').click();
  check("metric def mentions 占比定义", doc.querySelector("#metricDef").textContent.includes("当年总死亡数"));
  doc.querySelector('#metricSeg button[data-metric="rate"]').click();
  check("rate metric renders", doc.querySelector("#scaleNote").textContent.includes("‰"));

  // region switching
  const sel = doc.querySelector("#regionSel");
  sel.value = "JPN";
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  slider.value = "2023";
  slider.dispatchEvent(new window.Event("input", { bubbles: true }));
  const jpnTot = parseInt(doc.querySelectorAll(".stat .v")[0].textContent.replace(/,/g, ""), 10);
  check("JPN 2023 total ≈ 1,524,431 (±10 rounding)", Math.abs(jpnTot - 1524431) <= 10, String(jpnTot));
  slider.value = "2024";
  slider.dispatchEvent(new window.Event("input", { bubbles: true }));
  check("2024 badge UN预测", doc.querySelector("#yearBadge").textContent.includes("预测"), doc.querySelector("#yearBadge").textContent);

  // play / pause (from 2000 at speed 4 -> advances, then pause mid-way)
  slider.value = "2000";
  slider.dispatchEvent(new window.Event("input", { bubbles: true }));
  doc.querySelector('#speedSeg button[data-speed="4"]').click();
  doc.querySelector("#playBtn").click();
  await sleep(1200);
  const yAfter = parseInt(doc.querySelector("#yearBig").textContent, 10);
  check("playing advances year", yAfter > 2000 && yAfter < 2025, "year=" + yAfter);
  doc.querySelector("#playBtn").click();
  check("pause label restored", doc.querySelector("#playBtn").textContent.includes("播放"));

  // province mode
  doc.querySelector('#modeSeg button[data-mode="province"]').click();
  await sleep(200);
  check("province options = 8", doc.querySelectorAll("#regionSel option").length === 8, "got " + doc.querySelectorAll("#regionSel option").length);
  check("province default 上海", sel.value === "上海", sel.value);
  check("province year snapped to 2010", doc.querySelector("#yearBig").textContent === "2010", doc.querySelector("#yearBig").textContent);
  check("province badge 普查实测", doc.querySelector("#yearBadge").textContent.includes("普查实测"));
  check("上海 2010 total = 114,289", doc.querySelectorAll(".stat .v")[0].textContent === "114,289",
    doc.querySelectorAll(".stat .v")[0].textContent);
  check("rate button disabled in province mode", doc.querySelector('#metricSeg button[data-metric="rate"]').disabled === true);
  check("trend card hidden in province mode", doc.querySelector("#trendCard").style.display === "none");
  doc.querySelector("#prevBtn").click();
  check("province prev -> 2000", doc.querySelector("#yearBig").textContent === "2000");
  check("上海 2000 total = 94,927", doc.querySelectorAll(".stat .v")[0].textContent === "94,927",
    doc.querySelectorAll(".stat .v")[0].textContent);

  check("no window errors", errors.length === 0, errors.join(" | "));
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\nDOM TEST: ${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(2); });
