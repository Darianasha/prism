import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { Row } from "./spec";

const DATABASE = process.env.CLICKHOUSE_DATABASE ?? "canvas";

let client: ClickHouseClient | null = null;

export function clickhouse(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
      username: process.env.CLICKHOUSE_USER ?? "canvas",
      password: process.env.CLICKHOUSE_PASSWORD ?? "canvas",
      database: DATABASE,
    });
  }
  return client;
}

export class QueryError extends Error {}

/**
 * Read-only query path used by the agent. Defense in depth: single SELECT/WITH
 * statement only, and ClickHouse-side readonly=1 so nothing mutating can run
 * even if the keyword check is fooled.
 */
export async function safeSelect(
  sql: string,
  { maxRows = 2000, timeoutSec = 30 }: { maxRows?: number; timeoutSec?: number } = {}
): Promise<Row[]> {
  // Models sometimes double-escape whitespace in tool-call JSON, delivering
  // literal \n / \t sequences that ClickHouse rejects as unknown tokens.
  if (!sql.includes("\n") && /\\[nrt]/.test(sql)) {
    sql = sql.replace(/\\r/g, "").replace(/\\n/g, "\n").replace(/\\t/g, "  ");
  }
  const stmt = sql.trim().replace(/;+\s*$/, "");
  if (stmt.includes(";")) {
    throw new QueryError("Only a single statement is allowed");
  }
  if (!/^(select|with)\b/i.test(stmt)) {
    throw new QueryError("Only SELECT queries are allowed");
  }
  const rs = await clickhouse().query({
    query: stmt,
    format: "JSONEachRow",
    clickhouse_settings: {
      readonly: "1",
      max_result_rows: String(maxRows),
      result_overflow_mode: "break",
      max_execution_time: timeoutSec,
    },
  });
  return rs.json<Row>();
}

export interface TableInfo {
  table: string;
  rowCount: number;
  columns: { name: string; type: string; values?: string[] }[];
  timeColumn?: string;
  timeRange?: { min: string; max: string };
  sampleRows: Row[];
}

/** Everything the model needs to orient itself in the warehouse. */
export async function introspect(): Promise<TableInfo[]> {
  const columns = await safeSelect(
    `SELECT table, name, type FROM system.columns WHERE database = '${DATABASE}' ORDER BY table, position`
  );
  const counts = await safeSelect(
    `SELECT table, sum(rows) AS rows FROM system.parts WHERE database = '${DATABASE}' AND active GROUP BY table`
  );
  const countByTable = new Map(counts.map((r) => [String(r.table), Number(r.rows)]));

  const byTable = new Map<string, TableInfo["columns"]>();
  for (const c of columns) {
    const t = String(c.table);
    if (!byTable.has(t)) byTable.set(t, []);
    byTable.get(t)!.push({ name: String(c.name), type: String(c.type) });
  }

  const infos: TableInfo[] = [];
  for (const [table, cols] of byTable) {
    const timeColumn = cols.find((c) => c.type.startsWith("DateTime"))?.name;
    let timeRange: TableInfo["timeRange"];
    if (timeColumn) {
      const [r] = await safeSelect(
        `SELECT toString(min(${timeColumn})) AS min, toString(max(${timeColumn})) AS max FROM ${DATABASE}.${table}`
      );
      if (r) timeRange = { min: String(r.min), max: String(r.max) };
    }
    const sampleRows = await safeSelect(`SELECT * FROM ${DATABASE}.${table} LIMIT 3`);
    // enumerate values of low-cardinality columns so the model writes correct filters
    for (const c of cols) {
      if (c.type.includes("LowCardinality")) {
        const vals = await safeSelect(
          `SELECT DISTINCT ${c.name} AS v FROM ${DATABASE}.${table} LIMIT 12`
        );
        c.values = vals.map((r) => String(r.v));
      }
    }
    infos.push({
      table,
      rowCount: countByTable.get(table) ?? 0,
      columns: cols,
      timeColumn,
      timeRange,
      sampleRows,
    });
  }
  return infos;
}

const VALID_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function assertIdent(name: string): string {
  if (!VALID_IDENT.test(name)) {
    throw new QueryError(`Invalid identifier: ${name}`);
  }
  return name;
}

/** Used by ingestion connectors only — never exposed to raw model SQL. */
export async function createTable(
  table: string,
  columns: { name: string; type: string }[],
  orderBy: string
): Promise<void> {
  assertIdent(table);
  columns.forEach((c) => assertIdent(c.name));
  assertIdent(orderBy);
  const cols = columns.map((c) => `\`${c.name}\` ${c.type}`).join(", ");
  await clickhouse().command({
    query: `CREATE OR REPLACE TABLE ${DATABASE}.${table} (${cols}) ENGINE = MergeTree ORDER BY ${orderBy}`,
  });
}

export async function insertRows(table: string, rows: Row[]): Promise<void> {
  assertIdent(table);
  const BATCH = 50_000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await clickhouse().insert({
      table: `${DATABASE}.${table}`,
      values: rows.slice(i, i + BATCH),
      format: "JSONEachRow",
    });
  }
}
