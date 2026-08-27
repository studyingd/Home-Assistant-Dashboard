import { memo } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import type { DeviceConfig } from '../../lib/types';
import { useSensorHistory } from '../../ha/useSensorHistory';
import { formatNumber } from '../../lib/format';
import { CardShell } from '../ui/CardShell';
import { Sparkline } from '../Sparkline';
import './SensorCard.css';

interface SensorStatus {
  label: string;
  color: string;
  background: string;
}

/** CO₂ 浓度档位(通风常用标准:1000 ppm 以下为宜) */
function getCo2Status(ppm: number): SensorStatus {
  if (ppm <= 600) {
    return { label: '优', color: 'var(--status-good)', background: 'var(--status-good-soft)' };
  }
  if (ppm <= 1000) {
    return { label: '中', color: 'var(--status-warning)', background: 'var(--status-warning-soft)' };
  }
  if (ppm <= 1500) {
    return { label: '差', color: 'var(--status-serious)', background: 'var(--status-serious-soft)' };
  }
  return { label: '严重', color: 'var(--status-critical)', background: 'var(--status-critical-soft)' };
}

/**
 * 识别 CO₂ 传感器:优先看 device_class === carbon_dioxide;
 * 集成未上报 device_class 时,用「单位为 ppm 且名称/实体 ID 含 co2 / 二氧化碳」兜底,
 * 避免这类传感器被当成普通温度计。纯 ppm 但名称无 CO₂ 特征的(如 CO/燃气)不误判。
 */
function isCo2Sensor(attrs: Record<string, unknown>, entityId: string): boolean {
  if (attrs.device_class === 'carbon_dioxide') return true;
  const unit =
    typeof attrs.unit_of_measurement === 'string' ? attrs.unit_of_measurement.trim() : '';
  if (unit !== 'ppm') return false;
  const haystack = `${(attrs.friendly_name as string) ?? ''} ${entityId}`.toLowerCase();
  return /co2|co₂|二氧化碳|carbon[ _-]?dioxide/.test(haystack);
}

interface SensorCardProps {
  config: DeviceConfig;
  entity: HassEntity;
}

/** 趋势图时间窗口(小时)。保留 24 小时可覆盖传感器暂时停报时的最近有效记录。 */
const HISTORY_HOURS = 24;
/** 超过该时长没有新记录即视为数据中断(高频上报的传感器静默≠数值不变) */
/** 毫秒时间戳 → 「MM-DD HH:mm」,用于中断提示 */
function formatTime(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '未知';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const SensorCard = memo(function SensorCard({ config, entity }: SensorCardProps) {
  const entityId = entity.entity_id;
  const attrs = entity.attributes as Record<string, unknown>;
  const unavailable = entity.state === 'unavailable' || entity.state === 'unknown';
  const name = config.name ?? (attrs.friendly_name as string) ?? entityId;
  const unit = (attrs.unit_of_measurement as string) ?? '';
  const isCo2 = isCo2Sensor(attrs, entityId);
  const icon = config.icon ?? (isCo2 ? 'leaf' : 'thermometer');

  const value = parseFloat(entity.state);
  const hasValue = Number.isFinite(value) && !unavailable;
  const status = hasValue && isCo2 ? getCo2Status(value) : null;

  const { points: historyPoints, loaded: historyLoaded } = useSensorHistory(
    entityId,
    HISTORY_HOURS,
  );

  // 窗口内无新记录(设备长时间未上报):不画平直线——对高频上报的传感器,
  // 「长时间没有记录」几乎必然是设备断连/停报,而不是数值恒定,画成直线会误导
  const noNewRecord = historyLoaded && historyPoints.length < 2 && hasValue;

  // 有数据但末条记录距今超过阈值 → 数据已中断,在标注中说明最后更新时间
  // sparkline 颜色:CO₂ 按当前档位,其它传感器用主题色
  const lineColor = status?.color ?? 'var(--accent)';

  let rangeCaption = `最近 ${HISTORY_HOURS} 小时`;
  if (historyPoints.length > 0 && !noNewRecord) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of historyPoints) {
      if (p.v < lo) lo = p.v;
      if (p.v > hi) hi = p.v;
    }
    rangeCaption = `最近 ${HISTORY_HOURS} 小时 · ${formatNumber(lo)} – ${formatNumber(hi)}`;
  }

  return (
    <CardShell
      name={name}
      icon={icon}
      iconOn={hasValue}
      unavailable={unavailable}
      trailing={
        status ? (
          <span
            className="chip"
            style={
              {
                '--chip-color': status.color,
                '--chip-bg': status.background,
              } as React.CSSProperties
            }
          >
            {status.label}
          </span>
        ) : undefined
      }
    >
      <div className="big-value">
        {hasValue ? formatNumber(value) : '–'}
        {unit && <span className="unit">{unit}</span>}
      </div>

      <div className="sparkline-wrap">
        {noNewRecord ? (
          <div className="sparkline-empty">
            无新记录 · 最后更新 {formatTime(Date.parse(entity.last_updated))}
          </div>
        ) : (
          <Sparkline points={historyPoints} color={lineColor} />
        )}
        <div className="sparkline-caption">
          <span>{rangeCaption}</span>
        </div>
      </div>
    </CardShell>
  );
});
