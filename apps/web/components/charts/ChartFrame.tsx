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
import { useElementWidth } from "@/lib/hooks/useElementWidth";

/**
 * Minimum horizontal room (px) a single `HH:mm` X-axis tick label needs
 * before it risks colliding with its neighbor — used to thin an explicit
 * tick array down to whatever actually fits the chart's real rendered
 * width (Responsive Design Sprint). At a typical desktop chart width this
 * never removes anything (the full 90-minute tick set already fits), so
 * desktop is unaffected; on a narrow phone-width chart it keeps roughly
 * every Nth label instead of rendering all of them crushed together.
 */
const MIN_PX_PER_X_TICK = 55;

/**
 * `ticks` is already evenly spaced (every chart passes an explicit,
 * regularly-stepped array — see `computeFixedChartTicks`), so thinning by
 * a constant stride keeps the remaining labels evenly spaced too, rather
 * than picking an arbitrary subset.
 */
function thinXTicks(ticks: number[] | undefined, containerWidth: number): number[] | undefined {
  if (!ticks || ticks.length === 0 || containerWidth <= 0) {
    return ticks;
  }

  const maxTicks = Math.max(2, Math.floor(containerWidth / MIN_PX_PER_X_TICK));

  if (ticks.length <= maxTicks) {
    return ticks;
  }

  const stride = Math.ceil(ticks.length / maxTicks);

  return ticks.filter((_, index) => index % stride === 0);
}

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
  /** Explicit tick positions (in the axis's own data units) - the domain itself is untouched, this only changes which values get a label. Omitted falls back to recharts' automatic placement. */
  ticks?: number[];
  unitLabel: string;
};

type ChartFrameProps = {
  data: ReadonlyArray<Record<string, unknown>>;
  yAxes: ChartFrameYAxis[];
  tooltipContent: ReactElement;
  /** Extra top margin for the NOW marker's pill+annotation, matching `MarketPriceChart`'s own convention. */
  hasAnnotationMargin?: boolean;
  /** Explicit X-axis tick positions (ms) — see `chart-style.ts`'s `computeFixedHourlyTicks`. Omitted falls back to recharts' automatic placement. */
  xTicks?: number[];
  /**
   * Dashboard & Market Analytics milestone (Weekly/Monthly/Yearly). How to
   * label an X-axis tick — defaults to `formatSofiaTime` (unchanged
   * behavior for every existing caller), overridden by a Week/Month/Year
   * chart to `formatSofiaDate`/`formatSofiaMonth` (`chart-style.ts`)
   * instead, since a time-of-day label is meaningless once one point is a
   * whole day or month.
   */
  tickFormatter?: (time: number) => string;
  /** The chart's own marks — `Line`/`Bar`/`ReferenceArea`/`ReferenceLine`, rendered as direct children of `ComposedChart`, exactly as if written inline. */
  children: ReactNode;
};

export function ChartFrame({
  data,
  yAxes,
  tooltipContent,
  hasAnnotationMargin,
  xTicks,
  tickFormatter = formatSofiaTime,
  children,
}: ChartFrameProps) {
  const [widthRef, containerWidth] = useElementWidth<HTMLDivElement>();

  return (
    <div ref={widthRef} className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={hasAnnotationMargin ? CHART_MARGIN_WITH_ANNOTATION : CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} />

          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            ticks={thinXTicks(xTicks, containerWidth)}
            tickFormatter={tickFormatter}
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
              ticks={axis.ticks}
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
    </div>
  );
}
