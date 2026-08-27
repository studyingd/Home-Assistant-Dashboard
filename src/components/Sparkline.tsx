import { useId } from 'react';
import type { HistoryPoint } from '../ha/useSensorHistory';

interface SparklineProps {
  points: HistoryPoint[];
  /** 线条与面积颜色 */
  color: string;
  width?: number;
  height?: number;
}

const PADDING_Y = 4;

/** 纯 SVG 迷你趋势图:折线 + 渐变面积 + 端点圆点,无坐标轴 */
export function Sparkline({ points, color, width = 240, height = 56 }: SparklineProps) {
  const gradientId = useId();

  if (points.length < 2) {
    return <div className="sparkline-empty">无历史数据</div>;
  }

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const tSpan = t1 - t0 || 1;

  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of points) {
    if (p.v < vMin) vMin = p.v;
    if (p.v > vMax) vMax = p.v;
  }
  const vSpan = vMax - vMin || 1;

  const x = (t: number) => ((t - t0) / tSpan) * width;
  const y = (v: number) =>
    height - PADDING_Y - ((v - vMin) / vSpan) * (height - PADDING_Y * 2);

  const lineParts = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`);
  const linePath = lineParts.join(' ');
  const areaPath = `${linePath} L${width} ${height} L0 ${height} Z`;

  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="历史趋势"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1="0"
        y1={height - 0.5}
        x2={width}
        y2={height - 0.5}
        stroke="var(--hairline)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {/* 端点圆点:由于 preserveAspectRatio=none,单独用归一化坐标绘制 */}
      <circle
        cx={x(last.t)}
        cy={y(last.v)}
        r={3.5}
        fill={color}
        stroke="var(--surface)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
