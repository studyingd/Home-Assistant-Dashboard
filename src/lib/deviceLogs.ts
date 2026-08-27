import { csrfToken } from './session';

export interface DeviceOperationLog {
  id: number;
  entity_id: string;
  occurred_at: string;
  action: string;
  source: 'manual' | 'automation' | 'system' | string;
  actor?: string | null;
  automation_name?: string | null;
  success: boolean;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
}

export async function fetchDeviceLogs(entityId: string): Promise<DeviceOperationLog[]> {
  const csrf = csrfToken();
  if (!csrf) throw new Error('管理员会话不存在');
  const res = await fetch(`/api/device-logs?entity_id=${encodeURIComponent(entityId)}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'x-csrf-token': csrf },
  });
  const data = await res.json().catch(() => null) as { logs?: DeviceOperationLog[]; error?: string } | null;
  if (!res.ok) throw new Error(data?.error || `设备日志读取失败: HTTP ${res.status}`);
  return Array.isArray(data?.logs) ? data.logs : [];
}
