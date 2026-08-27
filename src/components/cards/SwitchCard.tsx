import { memo, useEffect, useState } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import type { DeviceConfig } from '../../lib/types';
import { useHass } from '../../ha/useHass';
import { CardShell } from '../ui/CardShell';
import { IconButton } from '../ui/IconButton';

interface SwitchCardProps {
  config: DeviceConfig;
  entity: HassEntity;
}

/** HA switch 实体卡片。多开墙壁开关在 HA 中是多个 switch 实体，因此每一路独立控制。 */
export const SwitchCard = memo(function SwitchCard({ config, entity }: SwitchCardProps) {
  const { callService } = useHass();
  const entityId = entity.entity_id;
  const attrs = entity.attributes as Record<string, unknown>;
  const unavailable = entity.state === 'unavailable' || entity.state === 'unknown';
  const actualOn = entity.state === 'on';
  const [pendingOn, setPendingOn] = useState<boolean | null>(null);
  const isOn = pendingOn ?? actualOn;
  const name = config.name ?? (attrs.friendly_name as string) ?? entityId;

  useEffect(() => {
    if (pendingOn === null) return undefined;
    if (pendingOn === actualOn) {
      setPendingOn(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setPendingOn(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [actualOn, pendingOn]);

  const toggle = () => {
    const next = !isOn;
    setPendingOn(next);
    callService('switch', next ? 'turn_on' : 'turn_off', { entity_id: entityId }).catch((error) => {
      setPendingOn(null);
      console.warn('[ha-dashboard] 灯光开关操作失败:', error);
    });
  };

  return (
    <CardShell
      name={name}
      icon={config.icon ?? 'power'}
      className="switch-card"
      iconOn={isOn && !unavailable}
      unavailable={unavailable}
      trailing={
        <IconButton
          icon="power"
          label={pendingOn !== null ? (pendingOn ? '正在开启' : '正在关闭') : isOn ? '关闭' : '开启'}
          active={isOn}
          disabled={unavailable || pendingOn !== null}
          className={pendingOn !== null ? 'is-pending' : ''}
          onClick={toggle}
        />
      }
    >
      <div className="switch-card__state">
        <strong>{unavailable ? '不可用' : isOn ? '已开启' : '已关闭'}</strong>
        <span>灯光开关</span>
      </div>
      <div className="card__sub">{entityId}</div>
    </CardShell>
  );
});
