import { useEffect, useMemo, useState } from 'react';
import { useHass } from './useHass';

export interface HistoryPoint {
  /** 毫秒时间戳 */
  t: number;
  /** 数值 */
  v: number;
}

const MAX_POINTS = 160;

/**
 * 订阅单个数值实体的历史数据(history/stream),用于 sparkline。
 * - 防御性解析:兼容压缩格式 {s, lu} 与完整格式 {state, last_updated}
 * - 兼容容器键 states / states_list(不同 HA 版本有差异)
 * - 重连后库会自动重新订阅,首条消息会再次携带全量历史,
 *   mergeSorted 按时间戳去重,结果幂等
 */
export interface SensorHistory {
  points: HistoryPoint[];
  /** 首条历史消息是否已到达(区分「还在加载」与「窗口内确实无数据」) */
  loaded: boolean;
}

export function useSensorHistory(entityId: string, hours = 24): SensorHistory {
  const { connection } = useHass();
  const [series, setSeries] = useState<HistoryPoint[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!connection) return;
    setSeries([]);
    setLoaded(false);

    let cancelled = false;
    let unsub: (() => Promise<void>) | undefined;

    const start = new Date(Date.now() - hours * 3_600_000).toISOString();

    connection
      .subscribeMessage<unknown>(
        (msg) => {
          if (cancelled) return;
          setLoaded(true);
          // 不同版本可能把数据包在 event 字段里,防御性解包
          const payload = (msg as { event?: unknown })?.event ?? msg;
          const container =
            (payload as { states?: Record<string, unknown[]> })?.states ??
            (payload as { states_list?: Record<string, unknown[]> })?.states_list;
          const entries = container?.[entityId];
          if (!Array.isArray(entries)) return;

          const points = normalizeEntries(entries);
          setSeries((prev) => mergeSorted(prev, points));
        },
        {
          type: 'history/stream',
          entity_ids: [entityId],
          start_time: start,
          minimal_response: true,
          no_attributes: true,
          significant_changes_only: false,
        },
      )
      .then((u) => {
        if (cancelled) {
          void u();
        } else {
          unsub = u;
        }
      })
      .catch((err) => {
        // recorder 未启用或命令不支持等情况,静默降级为无历史
        console.warn('[ha-dashboard] history/stream 订阅失败:', err);
      });

    return () => {
      cancelled = true;
      if (unsub) void unsub();
    };
  }, [connection, entityId, hours]);

  return useMemo(
    () => ({ points: downsample(series, MAX_POINTS), loaded }),
    [series, loaded],
  );
}

/** 将历史条目转换为数值点,过滤非数值(unknown/unavailable 等) */
function normalizeEntries(entries: unknown[]): HistoryPoint[] {
  const points: HistoryPoint[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;

    const stateValue = entry.s ?? entry.state;
    const value =
      typeof stateValue === 'number'
        ? stateValue
        : typeof stateValue === 'string'
          ? parseFloat(stateValue)
          : NaN;
    if (!Number.isFinite(value)) continue;

    const ts = parseTimestamp(entry.lu ?? entry.last_updated);
    if (ts === null) continue;

    points.push({ t: ts, v: value });
  }
  return points.sort((a, b) => a.t - b.t);
}

/** 兼容秒/毫秒时间戳(epoch 数值)与 ISO 字符串 */
function parseTimestamp(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === 'string') {
    const numeric = parseFloat(raw);
    if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(raw)) {
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** 合并两个按时间排序的数组,按时间戳去重(后者覆盖前者) */
function mergeSorted(a: HistoryPoint[], b: HistoryPoint[]): HistoryPoint[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const merged: HistoryPoint[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].t < b[j].t) {
      merged.push(a[i++]);
    } else if (a[i].t > b[j].t) {
      merged.push(b[j++]);
    } else {
      merged.push(b[j]); // 同一时刻以新数据为准
      i++;
      j++;
    }
  }
  while (i < a.length) merged.push(a[i++]);
  while (j < b.length) merged.push(b[j++]);
  return merged;
}

/** 按时间桶降采样,每桶保留最后一个值(适合阶梯式传感器数据) */
function downsample(points: HistoryPoint[], maxPoints: number): HistoryPoint[] {
  if (points.length <= maxPoints) return points;
  const first = points[0].t;
  const span = points[points.length - 1].t - first;
  if (span <= 0) return [points[points.length - 1]];
  const bucketWidth = span / maxPoints;
  const result: HistoryPoint[] = [];
  let bucketIndex = -1;
  for (const p of points) {
    const idx = Math.min(Math.floor((p.t - first) / bucketWidth), maxPoints - 1);
    if (idx !== bucketIndex) {
      result.push(p);
      bucketIndex = idx;
    } else {
      result[result.length - 1] = p; // 桶内保留最后一个
    }
  }
  return result;
}
