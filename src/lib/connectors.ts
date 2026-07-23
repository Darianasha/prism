import { createTable, insertRows } from "./clickhouse";
import type { Row } from "./spec";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { standardTableName } from "./tableNaming";
import { recordSource, type SourceParams } from "./sources";

// Recording provenance must never break a fetch (e.g. if prism_app isn't set up).
async function safeRecordSource(r: {
  table_name: string;
  source_kind: "open_meteo" | "url";
  params: SourceParams;
  origin: string;
  refreshable: boolean;
}): Promise<void> {
  try {
    await recordSource(r);
  } catch {
    /* provenance is best-effort */
  }
}

export interface IngestResult {
  table: string;
  rowCount: number;
  columns: { name: string; type: string }[];
  note: string;
}

// ---------------------------------------------------------------------------
// Open-Meteo: hourly weather + air quality forecast, keyless.
// ---------------------------------------------------------------------------

export async function fetchOpenMeteo(opts: {
  table: string;
  latitude: number;
  longitude: number;
  locationName: string;
  days?: number;
}): Promise<IngestResult> {
  const { latitude, longitude, locationName } = opts;
  const days = Math.min(Math.max(opts.days ?? 3, 1), 7);
  // Naming standard: weather always lands as wx_<place>, regardless of the name
  // the model proposed (it reads the real name back from this result).
  const table = standardTableName("open_meteo", locationName);

  const hourlyWeather =
    "temperature_2m,apparent_temperature,precipitation_probability,precipitation,cloud_cover,wind_speed_10m,wind_gusts_10m,uv_index";
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=${hourlyWeather}&forecast_days=${days}&timezone=auto`;
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&hourly=pm2_5,pm10,european_aqi&forecast_days=${days}&timezone=auto`;

  const [weather, air] = await Promise.all([getJson(weatherUrl), getJson(airUrl)]);

  const w = weather.hourly as Record<string, unknown[]>;
  const a = air.hourly as Record<string, unknown[]>;
  const airByTime = new Map<string, number>(
    (a.time as string[]).map((t, i) => [t, i])
  );

  const rows: Row[] = (w.time as string[]).map((t, i) => {
    const ai = airByTime.get(t);
    return {
      ts: t.replace("T", " ") + ":00",
      location: locationName,
      temp_c: num(w.temperature_2m?.[i]),
      feels_like_c: num(w.apparent_temperature?.[i]),
      precip_probability_pct: num(w.precipitation_probability?.[i]),
      precip_mm: num(w.precipitation?.[i]),
      cloud_cover_pct: num(w.cloud_cover?.[i]),
      wind_kmh: num(w.wind_speed_10m?.[i]),
      wind_gust_kmh: num(w.wind_gusts_10m?.[i]),
      uv_index: num(w.uv_index?.[i]),
      pm2_5: ai != null ? num(a.pm2_5?.[ai]) : null,
      pm10: ai != null ? num(a.pm10?.[ai]) : null,
      european_aqi: ai != null ? num(a.european_aqi?.[ai]) : null,
    };
  });

  const columns = [
    { name: "ts", type: "DateTime" },
    { name: "location", type: "LowCardinality(String)" },
    { name: "temp_c", type: "Nullable(Float64)" },
    { name: "feels_like_c", type: "Nullable(Float64)" },
    { name: "precip_probability_pct", type: "Nullable(Float64)" },
    { name: "precip_mm", type: "Nullable(Float64)" },
    { name: "cloud_cover_pct", type: "Nullable(Float64)" },
    { name: "wind_kmh", type: "Nullable(Float64)" },
    { name: "wind_gust_kmh", type: "Nullable(Float64)" },
    { name: "uv_index", type: "Nullable(Float64)" },
    { name: "pm2_5", type: "Nullable(Float64)" },
    { name: "pm10", type: "Nullable(Float64)" },
    { name: "european_aqi", type: "Nullable(Float64)" },
  ];

  await createTable(table, columns, "ts");
  await insertRows(table, rows);
  await safeRecordSource({
    table_name: table,
    source_kind: "open_meteo",
    params: { latitude, longitude, location_name: locationName, days },
    origin: "open-meteo.com",
    refreshable: true, // forecasts change daily — the cron re-fetches
  });

  return {
    table,
    rowCount: rows.length,
    columns,
    note: `Hourly forecast + air quality for ${locationName} (${days} days, local timezone of the location), stored as table "${table}". european_aqi: <=20 good, 20-40 fair, 40-60 moderate, >60 poor.`,
  };
}

// ---------------------------------------------------------------------------
// Generic URL ingest: CSV or JSON array of objects -> inferred-schema table.
// ---------------------------------------------------------------------------

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 100_000;

