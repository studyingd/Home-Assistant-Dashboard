export interface AdminSession {
  authenticated: boolean;
  csrf?: string;
}

let current: AdminSession = { authenticated: false };

export function currentSession(): AdminSession {
  return current;
}

export async function fetchSession(): Promise<AdminSession> {
  try {
    const res = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return (current = { authenticated: false });
    const data = (await res.json()) as AdminSession;
    current = data.authenticated && data.csrf ? data : { authenticated: false };
    return current;
  } catch {
    return (current = { authenticated: false });
  }
}

export async function loginAdmin(username: string, password: string): Promise<AdminSession> {
  const res = await fetch('/api/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `login_failed_${res.status}`);
  }
  const data = (await res.json()) as AdminSession;
  current = data;
  return data;
}

export async function logoutAdmin(): Promise<void> {
  const csrf = current.csrf;
  if (csrf) {
    await fetch('/api/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrf },
    }).catch(() => undefined);
  }
  current = { authenticated: false };
}

export function csrfToken(): string | null {
  return current.csrf ?? null;
}
