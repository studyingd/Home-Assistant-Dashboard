import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const SAFE_SERVICES = new Map([
  ['climate.set_temperature', new Set(['entity_id', 'temperature'])],
  ['climate.set_fan_mode', new Set(['entity_id', 'fan_mode'])],
  ['climate.set_hvac_mode', new Set(['entity_id', 'hvac_mode'])],
  ['cover.open_cover', new Set(['entity_id'])],
  ['cover.close_cover', new Set(['entity_id'])],
  ['cover.stop_cover', new Set(['entity_id'])],
  ['cover.set_cover_position', new Set(['entity_id', 'position'])],
  ['select.select_option', new Set(['entity_id', 'option'])],
  ['light.turn_on', new Set(['entity_id'])],
  ['light.turn_off', new Set(['entity_id'])],
  ['switch.turn_on', new Set(['entity_id'])],
  ['switch.turn_off', new Set(['entity_id'])],
]);

const SAFE_COMMANDS = new Set([
  'supported_features',
  'subscribe_entities',
  'get_states',
  'ping',
  'unsubscribe_events',
]);
const SUBSCRIPTION_COMMANDS = new Set(['subscribe_entities', 'subscribe_events', 'history/stream']);
const MAX_EVENT_SUBSCRIPTIONS = 120;

function wsUrlFromHass(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('HASS_URL 只允许 http/https');
  }
  if (parsed.protocol === 'http:' && !isPrivateHost(parsed.hostname) && process.env.ALLOW_INSECURE_HASS !== 'true') {
    throw new Error('公网 Home Assistant 必须使用 HTTPS；内网 HTTP 可直接使用私网地址');
  }
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '/api/websocket';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function isPrivateHost(host) {
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return isIP(host) === 6 && (host === '::1' || host.toLowerCase().startsWith('fc') || host.toLowerCase().startsWith('fd'));
}

async function readOptionalFile(path) {
  return path ? (await readFile(path, 'utf8')).trim() : '';
}

async function loadHassCredentials({ hassUrlFile, hassTokenFile }) {
  const envUrl = (process.env.HASS_URL || '').trim();
  const fileUrl = envUrl || (await readOptionalFile(hassUrlFile));
  const envToken = (await readOptionalFile(process.env.HASS_TOKEN_FILE || hassTokenFile)) || (process.env.HASS_TOKEN || '').trim();
  if (!fileUrl) throw new Error('未配置 HASS_URL 或 data/hass-url.txt');
  if (!envToken) throw new Error('未配置 HASS_TOKEN_FILE 或 HASS_TOKEN');
  return { url: fileUrl, token: envToken };
}

function errorResult(id, code, message) {
  return JSON.stringify({ id, type: 'result', success: false, error: { code, message } });
}

function entityIds(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  return [];
}

function operationEntities(entityId, allowedEntities) {
  if (!entityId.startsWith('select.')) return [entityId];
  const suffix = entityId.slice('select.'.length).toLowerCase();
  let best = '';
  for (const id of allowedEntities) {
    if (!id.startsWith('climate.')) continue;
    const stem = id.slice('climate.'.length).replace(/_air_conditioner(?:_\d+)?$/, '').toLowerCase();
    if (stem && suffix.startsWith(`${stem}_`) && stem.length > best.length) best = stem;
  }
  if (best) {
    const climate = [...allowedEntities].find((id) => id.startsWith('climate.') && id.slice('climate.'.length).replace(/_air_conditioner(?:_\d+)?$/, '').toLowerCase() === best);
    if (climate) return [climate];
  }
  return [entityId];
}

