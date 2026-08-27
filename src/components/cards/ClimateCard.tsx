import { memo, useEffect, useMemo, useState } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import type { DeviceConfig } from '../../lib/types';
import { useHass } from '../../ha/useHass';
import { useDebouncedCommit } from '../../hooks/useDebouncedCommit';
import { clamp, formatNumber, roundToStep } from '../../lib/format';
import { findFanSelect } from '../../lib/fanSelect';
import { CardShell } from '../ui/CardShell';
import { IconButton } from '../ui/IconButton';
import { PillSelector } from '../ui/PillSelector';
import './ClimateCard.css';

/** 已输出过「未找到挡位」诊断的空调实体,避免重复刷屏 */
const loggedFanMissing = new Set<string>();

/**
 * 风速挡位 → 中文 显示名(大小写不敏感)。
 * 部分集成(如海尔 qdhkl)的挡位 select 返回英文(Quiet/Low/…),
 * 未识别的值原样返回(可能是中文或自定义名)。
 */
const FAN_LEVEL_LABELS: Record<string, string> = {
  auto: '自动',
  quiet: '静音',
  silent: '静音',
  low: '低速',
  medium: '中速',
  middle: '中速',
  med: '中速',
  mid: '中速',
  high: '高速',
  turbo: '强劲',
  strong: '强劲',
  powerful: '强劲',
  max: '最强',
  circulate: '循环',
  circulation: '循环',
  cycle: '循环',
  sleep: '睡眠',
  night: '睡眠',
  natural: '自然风',
  off: '关',
};

function fanLevelLabel(option: string): string {
  return FAN_LEVEL_LABELS[option.trim().toLowerCase()] ?? option;
}

interface ClimateCardProps {
  config: DeviceConfig;
  entity: HassEntity;
}

