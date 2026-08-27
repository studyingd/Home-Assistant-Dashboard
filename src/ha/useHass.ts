import { useContext } from 'react';
import { HassContext, type HassContextValue } from './HassProvider';

/** 获取 HA 连接上下文(必须在 HassProvider 内使用) */
export function useHass(): HassContextValue {
  const ctx = useContext(HassContext);
  if (!ctx) {
    throw new Error('useHass 必须在 <HassProvider> 内使用');
  }
  return ctx;
}
