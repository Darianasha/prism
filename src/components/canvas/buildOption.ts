import type { EChartsOption, SeriesOption } from "echarts";
import type { RenderOutput, Row, Annotation } from "@/lib/spec";
import {
  SEVERITY_COLORS,
  SERIES_COLORS,
  isDateLike,
  toTimeValue,
  formatValue,
  barGradient,
  areaGradient,
} from "./format";

const FONT_FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

// Turns a RenderOutput (spec + rows) into an ECharts option. Defensive: the
// model sometimes omits encoding fields, so every accessor falls back to
// inference from the actual row shape.

interface Resolved {
  x: string;
  ys: string[];
  series?: string;
  value?: string;
}

function resolveColumns(out: RenderOutput): Resolved {
  const { encoding } = out.spec;
  const first = out.rows[0] ?? {};
  const keys = Object.keys(first);
  const numeric = keys.filter((k) => typeof first[k] === "number" || (!isNaN(Number(first[k])) && String(first[k]).trim() !== "" && !isDateLike(first[k])));
  const x =
    encoding.x && keys.includes(encoding.x)
      ? encoding.x
      : keys.find((k) => isDateLike(first[k])) ?? keys[0] ?? "x";
  const series = encoding.series && keys.includes(encoding.series) ? encoding.series : undefined;
  const value = encoding.value && keys.includes(encoding.value) ? encoding.value : undefined;
  let ys = (encoding.y ?? []).filter((y) => keys.includes(y));
  if (ys.length === 0) {
    ys = numeric.filter((k) => k !== x && k !== series);
    if (value) ys = [value];
  }
  if (ys.length === 0 && numeric.length > 0) ys = [numeric[0]];
  return { x, ys, series, value };
}

const AXIS = {
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: { color: "#8b98b8", fontSize: 11 },
  splitLine: { lineStyle: { color: "#1a2233", type: "dashed" as const, width: 1 } },
};

const TOOLTIP = {
  backgroundColor: "rgba(15,20,33,0.94)",
  borderColor: "#2a3346",
  borderWidth: 1,
  padding: [8, 12] as [number, number],
  textStyle: { color: "#dbe4f5", fontSize: 12 },
  extraCssText: "border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.45);",
};

function baseOption(hasLegend: boolean, shadowPointer = false): EChartsOption {
  return {
    backgroundColor: "transparent",
    animationDuration: 500,
    animationEasing: "cubicOut",
    textStyle: { fontFamily: FONT_FAMILY },
    grid: { left: 56, right: 22, top: hasLegend ? 44 : 22, bottom: 36 },
    tooltip: {
      trigger: "axis",
      ...TOOLTIP,
      axisPointer: shadowPointer
        ? { type: "shadow", shadowStyle: { color: "rgba(148,163,184,0.07)" } }
        : { type: "line", lineStyle: { color: "#334155", type: "dashed", width: 1 } },
    },
    legend: hasLegend
      ? {
          top: 4,
          textStyle: { color: "#94a3b8", fontSize: 11 },
          icon: "roundRect",
          itemWidth: 11,
          itemHeight: 4,
          itemGap: 16,
        }
      : undefined,
  };
}

function annotationMarks(annotations: Annotation[] | undefined, isTime: boolean) {
  const anns = annotations ?? [];
  const color = (a: Annotation) => SEVERITY_COLORS[a.severity] ?? SEVERITY_COLORS.info;
  const lineData = [
    ...anns
      .filter((a) => a.kind === "vline" && a.x != null)
      .map((a) => ({
        xAxis: isTime ? toTimeValue(a.x) : (a.x as string | number),
        label: { formatter: a.label, color: color(a), fontSize: 11, position: "insideEndTop" as const },
        lineStyle: { color: color(a), type: "dashed" as const, width: 1.5 },
      })),
    ...anns
      .filter((a) => a.kind === "hline" && a.y != null)
      .map((a) => ({
        yAxis: a.y,
        label: { formatter: a.label, color: color(a), fontSize: 11, position: "insideEndTop" as const },
        lineStyle: { color: color(a), type: "dashed" as const, width: 1.5 },
      })),
  ];
  const areaData = anns
    .filter((a) => a.kind === "region" && a.x != null && a.x2 != null)
    .map((a) => [
      {
        xAxis: isTime ? toTimeValue(a.x) : (a.x as string | number),
        name: a.label,
        label: { color: color(a), fontSize: 11, position: "insideTop" as const },
        itemStyle: { color: color(a) + "26" },
      },
      { xAxis: isTime ? toTimeValue(a.x2) : (a.x2 as string | number) },
    ]);
  return {
    markLine: lineData.length
      ? { symbol: "none", animation: false, data: lineData }
      : undefined,
    markArea: areaData.length ? { silent: true, data: areaData } : undefined,
  };
}

