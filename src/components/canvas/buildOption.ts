import type { EChartsOption, SeriesOption } from "echarts";
import type { RenderOutput, Row, Annotation } from "@/lib/spec";
import { SEVERITY_COLORS, SERIES_COLORS, isDateLike, toTimeValue, formatValue } from "./format";

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
  axisLine: { lineStyle: { color: "#2a3346" } },
  axisTick: { lineStyle: { color: "#2a3346" } },
  axisLabel: { color: "#8b98b8", fontSize: 11 },
  splitLine: { lineStyle: { color: "#161c2a" } },
};

function baseOption(hasLegend: boolean): EChartsOption {
  return {
    backgroundColor: "transparent",
    animationDuration: 400,
    grid: { left: 56, right: 20, top: hasLegend ? 40 : 20, bottom: 36 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#111726",
      borderColor: "#2a3346",
      textStyle: { color: "#dbe4f5", fontSize: 12 },
    },
    legend: hasLegend
      ? { top: 0, textStyle: { color: "#8b98b8", fontSize: 11 }, icon: "circle", itemWidth: 8 }
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
  const { x, ys, series } = resolveColumns(out);
  const isBar = spec.component === "bar";
  const isTime = !isBar && isDateLike(rows[0]?.[x]);
  const variant = spec.variant;
  const stacked = variant === "stacked-bar";
  const horizontal = variant === "horizontal-bar";

  const mkSeries = (name: string, data: [string | number, unknown][]): SeriesOption =>
    ({
      name,
      type: isBar ? "bar" : "line",
      stack: stacked ? "total" : undefined,
      showSymbol: false,
      smooth: false,
      lineStyle: { width: 2 },
      areaStyle: variant === "area" ? { opacity: 0.14 } : undefined,
      barMaxWidth: 28,
      emphasis: { focus: "series" },
      data: horizontal ? data.map(([a, b]) => [b, a]) : data,
    }) as SeriesOption;

  let seriesList: SeriesOption[];
  if (series) {
    const yCol = ys[0];
    seriesList = [...groupBy(rows, series)].map(([name, group]) =>
      mkSeries(
        name,
        group.map((r) => [isTime ? toTimeValue(r[x]) : String(r[x]), r[yCol]])
      )
    );
  } else {
    seriesList = ys.map((yCol) =>
      mkSeries(
        yCol,
        rows.map((r) => [isTime ? toTimeValue(r[x]) : String(r[x]), r[yCol]])
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
        axisLabel: { ...AXIS.axisLabel, hideOverlap: true },
      };

  return {
    option: {
      ...baseOption(seriesList.length > 1),
      color: SERIES_COLORS,
      xAxis: horizontal ? valueAxis : catAxis,
      yAxis: horizontal ? { type: "category", ...AXIS, inverse: true } : valueAxis,
      series: seriesList,
    },
    height: 300,
  };
}

/** One mini-chart per series, stacked, sharing the x axis + crosshair. */
function smallMultiples(
  seriesList: SeriesOption[],
  marks: ReturnType<typeof annotationMarks>,
  isTime: boolean
): BuiltChart {
  const n = seriesList.length;
  const topPad = 3;
  const bottomPad = 9;
  const gap = 7;
  const h = (100 - topPad - bottomPad - gap * (n - 1)) / n;

  return {
    option: {
      backgroundColor: "transparent",
      animationDuration: 400,
      color: SERIES_COLORS,
      tooltip: {
        trigger: "axis",
        backgroundColor: "#111726",
        borderColor: "#2a3346",
        textStyle: { color: "#dbe4f5", fontSize: 12 },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }], lineStyle: { color: "#475569" } },
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
          align: "left" as const,
          padding: [0, 0, 0, -40],
        },
        nameGap: 10,
        ...AXIS,
      })),
      series: seriesList.map(
        (s, i) =>
          ({
            ...s,
            xAxisIndex: i,
            yAxisIndex: i,
            areaStyle: { opacity: 0.1 },
            // deploy/incident annotations repeat on every strip
            ...marks,
          }) as SeriesOption
      ),
    },
    height: Math.max(110 * n + 50, 260),
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
      inRange: { color: ["#101828", "#1d4ed8", "#f59e0b", "#ef4444"] },
    },
    series: [
      {
        type: "heatmap",
        data,
        label: { show: false },
        itemStyle: { borderColor: "#0a0c12", borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: "#e2e8f0" } },
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
        : 8,
      itemStyle: { opacity: 0.75 },
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
