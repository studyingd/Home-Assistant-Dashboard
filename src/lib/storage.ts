/** 浏览器端仅保存非业务 UI 偏好（当前区域和 HVAC 模式）。 */

export const STORAGE_KEYS = {
  /** 当前激活的一级区域 id */
  activeRegion: 'ha:active-region',
} as const;

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 忽略隐私模式等写入失败
  }
}

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
