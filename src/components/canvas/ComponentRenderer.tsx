"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type RefObject } from "react";
import type { RenderOutput, Row } from "@/lib/spec";
import { buildOption } from "./buildOption";
import { EChart, type EChartHandle } from "./EChart";
import { formatValue, SEVERITY_COLORS } from "./format";
import { addChartToDashboard, getMyDashboardNames } from "../../../app/dashboard-actions";
import { rowsToCsv, slugFilename, downloadBlob, downloadDataUrl } from "@/lib/export";

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

export function ComponentRenderer({
  output,
  canSave = false,
}: {
  output: RenderOutput;
  canSave?: boolean;
}) {
  const chartRef = useRef<EChartHandle>(null);
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
  const hasChart = spec.component !== "bignumber" && spec.component !== "table";

  return (
    <div className={`rounded-xl border ${tint} bg-[#0e1220]/90 p-4 shadow-lg shadow-black/20`}>
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold leading-snug text-slate-100">{spec.title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {output.truncated && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
              truncated
            </span>
          )}
          <ExportMenu output={output} chartRef={chartRef} hasChart={hasChart} />
          {canSave && <AddToDashboard specJson={JSON.stringify(spec)} />}
        </div>
      </div>
      <Body output={output} chartRef={chartRef} />
    </div>
  );
}

function ExportMenu({
  output,
  chartRef,
  hasChart,
}: {
  output: RenderOutput;
  chartRef: RefObject<EChartHandle | null>;
  hasChart: boolean;
}) {
  const [open, setOpen] = useState(false);
  const name = slugFilename(output.spec.title);

  const item = (label: string, onClick: () => void) => (
    <button
      onClick={() => {
        onClick();
        setOpen(false);
      }}
      className="block w-full px-3 py-1.5 text-left text-xs text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
    >
      {label}
    </button>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
        title="Export this chart"
      >
        Export ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-6 z-20 w-32 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/40">
            {item("CSV", () =>
              downloadBlob(`${name}.csv`, rowsToCsv(output.rows), "text/csv")
            )}
            {item("JSON", () =>
              downloadBlob(`${name}.json`, JSON.stringify(output.rows, null, 2), "application/json")
            )}
            {hasChart &&
              item("PNG", () => {
                const url = chartRef.current?.getPng();
                if (url) downloadDataUrl(`${name}.png`, url);
              })}
          </div>
        </>
      )}
    </div>
  );
}

const NEW_DASH = "__new__";

function AddToDashboard({ specJson }: { specJson: string }) {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[] | null>(null); // existing dashboards
  const [choice, setChoice] = useState(""); // an existing name, or NEW_DASH
  const [newName, setNewName] = useState("");
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Load the user's existing dashboards once the picker opens.
  useEffect(() => {
    if (!open || names !== null) return;
    getMyDashboardNames()
      .then((n) => {
        setNames(n);
        setChoice(n[0] ?? NEW_DASH);
      })
      .catch(() => setNames([]));
  }, [open, names]);

  if (savedTo) {
    return (
      <span className="text-[11px] text-emerald-400">
        ✓ saved{" "}
        <a
          href={`/dashboard?only=${encodeURIComponent(savedTo)}`}
          className="text-sky-400 hover:underline"
        >
          open →
        </a>
      </span>
    );
  }
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 transition hover:border-sky-600/50 hover:text-sky-300"
        title="Save this chart to a dashboard"
      >
        ＋ Dashboard
      </button>
    );
  }

  const hasExisting = !!names && names.length > 0;
  const creating = choice === NEW_DASH || !hasExisting;
  const target = creating ? newName.trim() : choice;

  const save = () => {
    if (!target) return;
    start(async () => {
      await addChartToDashboard(target, specJson);
      setSavedTo(target);
    });
  };

  return (
    <div className="flex items-center gap-1">
      {hasExisting && (
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="max-w-[9rem] rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-100 outline-none focus:border-sky-500/60"
        >
          {names!.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={NEW_DASH}>＋ New dashboard…</option>
        </select>
      )}
      {creating && (
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Dashboard name"
          className="w-28 rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-100 outline-none focus:border-sky-500/60"
        />
      )}
      <button
        disabled={pending || !target}
        onClick={save}
        className="rounded-md bg-sky-600 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
      >
        {pending ? "…" : "Save"}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="px-1 text-[11px] text-slate-500 hover:text-slate-300"
      >
        ✕
      </button>
    </div>
  );
}

function Body({
  output,
  chartRef,
}: {
  output: RenderOutput;
  chartRef: RefObject<EChartHandle | null>;
}) {
  const { spec } = output;
  const { option, height } = useMemo(() => buildOption(output), [output]);

  if (spec.component === "bignumber") return <BigNumber output={output} />;
  if (spec.component === "table") return <DataTable rows={output.rows} />;
  if (option) return <EChart ref={chartRef} option={option} height={height} />;
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
