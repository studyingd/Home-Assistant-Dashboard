import type { AutomationConfig } from './types';
import { csrfToken } from './session';

export interface ExistingAutomation { id: string; name: string; enabled: boolean }

export async function fetchAutomations(): Promise<{ automations: AutomationConfig[]; existing: ExistingAutomation[] }> {
  const res = await fetch('/api/automations', { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new Error(`自动化加载失败: HTTP ${res.status}`);
  const data = (await res.json()) as { automations?: AutomationConfig[]; existing?: ExistingAutomation[] };
  return { automations: Array.isArray(data.automations) ? data.automations : [], existing: Array.isArray(data.existing) ? data.existing : [] };
}

export async function saveAutomations(automations: AutomationConfig[]): Promise<void> {
  const res = await fetch('/api/automations', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() ?? '' },
    body: JSON.stringify({ automations }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new Error(data?.message || data?.error || `自动化保存失败: HTTP ${res.status}`);
  }
}
