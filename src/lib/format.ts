/**
 * 数值格式化工具
 */

/** 将值限制在 [min, max] 内 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 计算步长的小数位数(1 -> 0,0.5 -> 1,0.25 -> 2) */
export function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * 按步长取整,避免浮点误差(如 21.499999)。
 * roundToStep(21.3, 0.5) -> 21.5
 */
export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  const decimals = Math.max(decimalsOf(step), 1);
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

/** 展示用数字格式化,默认最多 1 位小数 */
export function formatNumber(value: number, maxDecimals = 1): string {
  if (!Number.isFinite(value)) return '–';
  return value.toLocaleString('zh-CN', {
    maximumFractionDigits: maxDecimals,
  });
}
