import { assertIdent, createTable, insertRows } from "./clickhouse";
import type { Row } from "./spec";

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
  const table = assertIdent(opts.table);

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

  return {
    table,
    rowCount: rows.length,
    columns,
    note: `Hourly forecast + air quality for ${locationName} (${days} days, local timezone of the location). european_aqi: <=20 good, 20-40 fair, 40-60 moderate, >60 poor.`,
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
  const table = assertIdent(opts.table);
  const res = await fetch(opts.url, { redirect: "follow" });
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

  return {
    table,
    rowCount: rows.length,
    columns,
    note: `Ingested from ${opts.url} (${format}).`,
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