function validateService(message, allowedEntities) {
  const key = `${message.domain}.${message.service}`;
  const safeKeys = SAFE_SERVICES.get(key);
  if (!safeKeys) return '该服务未开放';
  const data = message.service_data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '缺少服务参数';
  if (Object.keys(data).some((keyName) => !safeKeys.has(keyName))) return '包含未允许的服务参数';
  const ids = entityIds(data.entity_id);
  if (ids.length === 0 || ids.some((id) => !allowedEntities.has(id))) return '实体不在看板允许列表中';

  if (message.domain === 'climate' && ids.some((id) => !id.startsWith('climate.'))) return '实体类型不匹配';
  if (message.domain === 'cover' && ids.some((id) => !id.startsWith('cover.'))) return '实体类型不匹配';
  if (message.domain === 'select' && ids.some((id) => !id.startsWith('select.'))) return '实体类型不匹配';
  if (message.domain === 'light' && ids.some((id) => !id.startsWith('light.'))) return '实体类型不匹配';
  if (message.domain === 'switch' && ids.some((id) => !id.startsWith('switch.'))) return '实体类型不匹配';
  if (message.service === 'set_temperature' && !Number.isFinite(data.temperature)) return '温度参数无效';
  if (message.service === 'set_cover_position' && (!Number.isFinite(data.position) || data.position < 0 || data.position > 100)) {
    return '位置参数无效';
  }
  return null;
}

function filterEntityObject(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([entityId]) => allowed.has(entityId)));
}

function expandDerivedFanEntities(event, allowed) {
  const states = event?.a;
  if (!states || typeof states !== 'object') return;
  const climateStems = [...allowed]
    .filter((entityId) => entityId.startsWith('climate.'))
    .map((entityId) => entityId.slice('climate.'.length).replace(/_air_conditioner(?:_\d+)?$/, ''))
    .filter(Boolean);
  for (const entityId of Object.keys(states)) {
    if (!entityId.startsWith('select.')) continue;
    const suffix = entityId.slice('select.'.length).toLowerCase();
    if (
      climateStems.some((stem) => suffix.startsWith(`${stem.toLowerCase()}_`)) &&
      /(fan|speed|level|wind|feng)/i.test(suffix)
    ) {
      allowed.add(entityId);
    }
  }
}

function filterEntitiesEvent(event, allowed) {
  if (!event || typeof event !== 'object') return event;
  const next = { ...event };
  if (next.a) next.a = filterEntityObject(next.a, allowed);
  if (next.c) next.c = filterEntityObject(next.c, allowed);
  if (Array.isArray(next.r)) next.r = next.r.filter((entityId) => allowed.has(entityId));
  return next;
}

function filterUpstreamMessage(message, commandTypes, allowed, admin) {
  if (!message || typeof message !== 'object') return message;
  const commandType = commandTypes.get(message.id);
  if (message.type === 'event') {
    if (commandType === 'subscribe_entities' && !admin) {
      return { ...message, event: filterEntitiesEvent(message.event, allowed) };
    }
    if (commandType === 'history/stream' && message.event && typeof message.event === 'object') {
      const event = { ...message.event };
      if (event.states) event.states = filterEntityObject(event.states, allowed);
      if (event.states_list) event.states_list = filterEntityObject(event.states_list, allowed);
      return { ...message, event };
    }
    if (commandType === 'subscribe_events' && message.event?.event_type === 'state_changed') {
      const entityId = message.event?.data?.entity_id;
      if (!allowed.has(entityId)) return null;
    }
  }
  if (message.type === 'result' && message.success) {
    if (commandType === 'get_states' && Array.isArray(message.result) && !admin) {
      return { ...message, result: message.result.filter((state) => allowed.has(state?.entity_id)) };
    }
    if (commandType === 'config/entity_registry/list' && Array.isArray(message.result)) {
      return {
        ...message,
        result: message.result.filter((entry) => admin || allowed.has(entry?.entity_id)),
      };
    }
  }
  if (message.type === 'result' && (!message.success || !SUBSCRIPTION_COMMANDS.has(commandType))) {
    commandTypes.delete(message.id);
  }
  return message;
}

