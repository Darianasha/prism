import type { RenderOutput, Row } from "./spec";
import { buildOption } from "@/components/canvas/buildOption";
import { formatValue } from "@/components/canvas/format";

// Builds a standalone HTML page that re-renders a dashboard's charts (ECharts
// from CDN) so the exported file opens as a nice, interactive dashboard.
// Note: chart axis/label number formatters are closures that can't be
// serialized, so exported charts fall back to ECharts' default number format;
// bignumber/table cards are formatted directly here and keep their units.

export interface ExportCard {
  title: string;
  output: RenderOutput;
  origin?: string | null;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string
  );
}

function cardWrap(title: string, origin: string | null | undefined, inner: string): string {
  const src = origin ? `<span class="src">↻ ${esc(origin)}</span>` : "";
  return `<section class="card"><div class="chead"><h2>${esc(title)}</h2>${src}</div>${inner}</section>`;
}

function tableHtml(rows: Row[]): string {
  const shown = rows.slice(0, 100);
  if (shown.length === 0) return `<div class="empty">No rows.</div>`;
  const cols = Object.keys(shown[0]);
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = shown
    .map(
      (r) =>
        `<tr>${cols
          .map((c) => {
            const v = r[c];
            const num = typeof v === "number";
            return `<td class="${num ? "num" : ""}">${esc(
              num ? (v as number).toLocaleString("en", { maximumFractionDigits: 2 }) : v
            )}</td>`;
          })
          .join("")}</tr>`
    )
    .join("");
  const more = rows.length > shown.length ? `<div class="empty">+${rows.length - shown.length} more rows</div>` : "";
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${more}`;
}

function bigNumberHtml(out: RenderOutput): string {
  const enc = out.spec.encoding;
  const first = out.rows[0] ?? {};
  const keys = Object.keys(first);
  const valueCol =
    enc.value && keys.includes(enc.value)
      ? enc.value
      : keys.find((k) => typeof first[k] === "number") ?? keys[0];
  const labelCol = enc.series && keys.includes(enc.series) ? enc.series : undefined;
  const cards = out.rows.slice(0, 4);
  return `<div class="bigrow">${cards
    .map((r) => {
      const label = labelCol ? `<div class="biglabel">${esc(r[labelCol])}</div>` : "";
      return `<div class="bigcell">${label}<div class="big">${esc(
        formatValue(Number(r[valueCol]), enc)
      )}</div></div>`;
    })
    .join("")}</div>`;
}

export function buildDashboardHtml(name: string, cards: ExportCard[]): string {
  const charts: { id: string; option: unknown }[] = [];
  const bodies = cards.map((card, i) => {
    const out = card.output;
    if (!out.ok || out.rows.length === 0) {
      return cardWrap(card.title, card.origin, `<div class="empty">No data.</div>`);
    }
    const kind = out.spec.component;
    if (kind === "bignumber") return cardWrap(card.title, card.origin, bigNumberHtml(out));
    if (kind === "table") return cardWrap(card.title, card.origin, tableHtml(out.rows));
    const { option, height } = buildOption(out);
    if (!option) return cardWrap(card.title, card.origin, tableHtml(out.rows));
    const id = `chart_${i}`;
    charts.push({ id, option });
    return cardWrap(
      card.title,
      card.origin,
      `<div id="${id}" style="width:100%;height:${height || 320}px"></div>`
    );
  });

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)} — Prism dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@6/dist/echarts.min.js"></script>
<style>
  body{margin:0;background:#0a0c12;color:#e2e8f0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  .wrap{max-width:900px;margin:0 auto;padding:32px 24px}
  h1{font-size:24px;margin:0 0 2px}
  .meta{color:#64748b;font-size:13px;margin-bottom:24px}
  .card{border:1px solid #1e2a3d;border-radius:12px;background:#0e1220;padding:16px;margin-bottom:20px}
  .chead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
  .card h2{font-size:15px;margin:0;color:#f1f5f9}
  .src{font-size:11px;color:#64748b}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #1e293b}
  th{color:#94a3b8;font-weight:500;text-transform:uppercase;font-size:11px}
  td{color:#cbd5e1} td.num{text-align:right;font-variant-numeric:tabular-nums}
  .bigrow{display:flex;flex-wrap:wrap;gap:24px}
  .biglabel{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8}
  .big{font-size:32px;font-weight:700;color:#34d399}
  .empty{color:#64748b;font-size:13px}
</style></head>
<body><div class="wrap">
  <h1>◇ ${esc(name)}</h1>
  <div class="meta">Exported from Prism · ${esc(new Date().toLocaleString())}</div>
  ${bodies.join("\n")}
</div>
<script>
  var CHARTS = ${JSON.stringify(charts)};
  var instances = CHARTS.map(function(c){
    var el = document.getElementById(c.id);
    if (!el) return null;
    var chart = echarts.init(el);
    chart.setOption(c.option);
    return chart;
  }).filter(Boolean);
  window.addEventListener('resize', function(){ instances.forEach(function(c){ c.resize(); }); });
</script></body></html>`;
}
