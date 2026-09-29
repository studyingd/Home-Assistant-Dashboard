/**
 * 墙壁开关面板识别规则 —— 前后端唯一来源(server 与 src 共同引用此文件)。
 *
 * 适用的设备形态(米家 xiaomi_home 集成的 W1/W2/W3 等开关面板):
 *   - 分路继电器通道: switch.{stem}_left|middle|right_switch_service
 *   - 单路继电器通道: switch.{stem}_switch (W1 单键面板等)
 *   - 整组主体灯光:   light.{stem}_all_switch | light.{stem}_all_switch_indicator | light.{stem}_indicator_light(旧)
 *   - 键位指示灯:     light.{stem}_left|middle|right_switch(_indicator)? (纯 LED,不可作为控制入口)
 *
 * HA 集成命名变化时只修改此文件,并同步更新 test/switch-panels.test.mjs。
 */

/** 面板分路通道后缀(按左/中/右顺序) */
export const PANEL_CHANNEL_SUFFIXES = ['_left_switch_service', '_middle_switch_service', '_right_switch_service'];

/** 面板分路通道实体 ID → 设备 stem */
export const PANEL_CHANNEL_ID_RE = /^switch\.(.+?)_(?:left|middle|right)_switch_service$/;

/** 面板整组主体的候选实体 ID(按新旧命名优先级排列) */
export function lightMainEntityCandidates(stem) {
  return [`light.${stem}_all_switch`, `light.${stem}_all_switch_indicator`, `light.${stem}_indicator_light`];
}

/** 设备 stem → 全部分路通道实体 ID */
export function panelChannelIds(stem) {
  return PANEL_CHANNEL_SUFFIXES.map((suffix) => `switch.${stem}${suffix}`);
}

/** 设备 stem → 单路继电器实体 ID */
export function panelSingleChannelId(stem) {
  return `switch.${stem}_switch`;
}

/** 设备 stem → 面板全部可控制继电器(单路 + 分路),用于服务端白名单与操作日志归属 */
export function panelControlEntityIds(stem) {
  return [panelSingleChannelId(stem), ...panelChannelIds(stem)];
}

/** 分路通道实体 → 设备 stem;非通道实体返回 null */
export function panelChannelStem(entityId) {
  const match = PANEL_CHANNEL_ID_RE.exec(entityId);
  return match ? match[1] : null;
}

/**
 * 灯光实体可剥离的主体/键指示灯后缀(剥离后得到设备 stem):
 * 旧主体 _indicator_light、新主体 _all_switch(_indicator)、键指示灯 _left|middle|right_switch(_indicator)
 */
export const LIGHT_MAIN_SUFFIX_RE = /_(?:all_switch(?:_indicator)?|indicator_light|(?:left|middle|right)_switch(?:_indicator)?)(?:_\d+)?$/;

/** 灯光主体/键指示灯实体 → 设备 stem;非该形态返回 null */
export function lightMainStem(entityId) {
  if (!entityId.startsWith('light.')) return null;
  const objectId = entityId.slice('light.'.length);
  const match = LIGHT_MAIN_SUFFIX_RE.exec(objectId);
  return match ? objectId.slice(0, match.index) : null;
}

/** 设备 stem 是否存在分路通道实体 */
export function hasPanelChannels(stem, allEntityIds) {
  return panelChannelIds(stem).some((id) => allEntityIds.includes(id));
}

/** 是否为开关面板的整组主体灯光(主体形态,且设备确实存在分路通道) */
export function isLightPanelMain(entityId, allEntityIds) {
  const stem = lightMainStem(entityId);
  return stem !== null && hasPanelChannels(stem, allEntityIds);
}

/** 从文本(friendly name / 实体 ID)识别通道键位;数字通道返回 {kind:'number'}
 * @param {string} text
 * @returns {{ kind: 'left' | 'middle' | 'right' } | { kind: 'number', value: number } | null}
 */
export function channelKeyFromText(text) {
  const numbered = /(?:开关|switch)[ _-]*(\d+)/i.exec(text);
  if (numbered) return { kind: 'number', value: Number(numbered[1]) };
  if (/left|左键/i.test(text)) return { kind: 'left' };
  if (/middle|中键/i.test(text)) return { kind: 'middle' };
  if (/right|右键/i.test(text)) return { kind: 'right' };
  return null;
}
