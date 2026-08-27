/**
 * 看板配置类型定义
 */

/** 设备卡片类型;generic 为其他域的兜底(显示状态值) */
export type DeviceType = 'climate' | 'sensor' | 'cover' | 'light' | 'switch' | 'generic';

/** cover 设备的展示变体(影响图标) */
export type CoverVariant = 'curtain' | 'window';

/** 单个设备配置 */
export interface DeviceConfig {
  /** Home Assistant 实体 ID,如 climate.living_room_ac */
  entity_id: string;
  /** 卡片类型 */
  type: DeviceType;
  /** 显示名称(可选,默认取实体的 friendly_name) */
  name?: string;
  /** 自定义图标名(可选,默认按卡片类型/属性自动选择) */
  icon?: string;
  /** type 为 cover 时的变体,默认 curtain */
  coverVariant?: CoverVariant;
  /** 管理员隐藏标记;未设置时默认对所有人可见 */
  hiddenFromUsers?: boolean;
}

/** 二级区域块 —— 区域内的一个分组,直接挂设备 */
export interface RegionBlock {
  /** 全局唯一 ID(crypto.randomUUID) */
  id: string;
  /** 显示名称,如 环境 */
  name: string;
  /** 块图标名(见 src/icons/index.tsx),可选 */
  icon?: string;
  hiddenFromUsers?: boolean;
  /** 本块设备 */
  devices: DeviceConfig[];
}

/** 一级区域 —— 顶部导航的一个标签 */
export interface Region {
  /** 全局唯一 ID(crypto.randomUUID) */
  id: string;
  /** 显示名称,如 客厅 */
  name: string;
  /** 区域图标名(见 src/icons/index.tsx),可选 */
  icon?: string;
  hiddenFromUsers?: boolean;
  /** 该区域下的区域块(平铺展示在同一界面) */
  blocks: RegionBlock[];
}

/** 看板完整配置（PostgreSQL/API 使用的结构） */
export interface DashboardConfig {
  schemaVersion: 2;
  title: string;
  /** 一级区域(顶部导航标签) */
  regions: Region[];
}

/** 管理员定时执行的设备开关规则 */
export interface AutomationConfig {
  id: string;
  name: string;
  entity_ids: string[];
  /** 设备选择方式：指定实体，或匹配整个 Home Assistant 设备域 */
  target_mode?: 'devices' | 'domain';
  /** target_mode 为 domain 时的 HA 域，如 climate、light */
  target_domain?: string;
  action: 'turn_on' | 'turn_off';
  time: string;
  days: number[];
  enabled: boolean;
}

/** 连接状态 */
export type ConnStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'unreachable'
  | 'auth-error';
