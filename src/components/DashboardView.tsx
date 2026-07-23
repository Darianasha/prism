"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { RenderOutput } from "@/lib/spec";
import { ComponentRenderer } from "./canvas/ComponentRenderer";
import { rowsToCsv, slugFilename, downloadBlob } from "@/lib/export";
import { buildDashboardHtml } from "@/lib/dashboardHtml";
import { addTablesToDashboard, removeItemFromDashboard } from "../../app/dashboard-actions";

export interface DashCard {
  item_id: string;
  title: string;
  output: RenderOutput;
  origin: string | null;
  lastRefreshed: string | null;
}
export interface DashGroup {
  name: string;
  cards: DashCard[];
}
export interface AvailableTable {
  table_name: string;
  origin: string;
}

export function DashboardView({
  groups,
  available,
  existingNames,
  focused = null,
}: {
  groups: DashGroup[];
  available: AvailableTable[];
  existingNames: string[];
  focused?: string | null;
}) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {focused ? (
        <div className="mb-6 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-100">▦ {focused}</h1>
          {groups[0] && <ExportDashboard name={focused} cards={groups[0].cards} />}
        </div>
      ) : (
        <>
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-100">Dashboards</h1>
            <p className="mt-1 text-sm text-slate-400">
              Your saved charts, grouped by name. Add charts straight from chat, or raw tables below.
              Sources marked ↻ refresh daily. Open any dashboard in its own window with ↗.
            </p>
          </div>
          <AddTableForm available={available} existingNames={existingNames} />
        </>
      )}

      {groups.length === 0 ? (
        <p className="mt-8 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-500">
          {focused
            ? "This dashboard is empty."
            : "No dashboards yet. Use “＋ Dashboard” on any chart in chat, or add a table above."}
        </p>
      ) : (
        <div className={focused ? "space-y-4" : "mt-8 space-y-10"}>
          {groups.map((g) => (
            <section key={g.name}>
              {!focused && (
                <div className="mb-3 flex items-center gap-3">
                  <Link
                    href={`/dashboard?only=${encodeURIComponent(g.name)}`}
                    title={`Open “${g.name}”`}
                    className="text-sm font-semibold uppercase tracking-wide text-slate-400 transition hover:text-sky-300"
                  >
                    {g.name} →
                  </Link>
                  <ExportDashboard name={g.name} cards={g.cards} />
                </div>
              )}
              <div className="space-y-4">
                {g.cards.map((c) => (
                  <div key={c.item_id} className="relative">
                    <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
                      {c.origin && (
                        <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-400">
                          ↻ {c.origin}
                        </span>
                      )}
                      <RemoveButton dashboard={g.name} itemId={c.item_id} />
                    </div>
                    <ComponentRenderer output={c.output} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportDashboard({ name, cards }: { name: string; cards: DashCard[] }) {
  const [open, setOpen] = useState(false);
  const slug = slugFilename(name);
  const rowsOf = (c: DashCard) => (c.output.ok ? c.output.rows : []);

  const exportJson = () =>
    downloadBlob(
      `${slug}.json`,
      JSON.stringify(
        {
          dashboard: name,
          exportedAt: new Date().toISOString(),
          tables: cards.map((c) => ({ title: c.title, source: c.origin, rows: rowsOf(c) })),
        },
        null,
        2
      ),
      "application/json"
    );

  const exportCsv = () =>
    downloadBlob(
      `${slug}.csv`,
      cards.map((c) => `# ${c.title}\n${rowsToCsv(rowsOf(c))}`).join("\n\n"),
      "text/csv"
    );

  const exportHtml = () =>
    downloadBlob(
      `${slug}.html`,
      buildDashboardHtml(
        name,
        cards.map((c) => ({ title: c.title, output: c.output, origin: c.origin }))
      ),
      "text/html"
    );

  if (cards.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] normal-case text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
        title="Export this whole dashboard"
      >
        Export ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-20 w-44 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/40">
            <button
              onClick={() => {
                exportHtml();
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs normal-case text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
            >
              Interactive page · HTML
            </button>
            <button
              onClick={() => {
                exportJson();
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs normal-case text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
            >
              All tables · JSON
            </button>
            <button
              onClick={() => {
                exportCsv();
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs normal-case text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
            >
              All tables · CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RemoveButton({ dashboard, itemId }: { dashboard: string; itemId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => start(() => removeItemFromDashboard(dashboard, itemId))}
      className="rounded-md bg-slate-800/80 px-2 py-0.5 text-xs text-slate-400 transition hover:text-red-300 disabled:opacity-50"
      title="Remove from dashboard"
    >
      ✕
    </button>
  );
}

function AddTableForm({
  available,
  existingNames,
}: {
  available: AvailableTable[];
  existingNames: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dashboard, setDashboard] = useState(existingNames[0] ?? "");
  const [pending, start] = useTransition();

  if (available.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-500">
        No fetched tables yet. Ask the agent something that needs live data (weather, a dataset URL)
        and add the chart from chat.
      </div>
    );
  }

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const submit = () => {
    if (selected.size === 0) return;
    const name = dashboard.trim() || "My dashboard";
    const tables = [...selected];
    start(async () => {
      await addTablesToDashboard(name, tables);
      setSelected(new Set());
    });
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 text-xs text-slate-400">Add tables to a dashboard</div>
      <div className="mb-3 grid max-h-44 gap-1.5 overflow-y-auto sm:grid-cols-2">
        {available.map((t) => {
          const on = selected.has(t.table_name);
          return (
            <button
              key={t.table_name}
              onClick={() => toggle(t.table_name)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                on
                  ? "border-sky-600/60 bg-sky-950/30 text-slate-100"
                  : "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700"
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                  on ? "border-sky-500 bg-sky-600 text-white" : "border-slate-600"
                }`}
              >
                {on ? "✓" : ""}
              </span>
              <span className="min-w-0 truncate">
                <span className="font-mono">{t.table_name}</span>
                <span className="text-slate-500"> · {t.origin}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Dashboard name
          <input
            list="dash-names"
            value={dashboard}
            onChange={(e) => setDashboard(e.target.value)}
            placeholder="My dashboard"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 outline-none focus:border-sky-500/60"
          />
          <datalist id="dash-names">
            {existingNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <button
          disabled={pending || selected.size === 0}
          onClick={submit}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
        >
          {pending
            ? "Adding…"
            : `Add ${selected.size || ""} ${selected.size === 1 ? "table" : "tables"}`.trim()}
        </button>
      </div>
    </div>
  );
}
