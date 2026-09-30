import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHass } from '../ha/useHass';
import { useDashboardConfig } from '../hooks/useDashboardConfig';
import { fetchAutomations, saveAutomations, type ExistingAutomation } from '../lib/automations';
import type { AutomationConfig } from '../lib/types';
import { Icon, type IconName } from '../icons';
import { Dialog } from './ui/Dialog';
import { isLightPanelSwitch } from '../../shared/switch-panels.mjs';

const DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const AUTOMATABLE_DOMAINS = ['climate', 'light'] as const;
const DEVICE_TYPE_LABELS: Record<string, string> = { climate: '空调', light: '灯光' };
const DEVICE_TYPE_ICONS: Record<string, IconName> = { climate: 'air-conditioner', light: 'sun' };

function newAutomation(): AutomationConfig {
  return { id: `automation-${Date.now().toString(36)}`, name: '新自动化', entity_ids: [], target_mode: 'devices', action: 'turn_on', time: '08:00', days: [1, 2, 3, 4, 5], enabled: true };
}

export function AutomationDialog({ onClose }: { onClose: () => void }) {
  const { states } = useHass();
  const { regions } = useDashboardConfig();
  const [items, setItems] = useState<AutomationConfig[]>([]);
  const [existing, setExisting] = useState<ExistingAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const stateIds = useMemo(() => new Set(states ? Object.keys(states) : []), [states]);
  /** 可自动化类型:灯光/空调域;开关域中属于灯光面板的单键开关(W1 等)归入灯光,其余(插座等)排除 */
  const automatableType = useCallback((entityId: string): 'climate' | 'light' | null => {
    const domain = entityId.split('.')[0];
    if (domain === 'climate' || domain === 'light') return domain;
    if (domain === 'switch' && isLightPanelSwitch(entityId, states ? stateIds : null)) return 'light';
    return null;
  }, [states, stateIds]);
  const devices = useMemo(() => regions.flatMap((region) => region.blocks.flatMap((block) => block.devices)).filter((device) => automatableType(device.entity_id) !== null), [regions, automatableType]);
  const names = useMemo(() => new Map(devices.map((device) => [device.entity_id, device.name || states?.[device.entity_id]?.attributes?.friendly_name || device.entity_id])), [devices, states]);
  const groupedDevices = useMemo(() => regions.map((region) => ({ ...region, blocks: region.blocks.map((block) => { const typeMap = new Map<string, typeof block.devices>(); block.devices.forEach((device) => { const type = automatableType(device.entity_id); if (!type) return; typeMap.set(type, [...(typeMap.get(type) ?? []), device]); }); return { ...block, types: Array.from(typeMap.entries()).map(([type, typeDevices]) => ({ type, devices: typeDevices })) }; }).filter((block) => block.types.length > 0) })).filter((region) => region.blocks.length > 0), [regions, automatableType]);
  useEffect(() => { fetchAutomations().then((data) => { setItems(data.automations); setExisting(data.existing); }).catch((err) => setError(err instanceof Error ? err.message : '自动化加载失败')).finally(() => setLoading(false)); }, []);
  const update = (id: string, patch: Partial<AutomationConfig>) => setItems((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
  const toggleDevice = (id: string, entityId: string, checked: boolean) => setItems((prev) => prev.map((item) => item.id === id ? { ...item, entity_ids: checked ? [...new Set([...item.entity_ids, entityId])] : item.entity_ids.filter((value) => value !== entityId) } : item));
  const toggleGroup = (id: string, entityIds: string[]) => setItems((prev) => prev.map((item) => { if (item.id !== id) return item; const selected = new Set(item.entity_ids); const allSelected = entityIds.every((entityId) => selected.has(entityId)); entityIds.forEach((entityId) => allSelected ? selected.delete(entityId) : selected.add(entityId)); return { ...item, entity_ids: [...selected] }; }));
  const setTargetMode = (id: string, mode: 'devices' | 'domain') => setItems((prev) => prev.map((item) => item.id === id ? { ...item, target_mode: mode, ...(mode === 'domain' ? { target_domain: item.target_domain ?? 'climate' } : {}) } : item));
  const add = () => { const item = newAutomation(); setItems((prev) => [...prev, item]); setExpandedId(item.id); };
  const remove = (id: string) => { setItems((prev) => prev.filter((item) => item.id !== id)); setExpandedId((current) => current === id ? null : current); };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // 提交前统一整理表单状态，域名模式不携带旧的实体选择，避免旧状态导致 400。
      const payload = items.map((item) => ({
        ...item,
        name: item.name.trim() || '未命名自动化',
        target_mode: item.target_mode === 'domain' ? 'domain' as const : 'devices' as const,
        target_domain: item.target_mode === 'domain' ? (item.target_domain === 'light' ? 'light' : 'climate') : undefined,
        entity_ids: item.target_mode === 'domain' ? [] : [...new Set(item.entity_ids.filter(Boolean))],
        days: [...new Set(item.days)].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort(),
      }));
      await saveAutomations(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '自动化保存失败');
    } finally {
      setSaving(false);
    }
  };

  return <Dialog title="定时自动化" onClose={onClose} wide className="automation-dialog" actions={<><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn primary" onClick={save} disabled={saving || loading}>{saving ? '保存中…' : '保存自动化'}</button></>}>
    <p className="picker-hint">规则会写入 Home Assistant 的自动化配置并由 HA 执行。按设备类型时仅匹配当前系统中已配置的设备，员工页面不会显示这些规则。</p>
    {error && <p className="panel-card__error" role="alert">{error}</p>}
    {loading ? <p>正在加载自动化…</p> : items.length === 0 ? <p className="picker-hint">还没有定时规则。</p> : items.map((item, itemIndex) => { const expanded = expandedId === item.id; const targetLabel = item.target_mode === 'domain' ? `当前系统${DEVICE_TYPE_LABELS[item.target_domain ?? ''] ?? item.target_domain}设备` : `${item.entity_ids.length} 台设备`; return <div className={`automation-row${expanded ? ' is-expanded' : ''}`} key={item.id}>
      <button type="button" className="automation-row__summary" onClick={() => setExpandedId((current) => current === item.id ? null : item.id)} aria-expanded={expanded}><span className="automation-row__summary-badge">{String(itemIndex + 1).padStart(2, '0')}</span><span className="automation-row__summary-main"><strong>{item.name || '未命名自动化'}</strong><span>{item.action === 'turn_on' ? '开启' : '关闭'} · {item.time} · {targetLabel}</span></span><span className={`automation-row__summary-status${item.enabled ? ' is-enabled' : ''}`}>{item.enabled ? '已启用' : '已停用'}</span><span className="automation-row__summary-chevron" aria-hidden="true">›</span></button>
      {expanded && <><div className="automation-row__top"><label className="automation-name-field"><span className="automation-name-field__badge">{String(itemIndex + 1).padStart(2, '0')}</span><span className="automation-name-field__content"><span className="automation-name-field__label">规则名称</span><input value={item.name} placeholder="例如：工作日早上打开客厅空调" aria-label="自动化名称" onChange={(e) => update(item.id, { name: e.target.value })} /></span></label><label className="automation-row__enabled"><input type="checkbox" checked={item.enabled} onChange={(e) => update(item.id, { enabled: e.target.checked })} />启用</label><button type="button" className="btn danger" onClick={() => remove(item.id)}>删除</button></div>
        <div className="automation-target-picker"><span className="automation-target-picker__label">目标范围</span><div className="automation-target-toggle" role="group" aria-label="目标范围"><button type="button" className={(item.target_mode ?? 'devices') === 'devices' ? 'is-active' : ''} aria-pressed={(item.target_mode ?? 'devices') === 'devices'} onClick={() => setTargetMode(item.id, 'devices')}>指定设备</button><button type="button" className={item.target_mode === 'domain' ? 'is-active' : ''} aria-pressed={item.target_mode === 'domain'} onClick={() => setTargetMode(item.id, 'domain')}>按设备类型</button></div>{item.target_mode === 'domain' && <div className="automation-domain-options">{AUTOMATABLE_DOMAINS.map((domain) => <button type="button" key={domain} className={item.target_domain === domain ? 'is-selected' : ''} aria-pressed={item.target_domain === domain} onClick={() => update(item.id, { target_domain: domain })}><Icon name={DEVICE_TYPE_ICONS[domain]} size={15} />{DEVICE_TYPE_LABELS[domain]}</button>)}</div>}</div>
        {item.target_mode === 'domain' && <p className="automation-domain-hint">仅匹配当前系统中已配置的{DEVICE_TYPE_LABELS[item.target_domain ?? 'climate']}设备。</p>}
        {item.target_mode !== 'domain' && <div className="automation-row__grid"><fieldset className="automation-devices"><legend><span>设备</span><span className="automation-devices__count">已选 {item.entity_ids.length} 台</span></legend>{groupedDevices.length === 0 ? <p className="picker-hint">当前看板没有可用于自动化的设备。</p> : <div className="automation-device-tree">{groupedDevices.map((region) => { const regionIds = region.blocks.flatMap((block) => block.types.flatMap((type) => type.devices.map((device) => device.entity_id))); const regionSelected = regionIds.filter((entityId) => item.entity_ids.includes(entityId)).length; return <details className="automation-section" key={region.id}><summary><span className="automation-section__title"><Icon name="home" size={15} />{region.name}<small>{regionSelected}/{regionIds.length} 台</small></span><button type="button" className="automation-select-all automation-select-all--group" onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleGroup(item.id, regionIds); }}>{regionSelected === regionIds.length ? '取消全选' : '全选'}</button></summary>{region.blocks.map((block) => { const blockIds = block.types.flatMap((type) => type.devices.map((device) => device.entity_id)); const blockSelected = blockIds.filter((entityId) => item.entity_ids.includes(entityId)).length; return <details className="automation-block" key={block.id}><summary><span>{block.name}</span><small>{blockSelected}/{blockIds.length} 台</small><button type="button" className="automation-select-all automation-select-all--group" onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleGroup(item.id, blockIds); }}>{blockSelected === blockIds.length ? '取消全选' : '全选'}</button></summary>{block.types.map((group) => { const entityIds = group.devices.map((device) => device.entity_id); const selectedCount = entityIds.filter((entityId) => item.entity_ids.includes(entityId)).length; const allSelected = selectedCount === entityIds.length; return <div className="automation-type" key={group.type}><div className="automation-type__header"><span><Icon name={DEVICE_TYPE_ICONS[group.type] ?? 'gear'} size={14} />{DEVICE_TYPE_LABELS[group.type] ?? group.type}<small>{selectedCount}/{entityIds.length}</small></span><button type="button" className="automation-select-all" onClick={() => toggleGroup(item.id, entityIds)}>{allSelected ? '取消全选' : '全选'}</button></div><div className="automation-type__devices">{group.devices.map((device) => <label className="automation-device" key={device.entity_id}><input type="checkbox" checked={item.entity_ids.includes(device.entity_id)} onChange={(e) => toggleDevice(item.id, device.entity_id, e.target.checked)} /><span><strong>{names.get(device.entity_id)}</strong><small>{device.entity_id}</small></span></label>)}</div></div>; })}</details>; })}</details>; })}</div>}</fieldset></div>}
        <div className="automation-controls"><fieldset className="automation-action-field"><legend>动作</legend><div className="automation-action-toggle" role="group" aria-label="动作"><button type="button" className={item.action === 'turn_on' ? 'is-on' : ''} aria-pressed={item.action === 'turn_on'} onClick={() => update(item.id, { action: 'turn_on' })}><Icon name="power" size={15} />开启</button><button type="button" className={item.action === 'turn_off' ? 'is-off' : ''} aria-pressed={item.action === 'turn_off'} onClick={() => update(item.id, { action: 'turn_off' })}><Icon name="stop" size={15} />关闭</button></div></fieldset><label className="field automation-time-field"><span>执行时间</span><input type="time" value={item.time} onChange={(e) => update(item.id, { time: e.target.value })} /></label></div>
        <div className="automation-days" role="group" aria-label="重复日期">{DAYS.map((day, index) => <label key={day}><input type="checkbox" checked={item.days.includes(index)} onChange={(e) => update(item.id, { days: e.target.checked ? [...item.days, index].sort() : item.days.filter((d) => d !== index) })} />{day}</label>)}</div>
      </>}
    </div>; })}
    {!loading && <details className="automation-existing"><summary>Home Assistant 当前已有自动化（{existing.length} 条，只读）</summary><div className="automation-existing__list">{existing.map((item) => <span key={item.id}>{item.name}{item.enabled ? '' : '（已停用）'}</span>)}</div></details>}
    <button type="button" className="btn" onClick={add} disabled={loading}>+ 添加定时规则</button>
  </Dialog>;
}
