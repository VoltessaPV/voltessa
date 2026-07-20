"use client";

import type { ReactElement, ReactNode } from "react";
import { CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  CHART_AXIS_LINE,
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  CHART_MARGIN,
  CHART_MARGIN_WITH_ANNOTATION,
  formatSofiaTime,
} from "@/components/charts/chart-style";

/**
 * The one chart shell every `recharts` chart in the app renders through
 * (Design-System Consistency milestone, second pass) — not just shared
 * style constants, an actual shared component. `MarketPriceChart` (the
 * reference implementation) and the Dashboard's Live Energy chart both
 * render through this: same `ComposedChart`/grid/axis/tooltip wiring,
 * same margins, same time-based X axis. Only each chart's own `children`
 * (its `Line`/`Bar`/`ReferenceArea`/`ReferenceLine` marks) and Y-axis
 * configuration differ — literally "the same component, only the plotted
 * data differs," per this milestone's explicit requirement.
 */
export type ChartFrameYAxis = {
  yAxisId: string;
  orientation?: "left" | "right";
  domain?: [number, number];
  allowDataOverflow?: boolean;
  unitLabel: string;
};

type ChartFrameProps = {
  data: ReadonlyArray<Record<string, unknown>>;
  yAxes: ChartFrameYAxis[];
  tooltipContent: ReactElement;
  /** Extra top margin for the NOW marker's pill+annotation, matching `MarketPriceChart`'s own convention. */
  hasAnnotationMargin?: boolean;
  /** The chart's own marks — `Line`/`Bar`/`ReferenceArea`/`ReferenceLine`, rendered as direct children of `ComposedChart`, exactly as if written inline. */
  children: ReactNode;
};

export function ChartFrame({ data, yAxes, tooltipContent, hasAnnotationMargin, children }: ChartFrameProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={hasAnnotationMargin ? CHART_MARGIN_WITH_ANNOTATION : CHART_MARGIN}>
        <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} />

        <XAxis
          dataKey="time"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={formatSofiaTime}
          tick={CHART_AXIS_TICK}
          tickLine={false}
          axisLine={CHART_AXIS_LINE}
          tickMargin={10}
          minTickGap={48}
        />

        {yAxes.map((axis) => (
          <YAxis
            key={axis.yAxisId}
            yAxisId={axis.yAxisId}
            orientation={axis.orientation}
            tick={CHART_AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={axis.orientation === "right" ? 52 : 44}
            tickMargin={8}
            domain={axis.domain}
            allowDataOverflow={axis.allowDataOverflow}
            label={{
              value: axis.unitLabel,
              angle: -90,
              position: axis.orientation === "right" ? "insideRight" : "insideLeft",
              fill: "#64748b",
              fontSize: 10,
            }}
          />
        ))}

        <Tooltip content={tooltipContent} />

        {children}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
