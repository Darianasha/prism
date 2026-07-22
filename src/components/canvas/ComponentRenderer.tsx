"use client";

import { useMemo } from "react";
import type { RenderOutput, Row } from "@/lib/spec";
import { buildOption } from "./buildOption";
import { EChart } from "./EChart";
import { formatValue, SEVERITY_COLORS } from "./format";

const STATUS_TINT: Record<string, string> = {
  good: "border-emerald-500/30",
  warn: "border-amber-500/30",
  bad: "border-red-500/30",
  neutral: "border-slate-700/60",
};

/**
 * The user should never see raw ClickHouse table names dressed up as a "source".
 * Drop subtitles that cite an internal dataset/table; keep real ones (web domains).
 */
function cleanSubtitle(s?: string): string | undefined {
  if (!s) return undefined;
  if (/\b(internal|warehouse)\b/i.test(s) && /\b(dataset|table|source)\b/i.test(s)) return undefined;
  if (/source:\s*[a-z0-9]+_[a-z0-9_]+/i.test(s)) return undefined; // snake_case table-looking source
  return s;
}

export function ComponentRenderer({ output }: { output: RenderOutput }) {
  if (!output.ok) {
    // The agent sees the error and retries on its own — keep the failure quiet.
    return (
      <details>
        <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-amber-900/40 bg-amber-950/15 px-3 py-1 text-xs text-amber-500/80">
          ⚠ a query attempt failed — retrying
          <span className="text-amber-700">· details</span>
        </summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-500">
          {output.spec.title}
          {"\n"}
          {output.error}
        </pre>
      </details>
    );
  }
  if (output.rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
        “{output.spec.title}” — the query returned no rows.
      </div>
    );
  }

  const { spec } = output;
  const tint = STATUS_TINT[spec.status ?? "neutral"] ?? STATUS_TINT.neutral;
  const subtitle = cleanSubtitle(spec.subtitle);

  return (
    <div className={`rounded-xl border ${tint} bg-[#0e1220]/90 p-4 shadow-lg shadow-black/20`}>
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold leading-snug text-slate-100">{spec.title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
        {output.truncated && (
          <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            truncated
          </span>
        )}
      </div>
      <Body output={output} />
    </div>
  );
}

function Body({ output }: { output: RenderOutput }) {
  const { spec } = output;
  const { option, height } = useMemo(() => buildOption(output), [output]);

  if (spec.component === "bignumber") return <BigNumber output={output} />;
  if (spec.component === "table") return <DataTable rows={output.rows} />;
  if (option) return <EChart option={option} height={height} />;
  return <DataTable rows={output.rows} />;
}

// ---------------------------------------------------------------------------

function BigNumber({ output }: { output: RenderOutput }) {
  const { spec, rows } = output;
  const enc = spec.encoding;
  const first = rows[0] ?? {};
  const keys = Object.keys(first);
  const valueCol =
    enc.value && keys.includes(enc.value)
      ? enc.value
      : keys.find((k) => typeof first[k] === "number") ?? keys[0];
  const labelCol = enc.series && keys.includes(enc.series) ? enc.series : undefined;
  const compareCol = enc.compare && keys.includes(enc.compare) ? enc.compare : undefined;
  const cards = rows.slice(0, 4);
  const accent = SEVERITY_COLORS[spec.status === "neutral" ? "info" : (spec.status ?? "info")];

  return (
    <div className={`grid gap-3 ${cards.length > 1 ? "grid-cols-2 sm:grid-cols-" + Math.min(cards.length, 4) : ""}`}>
      {cards.map((row, i) => {
        const value = Number(row[valueCol]);
        const compare = compareCol != null ? Number(row[compareCol]) : null;
        const delta =
          compare != null && compare !== 0 ? ((value - compare) / Math.abs(compare)) * 100 : null;
        return (
          <div key={i} className="py-2">
            {labelCol && (
              <div className="text-xs uppercase tracking-wide text-slate-400">
                {String(row[labelCol])}
              </div>
            )}
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-4xl font-bold tabular-nums" style={{ color: accent }}>
                {formatValue(value, enc)}
              </span>
              {delta != null && (
                <span
                  className="text-sm font-semibold tabular-nums"
                  style={{ color: delta < 0 ? SEVERITY_COLORS.bad : SEVERITY_COLORS.good }}
                >
                  {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
                </span>
              )}
            </div>
            {compare != null && (
              <div className="mt-0.5 text-xs text-slate-500">
                vs {formatValue(compare, enc)} before
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DataTable({ rows }: { rows: Row[] }) {
  const shown = rows.slice(0, 12);
  const cols = Object.keys(shown[0] ?? {});
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800">
            {cols.map((c) => (
              <th key={c} className="py-1.5 pr-4 text-xs font-medium uppercase tracking-wide text-slate-400">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className="border-b border-slate-800/50 last:border-0">
              {cols.map((c) => {
                const v = r[c];
                const numeric = typeof v === "number";
                return (
                  <td
                    key={c}
                    className={`py-1.5 pr-4 ${numeric ? "tabular-nums text-slate-200" : "text-slate-300"}`}
                  >
                    {numeric ? v.toLocaleString("en", { maximumFractionDigits: 2 }) : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <div className="pt-2 text-xs text-slate-500">+{rows.length - shown.length} more rows</div>
      )}
    </div>
  );
}
