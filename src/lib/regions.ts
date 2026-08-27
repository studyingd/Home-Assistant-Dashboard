/**
 * 区域/区域块纯函数操作库(不可变更新,均返回新数组)
 */
import type { DashboardConfig, DeviceConfig, DeviceType, Region, RegionBlock } from './types';
import { DASHBOARD_TITLE, seedRegions } from '../config/dashboard';

/** 生成全局唯一 ID */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 构造首次运行的种子配置 */
export function buildSeedConfig(): DashboardConfig {
  return { schemaVersion: 2, title: DASHBOARD_TITLE, regions: structuredClone(seedRegions) };
}

/** 查找一级区域 */
export function findRegion(regions: Region[], id: string): Region | undefined {
  return regions.find((r) => r.id === id);
}

/** 统计区域设备总数(用于删除确认文案) */
export function countRegionDevices(region: Region): number {
  return region.blocks.reduce((sum, b) => sum + b.devices.length, 0);
}

// ---------- 一级区域 ----------

/** 末尾追加一级区域 */
export function insertRegion(regions: Region[], node: Region): Region[] {
  return [...regions, node];
}

/** 改名 / 换图标 */
export function updateRegion(
  regions: Region[],
  id: string,
  patch: { name?: string; icon?: string; hiddenFromUsers?: boolean },
): Region[] {
  return regions.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

/** 删除一级区域(级联删除其下所有块与设备) */
export function removeRegion(regions: Region[], id: string): Region[] {
  return regions.filter((r) => r.id !== id);
}

// ---------- 二级区域块(跨区域按 blockId 定位) ----------

/** 对所有区域块做映射;fn 返回 null 表示删除该块 */
function mapBlocks(regions: Region[], fn: (b: RegionBlock) => RegionBlock | null): Region[] {
  return regions.map((r) => {
    const blocks: RegionBlock[] = [];
    for (const b of r.blocks) {
      const next = fn(b);
      if (next !== null) blocks.push(next);
    }
    return { ...r, blocks };
  });
}

/** 向指定区域追加区域块 */
export function insertBlock(regions: Region[], regionId: string, block: RegionBlock): Region[] {
  return regions.map((r) => (r.id === regionId ? { ...r, blocks: [...r.blocks, block] } : r));
}

/** 改块名 / 换块图标 */
export function updateBlock(
  regions: Region[],
  blockId: string,
  patch: { name?: string; icon?: string; hiddenFromUsers?: boolean },
): Region[] {
  return mapBlocks(regions, (b) => (b.id === blockId ? { ...b, ...patch } : b));
}

/** 删除区域块(级联删除块内设备) */
export function removeBlock(regions: Region[], blockId: string): Region[] {
  return mapBlocks(regions, (b) => (b.id === blockId ? null : b));
}

// ---------- 拖动排序 ----------

/** 通用:把 dragKey 元素移到 targetKey 元素之前/之后(同数组内,keyOf 提取键;任一不存在或相同则原样返回) */
function reorderByKey<T>(
  list: T[],
  keyOf: (item: T) => string,
  dragKey: string,
  targetKey: string,
  after: boolean,
): T[] {
  if (dragKey === targetKey) return list;
  const from = list.findIndex((x) => keyOf(x) === dragKey);
  if (from < 0) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  // 移除被拖元素后,target 的下标可能前移,需在新数组里重新定位
  const targetIdx = next.findIndex((x) => keyOf(x) === targetKey);
  if (targetIdx < 0) return list;
  next.splice(after ? targetIdx + 1 : targetIdx, 0, item);
  return next;
}

/** 拖动排序:移动一级区域 */
export function moveRegion(
  regions: Region[],
  dragId: string,
  targetId: string,
  after: boolean,
): Region[] {
  return reorderByKey(regions, (r) => r.id, dragId, targetId, after);
}

/** 拖动排序:在某一级区域内移动区域块 */
export function moveBlock(
  regions: Region[],
  regionId: string,
  dragId: string,
  targetId: string,
  after: boolean,
): Region[] {
  return regions.map((r) =>
    r.id === regionId
      ? { ...r, blocks: reorderByKey(r.blocks, (b) => b.id, dragId, targetId, after) }
      : r,
  );
}

/** 拖动排序:在某区域块内移动设备(按 entity_id 定位) */
export function moveDevice(
  regions: Region[],
  blockId: string,
  dragEntityId: string,
  targetEntityId: string,
  after: boolean,
): Region[] {
  return mapBlocks(regions, (b) =>
    b.id === blockId
      ? { ...b, devices: reorderByKey(b.devices, (d) => d.entity_id, dragEntityId, targetEntityId, after) }
      : b,
  );
}

// ---------- 设备(挂在区域块上) ----------

/** 向区域块追加设备;同一区域内已存在的 entity_id 自动跳过 */
export function addDevicesToBlock(
  regions: Region[],
  blockId: string,
  devices: DeviceConfig[],
): Region[] {
  const region = regions.find((item) => item.blocks.some((candidate) => candidate.id === blockId));
  const regionExisting = new Set(region?.blocks.flatMap((candidate) => candidate.devices.map((device) => device.entity_id)) ?? []);
  return mapBlocks(regions, (b) => {
    if (b.id !== blockId) return b;
    const fresh = devices.filter((d) => !regionExisting.has(d.entity_id));
    return fresh.length > 0 ? { ...b, devices: [...b.devices, ...fresh] } : b;
  });
}

/** 从区域块移除设备 */
export function removeDeviceFromBlock(
  regions: Region[],
  blockId: string,
  entityId: string,
): Region[] {
  return mapBlocks(regions, (b) =>
    b.id === blockId ? { ...b, devices: b.devices.filter((d) => d.entity_id !== entityId) } : b,
  );
}

/**
 * 改设备自定义名 / 图标;字段为空/空白则清除该自定义项,恢复自动
 * (name 恢复跟随 HA 的 friendly_name,icon 恢复按类型/属性自动选择)
 */
export function updateDevice(
  regions: Region[],
  blockId: string,
  entityId: string,
  patch: { name?: string; icon?: string; hiddenFromUsers?: boolean },
): Region[] {
  return mapBlocks(regions, (b) => {
    if (b.id !== blockId) return b;
    const name = patch.name?.trim();
    const icon = patch.icon?.trim();
    return {
      ...b,
      devices: b.devices.map((d) => {
        if (d.entity_id !== entityId) return d;
        const next = { ...d };
        if (name) next.name = name;
        else delete next.name;
        if (icon) next.icon = icon;
        else delete next.icon;
        if (patch.hiddenFromUsers !== undefined) next.hiddenFromUsers = patch.hiddenFromUsers;
        return next;
      }),
    };
  });
}

// ---------- 持久化数据的净化 ----------

const DEVICE_TYPES: ReadonlySet<string> = new Set<DeviceType>(['climate', 'sensor', 'cover', 'light', 'switch', 'generic']);

function sanitizeDevice(raw: unknown): DeviceConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.entity_id !== 'string' || d.entity_id.trim() === '') return null;
  const type = DEVICE_TYPES.has(String(d.type)) ? (d.type as DeviceType) : 'generic';
  const out: DeviceConfig = { entity_id: d.entity_id.trim(), type };
  if (typeof d.name === 'string' && d.name.trim() !== '') out.name = d.name.trim();
  if (typeof d.icon === 'string' && d.icon.trim() !== '') out.icon = d.icon.trim();
  if (type === 'cover') out.coverVariant = d.coverVariant === 'window' ? 'window' : 'curtain';
  if (d.hiddenFromUsers === true) out.hiddenFromUsers = true;
  return out;
}

