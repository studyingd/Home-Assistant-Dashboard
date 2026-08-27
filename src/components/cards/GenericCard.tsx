import { memo } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import type { DeviceConfig } from '../../lib/types';
import { CardShell } from '../ui/CardShell';

interface GenericCardProps {
  config: DeviceConfig;
  entity: HassEntity;
}

/** 未知类型设备的兜底卡片:只显示状态文本 */
export const GenericCard = memo(function GenericCard({ config, entity }: GenericCardProps) {
  const attrs = entity.attributes as Record<string, unknown>;
  const unavailable = entity.state === 'unavailable' || entity.state === 'unknown';
  const name = config.name ?? (attrs.friendly_name as string) ?? entity.entity_id;
  const unit = attrs.unit_of_measurement as string | undefined;

  return (
    <CardShell name={name} icon={config.icon ?? 'monitor'} unavailable={unavailable}>
      <div className="big-value">
        {unavailable ? '–' : entity.state}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="card__sub">{entity.entity_id}</div>
    </CardShell>
  );
});
