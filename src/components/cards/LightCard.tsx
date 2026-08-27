import { memo, useEffect, useMemo, useState } from 'react';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import type { DeviceConfig } from '../../lib/types';
import { useHass } from '../../ha/useHass';
import { CardShell } from '../ui/CardShell';
import { IconButton } from '../ui/IconButton';
import { Icon } from '../../icons';

interface LightCardProps { config: DeviceConfig; entity: HassEntity; }

function findSwitchChannels(entityId: string, states: HassEntities | null): HassEntity[] {
  if (!states || !entityId.startsWith('light.')) return [];
  const stem = entityId.slice('light.'.length).replace(/_indicator_light(?:_\d+)?$/, '');
  if (!stem) return [];
  const ids = [
    `${stem}_left_switch_service`,
    `${stem}_middle_switch_service`,
    `${stem}_right_switch_service`,
    `${stem}_switch`,
  ].map((value) => `switch.${value}`);
  return ids.map((id) => states[id]).filter((value): value is HassEntity => Boolean(value));
}

function channelLabel(entity: HassEntity, index: number): string {
  const name = String(entity.attributes?.friendly_name ?? '');
  if (/左键|left/i.test(name)) return '左';
  if (/中键|middle/i.test(name)) return '中';
  if (/右键|right/i.test(name)) return '右';
  return `第${index + 1}路`;
}

export const LightCard = memo(function LightCard({ config, entity }: LightCardProps) {
  const { callService, states } = useHass();
  const entityId = entity.entity_id;
  const attrs = entity.attributes as Record<string, unknown>;
  const channels = useMemo(() => findSwitchChannels(entityId, states), [entityId, states]);
  const hasChannels = channels.length > 0;
  const unavailable = hasChannels
    ? channels.every((channel) => channel.state === 'unavailable' || channel.state === 'unknown')
    : entity.state === 'unavailable' || entity.state === 'unknown';
  const actualOn = hasChannels ? channels.some((channel) => channel.state === 'on') : entity.state === 'on';
  const [pendingOn, setPendingOn] = useState<boolean | null>(null);
  const isOn = pendingOn ?? actualOn;
  const name = config.name ?? (attrs.friendly_name as string) ?? entityId;
  const brightness = typeof attrs.brightness === 'number' ? Math.round((attrs.brightness / 255) * 100) : null;

  useEffect(() => {
    if (pendingOn === null) return undefined;
    if (pendingOn === actualOn) { setPendingOn(null); return undefined; }
    const timer = window.setTimeout(() => setPendingOn(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [actualOn, pendingOn]);

  const [pendingChannels, setPendingChannels] = useState<Record<string, boolean>>({});
  const shownChannelOn = (channel: HassEntity) => pendingChannels[channel.entity_id] ?? channel.state === 'on';
  const toggle = () => {
    const next = !isOn;
    setPendingOn(next);
    const targets = hasChannels ? channels : [entity];
    if (hasChannels) {
      setPendingChannels(Object.fromEntries(channels.map((channel) => [channel.entity_id, next])));
    }
    Promise.all(targets.map((target) => callService(hasChannels ? 'switch' : 'light', next ? 'turn_on' : 'turn_off', { entity_id: target.entity_id }))).catch((error) => {
      setPendingOn(null);
      setPendingChannels({});
      console.warn('[ha-dashboard] 灯光开关失败:', error);
    });
  };

  const toggleChannel = (channel: HassEntity) => {
    const next = !shownChannelOn(channel);
    setPendingChannels((prev) => ({ ...prev, [channel.entity_id]: next }));
    callService('switch', next ? 'turn_on' : 'turn_off', { entity_id: channel.entity_id }).catch((error) => {
      setPendingChannels((prev) => { const copy = { ...prev }; delete copy[channel.entity_id]; return copy; });
      console.warn('[ha-dashboard] 灯光分路开关失败:', error);
    });
  };

  useEffect(() => {
    if (!hasChannels) return undefined;
    setPendingChannels((prev) => {
      const next = { ...prev };
      for (const channel of channels) if (channel.entity_id in next && next[channel.entity_id] === (channel.state === 'on')) delete next[channel.entity_id];
      if (Object.keys(next).length === Object.keys(prev).length) return prev;
      return next;
    });
    return undefined;
  }, [channels, hasChannels]);

  return <CardShell name={name} icon={config.icon ?? 'sun'} className="light-card" iconOn={isOn && !unavailable} unavailable={unavailable} trailing={<IconButton icon="power" label={pendingOn !== null ? (pendingOn ? '正在开灯' : '正在关灯') : isOn ? '关闭整组灯光' : '开启整组灯光'} active={isOn} disabled={unavailable || pendingOn !== null} className={pendingOn !== null ? 'is-pending' : ''} onClick={toggle} />}>
    <div className="light-card__state"><div className="light-card__status"><span className={`light-card__status-dot${isOn && !unavailable ? ' is-on' : ''}`} aria-hidden="true" /><span>{unavailable ? '不可用' : hasChannels ? `${channels.filter(shownChannelOn).length}/${channels.length} 路开启` : isOn ? '开启' : '关闭'}</span></div>{!hasChannels && brightness !== null && isOn && <span className="light-card__meta">亮度 {brightness}%</span>}</div>
    {hasChannels && <div className="light-card__channels" aria-label="各路灯光状态">{channels.map((channel, index) => { const channelUnavailable = channel.state === 'unavailable' || channel.state === 'unknown'; const channelOn = shownChannelOn(channel); const label = channelLabel(channel, index); return <button type="button" key={channel.entity_id} className={`light-channel${channelOn ? ' is-on' : ''}`} aria-label={`${label}${channelUnavailable ? '不可用' : channelOn ? '已开启' : '已关闭'}`} title={`${label}${channelUnavailable ? ' · 不可用' : channelOn ? ' · 已开启' : ' · 已关闭'}`} aria-pressed={channelOn} disabled={channelUnavailable || channel.entity_id in pendingChannels} onClick={() => toggleChannel(channel)}><span className="light-channel__main"><span className="light-channel__icon"><Icon name="power" size={14} /></span><span>{label}</span></span></button>; })}</div>}
  </CardShell>;
});