function validateCommand(message, allowed, admin, serviceLimiter, historyLimiter, commandTypes) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return '消息格式无效';
  if (!Number.isInteger(message.id) || message.id < 1) return '消息 ID 无效';
  if (typeof message.type !== 'string') return '消息类型无效';
  if (SAFE_COMMANDS.has(message.type)) {
    if (message.type === 'unsubscribe_events' && !Number.isInteger(message.subscription)) return '订阅 ID 无效';
    if (message.type === 'subscribe_entities' && [...commandTypes.values()].includes('subscribe_entities')) return '实体状态已订阅';
    return null;
  }
  if (message.type === 'subscribe_events') {
    if (message.event_type !== 'state_changed') return '只允许订阅实体状态变化';
    if ([...commandTypes.values()].filter((type) => type === 'subscribe_events').length >= MAX_EVENT_SUBSCRIPTIONS) return '事件订阅数量过多';
    return null;
  }
  if (message.type === 'history/stream') {
    if (!historyLimiter()) return '历史查询过于频繁，请稍后再试';
    if ([...commandTypes.values()].filter((type) => type === 'history/stream').length >= 100) return '历史订阅数量过多';
    const ids = entityIds(message.entity_ids);
    return ids.length > 0 && (admin || ids.every((id) => allowed.has(id))) ? null : '历史实体不在允许列表中';
  }
  if (message.type === 'config/entity_registry/list') {
    return admin ? null : '该命令仅管理员可用';
  }
  if (message.type === 'call_service') {
    if (!serviceLimiter()) return '设备操作过于频繁，请稍后再试';
    return validateService(message, allowed);
  }
  return '该 Home Assistant 命令未开放';
}

