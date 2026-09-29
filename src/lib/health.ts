/** 设备健康检查(管理端):核对看板配置的设备实体在 Home Assistant 中的存在性 */

export interface DeviceHealthProblem {
  entity_id: string;
  /** 所属区域/区域块 ID(用于一键移除失效卡片) */
  regionId: string;
  blockId: string;
  /** 卡片显示名(自定义名或 HA friendly_name) */
  name: string;
  /** 所属位置:区域 / 区域块 */
  location: string;
  /** missing = HA 中已无此实体;unavailable = 实体存在但不可用 */
  status: 'missing' | 'unavailable';
  state: string;
}

export interface DeviceHealthReport {
  checkedAt: string;
  /** 配置中的设备实体总数 */
  total: number;
  /** 按问题严重度排序(missing 优先) */
  problems: DeviceHealthProblem[];
}

export async function fetchDeviceHealth(): Promise<DeviceHealthReport> {
  const res = await fetch('/api/config/health', { credentials: 'same-origin', cache: 'no-store' });
  if (res.status === 401) {
    window.dispatchEvent(new Event('ha:session-expired'));
    throw new Error('管理员会话已过期,请重新登录');
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(typeof data?.error === 'string' ? data.error : `健康检查失败: HTTP ${res.status}`);
  }
  return (await res.json()) as DeviceHealthReport;
}

/** 体检摘要(服务端定时缓存):管理页角标用;接口异常时返回 null,由调用方静默降级 */
export interface DeviceHealthSummary {
  checkedAt: string;
  total: number;
  problemCount: number;
  missingCount: number;
  unavailableCount: number;
}

export async function fetchDeviceHealthSummary(): Promise<DeviceHealthSummary | null> {
  try {
    const res = await fetch('/api/config/health/summary', { credentials: 'same-origin', cache: 'no-store' });
    if (res.status === 401) {
      window.dispatchEvent(new Event('ha:session-expired'));
      return null;
    }
    if (!res.ok) return null;
    return (await res.json()) as DeviceHealthSummary;
  } catch {
    return null;
  }
}
