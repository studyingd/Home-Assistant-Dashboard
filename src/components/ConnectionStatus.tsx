import { useHass } from '../ha/useHass';
import type { ConnStatus } from '../lib/types';

const STATUS_META: Record<ConnStatus, { label: string; color: string; pulse: boolean }> = {
  connecting: { label: '正在连接…', color: 'var(--status-warning)', pulse: true },
  connected: { label: '已连接', color: 'var(--status-good)', pulse: false },
  reconnecting: { label: '连接断开,重连中…', color: 'var(--status-warning)', pulse: true },
  unreachable: { label: '无法连接', color: 'var(--status-critical)', pulse: false },
  'auth-error': { label: '认证失败', color: 'var(--status-critical)', pulse: false },
};

export function ConnectionStatus() {
  const { connStatus } = useHass();
  const meta = STATUS_META[connStatus];
  return (
    <span
      className={`conn-dot${meta.pulse ? ' pulse' : ''}`}
      style={{ '--dot-color': meta.color } as React.CSSProperties}
      title={meta.label}
      role="status"
      aria-label={meta.label}
    />
  );
}