function sanitizeDevices(raw: unknown): DeviceConfig[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DeviceConfig[] = [];
  for (const item of raw) {
    const device = sanitizeDevice(item);
    if (device && !seen.has(device.entity_id)) {
      seen.add(device.entity_id);
      out.push(device);
    }
  }
  return out;
}

function takeId(raw: unknown, takenIds: Set<string>): string {
  let id = typeof raw === 'string' && raw.trim() !== '' ? raw : newId();
  if (takenIds.has(id)) id = newId();
  takenIds.add(id);
  return id;
}

function cleanName(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : fallback;
}

function cleanIcon(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;
}

function sanitizeBlock(raw: unknown, takenIds: Set<string>): RegionBlock | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;
  const node: RegionBlock = {
    id: takeId(b.id, takenIds),
    name: cleanName(b.name, '未命名区域块'),
    devices: sanitizeDevices(b.devices),
  };
  const icon = cleanIcon(b.icon);
  if (icon) node.icon = icon;
  if (b.hiddenFromUsers === true) node.hiddenFromUsers = true;
  return node;
}

function sanitizeRegion(raw: unknown, takenIds: Set<string>): Region | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const node: Region = {
    id: takeId(r.id, takenIds),
    name: cleanName(r.name, '未命名区域'),
    blocks: [],
  };
  const icon = cleanIcon(r.icon);
  if (icon) node.icon = icon;
  if (r.hiddenFromUsers === true) node.hiddenFromUsers = true;
  if (Array.isArray(r.blocks)) {
    for (const item of r.blocks) {
      const block = sanitizeBlock(item, takenIds);
      if (block) node.blocks.push(block);
    }
  }
  return node;
}

/**
 * 净化任意来源的配置数据;结构彻底无法识别时返回 null(调用方回退种子)。
 * 仅接受当前 v2 `regions` 结构。
 * 注意:净化后 regions 为空数组是**合法状态**(用户删光了),不回退种子。
 */
export function sanitizeDashboard(raw: unknown): DashboardConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const title = cleanName(c.title, DASHBOARD_TITLE);

  if (Array.isArray(c.regions)) {
    const takenIds = new Set<string>();
    const regions: Region[] = [];
    for (const item of c.regions) {
      const region = sanitizeRegion(item, takenIds);
      if (region) regions.push(region);
    }
    return { schemaVersion: 2, title, regions };
  }

  return null;
}
