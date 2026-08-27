import type { HassEntity } from 'home-assistant-js-websocket';
import { useHass } from './useHass';

/** 读取单个实体的状态;实体不存在或数据未加载时返回 undefined */
export function useEntityState(entityId: string): HassEntity | undefined {
  const { states } = useHass();
  return states?.[entityId];
}
