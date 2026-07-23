"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";

export interface EChartHandle {
  getPng: (bg?: string) => string | undefined;
}

export const EChart = forwardRef<EChartHandle, { option: EChartsOption; height?: number }>(
  function EChart({ option, height = 320 }, ref) {
    const el = useRef<HTMLDivElement>(null);
    const chart = useRef<echarts.ECharts | null>(null);

    useEffect(() => {
      const node = el.current;
      if (!node) return;
      const c = echarts.init(node, null, { renderer: "canvas" });
      chart.current = c;
      const ro = new ResizeObserver(() => c.resize());
      ro.observe(node);
      return () => {
        ro.disconnect();
        c.dispose();
        chart.current = null;
      };
    }, []);

    useEffect(() => {
      chart.current?.setOption(option, true);
    }, [option]);

    useImperativeHandle(
      ref,
      () => ({
        getPng: (bg = "#0e1220") =>
          chart.current?.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: bg }),
      }),
      []
    );

    return <div ref={el} style={{ height, width: "100%" }} />;
  }
);
