import type { Encoding } from "@/lib/spec";

export const SEVERITY_COLORS: Record<string, string> = {
  bad: "#f87171",
  warn: "#fbbf24",
  good: "#34d399",
  info: "#60a5fa",
};

export const SERIES_COLORS = [
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#a78bfa",
  "#22d3ee",
  "#fb7185",
  "#4ade80",
];

export function formatValue(v: unknown, encoding?: Encoding): string {
  const n = Number(v);
  if (v == null || Number.isNaN(n)) return String(v ?? "—");
  const unit = encoding?.unit ? ` ${encoding.unit}` : "";
  switch (encoding?.format) {
    case "percent":
      return `${round(n, 1)}%`;
    case "duration_ms":
      return n >= 60_000
        ? `${round(n / 60_000, 1)}m`
        : n >= 1000
          ? `${round(n / 1000, 2)}s`
          : `${round(n, 0)}ms`;
    case "compact":
      return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n) + unit;
    default:
      return n.toLocaleString("en", { maximumFractionDigits: 2 }) + unit;
  }
}

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?/;

export function isDateLike(v: unknown): boolean {
  return typeof v === "string" && DATETIME_RE.test(v);
}

/** ClickHouse returns 'YYYY-MM-DD HH:MM:SS'; ECharts time axis wants ISO-ish. */
export function toTimeValue(v: unknown): string | number {
  if (typeof v === "string") return v.replace(" ", "T");
  return v as number;
}
