/**
 * 设备选择器:从 HA 实时实体列表中挑选设备加入指定区域块
 */
import { useMemo, useState } from 'react';
import type { DeviceConfig, DeviceType, RegionBlock } from '../lib/types';
import { useHass } from '../ha/useHass';
import { useDashboardConfig } from '../hooks/useDashboardConfig';
import { Icon, type IconName } from '../icons';
import { Dialog } from './ui/Dialog';
import { PillSelector } from './ui/PillSelector';

type DomainFilter = 'all' | 'climate' | 'sensor' | 'light' | 'switch' | 'opener';

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
  if (domain === 'light') return 'light';
  if (domain === 'switch') return 'switch';
  return null;
}

/** switch 域还可能包含插座、新风机或机器人等非灯光设备；明显非灯光实体不放入灯光开关列表。 */
function isLikelyLightSwitch(entity: { entity_id: string; attributes?: Record<string, unknown> }): boolean {
  const text = `${entity.entity_id} ${String(entity.attributes?.friendly_name ?? '')}`.toLowerCase();
  return !/(插座|outlet|新风|风机|fan|机器人|robot|空调|air.?condition|电机|motor|热水器|water.?heater|加湿器|humidifier|指示灯|indicator|child.?lock|儿童锁)/i.test(text);
}

function switchChannelLabel(entityId: string, friendlyName: string): string | null {
  const text = `${friendlyName} ${entityId}`;
  const numbered = text.match(/(?:开关|switch)[ _-]*(\d+)/i);
  if (numbered) return `第${numbered[1]}路`;
  if (/left|左键/i.test(text)) return '左键';
  if (/middle|中键/i.test(text)) return '中键';
  if (/right|右键/i.test(text)) return '右键';
  return null;
}

const DOMAIN_LABELS: Record<string, string> = {
  climate: '空调',
  sensor: '传感器',
  binary_sensor: '传感器',
  cover: '开窗器',
  light: '灯光',
  switch: '灯光开关',
  fan: '风扇',
  media_player: '媒体',
};

const FILTER_DOMAIN_ICON: Record<DomainFilter, IconName> = {
  all: 'home',
  climate: 'thermometer',
  sensor: 'leaf',
  opener: 'window',
  light: 'sun',
  switch: 'power',
};

interface DevicePickerDialogProps {
  block: RegionBlock;
  onClose: () => void;
}

export function DevicePickerDialog({ block, onClose }: DevicePickerDialogProps) {
  const { states } = useHass();
  const { regions, addDevices } = useDashboardConfig();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DomainFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const regionExisting = useMemo(() => {
    const region = regions.find((item) => item.blocks.some((candidate) => candidate.id === block.id));
    return new Set(region?.blocks.flatMap((candidate) => candidate.devices.map((device) => device.entity_id)) ?? []);
  }, [regions, block.id]);

  const rows = useMemo(() => {
    if (!states) return [];
    const q = query.trim().toLowerCase();
    return Object.values(states)
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
      .filter((entity) => {
        const group = domainGroup(domainOf(entity.entity_id));
        if (!group) return false;
        if (group === 'switch' && !isLikelyLightSwitch(entity)) return false;
        if (filter !== 'all' && group !== filter) return false;
        if (q === '') return true;
        const name = String(entity.attributes.friendly_name ?? '').toLowerCase();
        return entity.entity_id.toLowerCase().includes(q) || name.includes(q);
      });
  }, [states, query, filter]);

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
      ['light', '灯光'],
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
                  <span className="chip">{DOMAIN_LABELS[domain] ?? domain}{channel ? ` · ${channel}` : ''}</span>
                </div>
              );
            })}
          </div>
        )}
        <p className="picker-hint">同一区域内的设备不能重复添加；实体 ID 可在 Home Assistant「开发者工具 → 状态」中查看</p>
      </div>
    </Dialog>
  );
}
