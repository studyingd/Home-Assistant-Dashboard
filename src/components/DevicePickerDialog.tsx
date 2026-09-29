/**
 * 设备选择器:从 HA 实时实体列表中挑选设备加入指定区域块
 */
import { useMemo, useState } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import type { DeviceConfig, DeviceType, RegionBlock } from '../lib/types';
import {
  channelKeyFromText,
  hasPanelChannels,
  isLightPanelMain,
  lightMainEntityCandidates,
  PANEL_CHANNEL_ID_RE,
} from '../../shared/switch-panels.mjs';
import { useHass } from '../ha/useHass';
import { useDashboardConfig } from '../hooks/useDashboardConfig';
import { Icon, type IconName } from '../icons';
import { Dialog } from './ui/Dialog';
import { PillSelector } from './ui/PillSelector';

type DomainFilter = 'all' | 'climate' | 'sensor' | 'switch' | 'opener';

function domainOf(entityId: string): string {
  return entityId.split('.')[0] ?? '';
}

function inferType(domain: string): DeviceType {
  if (domain === 'climate') return 'climate';
  if (domain === 'cover') return 'cover';
  if (domain === 'light') return 'light';
  if (domain === 'switch') return 'switch';
  if (domain === 'sensor' || domain === 'binary_sensor') return 'sensor';
  return 'generic';
}

function domainGroup(domain: string): DomainFilter | null {
  if (domain === 'climate') return 'climate';
  if (domain === 'sensor' || domain === 'binary_sensor') return 'sensor';
  if (domain === 'cover') return 'opener';
  // 灯光实体并入「灯光开关」分类:看板中的灯光都是开关面板形态,不再单设「灯光」分类
  if (domain === 'light') return 'switch';
  if (domain === 'switch') return 'switch';
  return null;
}

/** 灯光域整组主体实体(添加后卡片会自动聚合各路通道,是推荐入口)。
 *  规则见 shared/switch-panels.mjs:主体形态 + 设备确实存在分路通道,避免把插座/网关等设备的指示灯当主体。 */
function isGroupLightEntity(id: string, allEntityIds: string[]): boolean {
  return isLightPanelMain(id, allEntityIds);
}

/** 隐藏的灯光实体:纯指示灯与附属灯(属于其他设备的 LED);整组主体始终保留 */
function isHiddenLightEntity(
  entity: { entity_id: string; attributes?: Record<string, unknown> },
  coverObjectIds: string[],
  allEntityIds: string[],
): boolean {
  const id = entity.entity_id;
  if (!id.startsWith('light.') || isGroupLightEntity(id, allEntityIds)) return false;
  const objectId = id.slice('light.'.length);
  // a) friendly_name 带「指示灯」且 ID 为 *_switch 形态 → 开关面板纯指示灯
  if (
    String(entity.attributes?.friendly_name ?? '').includes('指示灯') &&
    /_(?:left|middle|right)?_?switch(?:_indicator)?(?:_\d+)?$/.test(objectId)
  ) {
    return true;
  }
  // b) ID 去掉末段后与某个 cover 域对象同前缀 → 开窗器等设备的附属灯(如 liyan_1816_light)
  const bareStem = objectId.replace(/_[^_]+$/, '');
  if (bareStem && coverObjectIds.some((coverId) => coverId.startsWith(`${bareStem}_`))) return true;
  // c) 附属灯后缀(_indicator_light/_backlight/_rgb_light):仅当设备是开关面板主体(存在左右键通道)时保留,
  //    否则视为网关/插座/传感器/新风机等设备的指示灯隐藏
  const accessory = /_(?:indicator_light|backlight|rgb_light)(?:_\d+)?$/.exec(objectId);
  if (accessory) {
    const stem = objectId.slice(0, accessory.index);
    if (!hasPanelChannels(stem, allEntityIds) && allEntityIds.some((eid) => {
      if (eid.startsWith('light.')) return false;
      const dot = eid.indexOf('.');
      return dot > 0 && eid.slice(dot + 1).startsWith(`${stem}_`);
    })) {
      return true;
    }
  }
  return false;
}

/** switch 域还可能包含插座、新风机或机器人等非灯光设备；明显非灯光实体不放入灯光开关列表。 */
function isLikelyLightSwitch(entity: { entity_id: string; attributes?: Record<string, unknown> }): boolean {
  const text = `${entity.entity_id} ${String(entity.attributes?.friendly_name ?? '')}`.toLowerCase();
  return !/(插座|outlet|新风|风机|fan|机器人|robot|空调|air.?condition|电机|motor|热水器|water.?heater|加湿器|humidifier|指示灯|indicator|child.?lock|儿童锁)/i.test(text);
}

