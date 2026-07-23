import { clickhouse } from "./clickhouse";
import type { SourceKind } from "./tableNaming";

// Provenance for every fetched table lives in prism_app (kept out of the
// `canvas` warehouse so the agent's introspect() never sees it). One logical
// record per table; ReplacingMergeTree folds re-fetches, newest wins.
const DB = "prism_app";

export interface SourceParams {
  // open_meteo
  latitude?: number;
  longitude?: number;
  location_name?: string;
  days?: number;
  // url
  url?: string;
  format?: "csv" | "json" | "auto";
}

export interface SourceRecord {
  table_name: string;
  source_kind: SourceKind;
  params: SourceParams;
  origin: string; // human origin: a domain ("open-meteo.com") or the source URL
  refreshable: boolean; // can the cron re-fetch it to keep it current?
}

export interface SourceRow extends SourceRecord {
  created_at: string;
  last_refreshed_at: string;
}

function nowStr(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/** Record (or refresh) a fetched table's provenance. */
export async function recordSource(r: SourceRecord): Promise<void> {
  const now = nowStr();
  await clickhouse().insert({
    table: `${DB}.sources`,
    values: [
      {
        table_name: r.table_name,
        source_kind: r.source_kind,
        params: JSON.stringify(r.params),
        origin: r.origin,
        refreshable: r.refreshable ? 1 : 0,
        created_at: now,
        last_refreshed_at: now,
      },
    ],
    format: "JSONEachRow",
  });
}

/** Bump last_refreshed_at after the cron re-fetches a source. */
export async function touchSource(tableName: string): Promise<void> {
  const [row] = await readSources(`WHERE table_name = {t:String}`, { t: tableName });
  if (!row) return;
  await clickhouse().insert({
    table: `${DB}.sources`,
    values: [
      {
        table_name: row.table_name,
        source_kind: row.source_kind,
        params: JSON.stringify(row.params),
        origin: row.origin,
        refreshable: row.refreshable ? 1 : 0,
        created_at: row.created_at,
        last_refreshed_at: nowStr(),
      },
    ],
    format: "JSONEachRow",
  });
}

export async function listRefreshableSources(): Promise<SourceRow[]> {
  return readSources(`WHERE refreshable = 1`);
}

export async function listAllSources(): Promise<SourceRow[]> {
  return readSources("");
}

export async function getSource(tableName: string): Promise<SourceRow | null> {
  const [row] = await readSources(`WHERE table_name = {t:String}`, { t: tableName });
  return row ?? null;
}

async function readSources(
  where: string,
  params: Record<string, string> = {}
): Promise<SourceRow[]> {
  const rs = await clickhouse().query({
    query: `SELECT table_name, source_kind, params, origin, refreshable,
                   toString(created_at) AS created_at, toString(last_refreshed_at) AS last_refreshed_at
            FROM ${DB}.sources FINAL ${where}
            ORDER BY last_refreshed_at DESC`,
    query_params: params,
    format: "JSONEachRow",
  });
  const rows = await rs.json<{
    table_name: string;
    source_kind: SourceKind;
    params: string;
    origin: string;
    refreshable: number;
    created_at: string;
    last_refreshed_at: string;
  }>();
  return rows.map((r) => ({
    table_name: r.table_name,
    source_kind: r.source_kind,
    params: safeParse(r.params),
    origin: r.origin,
    refreshable: r.refreshable === 1,
    created_at: r.created_at,
    last_refreshed_at: r.last_refreshed_at,
  }));
}

function safeParse(s: string): SourceParams {
  try {
    return JSON.parse(s) as SourceParams;
  } catch {
    return {};
  }
}