export const ClimateCard = memo(function ClimateCard({ config, entity }: ClimateCardProps) {
  const { callService, states, entityDevice } = useHass();
  const entityId = entity.entity_id;
  const attrs = entity.attributes as Record<string, unknown>;

  const unavailable = entity.state === 'unavailable' || entity.state === 'unknown';
  const actualOff = entity.state === 'off' || unavailable;
  const [pendingPower, setPendingPower] = useState<boolean | null>(null);
  const isOff = pendingPower ?? actualOff;
  const name = config.name ?? (attrs.friendly_name as string) ?? entityId;
  const icon = config.icon ?? 'air-conditioner';

  const currentTemp =
    typeof attrs.current_temperature === 'number' ? attrs.current_temperature : null;
  const targetTemp = typeof attrs.temperature === 'number' ? attrs.temperature : null;
  const minTemp = typeof attrs.min_temp === 'number' ? attrs.min_temp : 7;
  const maxTemp = typeof attrs.max_temp === 'number' ? attrs.max_temp : 35;
  const step =
    typeof attrs.target_temp_step === 'number' && attrs.target_temp_step > 0
      ? attrs.target_temp_step
      : 1;
  const fanModes = Array.isArray(attrs.fan_modes) ? (attrs.fan_modes as string[]) : [];
  const [pendingFan, setPendingFan] = useState<string | null>(null);

  useEffect(() => {
    if (pendingPower === null) return undefined;
    if (pendingPower === actualOff) {
      setPendingPower(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setPendingPower(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [actualOff, pendingPower]);
  // 风速挡位:优先找配对的 select 挡位实体(如 select.qdhkl_ac_0103_fan_level)。
  // 部分集成(如海尔 qdhkl)climate 自带 fan_modes 与 select 挡位并存,
  // select 的挡位更全(静音/低速/…/循环),是实际控制,因此优先显示;
  // 找不到 select 时才退回 fan_modes 胶囊行
  const fanSelect = useMemo(
    () => findFanSelect(entityId, states, entityDevice).entity,
    [states, entityDevice, entityId],
  );
  const actualFan = fanSelect?.state ?? (typeof attrs.fan_mode === 'string' ? attrs.fan_mode : null);
  useEffect(() => {
    if (pendingFan === null) return undefined;
    if (pendingFan === actualFan) {
      setPendingFan(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setPendingFan(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [actualFan, pendingFan]);

  // 找不到挡位时输出一次性诊断(注册表加载完成后才判断,避免误报)
  useEffect(() => {
    if (entityDevice === null || fanSelect || fanModes.length > 0) return;
    if (loggedFanMissing.has(entityId)) return;
    loggedFanMissing.add(entityId);
    const deviceId = entityDevice.get(entityId);
    console.warn(
      `[ha-dashboard] ${entityId} 未找到风速挡位 select 实体。` +
        `实体注册表${entityDevice.size > 0 ? '已加载' : '不可用(需要管理员权限)'},` +
        `该空调的设备关联: ${deviceId ?? '无'}`,
    );
  }, [entityDevice, fanSelect, fanModes.length, entityId]);

  // 设定温度:连点 +/- 时先在本地更新,500ms 无操作后提交一次
  const [draftTemp, setDraftTemp] = useDebouncedCommit<number>((temperature) => {
    callService('climate', 'set_temperature', { entity_id: entityId, temperature }).catch(
      (err) => console.warn('[ha-dashboard] set_temperature 失败:', err),
    );
  }, 500);
  const shownTarget = draftTemp ?? targetTemp;

  const changeTarget = (delta: number) => {
    const base = shownTarget ?? minTemp;
    setDraftTemp(clamp(roundToStep(base + delta, step), minTemp, maxTemp));
  };

  const setFanMode = (fanMode: string) => {
    setPendingFan(fanMode);
    callService('climate', 'set_fan_mode', { entity_id: entityId, fan_mode: fanMode }).catch((err) => {
      setPendingFan(null);
      console.warn('[ha-dashboard] set_fan_mode 失败:', err);
    });
  };

  const setFanLevel = (option: string) => {
    if (!fanSelect) return;
    setPendingFan(option);
    callService('select', 'select_option', { entity_id: fanSelect.entity_id, option }).catch((err) => {
      setPendingFan(null);
      console.warn('[ha-dashboard] select_option 失败:', err);
    });
  };

  const togglePower = () => {
    const nextOff = !isOff;
    setPendingPower(nextOff);
    callService('climate', 'set_hvac_mode', { entity_id: entityId, hvac_mode: nextOff ? 'off' : 'cool' }).catch(
      (err) => { setPendingPower(null); console.warn('[ha-dashboard] 空调开关失败:', err); },
    );
    if (nextOff) {
      return;
    }
  };

  return (
    <CardShell
      name={name}
      icon={icon}
      className="climate-card"
      iconOn={!isOff}
      unavailable={unavailable}
      trailing={
        <IconButton
          icon="power"
          label={pendingPower !== null ? (pendingPower ? '正在关机' : '正在开机') : isOff ? '开机' : '关机'}
          active={!isOff}
          disabled={unavailable || pendingPower !== null}
          className={pendingPower !== null ? 'is-pending' : ''}
          onClick={togglePower}
        />
      }
    >
      <div className="climate-body">
        <div className="climate-current">
          <span className="climate-current__label">室内温度</span>
          <div className="big-value">
            {currentTemp !== null ? formatNumber(currentTemp) : '–'}
            <span className="unit">°C</span>
          </div>
        </div>
        <div className={`climate-setpoint${isOff ? ' disabled' : ''}`}>
          <span className="climate-current__label">设定温度</span>
          <div className="climate-setpoint__controls">
            <IconButton
              icon="minus"
              label="调低设定温度"
              size={16}
              disabled={isOff}
              onClick={() => changeTarget(-step)}
            />
            <span className="climate-setpoint__value">
              {shownTarget !== null ? `${formatNumber(shownTarget)}°` : '–'}
            </span>
            <IconButton
              icon="plus"
              label="调高设定温度"
              size={16}
              disabled={isOff}
              onClick={() => changeTarget(step)}
            />
          </div>
        </div>
      </div>

      {fanSelect ? (
        <PillSelector
          options={(
            Array.isArray(fanSelect.attributes?.options)
              ? (fanSelect.attributes.options as string[])
              : []
          ).map((o) => ({ value: o, label: fanLevelLabel(o) }))}
          value={unavailable ? null : (pendingFan ?? fanSelect.state)}
          onSelect={setFanLevel}
          disabled={isOff || pendingFan !== null}
        />
      ) : fanModes.length > 0 ? (
        <PillSelector
          options={fanModes.map((m) => ({ value: m, label: fanLevelLabel(m) }))}
          value={unavailable ? null : (pendingFan ?? ((attrs.fan_mode as string) ?? null))}
          onSelect={setFanMode}
          disabled={isOff || pendingFan !== null}
        />
      ) : null}
    </CardShell>
  );
});