function switchChannelLabel(entityId: string, friendlyName: string): string | null {
  const key = channelKeyFromText(`${friendlyName} ${entityId}`);
  if (!key) return null;
  if (key.kind === 'number') return `第${key.value}路`;
  const labels = { left: '左键', middle: '中键', right: '右键' } as const;
  return labels[key.kind];
}

const DOMAIN_LABELS: Record<string, string> = {
  climate: '空调',
  sensor: '传感器',
  binary_sensor: '传感器',
  cover: '开窗器',
  light: '灯光开关',
  switch: '灯光开关',
  fan: '风扇',
  media_player: '媒体',
};

const FILTER_DOMAIN_ICON: Record<DomainFilter, IconName> = {
  all: 'home',
  climate: 'thermometer',
  sensor: 'leaf',
  opener: 'window',
  switch: 'lightbulb',
};

interface DevicePickerDialogProps {
  block: RegionBlock;
  onClose: () => void;
}

export function DevicePickerDialog({ block, onClose }: DevicePickerDialogProps) {
  const { states, entityDevice } = useHass();
  const { regions, addDevices } = useDashboardConfig();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DomainFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const regionExisting = useMemo(() => {
    const region = regions.find((item) => item.blocks.some((candidate) => candidate.id === block.id));
    return new Set(region?.blocks.flatMap((candidate) => candidate.devices.map((device) => device.entity_id)) ?? []);
  }, [regions, block.id]);

  // cover 域对象 ID 列表:用于识别开窗器等设备的附属灯实体
  const coverObjectIds = useMemo(() => {
    if (!states) return [];
    return Object.keys(states)
      .filter((id) => id.startsWith('cover.'))
      .map((id) => id.slice('cover.'.length));
  }, [states]);

  const allEntityIds = useMemo(() => (states ? Object.keys(states) : []), [states]);

  // 多键开关面板聚合信息:每块面板生成一条干净的「整组」虚拟条目(底层挂在其整组灯光实体上),
  // 原始的「全部开关指示灯状态」等指示灯实体不再出现在列表中。
  // 通道按设备注册表(device_id)聚合优先,注册表缺失时按词干回退 —— HA 改名不再断链。
  const panelInfo = useMemo(() => {
    const empty = { virtualRows: [] as HassEntity[], mainEntityIds: new Set<string>(), panelNames: new Map<string, string>() };
    if (!states) return empty;
    const deviceIdOf = (id: string) => entityDevice?.get(id) ?? null;
    const panels = new Map<string, { stem: string; channelFriendly: string }>();
    for (const id of allEntityIds) {
      const match = PANEL_CHANNEL_ID_RE.exec(id);
      if (!match) continue;
      const key = deviceIdOf(id) ?? `stem:${match[1]}`;
      if (!panels.has(key)) panels.set(key, { stem: match[1], channelFriendly: String(states[id]?.attributes?.friendly_name ?? '') });
    }
    const virtualRows: HassEntity[] = [];
    const mainEntityIds = new Set<string>();
    const panelNames = new Map<string, string>();
    for (const [key, { stem, channelFriendly }] of panels) {
      // 整组主体:同设备上所有面板形态的灯光(改名免疫);无注册表时回退词干候选
      const sameDeviceMains = key.startsWith('stem:')
        ? []
        : allEntityIds.filter((id) => id.startsWith('light.') && deviceIdOf(id) === key && isLightPanelMain(id, allEntityIds));
      const candidates = lightMainEntityCandidates(stem);
      const mainId = candidates.find((candidate) => sameDeviceMains.includes(candidate))
        ?? sameDeviceMains[0]
        ?? candidates.find((candidate) => allEntityIds.includes(candidate));
      if (!mainId) continue;
      // 同设备的其它面板形态变体(左/中/右键指示灯等)也从原始列表隐藏,只保留「整组」入口
      for (const variant of sameDeviceMains) mainEntityIds.add(variant);
      const name = channelFriendly.replace(/\s*开关[左右中]键\s*$/, '').trim() || stem;
      mainEntityIds.add(mainId);
      panelNames.set(mainId, name);
      virtualRows.push({
        entity_id: mainId,
        attributes: { friendly_name: name },
        state: states[mainId]?.state ?? 'off',
      } as HassEntity);
    }
    return { virtualRows, mainEntityIds, panelNames };
  }, [states, allEntityIds, entityDevice]);

  const rows = useMemo(() => {
    if (!states) return [];
    const q = query.trim().toLowerCase();
    const matches = (entityId: string, name: string) => {
      if (filter !== 'all' && domainGroup(domainOf(entityId)) !== filter) return false;
      if (q === '') return true;
      return entityId.toLowerCase().includes(q) || name.toLowerCase().includes(q);
    };
    const list = Object.values(states).filter((entity) => {
      const domain = domainOf(entity.entity_id);
      const group = domainGroup(domain);
      if (!group) return false;
      // 面板整组主体不按原始指示灯名称展示,由虚拟「整组」条目代替
      if (domain === 'light' && panelInfo.mainEntityIds.has(entity.entity_id)) return false;
      if (group === 'switch' && domain === 'switch' && !isLikelyLightSwitch(entity)) return false;
      if (group === 'switch' && domain === 'light' && isHiddenLightEntity(entity, coverObjectIds, allEntityIds)) return false;
      return matches(entity.entity_id, String(entity.attributes.friendly_name ?? ''));
    });
    for (const virtualRow of panelInfo.virtualRows) {
      if (matches(virtualRow.entity_id, String(virtualRow.attributes.friendly_name ?? ''))) list.push(virtualRow);
    }
    return list.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  }, [states, query, filter, coverObjectIds, allEntityIds, panelInfo]);

  const toggle = (entityId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  };

  const commit = () => {
    if (!states || selected.size === 0) return;
    const devices: DeviceConfig[] = [];
    for (const entityId of selected) {
      const entity = states[entityId];
      if (!entity) continue;
      const type = inferType(domainOf(entityId));
      const device: DeviceConfig = { entity_id: entityId, type };
      // 面板整组条目自动使用干净的面板名称,避免卡片显示「全部开关指示灯状态」
      const panelName = panelInfo.panelNames.get(entityId);
      if (panelName) device.name = panelName;
      if (type === 'cover') device.coverVariant = 'window';
      devices.push(device);
    }
    addDevices(block.id, devices);
    onClose();
  };

  const filterOptions = (
    [
      ['all', '全部'],
      ['climate', '空调'],
      ['sensor', '传感器'],
      ['switch', '灯光开关'],
      ['opener', '开窗器'],
    ] as const
  ).map(([value, label]) => ({ value, label }));

  return (
    <Dialog
      title={`添加设备到「${block.name}」`}
      onClose={onClose}
      wide
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn primary" disabled={selected.size === 0} onClick={commit}>
            添加{selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </>
      }
    >
      <div className="picker">
        <div className="field search-field">
          <Icon name="search" size={16} className="search-field__icon" />
          <input
            value={query}
            placeholder="搜索实体 ID 或名称"
            aria-label="搜索实体"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <PillSelector options={filterOptions} value={filter} onSelect={(v) => setFilter(v as DomainFilter)} />
        {states === null ? (
          <div className="picker-empty">正在等待实体数据…</div>
        ) : rows.length === 0 ? (
          <div className="picker-empty">没有匹配的实体</div>
        ) : (
          <div className="picker-list" role="listbox" aria-label="实体列表" aria-multiselectable="true">
            {rows.map((entity) => {
              const domain = domainOf(entity.entity_id);
              const friendlyName = String(entity.attributes.friendly_name ?? entity.entity_id);
              const channel = domain === 'switch' ? switchChannelLabel(entity.entity_id, friendlyName) : null;
              const group = domain === 'light' && isGroupLightEntity(entity.entity_id, allEntityIds);
              const added = regionExisting.has(entity.entity_id);
              const checked = selected.has(entity.entity_id);
              return (
                <div
                  key={entity.entity_id}
                  role="option"
                  tabIndex={added ? -1 : 0}
                  aria-selected={checked}
                  aria-disabled={added}
                  className={`picker-row${checked ? ' selected' : ''}${added ? ' added' : ''}`}
                  onClick={() => {
                    if (!added) toggle(entity.entity_id);
                  }}
                  onKeyDown={(event) => {
                    if (!added && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      toggle(entity.entity_id);
                    }
                  }}
                >
                  <span className="picker-row__icon">
                    <Icon name={checked ? 'check' : FILTER_DOMAIN_ICON[domainGroup(domain) ?? 'all']} size={17} />
                  </span>
                  <span className="picker-row__text">
                    <span className="picker-row__name">{friendlyName}</span>
                    <span className="picker-row__id">{entity.entity_id}</span>
                  </span>
                  <span className="chip">{DOMAIN_LABELS[domain] ?? domain}{group ? ' · 整组' : channel ? ` · ${channel}` : ''}</span>
                </div>
              );
            })}
          </div>
        )}
        <p className="picker-hint">同一区域内的设备不能重复添加；多键开关建议添加标注「整组」的灯光实体，卡片会自动聚合各路通道与总开关</p>
      </div>
    </Dialog>
  );
}
