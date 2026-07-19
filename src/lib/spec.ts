import { z } from "zod";

// The contract between the agent and the frontend: render_component's input is a
// declarative spec (SQL travels in the call, never rows), its output carries the
// executed rows. The frontend renders exclusively from RenderOutput.

export const componentTypes = [
  "timeseries",
  "bar",
  "heatmap",
  "scatter",
  "bignumber",
  "table",
] as const;
export type ComponentType = (typeof componentTypes)[number];

export const annotationSchema = z.object({
  kind: z
    .enum(["vline", "region", "hline"])
    .describe(
      "vline: vertical marker at x (e.g. a deploy). region: shaded x..x2 (an incident window). hline: horizontal threshold at y."
    ),
  label: z.string().describe("Short label shown on the chart, e.g. 'deploy v2.4.0'"),
  x: z
    .union([z.string(), z.number()])
    .optional()
    .describe("x position; for time axes use 'YYYY-MM-DD HH:MM:SS'"),
  x2: z.union([z.string(), z.number()]).optional().describe("region end (kind=region)"),
  y: z.number().optional().describe("y position (kind=hline)"),
  severity: z.enum(["info", "warn", "bad", "good"]).describe("controls color"),
});
export type Annotation = z.infer<typeof annotationSchema>;

export const encodingSchema = z.object({
  x: z.string().optional().describe("column for the x axis (time or category)"),
  y: z
    .array(z.string())
    .optional()
    .describe("numeric column(s) to plot; multiple columns become multiple series"),
  series: z
    .string()
    .optional()
    .describe(
      "column that splits rows into series (charts) / the y-category (heatmap) / the card label (bignumber grid)"
    ),
  value: z
    .string()
    .optional()
    .describe("numeric value column (heatmap cell / bignumber value / scatter size)"),
  compare: z
    .string()
    .optional()
    .describe("bignumber only: column holding the comparison value; renders a delta"),
  unit: z.string().optional().describe("display unit suffix, e.g. 'ms', '%', '€'"),
  format: z
    .enum(["number", "percent", "duration_ms", "compact"])
    .optional()
    .describe("value formatting"),
});
export type Encoding = z.infer<typeof encodingSchema>;

export const renderInputSchema = z.object({
  component: z.enum(componentTypes),
  title: z.string().describe("short, insight-first title, e.g. 'Mobile signups fell 72% after the 14:00 deploy'"),
  subtitle: z.string().optional().describe("one short qualifier line; optional"),
  query: z
    .string()
    .describe(
      "ClickHouse SELECT producing exactly the columns referenced by encoding. Aggregate to a sensible grain (<= ~500 points per series)."
    ),
  encoding: encodingSchema,
  variant: z
    .enum(["line", "area", "strips", "stacked-bar", "grouped-bar", "horizontal-bar"])
    .optional()
    .describe(
      "strips (timeseries only): stack each y column as its own mini-chart sharing the time axis — REQUIRED when y columns have different units (°C vs % vs ms)"
    ),
  status: z
    .enum(["good", "warn", "bad", "neutral"])
    .optional()
    .describe("bignumber card tint / overall verdict color"),
  annotations: z.array(annotationSchema).optional(),
});
export type RenderInput = z.infer<typeof renderInputSchema>;

export type Row = Record<string, unknown>;

export interface RenderOutput {
  ok: boolean;
  error?: string;
  spec: RenderInput;
  rows: Row[];
  rowCount: number;
  truncated: boolean;
}