function groupBy(rows: Row[], col: string): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = String(r[col]);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

export interface BuiltChart {
  option: EChartsOption | null;
  height: number;
}

export function buildOption(out: RenderOutput): BuiltChart {
  switch (out.spec.component) {
    case "timeseries":
    case "bar":
      return cartesian(out);
    case "heatmap":
      return { option: heatmap(out), height: 300 };
    case "scatter":
      return { option: scatter(out), height: 300 };
    default:
      return { option: null, height: 0 }; // bignumber & table render as React
  }
}

function cartesian(out: RenderOutput): BuiltChart {
  const { spec, rows } = out;
  const cols = resolveColumns(out);
  const { x, ys } = cols;
  // A "series" that's identical to the category axis is redundant — it splits
  // each category into empty grouped slots (thin bars + a pointless legend).
  // Collapse it to a single full-width series.
  const series = cols.series && cols.series !== x ? cols.series : undefined;
  const isBar = spec.component === "bar";
  const isTime = !isBar && isDateLike(rows[0]?.[x]);
  const variant = spec.variant;
  const stacked = variant === "stacked-bar";
  const horizontal = variant === "horizontal-bar";

  // Value labels read well on small categorical comparisons (e.g. two teams'
  // stats); they'd clutter a dense time series, so only show them when sparse.
  const seriesCount = series ? new Set(rows.map((r) => String(r[series]))).size : ys.length;
  const showBarLabels = isBar && rows.length * Math.max(seriesCount, 1) <= 24;

  const mkSeries = (name: string, data: [string | number, unknown][], idx: number): SeriesOption => {
    const color = SERIES_COLORS[idx % SERIES_COLORS.length];
    const radius = horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0];
    return {
      name,
      type: isBar ? "bar" : "line",
      stack: stacked ? "total" : undefined,
      showSymbol: false,
      symbolSize: 7,
      smooth: false,
      lineStyle: isBar ? undefined : { width: 2.5, color },
      itemStyle: isBar
        ? { color: barGradient(color), borderRadius: stacked ? 0 : radius }
        : { color },
      areaStyle:
        variant === "area" ? { color: areaGradient(color), opacity: 1 } : undefined,
      barMaxWidth: 46,
      barCategoryGap: "42%",
      emphasis: { focus: "series", scale: false },
      label: showBarLabels
        ? {
            show: true,
            position: stacked ? "inside" : horizontal ? "right" : "top",
            color: "#cbd5e1",
            fontSize: 11,
            fontWeight: 600,
            formatter: (p: { value: unknown }) => {
              const v = Array.isArray(p.value) ? p.value[horizontal ? 0 : 1] : p.value;
              return formatValue(v, spec.encoding);
            },
          }
        : undefined,
      data: horizontal ? data.map(([a, b]) => [b, a]) : data,
    } as SeriesOption;
  };

  let seriesList: SeriesOption[];
  if (series) {
    const yCol = ys[0];
    seriesList = [...groupBy(rows, series)].map(([name, group], i) =>
      mkSeries(
        name,
        group.map((r) => [isTime ? toTimeValue(r[x]) : String(r[x]), r[yCol]]),
        i
      )
    );
  } else {
    seriesList = ys.map((yCol, i) =>
      mkSeries(
        yCol,
        rows.map((r) => [isTime ? toTimeValue(r[x]) : String(r[x]), r[yCol]]),
        i
      )
    );
  }

  const marks = annotationMarks(spec.annotations, isTime);

  // Series with incompatible units/scales are unreadable on one shared axis —
  // split them into stacked strips. Explicit via variant "strips", or inferred
  // when distinct y columns (= distinct metrics) have very different magnitudes.
  if (!isBar && !stacked && seriesList.length >= 2 && seriesList.length <= 6) {
    const maxes = seriesList.map((s) =>
      Math.max(
        ...((s.data as [unknown, unknown][]) ?? []).map((d) => Math.abs(Number(d[1])) || 0),
        0
      )
    );
    const spread = Math.max(...maxes) / Math.max(Math.min(...maxes), 1e-9);
    const multiMetric = !series && ys.length > 1;
    if (variant === "strips" || (multiMetric && spread > 5) || spread > 12) {
      return smallMultiples(seriesList, marks, isTime);
    }
  }

  if (seriesList.length > 0) Object.assign(seriesList[0], marks);

  const valueAxis = {
    type: "value" as const,
    ...AXIS,
    axisLabel: {
      ...AXIS.axisLabel,
      formatter: (v: number) => formatValue(v, { ...spec.encoding, unit: undefined }),
    },
  };
  const catAxis = isTime
    ? { type: "time" as const, ...AXIS }
    : {
        type: "category" as const,
        ...AXIS,
        splitLine: { show: false },
        axisLabel: { ...AXIS.axisLabel, hideOverlap: true },
      };

  const option: EChartsOption = {
    ...baseOption(seriesList.length > 1, isBar),
    color: SERIES_COLORS,
    xAxis: horizontal ? valueAxis : catAxis,
    yAxis: horizontal ? { type: "category", ...AXIS, splitLine: { show: false }, inverse: true } : valueAxis,
    series: seriesList,
  };
  // Horizontal value labels sit to the RIGHT of each bar; widen the right
  // margin so the longest ("40M USD") isn't clipped at the container edge.
  if (horizontal && showBarLabels) {
    option.grid = { ...(option.grid as Record<string, unknown>), right: 88 };
  }
  return { option, height: 300 };
}

