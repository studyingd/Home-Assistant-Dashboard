import { csrfToken } from './session';

export interface DatabaseConnectionInfo {
  configured: boolean;
  connected: boolean;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  ssl?: boolean;
}

export async function fetchDatabase(): Promise<DatabaseConnectionInfo> {
  const res = await fetch('/api/database', { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new Error(`数据库状态读取失败: HTTP ${res.status}`);
  return res.json() as Promise<DatabaseConnectionInfo>;
}

export async function saveDatabase(input: { host: string; port: number; database: string; user: string; password: string; ssl: boolean }): Promise<DatabaseConnectionInfo> {
  const csrf = csrfToken();
  if (!csrf) throw new Error('管理员会话不存在');
  const res = await fetch('/api/database', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => null) as { error?: string } | null;
  if (!res.ok) throw new Error(data?.error || `数据库连接失败: HTTP ${res.status}`);
  return data as DatabaseConnectionInfo;
}
