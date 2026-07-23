import { createHash } from "node:crypto";
import { clickhouse, safeSelect } from "./clickhouse";
import { getSource, type SourceRow } from "./sources";
import type { RenderInput, RenderOutput } from "./spec";

// Per-user dashboards: a dashboard is a named group of saved charts. Each item
// stores the full render spec, so opening a dashboard re-runs the query and
// shows a live chart (kept current by the daily refresh cron).
const DB = "prism_app";

export interface SavedItem {
  item_id: string;
  title: string;
  table_name: string;
  spec: RenderInput;
  source: SourceRow | null;
}
export interface Dashboard {
  name: string;
  items: SavedItem[];
}

function nowStr(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/** First real table referenced by a query — for provenance + refresh linkage. */
export function tableFromQuery(query: string): string {
  const m = query.match(/\bfrom\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
  return m ? m[1] : "";
}

function itemId(spec: RenderInput): string {
  return createHash("sha1").update(`${spec.title}\n${spec.query}`).digest("hex").slice(0, 12);
}

/** Save a chart (from chat) to a dashboard. Idempotent per (title+query). */
export async function addChart(
  userId: string,
  dashboard: string,
  spec: RenderInput
): Promise<void> {
  await clickhouse().insert({
    table: `${DB}.dashboard_items`,
    values: [
      {
        user_id: userId,
        dashboard: dashboard.trim() || "My dashboard",
        item_id: itemId(spec),
        table_name: tableFromQuery(spec.query),
        title: spec.title,
        spec: JSON.stringify(spec),
        active: 1,
        added_at: nowStr(),
      },
    ],
    format: "JSONEachRow",
  });
}

/** Add a raw table by synthesizing a simple table-preview chart for it. */
export async function addTable(
  userId: string,
  dashboard: string,
  tableName: string
): Promise<void> {
  const spec = {
    component: "table",
    title: tableName,
    query: `SELECT * FROM ${tableName} LIMIT 50`,
    encoding: {},
  } as unknown as RenderInput;
  await addChart(userId, dashboard, spec);
}

export async function removeItem(
  userId: string,
  dashboard: string,
  itemId: string
): Promise<void> {
  const [row] = await readItems(
    `WHERE user_id = {u:String} AND dashboard = {d:String} AND item_id = {i:String}`,
    { u: userId, d: dashboard, i: itemId }
  );
  if (!row) return;
  await clickhouse().insert({
    table: `${DB}.dashboard_items`,
    values: [
      {
        user_id: userId,
        dashboard,
        item_id: itemId,
        table_name: row.table_name,
        title: row.title,
        spec: JSON.stringify(row.spec),
        active: 0,
        added_at: nowStr(),
      },
    ],
    format: "JSONEachRow",
  });
}

export async function listDashboards(userId: string): Promise<Dashboard[]> {
  const items = await readItems(
    `WHERE user_id = {u:String} AND active = 1`,
    { u: userId }
  );
  const byName = new Map<string, SavedItem[]>();
  for (const it of items) {
    const withSource: SavedItem = { ...it, source: await getSource(it.table_name) };
    if (!byName.has(it.dashboard)) byName.set(it.dashboard, []);
    byName.get(it.dashboard)!.push(withSource);
  }
  return [...byName].map(([name, items]) => ({ name, items }));
}

export async function listDashboardNames(userId: string): Promise<string[]> {
  const rs = await clickhouse().query({
    query: `SELECT DISTINCT dashboard FROM ${DB}.dashboard_items FINAL
            WHERE user_id = {userId:String} AND active = 1 ORDER BY dashboard`,
    query_params: { userId },
    format: "JSONEachRow",
  });
  return (await rs.json<{ dashboard: string }>()).map((r) => r.dashboard);
}

/** Re-run a saved chart's query and return a RenderOutput ready for the UI. */
export async function buildItemOutput(spec: RenderInput): Promise<RenderOutput> {
  try {
    const rows = await safeSelect(spec.query, { maxRows: 2000, timeoutSec: 20 });
    return { ok: true, spec, rows, rowCount: rows.length, truncated: false };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      spec,
      rows: [],
      rowCount: 0,
      truncated: false,
    };
  }
}

interface RawItem {
  dashboard: string;
  item_id: string;
  title: string;
  table_name: string;
  spec: RenderInput;
}

async function readItems(
  where: string,
  params: Record<string, string>
): Promise<RawItem[]> {
  const rs = await clickhouse().query({
    query: `SELECT dashboard, item_id, title, table_name, spec
            FROM ${DB}.dashboard_items FINAL ${where}
            ORDER BY dashboard, added_at DESC`,
    query_params: params,
    format: "JSONEachRow",
  });
  const rows = await rs.json<{
    dashboard: string;
    item_id: string;
    title: string;
    table_name: string;
    spec: string;
  }>();
  return rows
    .map((r) => {
      try {
        return { ...r, spec: JSON.parse(r.spec) as RenderInput };
      } catch {
        return null;
      }
    })
    .filter((r): r is RawItem => r !== null);
}
