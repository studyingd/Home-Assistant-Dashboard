// 看板托管自动化的纯逻辑:HA 自动化配置 ↔ 看板模型互转。
// 通道展开/归一规则统一引用 shared/switch-panels.mjs(前后端唯一来源),本模块保持无副作用(不发请求)。
import { isLightPanelSwitch, lightMainEntityCandidates, lightMainStem, panelChannelStem, panelControlEntityIds } from '../shared/switch-panels.mjs';

/** 托管自动化在 HA 中的名称前缀 */
export const AUTOMATION_MARKER = '[Seeed 看板自动化]';

/** '07:30:00' / '07:30' → '07:30';非时刻返回 null */
export function parseHaTime(value) {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(value || ''));
  return match ? `${match[1]}:${match[2]}` : null;
}

/** HA 自动化配置 + 状态实体 → 看板自动化模型;非本看板托管或结构不符返回 null */
export function parseHaAutomation(config, state, availableEntities = new Set()) {
  if (!config || typeof config !== 'object' || !String(config.alias || '').startsWith(AUTOMATION_MARKER)) return null;
  const trigger = Array.isArray(config.triggers) ? config.triggers.find((item) => item?.trigger === 'time' && parseHaTime(item.at)) : null;
  const action = Array.isArray(config.actions) ? config.actions[0] : null;
  const service = String(action?.action || '');
  const targetIds = Array.isArray(action?.target?.entity_id) ? action.target.entity_id : [action?.target?.entity_id];
  const automationAction = service === 'homeassistant.turn_off' ? 'turn_off' : service === 'homeassistant.turn_on' ? 'turn_on' : null;
  if (!trigger || !automationAction || targetIds.some((entity) => typeof entity !== 'string')) return null;
  const domainMatch = targetIds.length === 1
    ? (/^([a-z_]+)\.\*$/.exec(targetIds[0]) || /^\{\{\s*states\.([a-z_]+)\s*\|/.exec(targetIds[0]) || /states\.(climate|light)\b/.exec(targetIds[0]))
    : null;
  const domainTarget = Boolean(domainMatch);
  const weekdays = Array.isArray(trigger.weekday) ? trigger.weekday : ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayMap = new Map([['sun', 0], ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5], ['sat', 6]]);
  const normalizedTargetIds = [...new Set(targetIds.map((id) => {
    // 开关通道 → 面板整组主体实体展示(新旧命名均适配,以 HA 中实际存在的为准)
    const stem = panelChannelStem(id) ?? /^switch\.(.+)_switch$/.exec(id)?.[1];
    const main = stem ? lightMainEntityCandidates(stem).find((candidate) => availableEntities.has(candidate)) : undefined;
    return main ?? id;
  }))];
  return {
    id: String(config.id),
    name: String(config.alias).replace(`${AUTOMATION_MARKER} `, ''),
    entity_ids: domainTarget ? [] : normalizedTargetIds,
    target_mode: domainTarget ? 'domain' : 'devices',
    ...(domainTarget ? { target_domain: domainMatch?.[1] } : {}),
    action: automationAction,
    time: parseHaTime(trigger.at),
    days: weekdays.map((day) => dayMap.get(String(day).slice(0, 3).toLowerCase())).filter((day) => day !== undefined),
    enabled: state?.state !== 'off',
  };
}

/** 灯光面板主体/通道灯 → 展开为可下发的继电器通道(规则统一走 shared/switch-panels.mjs) */
export function lightControlEntities(entityId, availableEntities) {
  const stem = lightMainStem(entityId);
  if (!stem) return [entityId];
  const channels = panelControlEntityIds(stem)
    .filter((id) => !availableEntities || availableEntities.has(id));
  return channels.length > 0 ? channels : [entityId];
}

/** 看板自动化模型 → HA 自动化配置(灯光目标会展开为继电器通道) */
export function toHaAutomation(automation, availableEntities, dashboardEntities = availableEntities) {
  const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const targetIds = automation.target_mode === 'domain'
    ? [...new Set([...dashboardEntities]
      .filter((entityId) => automation.target_domain === 'light'
        // 灯光除 light 域外,还包含看板上的单键灯光面板开关(W1 等,形态与插座相似,靠整组灯主体存在性区分)
        ? entityId.startsWith('light.') || isLightPanelSwitch(entityId, availableEntities)
        : entityId.startsWith(`${automation.target_domain}.`))
      .flatMap((entityId) => automation.target_domain === 'light' ? lightControlEntities(entityId, availableEntities) : [entityId]))]
    : automation.entity_ids.flatMap((entityId) => lightControlEntities(entityId, availableEntities));
  if (targetIds.length === 0) {
    throw Object.assign(new Error(`当前系统没有可用于自动化的${automation.target_domain === 'light' ? '灯光' : '空调'}设备`), { status: 400 });
  }
  return {
    id: automation.id,
    alias: `${AUTOMATION_MARKER} ${automation.name}`,
    description: '由 Seeed 办公看板管理（当前系统设备）',
    triggers: [{ trigger: 'time', at: `${automation.time}:00`, weekday: automation.days.map((day) => weekdays[day]) }],
    conditions: [],
    actions: [{ action: `homeassistant.${automation.action}`, target: { entity_id: targetIds } }],
    mode: 'single',
    initial_state: automation.enabled !== false,
  };
}
