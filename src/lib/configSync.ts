/**
 * 与轻后端(/api/config)同步看板配置。
 * 三种结果要区分开:
 *  - ok          服务器有配置 → 采用它(服务器是共享的权威来源)
 *  - empty       服务器在线但还没有配置 → 仅管理员可初始化
 *  - unavailable 服务器不可达 → 阻止业务配置继续使用过期本地副本
 */
import type { DashboardConfig } from './types';
import { sanitizeDashboard } from './regions';
import { csrfToken } from './session';

export type RemoteConfig =
  | { status: 'ok'; config: DashboardConfig }
  | { status: 'empty' }
  | { status: 'unavailable' };

let currentEtag: string | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export async function fetchRemoteConfig(): Promise<RemoteConfig> {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (res.status === 204) return { status: 'empty' };
    if (!res.ok) return { status: 'unavailable' };
    currentEtag = res.headers.get('etag');
    const sanitized = sanitizeDashboard(await res.json());
    // 服务器内容彻底无法识别时按「空」处理(等本地或种子去初始化)
    return sanitized ? { status: 'ok', config: sanitized } : { status: 'empty' };
  } catch {
    return { status: 'unavailable' };
  }
}

/** 把配置写回服务器；失败必须交给界面显示，不静默丢失。 */
export async function pushRemoteConfig(config: DashboardConfig): Promise<void> {
  const run = writeQueue.then(async () => {
    const csrf = csrfToken();
    if (!csrf) throw new Error('管理员会话不存在');
    const res = await fetch('/api/config', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        'if-match': currentEtag ?? '*',
      },
      body: JSON.stringify(config),
    });
    if (res.status === 401) window.dispatchEvent(new Event('ha:session-expired'));
    if (res.status === 409) window.dispatchEvent(new Event('ha:config-conflict'));
    if (!res.ok) throw new Error(`配置同步失败: HTTP ${res.status}`);
    currentEtag = res.headers.get('etag') ?? currentEtag;
  });
  writeQueue = run.catch(() => {});
  return run;
}
