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

/** hex + alpha (0..1) -> 8-digit hex, e.g. withAlpha("#60a5fa", 0.5). */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return hex + a;
}

/** Top-to-bottom fill for bars: saturated at the cap, softer at the base. */
export function barGradient(color: string): object {
  return {
    type: "linear",
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: withAlpha(color, 1) },
      { offset: 1, color: withAlpha(color, 0.5) },
    ],
  };
}

/** Line-chart area wash that fades to nothing. */
export function areaGradient(color: string): object {
  return {
    type: "linear",
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: withAlpha(color, 0.28) },
      { offset: 1, color: withAlpha(color, 0.01) },
    ],
  };
}

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