export async function ingestUrl(opts: {
  table: string;
  url: string;
  format?: "csv" | "json" | "auto";
}): Promise<IngestResult> {
  // Naming standard: external ingests land as ext_<slug> (from the model's hint
  // or the source host). The model reads the real name back from this result.
  let host = "";
  try {
    host = new URL(opts.url).hostname.replace(/^www\./, "");
  } catch {}
  const table = standardTableName("url", opts.table || host);
  const res = await safeFetch(opts.url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("File too large (>20MB)");

  const format =
    opts.format && opts.format !== "auto"
      ? opts.format
      : opts.url.includes(".json") || text.trimStart().startsWith("[") || text.trimStart().startsWith("{")
        ? "json"
        : "csv";

  let objects: Row[];
  if (format === "json") {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed)
      ? parsed
      : // common shapes: { data: [...] } / { results: [...] } / first array value
        (Object.values(parsed).find((v) => Array.isArray(v)) as Row[] | undefined);
    if (!arr || !Array.isArray(arr)) throw new Error("No array of objects found in JSON");
    objects = arr.slice(0, MAX_ROWS) as Row[];
  } else {
    objects = parseCsv(text).slice(0, MAX_ROWS);
  }
  if (objects.length === 0) throw new Error("No rows parsed from source");

  const { columns, rows } = inferSchema(objects);
  const orderBy = columns.find((c) => c.type === "DateTime")?.name ?? columns[0].name;
  await createTable(table, columns, orderBy);
  await insertRows(table, rows);
  await safeRecordSource({
    table_name: table,
    source_kind: "url",
    params: { url: opts.url, format },
    origin: host || opts.url,
    refreshable: true, // re-ingest daily to catch updates at the source
  });

  return {
    table,
    rowCount: rows.length,
    columns,
    note: `Ingested from ${opts.url} (${format}), stored as table "${table}".`,
  };
}

// Minimal RFC4180 CSV parser (quotes, escaped quotes, CRLF).
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.length > 1 || record[0] !== "") rows.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    if (record.length > 1 || record[0] !== "") rows.push(record);
  }
  if (rows.length < 2) return [];
  const header = rows[0].map((h, i) => sanitizeColumn(h) || `col_${i}`);
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function sanitizeColumn(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "c$1");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function inferSchema(objects: Row[]): { columns: { name: string; type: string }[]; rows: Row[] } {
  const keys = Object.keys(objects[0]).map((k) => sanitizeColumn(k) || "col");
  const rawKeys = Object.keys(objects[0]);
  const sample = objects.slice(0, 200);

  const types = rawKeys.map((rk) => {
    const values = sample.map((o) => o[rk]).filter((v) => v !== "" && v != null);
    if (values.length === 0) return "String";
    if (values.every((v) => typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v))))) {
      return "Nullable(Float64)";
    }
    if (values.every((v) => typeof v === "string" && DATE_RE.test(v.trim()))) return "DateTime";
    return "String";
  });

  const columns = keys.map((name, i) => ({ name, type: types[i] }));
  const rows = objects.map((o) =>
    Object.fromEntries(
      rawKeys.map((rk, i) => {
        let v: unknown = o[rk];
        if (types[i] === "Nullable(Float64)") v = v === "" || v == null ? null : Number(v);
        if (types[i] === "DateTime") v = normalizeDateTime(String(v));
        if (types[i] === "String") v = v == null ? "" : String(v);
        return [keys[i], v];
      })
    )
  );
  return { columns, rows };
}

function normalizeDateTime(v: string): string {
  const d = new Date(v.includes("T") || v.includes("Z") ? v : v.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "1970-01-01 00:00:00";
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  return (await res.json()) as Record<string, unknown>;
}

function num(v: unknown): number | null {
  return v == null ? null : Number(v);
}

const FETCH_MAX_BYTES = 2 * 1024 * 1024; // 2 MB of HTML is plenty to read
const FETCH_MAX_CHARS = 8_000;           // chars handed to the model

export async function fetchReadable(
  url: string
): Promise<{ url: string; title: string; text: string; truncated: boolean }> {
  const res = await safeFetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain|application\/(json|xhtml)/.test(ct)) {
    throw new Error(`Unsupported content-type: ${ct}`);
  }
  const raw = (await res.text()).slice(0, FETCH_MAX_BYTES);
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(raw)?.[1]?.trim() ?? url;
  const text = htmlToText(raw);
  const body = text.slice(0, FETCH_MAX_CHARS);
  const fenced = `<untrusted_web_content source="${res.url}">\n${body}\n</untrusted_web_content>`;
  return { url: res.url, title, text: fenced, truncated: text.length > FETCH_MAX_CHARS };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Only allow public http(s) targets. Rejects loopback/private/link-local hosts and
// cloud metadata endpoints BEFORE any network call. Fails closed on anything odd.
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error(`Invalid URL: ${raw}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are allowed (got ${u.protocol})`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");           // strip IPv6 brackets
  const ip = isIP(host) ? host : (await lookup(host)).address; // resolve DNS names
  if (isPrivateIp(ip)) {
    throw new Error(`Refusing to fetch an internal address: ${host} -> ${ip}`);
  }
  return u;
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));  // IPv4-mapped
    return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return true;        // fail closed
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||            // link-local incl. 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||  // CGNAT
    a >= 224                               // multicast / reserved
  );
}

async function safeFetch(url: string, maxRedirects = 3): Promise<Response> {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const target = await assertPublicUrl(current);
    const res = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, target).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