export function createHaProxy({ hassUrlFile, hassTokenFile, getAllowedEntities, isAdminRequest, isAllowedOrigin, clientIp, audit, recordOperation }) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 * 1024 });
  const ipConnections = new Map();
  const clients = new Set();

  wss.on('connection', async (client, req) => {
    const ip = clientIp(req);
    const operationNonce = randomUUID();
    const admin = isAdminRequest(req);
    audit?.('ha_proxy_client_connected', { ip, admin });
    const current = ipConnections.get(ip) || 0;
    if (current >= 500 || clients.size >= 2_000) {
      client.close(1013, 'too many connections');
      return;
    }
    ipConnections.set(ip, current + 1);
    const release = () => {
      const remaining = (ipConnections.get(ip) || 1) - 1;
      if (remaining <= 0) ipConnections.delete(ip);
      else ipConnections.set(ip, remaining);
    };
    client.once('close', release);

    let upstream;
    try {
      const { url, token } = await loadHassCredentials({ hassUrlFile, hassTokenFile });
      clients.add(client);
      const allowed = await getAllowedEntities(admin);
      const extra = String(process.env.HA_EXTRA_ENTITIES || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      const allowedClimateStems = new Set([...allowed]
        .filter((id) => id.startsWith('climate.'))
        .map((id) => id.slice('climate.'.length).replace(/_air_conditioner(?:_\d+)?$/, '').toLowerCase()));
      for (const entityId of extra) {
        if (admin || !entityId.startsWith('select.')) {
          if (admin) allowed.add(entityId);
          continue;
        }
        const stem = entityId.slice('select.'.length).toLowerCase();
        if ([...allowedClimateStems].some((base) => stem.startsWith(`${base}_`))) allowed.add(entityId);
      }

      upstream = new WebSocket(wsUrlFromHass(url), {
        perMessageDeflate: false,
        handshakeTimeout: 10_000,
        maxPayload: 2 * 1024 * 1024,
      });
      const commandTypes = new Map();
      const pendingOperations = new Map();
      let upstreamReady = false;
      let serviceWindowStarted = Date.now();
      let serviceCount = 0;
      let commandWindowStarted = Date.now();
      let commandCount = 0;
      let historyWindowStarted = Date.now();
      let historyCount = 0;
      const takeWindow = (kind) => {
        const now = Date.now();
        if (kind === 'command') {
          if (now - commandWindowStarted >= 60_000) {
            commandWindowStarted = now;
            commandCount = 0;
          }
          commandCount += 1;
          return commandCount <= 600;
        }
        if (now - historyWindowStarted >= 60_000) {
          historyWindowStarted = now;
          historyCount = 0;
        }
        historyCount += 1;
        return historyCount <= 30;
      };
      const takeService = () => {
        const now = Date.now();
        if (now - serviceWindowStarted >= 60_000) {
          serviceWindowStarted = now;
          serviceCount = 0;
        }
        serviceCount += 1;
        return serviceCount <= 40;
      };

      upstream.on('open', () => {
        upstream.send(JSON.stringify({ type: 'auth', access_token: token }));
      });
      upstream.on('message', (raw) => {
        let parsed;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!upstreamReady) {
          const message = Array.isArray(parsed) ? parsed[0] : parsed;
          if (message.type === 'auth_ok') {
            upstreamReady = true;
            audit?.('ha_proxy_ready', { ip, admin, haVersion: message.ha_version });
            client.send(JSON.stringify({ type: 'proxy_ready', ha_version: message.ha_version }));
          } else if (message.type === 'auth_invalid') {
            client.close(1011, 'Home Assistant authentication failed');
          }
          return;
        }
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        for (const message of messages) {
          const pending = pendingOperations.get(message?.id);
          if (pending && message?.type === 'result') {
            for (const entry of pending) recordOperation?.({ ...entry, success: message.success === true, error_message: message.success === true ? null : String(message.error?.message || 'Home Assistant 执行失败').slice(0, 500) });
            pendingOperations.delete(message.id);
          }
        }
        for (const message of messages) {
          if (message?.type === 'event' && commandTypes.get(message.id) === 'subscribe_entities') {
            expandDerivedFanEntities(message.event, allowed);
          }
        }
        const filtered = messages
          .map((message) => filterUpstreamMessage(message, commandTypes, allowed, admin))
          .filter(Boolean);
        if (filtered.length > 0 && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(filtered.length === 1 ? filtered[0] : filtered));
        }
      });
      upstream.on('close', (code, reason) => {
        audit?.('ha_proxy_upstream_closed', { ip, admin, code, reason: reason.toString().slice(0, 120) });
        if (client.readyState === WebSocket.OPEN) client.close(1011, 'Home Assistant disconnected');
      });
      upstream.on('error', (error) => {
        audit?.('ha_proxy_upstream_error', { ip, admin, message: error.message.slice(0, 200) });
        if (client.readyState === WebSocket.OPEN) client.close(1011, 'Home Assistant unavailable');
      });

      client.on('message', (raw) => {
        if (!takeWindow('command')) {
          client.close(1008, 'command rate exceeded');
          return;
        }
        let message;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          client.close(1007, 'invalid json');
          return;
        }
        const error = validateCommand(message, allowed, admin, takeService, () => takeWindow('history'), commandTypes);
        if (error) {
          client.send(errorResult(Number.isInteger(message?.id) ? message.id : 0, 'forbidden', error));
          return;
        }
        commandTypes.set(message.id, message.type);
        if (message.type === 'unsubscribe_events') commandTypes.delete(message.subscription);
        if (!upstreamReady || upstream.readyState !== WebSocket.OPEN) {
          const pending = pendingOperations.get(message.id);
          if (pending) {
            for (const entry of pending) recordOperation?.({ ...entry, success: false, error_message: 'Home Assistant 尚未连接' });
            pendingOperations.delete(message.id);
          }
          client.send(errorResult(message.id, 'unavailable', 'Home Assistant 尚未连接'));
          return;
        }
        if (message.type === 'call_service') {
          const targetEntities = entityIds(message.service_data?.entity_id).slice(0, 50);
          audit?.('ha_service_called', {
            ip,
            admin,
            service: `${message.domain}.${message.service}`,
            entities: targetEntities.slice(0, 20),
          });
           pendingOperations.set(message.id, targetEntities.flatMap((entityId) => operationEntities(entityId, allowed)).map((entityId) => ({
               entity_id: entityId,
               action: `${message.domain}.${message.service}`,
               source: 'manual',
               actor: admin ? 'admin' : 'user',
               external_key: `manual:${operationNonce}:${message.id}:${entityId}`,
               metadata: { service_data: message.service_data ?? {} },
           })));
        }
        upstream.send(JSON.stringify(message));
      });
      client.on('close', (code, reason) => {
        audit?.('ha_proxy_client_closed', { ip, admin, code, reason: reason.toString().slice(0, 120) });
        clients.delete(client);
        upstream?.close();
      });
      client.on('error', () => upstream?.close());
    } catch (err) {
      console.error('[ha-dashboard] HA 代理启动失败:', err instanceof Error ? err.message : err);
      client.close(1011, 'Home Assistant proxy unavailable');
      upstream?.close();
    }
  });

  return {
    handleUpgrade(req, socket, head) {
      if (!isAllowedOrigin(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    disconnectClients() {
      for (const client of clients) client.close(1012, 'dashboard configuration changed');
      clients.clear();
    },
    close() {
      for (const client of clients) client.close(1001, 'server shutdown');
      clients.clear();
      wss.close();
    },
  };
}