/** One mini-chart per series, stacked, sharing the x axis + crosshair. */
function smallMultiples(
  seriesList: SeriesOption[],
  marks: ReturnType<typeof annotationMarks>,
  isTime: boolean
): BuiltChart {
  const n = seriesList.length;
  const topPad = 4;
  const bottomPad = 9;
  const gap = 9;
  const h = (100 - topPad - bottomPad - gap * (n - 1)) / n;

  return {
    option: {
      backgroundColor: "transparent",
      animationDuration: 500,
      animationEasing: "cubicOut",
      textStyle: { fontFamily: FONT_FAMILY },
      color: SERIES_COLORS,
      tooltip: { trigger: "axis", ...TOOLTIP },
      axisPointer: {
        link: [{ xAxisIndex: "all" }],
        lineStyle: { color: "#475569", type: "dashed", width: 1 },
      },
      grid: seriesList.map((_, i) => ({
        left: 56,
        right: 20,
        top: `${topPad + i * (h + gap)}%`,
        height: `${h}%`,
      })),
      xAxis: seriesList.map((_, i) => ({
        type: isTime ? ("time" as const) : ("category" as const),
        gridIndex: i,
        ...AXIS,
        axisLabel: { ...AXIS.axisLabel, show: i === n - 1, hideOverlap: true },
        axisTick: { show: i === n - 1 },
      })),
      yAxis: seriesList.map((s, i) => ({
        type: "value" as const,
        gridIndex: i,
        scale: true,
        splitNumber: 2,
        name: String(s.name ?? ""),
        nameTextStyle: {
          color: SERIES_COLORS[i % SERIES_COLORS.length],
          fontSize: 11,
          fontWeight: 600 as const,
          align: "left" as const,
          padding: [0, 0, 0, -40],
        },
        nameGap: 10,
        ...AXIS,
        // the metric name sits at the top; hide the top tick label so they don't collide
        axisLabel: { ...AXIS.axisLabel, showMaxLabel: false },
      })),
      series: seriesList.map((s, i) => {
        const color = SERIES_COLORS[i % SERIES_COLORS.length];
        return {
          ...s,
          xAxisIndex: i,
          yAxisIndex: i,
          lineStyle: { width: 2.5, color },
          itemStyle: { color },
          areaStyle: { color: areaGradient(color), opacity: 1 },
          // deploy/incident annotations repeat on every strip
          ...marks,
        } as SeriesOption;
      }),
    },
    height: Math.max(82 * n + 42, 230),
  };
}

