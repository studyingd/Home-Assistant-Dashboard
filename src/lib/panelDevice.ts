/**
 * 多键开关面板的通道解析(device_id 优先,词干回退)。
 * HA 设备注册表(entity_id → device_id)可用时按同设备聚合:
 * 实体被 HA 改名后分组依然成立;注册表缺失或未命中时回退实体名词干规则(shared/switch-panels.mjs)。
 */
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { lightMainStem, panelControlEntityIds } from '../../shared/switch-panels.mjs';

/** 继电器通道后缀:单路 + 左/中/右分路(新旧命名兼容,允许数字尾缀) */
const RELAY_SUFFIX_RE = /_(?:switch|left_switch(?:_service)?|middle_switch(?:_service)?|right_switch(?:_service)?)(?:_\d+)?$/;

/** 通道展示顺序:单路 → 左 → 中 → 右,同序按实体 ID 稳定排序 */
function channelRank(entityId: string): number {
  if (/_(?:left_switch(?:_service)?)(?:_\d+)?$/.test(entityId)) return 1;
  if (/_(?:middle_switch(?:_service)?)(?:_\d+)?$/.test(entityId)) return 2;
  if (/_(?:right_switch(?:_service)?)(?:_\d+)?$/.test(entityId)) return 3;
  return 0;
}

/** 词干回退路径:主体/键指示灯后缀剥离后按候选实体取存在的通道 */
function stemChannels(entityId: string, states: HassEntities): HassEntity[] {
  const stem = lightMainStem(entityId);
  if (!stem) return [];
  return panelControlEntityIds(stem)
    .map((id) => states[id])
    .filter((value): value is HassEntity => Boolean(value));
}

/** 灯光主体 → 面板继电器通道(整组卡片渲染用) */
export function panelChannelsForMain(
  entityId: string,
  states: HassEntities | null,
  entityDevice: Map<string, string> | null,
): HassEntity[] {
  if (!states) return [];
  const deviceId = entityDevice?.get(entityId);
  if (entityDevice && deviceId) {
    const channelIds = Object.keys(states).filter(
      (id) => id.startsWith('switch.') && entityDevice.get(id) === deviceId && RELAY_SUFFIX_RE.test(id.slice('switch.'.length)),
    );
    if (channelIds.length > 0) {
      return channelIds
        .sort((a, b) => channelRank(a) - channelRank(b) || a.localeCompare(b))
        .map((id) => states[id]);
    }
  }
  return stemChannels(entityId, states);
}
