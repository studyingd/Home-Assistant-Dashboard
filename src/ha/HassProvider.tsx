import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ERR_INVALID_AUTH,
  callService,
  createConnection,
  subscribeEntities,
  type Connection,
  type HassEntities,
  type HaWebSocket,
} from 'home-assistant-js-websocket';
import type { ConnStatus } from '../lib/types';

export interface HassContextValue {
  /** 全量实体状态;null 表示首次数据尚未到达 */
  states: HassEntities | null;
  connStatus: ConnStatus;
  haVersion: string | null;
  /** 原始连接,供 history/stream 等订阅使用 */
  connection: Connection | null;
  /** 实体注册表映射 entity_id → device_id;null 表示尚未加载或不可用 */
  entityDevice: Map<string, string> | null;
  callService: (
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
  ) => Promise<void>;
  /** 首连失败后重试 */
  retry: () => void;
}

export const HassContext = createContext<HassContextValue | null>(null);

interface HassProviderProps { children: ReactNode }

function createProxySocket(): Promise<HaWebSocket> {
  const connectOnce = (): Promise<HaWebSocket> =>
    new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/ha-websocket`) as HaWebSocket;
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          try { socket.close(); } catch { /* socket may already be closed */ }
          reject(error);
        } else {
          resolve(socket);
        }
      };
      const fail = () => finish(new Error('无法连接看板的 Home Assistant 代理'));
      const onClose = (event: CloseEvent) =>
        finish(event.reason.includes('authentication failed') ? ERR_INVALID_AUTH : new Error('Home Assistant 代理已断开'));
      const onMessage = (event: MessageEvent<string>) => {
        try {
          const message = JSON.parse(event.data) as { type?: string; ha_version?: string };
          if (message.type !== 'proxy_ready' || !message.ha_version) return;
          socket.haVersion = message.ha_version;
          finish();
        } catch {
          fail();
        }
      };
      const cleanup = () => {
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('close', onClose);
        socket.removeEventListener('error', fail);
      };
      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', onClose);
      socket.addEventListener('error', fail);
    });

  return (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await connectOnce();
      } catch (error) {
        if (error === ERR_INVALID_AUTH) throw error;
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      }
    }
    throw lastError ?? new Error('无法连接看板的 Home Assistant 代理');
  })();
}

export function HassProvider({ children }: HassProviderProps) {
  const [states, setStates] = useState<HassEntities | null>(null);
  const [connStatus, setConnStatus] = useState<ConnStatus>('connecting');
  const [haVersion, setHaVersion] = useState<string | null>(null);
  const [entityDevice, setEntityDevice] = useState<Map<string, string> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const connRef = useRef<Connection | null>(null);

  useEffect(() => {
    let disposed = false;
    let unsubEntities: (() => void) | undefined;

    // 实体注册表:用于把 climate 与同设备的 select(如风速挡位)关联
    const loadRegistry = (conn: Connection) => {
      conn
        .sendMessagePromise<{ entity_id: string; device_id?: string | null }[]>({
          type: 'config/entity_registry/list',
        })
        .then((entries) => {
          if (disposed) return;
          const map = new Map<string, string>();
          for (const e of Array.isArray(entries) ? entries : []) {
            if (e.entity_id && e.device_id) map.set(e.entity_id, e.device_id);
          }
          setEntityDevice(map);
        })
        .catch((err) => {
          // 常见原因:当前用户不是管理员。退用实体 ID 匹配,并明确提示
          console.warn('[ha-dashboard] 实体注册表不可用(需要管理员权限),风速挡位将按实体 ID 匹配:', err);
          if (!disposed) setEntityDevice(new Map());
        });
    };

    setConnStatus('connecting');
    setStates(null);
    setEntityDevice(null);

    // 首次连接允许短暂失败后自动重试，避免页面刷新时把瞬时网络/TLS延迟误判为不可达。
    // 共最多尝试 4 次(初次 + 3 次重试)，全部失败后才交给 UI 显示错误。
    createConnection({ createSocket: createProxySocket, setupRetry: 3 })
      .then((conn) => {
        if (disposed) {
          conn.close();
          return;
        }
        connRef.current = conn;
        conn.addEventListener('ready', () => {
          if (disposed) return;
          setConnStatus('connected');
          loadRegistry(conn); // 重连成功后刷新注册表
        });
        conn.addEventListener('disconnected', () => {
          if (!disposed) setConnStatus('reconnecting');
        });
        conn.addEventListener('reconnect-error', (_connection, error) => {
          if (disposed) return;
          // home-assistant-js-websocket currently emits reconnect-error for
          // fatal authentication failures, but keep network failures distinct
          // so the UI does not misleadingly ask for new credentials.
          setConnStatus(error === ERR_INVALID_AUTH ? 'auth-error' : 'unreachable');
        });
        setConnStatus('connected');
        setHaVersion(conn.haVersion || null);
        unsubEntities = subscribeEntities(conn, (next) => {
          if (!disposed) setStates(next);
        });
        loadRegistry(conn);
      })
      .catch((err) => {
        if (disposed) return;
        if (err === ERR_INVALID_AUTH) {
          setConnStatus('auth-error');
        } else {
          // ERR_CANNOT_CONNECT 及其它情况统一视为不可达
          console.warn('[ha-dashboard] 连接失败:', err);
          setConnStatus('unreachable');
        }
      });

    return () => {
      disposed = true;
      unsubEntities?.();
      connRef.current?.close();
      connRef.current = null;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setAttempt((a) => a + 1);
  }, []);

  const callServiceSafe = useCallback(
    async (domain: string, service: string, serviceData?: Record<string, unknown>) => {
      const conn = connRef.current;
      if (!conn) throw new Error('尚未连接到 Home Assistant');
      await callService(conn, domain, service, serviceData);
    },
    [],
  );

  const value = useMemo<HassContextValue>(
    () => ({
      states,
      connStatus,
      haVersion,
      connection: connRef.current,
      entityDevice,
      callService: callServiceSafe,
      retry,
    }),
    [states, connStatus, haVersion, entityDevice, callServiceSafe, retry],
  );

  return <HassContext.Provider value={value}>{children}</HassContext.Provider>;
}