function heatmap(out: RenderOutput): EChartsOption {
  const { rows, spec } = out;
  const { x, series, value, ys } = resolveColumns(out);
  const yCol = series ?? ys.find((c) => c !== x) ?? x;
  const vCol = value ?? ys.find((c) => c !== x && c !== yCol) ?? ys[0];

  const xs = [...new Set(rows.map((r) => String(r[x])))];
  const ycats = [...new Set(rows.map((r) => String(r[yCol])))];
  const data = rows.map((r) => [
    xs.indexOf(String(r[x])),
    ycats.indexOf(String(r[yCol])),
    Number(r[vCol]),
  ]);
  const values = data.map((d) => d[2]).filter((v) => !Number.isNaN(v));
  const max = Math.max(...values, 0);

  return {
    ...baseOption(false),
    grid: { left: 90, right: 20, top: 16, bottom: 64 },
    tooltip: {
      ...((baseOption(false).tooltip as object) ?? {}),
      trigger: "item",
      formatter: (p: unknown) => {
        const d = (p as { data: number[] }).data;
        return `${ycats[d[1]]} · ${xs[d[0]]}<br/><b>${formatValue(d[2], spec.encoding)}</b>`;
      },
    },
    xAxis: {
      type: "category",
      data: xs,
      ...AXIS,
      axisLabel: { ...AXIS.axisLabel, hideOverlap: true },
      splitArea: { show: false },
    },
    yAxis: { type: "category", data: ycats, ...AXIS },
    visualMap: {
      min: 0,
      max: max || 1,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 120,
      textStyle: { color: "#8b98b8", fontSize: 10 },
      inRange: { color: ["#0f1729", "#1e3a8a", "#7c3aed", "#f59e0b", "#ef4444"] },
    },
    series: [
      {
        type: "heatmap",
        data,
        label: { show: false },
        itemStyle: { borderColor: "#0a0c12", borderWidth: 3, borderRadius: 4 },
        emphasis: {
          itemStyle: { borderColor: "#e2e8f0", shadowBlur: 8, shadowColor: "rgba(0,0,0,0.4)" },
        },
      },
    ],
  };
}

function scatter(out: RenderOutput): EChartsOption {
  const { rows, spec } = out;
  const { x, ys, series, value } = resolveColumns(out);
  const yCol = ys[0];
  const isTime = isDateLike(rows[0]?.[x]);
  const sizes = value ? rows.map((r) => Number(r[value])) : [];
  const maxSize = Math.max(...sizes, 1);

  const mk = (name: string, group: Row[]): SeriesOption =>
    ({
      name,
      type: "scatter",
      data: group.map((r) => [isTime ? toTimeValue(r[x]) : Number(r[x]), Number(r[yCol])]),
      symbolSize: value
        ? (v: unknown, p: { dataIndex: number }) =>
            6 + 24 * Math.sqrt(Number(group[p.dataIndex][value]) / maxSize)
        : 9,
      itemStyle: { opacity: 0.8, borderColor: "rgba(255,255,255,0.18)", borderWidth: 1 },
      emphasis: { itemStyle: { opacity: 1, shadowBlur: 10, shadowColor: "rgba(0,0,0,0.5)" } },
    }) as SeriesOption;

  const seriesList = series
    ? [...groupBy(rows, series)].map(([name, g]) => mk(name, g))
    : [mk(yCol, rows)];

  const marks = annotationMarks(spec.annotations, isTime);
  if (seriesList.length > 0) Object.assign(seriesList[0], marks);

  return {
    ...baseOption(seriesList.length > 1),
    color: SERIES_COLORS,
    tooltip: { ...(baseOption(false).tooltip as object), trigger: "item" },
    xAxis: isTime ? { type: "time", ...AXIS } : { type: "value", ...AXIS },
    yAxis: { type: "value", ...AXIS },
    series: seriesList,
  };
}
