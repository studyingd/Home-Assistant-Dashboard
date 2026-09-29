/**
 * Home Dashboard 安全后端:
 * - 托管前端与公开只读看板配置
 * - 服务端管理员会话保护配置写入
 * - HA 长期令牌仅保存在服务端，通过受限 WebSocket 代理提供状态与设备控制
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHaProxy } from './ha-proxy.mjs';
import { createConfigStore } from './db.mjs';
import { validateAutomation, validateDashboard } from './validation.mjs';
import { AUTOMATION_MARKER, parseHaAutomation, toHaAutomation } from './automations.mjs';
import { createHealthService } from './health.mjs';
import { lightMainStem, panelControlEntityIds } from '../shared/switch-panels.mjs';
import {
  SlidingWindowLimiter,
  clearSessionCookie,
  createSession,
  isSameOrigin,
  loadSecurityConfig,
  parseSession,
  sessionCookie,
  verifyPassword,
} from './security.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '..', 'dist');
const PORT = Number(process.env.PORT || 5174);
const IMPORT_FILE = process.env.CONFIG_IMPORT_FILE || join(HERE, '..', 'data', 'import-config.json');
const DB_CONNECTION_FILE = process.env.DB_CONNECTION_FILE || join(HERE, '..', 'data', 'postgres-connection.json');
const DB_PASSWORD_FILE = process.env.DB_PASSWORD_FILE || join(HERE, '..', 'data', 'postgres-connection-password');
const HASS_URL_FILE = process.env.HASS_URL_FILE || join(HERE, '..', 'data', 'hass-url.txt');
const HASS_TOKEN_FILE = process.env.HASS_TOKEN_FILE || join(HERE, '..', 'secrets', 'ha-token');
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const ALLOWED_IP_CIDRS = String(process.env.ALLOWED_IP_CIDRS || '')
  .split(',')
  .map((cidr) => cidr.trim())
  .filter(Boolean);
const MAX_CONFIG_BODY = 512 * 1024;
const MAX_LOGIN_BODY = 16 * 1024;
const HA_REQUEST_TIMEOUT_MS = 10_000;
const GZIP_EXTS = new Set(['.html', '.js', '.css', '.json', '.svg', '.map']);
const security = await loadSecurityConfig();
const configStore = await createConfigStore({ importFile: IMPORT_FILE, connectionFile: DB_CONNECTION_FILE, passwordFile: DB_PASSWORD_FILE });
const healthService = createHealthService(configStore, haRest);

// 操作日志保留 90 天:启动时清一次,此后每 24 小时清一次(unref:不阻塞测试进程退出)
const LOG_RETENTION_DAYS = 90;
async function pruneLogs() {
  try {
    const removed = await configStore.pruneOperationLogs(LOG_RETENTION_DAYS);
    if (removed > 0) console.log(`[ha-dashboard] 已清理 ${removed} 条过期操作日志(超过 ${LOG_RETENTION_DAYS} 天)`);
  } catch (error) {
    console.warn('[ha-dashboard] 操作日志清理失败:', error?.message || error);
  }
}
void pruneLogs();
setInterval(() => { void pruneLogs(); }, 24 * 60 * 60_000).unref();
const hassUrlFromFile = await readFile(HASS_URL_FILE, 'utf8').then((value) => value.trim()).catch(() => '');
function validCidr(cidr) {
  const [network, prefixText] = cidr.split('/');
  const prefix = Number(prefixText ?? 32);
  return ipv4Number(network) !== null && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32;
}
if (ALLOWED_IP_CIDRS.some((cidr) => !validCidr(cidr))) throw new Error('ALLOWED_IP_CIDRS 包含无效 IPv4 CIDR');
if (process.env.NODE_ENV === 'production') {
  let appUrl;
  try {
    appUrl = new URL(security.appOrigin);
  } catch {
    appUrl = null;
  }
  if (security.appOrigin && (!appUrl || !['http:', 'https:'].includes(appUrl.protocol) || appUrl.origin !== security.appOrigin)) {
    throw new Error('APP_ORIGIN 必须是有效的 HTTP/HTTPS Origin');
  }
  if (!security.adminUsername) throw new Error('生产环境必须配置 ADMIN_USERNAME');
  if (!security.adminPasswordHash) throw new Error('生产环境必须配置 ADMIN_PASSWORD_HASH_FILE');
  if (!security.sessionSecretConfigured || security.sessionSecret.length < 32) {
    throw new Error('生产环境必须配置至少 32 字符的 SESSION_SECRET_FILE');
  }
  if (appUrl?.protocol === 'https:' && !security.cookieSecure) {
    throw new Error('HTTPS APP_ORIGIN 必须启用 Secure Cookie');
  }
  if (appUrl?.protocol === 'http:' && security.cookieSecure) {
    throw new Error('HTTP APP_ORIGIN 必须关闭 Secure Cookie');
  }
}
const loginLimiter = new SlidingWindowLimiter(5, 15 * 60_000);
const loginIpLimiter = new SlidingWindowLimiter(30, 15 * 60_000);
const apiLimiter = new SlidingWindowLimiter(1_200, 60_000);
let configWriteQueue = Promise.resolve();

function audit(event, fields = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

function ipv4Number(value) {
  const normalized = value.startsWith('::ffff:') ? value.slice(7) : value;
  const parts = normalized.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function ipInCidr(ip, cidr) {
  const [networkText, prefixText] = cidr.split('/');
  const value = ipv4Number(ip);
  const network = ipv4Number(networkText);
  const prefix = Number(prefixText ?? 32);
  if (value === null || network === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
}

function isClientAllowed(req) {
  if (ALLOWED_IP_CIDRS.length === 0) return true;
  const ip = clientIp(req);
  return ALLOWED_IP_CIDRS.some((cidr) => ipInCidr(ip, cidr));
}

function securityHeaders() {
  const websocketOrigin = security.appOrigin.replace(/^http/, 'ws');
  const headers = {
    'content-security-policy': [
      "default-src 'self'",
      "base-uri 'none'",
      `connect-src 'self'${websocketOrigin ? ` ${websocketOrigin}` : ''}`,
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
    ].join('; '),
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  };
  if (security.appOrigin.startsWith('https://')) {
    headers['strict-transport-security'] = 'max-age=31536000';
  }
  return headers;
}

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, { ...securityHeaders(), ...headers });
  res.end(body);
}

function sendJson(res, status, value, headers = {}) {
  send(res, status, JSON.stringify(value), {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
}

async function readBody(req, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonBody(req, maxBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    throw Object.assign(new Error('content type'), { status: 415 });
  }
  try {
    return JSON.parse(await readBody(req, maxBytes));
  } catch (err) {
    if (err?.status) throw err;
    throw Object.assign(new Error('invalid json'), { status: 400 });
  }
}

function etagFor(body) {
  return `"${createHash('sha256').update(body).digest('base64url')}"`;
}

function withConfigLock(task) {
  const run = configWriteQueue.then(task, task);
  configWriteQueue = run.catch(() => {});
  return run;
}


/** 统一数据库/API 的 JSON 形状，避免默认值差异导致 ETag 虚假冲突。 */
function canonicalDashboard(value) {
  return {
    schemaVersion: 2,
    title: value.title.trim(),
    regions: value.regions.map((region) => ({
      id: region.id,
      name: region.name.trim(),
      ...(region.icon?.trim() ? { icon: region.icon.trim() } : {}),
      ...(region.hiddenFromUsers === true ? { hiddenFromUsers: true } : {}),
      blocks: region.blocks.map((block) => ({
        id: block.id,
        name: block.name.trim(),
        ...(block.icon?.trim() ? { icon: block.icon.trim() } : {}),
        ...(block.hiddenFromUsers === true ? { hiddenFromUsers: true } : {}),
        devices: block.devices.map((device) => ({
          entity_id: device.entity_id,
          type: device.type,
          ...(device.name?.trim() ? { name: device.name.trim() } : {}),
          ...(device.icon?.trim() ? { icon: device.icon.trim() } : {}),
          ...(device.coverVariant ? { coverVariant: device.coverVariant } : {}),
          ...(device.hiddenFromUsers === true ? { hiddenFromUsers: true } : {}),
        })),
      })),
    })),
  };
}

function publicDashboard(config) {
  return {
    schemaVersion: config.schemaVersion,
    title: config.title,
    regions: config.regions
      .filter((region) => !region.hiddenFromUsers)
      .map((region) => ({
        id: region.id,
        name: region.name,
        ...(region.icon ? { icon: region.icon } : {}),
        blocks: region.blocks
          .filter((block) => !block.hiddenFromUsers)
          .map((block) => ({
            id: block.id,
            name: block.name,
            ...(block.icon ? { icon: block.icon } : {}),
            devices: block.devices
              .filter((device) => !device.hiddenFromUsers)
              .map(({ hiddenFromUsers: _hidden, ...device }) => device),
          })),
      })),
  };
}

let managedAutomationCache = { value: [], expiresAt: 0 };
const managedAutomationIds = new Set();

async function haRest(path, options = {}) {
  const url = (process.env.HASS_URL || hassUrlFromFile).replace(/\/$/, '');
  const token = (await readFile(process.env.HASS_TOKEN_FILE || HASS_TOKEN_FILE, 'utf8').catch(() => '')).trim();
  if (!url || !token) throw new Error('HA 凭据未配置');
  let response;
  try {
    response = await fetch(`${url}${path}`, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(HA_REQUEST_TIMEOUT_MS),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers || {}) },
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw Object.assign(new Error('Home Assistant 请求超时'), { code: 'HA_TIMEOUT', status: 504 });
    }
    throw Object.assign(new Error('Home Assistant 暂时不可达'), { code: 'HA_UNAVAILABLE', status: 503, cause: error });
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).trim().slice(0, 500);
    console.error(`[ha-dashboard] HA 请求失败 ${options.method || 'GET'} ${path} HTTP ${response.status}: ${detail}`);
    throw Object.assign(new Error(`HA 自动化接口失败: ${options.method || 'GET'} ${path} HTTP ${response.status}${detail ? ` · ${detail}` : ''}`), { status: response.status });
  }
  return response.status === 204 ? null : response.json();
}

async function syncDeviceAutomationLogs(entityId) {
  const end = new Date().toISOString();
  const start = deviceLogSyncState.get(entityId) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sourceEntities = lightControlEntitiesForLog(entityId);
  for (const sourceEntity of sourceEntities) {
    const params = new URLSearchParams({ entity: sourceEntity, end_time: end });
    const entries = await haRest(`/api/logbook/${encodeURIComponent(start)}?${params.toString()}`);
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const isAutomationEntry = entry?.context_parent_id || entry?.context_domain === 'automation' || entry?.context_event_type === 'automation_triggered';
      if (entry?.entity_id !== sourceEntity || !isAutomationEntry) continue;
      const occurredAt = entry.when || entry.timestamp || entry.time;
      const action = String(entry.message || entry.state || '状态变化').trim().slice(0, 120) || '状态变化';
      const externalKey = `ha-logbook:${entityId}:${sourceEntity}:${entry.context_id || `${occurredAt || ''}|${action}`}`;
      await configStore.appendOperationLog({
        // 通道日志归并到灯光主体，管理员点击主体卡片即可查看完整记录。
        entity_id: entityId,
        occurred_at: occurredAt,
        action,
        source: 'automation',
        automation_name: typeof entry.context_name === 'string' && entry.context_name.trim()
          ? entry.context_name.trim().replace(`${AUTOMATION_MARKER} `, '').slice(0, 120)
          : typeof entry.name === 'string' && entry.name.trim()
            ? entry.name.trim().replace(`${AUTOMATION_MARKER} `, '').slice(0, 120)
            : 'Home Assistant 自动化',
        success: true,
        external_key: externalKey,
        metadata: {
          source_entity_id: sourceEntity,
          context_id: entry.context_id ?? null,
          context_parent_id: entry.context_parent_id ?? null,
          context_entity_id: entry.context_entity_id ?? null,
          state: entry.state ?? null,
        },
      });
    }
  }
  deviceLogSyncState.set(entityId, end);
}

function lightControlEntitiesForLog(entityId) {
  const stem = lightMainStem(entityId);
  return stem ? [entityId, ...panelControlEntityIds(stem)] : [entityId];
}

const deviceLogSyncState = new Map();
const deviceLogSyncInFlight = new Map();

function syncDeviceAutomationLogsOnce(entityId) {
  const running = deviceLogSyncInFlight.get(entityId);
  if (running) return running;
  const task = syncDeviceAutomationLogs(entityId).finally(() => deviceLogSyncInFlight.delete(entityId));
  deviceLogSyncInFlight.set(entityId, task);
  return task;
}

async function readHaAutomations(preferredEntities = null) {
  // 传入看板实体白名单时需要重新归并灯光主体，不能直接复用未归并的旧缓存。
  if (!(preferredEntities instanceof Set) && managedAutomationCache.expiresAt > Date.now()) return managedAutomationCache.value;
  const states = await haRest('/api/states');
  const automationStates = Array.isArray(states)
    ? states.filter((item) => String(item?.entity_id || '').startsWith('automation.') && String(item.attributes?.friendly_name || '').startsWith(AUTOMATION_MARKER))
    : [];
  const availableEntities = preferredEntities instanceof Set
    ? preferredEntities
    : new Set(Array.isArray(states) ? states.map((item) => item?.entity_id).filter((id) => typeof id === 'string') : []);
  const configs = await Promise.all(automationStates.map(async (state) => {
    try {
      return parseHaAutomation(await haRest(`/api/config/automation/config/${encodeURIComponent(state.attributes?.id || '')}`), state, availableEntities);
    } catch {
      return null;
    }
  }));
  const value = configs.filter(Boolean);
  for (const item of value) managedAutomationIds.add(item.id);
  managedAutomationCache = { value, expiresAt: Date.now() + 30_000 };
  return value;
}

async function readHaAutomationSummary() {
  const states = await haRest('/api/states');
  return Array.isArray(states)
    ? states.filter((item) => String(item?.entity_id || '').startsWith('automation.')).map((item) => ({
      id: String(item.attributes?.id || ''),
      name: String(item.attributes?.friendly_name || item.entity_id),
      enabled: item.state !== 'off',
    })).filter((item) => item.id)
    : [];
}

async function setHaAutomationState(automation) {
  const path = `/api/services/automation/${automation.enabled ? 'turn_on' : 'turn_off'}`;
  const body = JSON.stringify({ entity_id: `automation.${automation.id}` });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await haRest(path, { method: 'POST', body });
      return;
    } catch (error) {
      // HA 写入 automation 配置后，automation.* 状态实体可能延迟几百毫秒出现。
      // 400/404 在这个初始化窗口内是可恢复的，配置本身已经成功写入。
      if (error?.status !== 400 && error?.status !== 404) throw error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
}

async function writeHaAutomations(automations, dashboardEntities = new Set()) {
  const current = await readHaAutomations(dashboardEntities);
  const availableStates = await haRest('/api/states');
  const availableEntities = new Set(Array.isArray(availableStates) ? availableStates.map((state) => state?.entity_id).filter((id) => typeof id === 'string') : []);
  const snapshot = current.map((item) => ({ ...item }));
  const nextIds = new Set(automations.map((item) => item.id));
  const currentIds = new Set([...managedAutomationIds, ...current.map((item) => item.id)]);
  try {
    for (const item of automations) {
      await haRest(`/api/config/automation/config/${encodeURIComponent(item.id)}`, {
        method: 'POST',
        body: JSON.stringify(toHaAutomation(item, availableEntities, dashboardEntities)),
      });
      await setHaAutomationState(item);
    }
    for (const id of currentIds) {
      if (nextIds.has(id)) continue;
      try {
        await haRest(`/api/config/automation/config/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch (error) {
        // 删除接口是幂等操作：HA 对已经不存在的自动化可能返回 400/404，视为清理完成。
        if (error?.status !== 400 && error?.status !== 404) throw error;
      }
    }
  } catch (error) {
    const snapshotIds = new Set(snapshot.map((item) => item.id));
    await Promise.allSettled([...nextIds].filter((id) => !snapshotIds.has(id)).map((id) => haRest(`/api/config/automation/config/${encodeURIComponent(id)}`, { method: 'DELETE' })));
    await Promise.allSettled(snapshot.map((item) => haRest(`/api/config/automation/config/${encodeURIComponent(item.id)}`, {
      method: 'POST',
      body: JSON.stringify(toHaAutomation(item, availableEntities, dashboardEntities)),
    }).then(() => setHaAutomationState(item))));
    throw error;
  }
  managedAutomationIds.clear();
  for (const id of nextIds) managedAutomationIds.add(id);
  // HA 写入配置后，automation.* 状态实体可能需要几秒才出现在 /api/states。
  // 立即用已成功提交的配置填充缓存，避免用户重新打开管理页时看到空列表；
  // 缓存过期后仍会从 HA 读取并校正最终状态。
  const saved = automations.map((item) => ({ ...item, entity_ids: [...item.entity_ids], days: [...item.days] }));
  managedAutomationCache = { value: saved, expiresAt: Date.now() + 30_000 };
  return saved;
}

/** 配置体检:遍历看板配置设备,对照 HA 实时状态标记 missing(实体不存在)/unavailable(不可用) */
async function allowedEntities(admin = false) {
  const config = await configStore.readConfig();
  const ids = new Set();
  for (const region of Array.isArray(config?.regions) ? config.regions : []) {
    if (!admin && region.hiddenFromUsers) continue;
    for (const block of Array.isArray(region?.blocks) ? region.blocks : []) {
      if (!admin && block.hiddenFromUsers) continue;
      for (const device of Array.isArray(block?.devices) ? block.devices : []) {
        if (typeof device?.entity_id === 'string' && (admin || !device.hiddenFromUsers)) {
          ids.add(device.entity_id);
          // 灯光主体使用 HA 的 indicator_light 实体承载整组设备；同时放行对应的真实 switch 通道，
          // 供前端在主体卡片内反馈并控制每一路，而不会把通道拆成额外卡片。
          // 灯光主体承载整组设备(旧版 _indicator_light / 新版 _all_switch 等,规则见 shared/switch-panels.mjs);
          // 同时放行对应的真实 switch 通道,供前端在主体卡片内反馈并控制每一路。
          const panelStem = lightMainStem(device.entity_id);
          if (panelStem) {
            for (const channelId of panelControlEntityIds(panelStem)) ids.add(channelId);
          }
        }
      }
    }
  }
  return ids;
}

function sessionFor(req) {
  return parseSession(req, security.sessionSecret);
}

function requireSameOrigin(req, res) {
  if (isSameOrigin(req, security.appOrigin, TRUST_PROXY)) return true;
  sendJson(res, 403, { error: 'origin_not_allowed' });
  return false;
}

function requireAdmin(req, res, csrf = false) {
  const session = sessionFor(req);
  if (!session) {
    sendJson(res, 401, { error: 'authentication_required' });
    return null;
  }
  if (csrf && req.headers['x-csrf-token'] !== session.csrf) {
    sendJson(res, 403, { error: 'csrf_invalid' });
    return null;
  }
  return session;
}

async function handleApi(req, res, pathname) {
  const ip = clientIp(req);
  if (!apiLimiter.take(ip)) {
    sendJson(res, 429, { error: 'rate_limited' }, { 'retry-after': '60' });
    return;
  }

  if (pathname === '/api/session' && req.method === 'GET') {
    const session = sessionFor(req);
    sendJson(res, 200, session ? { authenticated: true, csrf: session.csrf } : { authenticated: false });
    return;
  }

  if (pathname === '/api/database' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, configStore.getConnectionStatus());
    return;
  }

  // 配置体检:核对看板配置的设备实体在 HA 中的存在性,标记已失效/不可用的卡片
  if (pathname === '/api/config/health' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    try {
      sendJson(res, 200, await healthService.buildDeviceHealth());
    } catch (error) {
      const status = Number(error?.status) || 503;
      sendJson(res, status, { error: error instanceof Error ? error.message : 'health_check_failed' });
    }
    return;
  }

  // 体检摘要(读缓存):管理页角标用;缓存缺失/过期时后台补跑一次
  if (pathname === '/api/config/health/summary' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    await healthService.ensureDeviceHealth();
    const report = healthService.getReport();
    if (!report) {
      sendJson(res, 503, { error: 'health_check_failed' });
      return;
    }
    const missingCount = report.problems.filter((problem) => problem.status === 'missing').length;
    sendJson(res, 200, { checkedAt: report.checkedAt, total: report.total, problemCount: report.problems.length, missingCount, unavailableCount: report.problems.length - missingCount });
    return;
  }

  if (pathname === '/api/database' && req.method === 'PUT') {
    if (!requireSameOrigin(req, res)) return;
    if (!requireAdmin(req, res, true)) return;
    try {
      const data = await readJsonBody(req, 16 * 1024);
      const connectionInfo = await configStore.configure(data);
      audit('database_connection_updated', { ip, username: sessionFor(req)?.sub, host: connectionInfo.host, database: connectionInfo.database });
      sendJson(res, 200, connectionInfo);
    } catch (error) {
      const status = Number(error?.status) >= 400 && Number(error?.status) < 500 ? Number(error.status) : 503;
      sendJson(res, status, { error: status === 503 ? 'database_unavailable' : (error instanceof Error ? error.message : '数据库连接参数无效') });
    }
    return;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    if (!requireSameOrigin(req, res)) return;
    if (!loginIpLimiter.take(ip)) {
      sendJson(res, 429, { error: 'too_many_attempts' }, { 'retry-after': '900' });
      return;
    }
    if (!security.adminPasswordHash) {
      sendJson(res, 503, { error: 'admin_not_configured' });
      return;
    }
    const data = await readJsonBody(req, MAX_LOGIN_BODY);
    const username = typeof data?.username === 'string' ? data.username.trim() : '';
    const password = typeof data?.password === 'string' ? data.password : '';
    if (!loginLimiter.take(`${ip}:${username.toLowerCase()}`)) {
      sendJson(res, 429, { error: 'too_many_attempts' }, { 'retry-after': '900' });
      return;
    }
    const passwordOk = await verifyPassword(password, security.adminPasswordHash);
    if (username !== security.adminUsername || !passwordOk) {
      audit('admin_login_failed', { ip, username: username.slice(0, 64) });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
      sendJson(res, 401, { error: 'invalid_credentials' });
      return;
    }
    const { session, token } = createSession(security.sessionSecret, username);
    audit('admin_login_success', { ip, username });
    sendJson(res, 200, { authenticated: true, csrf: session.csrf }, {
      'set-cookie': sessionCookie(token, security.cookieSecure),
    });
    return;
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    if (!requireSameOrigin(req, res)) return;
    const session = requireAdmin(req, res, true);
    if (!session) return;
    audit('admin_logout', { ip, username: session.sub });
    sendJson(res, 200, { authenticated: false }, {
      'set-cookie': clearSessionCookie(security.cookieSecure),
    });
    return;
  }

  if (pathname === '/api/config' && req.method === 'GET') {
    try {
      const config = await configStore.readConfig();
      const session = sessionFor(req);
      const data = config ? JSON.stringify(session ? canonicalDashboard(config) : publicDashboard(config)) : null;
      if (data === null) {
        send(res, 204, '', { 'cache-control': 'no-store' });
        return;
      }
      send(res, 200, data, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        etag: etagFor(data),
      });
    } catch (error) {
      console.error('[ha-dashboard] 读取 PostgreSQL 配置失败:', error);
      sendJson(res, 503, { error: 'config_unavailable' });
    }
    return;
  }

  if (pathname === '/api/config' && req.method === 'PUT') {
    if (!requireSameOrigin(req, res)) return;
    if (!requireAdmin(req, res, true)) return;
    const data = await readJsonBody(req, MAX_CONFIG_BODY);
    if (!validateDashboard(data)) {
      send(res, 400, JSON.stringify({ error: 'invalid_dashboard_config' }), {
        'content-type': 'application/json; charset=utf-8',
      });
      return;
    }
    const normalizedData = canonicalDashboard(data);
    const body = JSON.stringify(normalizedData);
    const newEtag = await withConfigLock(async () => {
      const currentConfig = await configStore.readConfig();
      const current = currentConfig ? JSON.stringify(canonicalDashboard(currentConfig)) : null;
      const expected = req.headers['if-match'];
      if (!expected) throw Object.assign(new Error('precondition_required'), { status: 428 });
      if (current !== null && expected !== etagFor(current)) {
        throw Object.assign(new Error('config_conflict'), { status: 409 });
      }
      if (current === null && expected !== '*') {
        throw Object.assign(new Error('config_conflict'), { status: 409 });
      }
      await configStore.writeConfig(normalizedData);
      return etagFor(body);
    });
    audit('dashboard_config_updated', { ip, username: sessionFor(req)?.sub, regions: normalizedData.regions.length });
    // 原地刷新各连接的实体白名单:纯移动/改名等白名单不变的保存不再断线重连
    void haProxy.refreshClients().catch(() => {});
    send(res, 204, '', { etag: newEtag });
    return;
  }

  if (pathname === '/api/automations' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    try {
      const allowed = await allowedEntities(true);
      const [automations, existing] = await Promise.all([readHaAutomations(allowed), readHaAutomationSummary()]);
      sendJson(res, 200, { automations, existing });
    } catch (error) {
      const status = Number(error?.status) >= 500 ? Number(error.status) : 503;
      sendJson(res, status, { error: status === 504 ? 'ha_timeout' : 'ha_unavailable' });
    }
    return;
  }

  if (pathname === '/api/automations' && req.method === 'PUT') {
    if (!requireSameOrigin(req, res)) return;
    if (!requireAdmin(req, res, true)) return;
    const data = await readJsonBody(req, MAX_CONFIG_BODY);
    const automations = data?.automations;
    const allowed = await allowedEntities(true);
    if (!Array.isArray(automations) || automations.length > 100 || automations.some((item) => !validateAutomation(item, allowed))) {
      sendJson(res, 400, { error: 'invalid_automations' });
      return;
    }
    const ids = new Set();
    if (automations.some((item) => {
      if (ids.has(item.id)) return true;
      ids.add(item.id);
      return false;
    })) {
      sendJson(res, 400, { error: 'duplicate_automation_id' });
      return;
    }
    try {
      const saved = await writeHaAutomations(automations, allowed);
      audit('automations_updated', { ip, username: sessionFor(req)?.sub, count: automations.length });
      sendJson(res, 200, { automations: saved });
    } catch (error) {
      const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 503;
      sendJson(res, status, { error: status === 504 ? 'ha_timeout' : 'automation_save_failed' });
    }
    return;
  }

  if (pathname === '/api/device-logs' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const entityId = new URL(req.url || '/', 'http://localhost').searchParams.get('entity_id')?.trim() || '';
    if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(entityId)) {
      sendJson(res, 400, { error: 'invalid_entity_id' });
      return;
    }
    const allowed = await allowedEntities(true);
    if (!allowed.has(entityId)) {
      sendJson(res, 404, { error: 'device_not_found' });
      return;
    }
    try {
      // 先做一次增量同步再读取，保证刚刚发生的自动化记录在首次打开时即可见。
      await syncDeviceAutomationLogsOnce(entityId).catch((error) => {
        console.warn('[ha-dashboard] 同步设备自动化日志失败:', error instanceof Error ? error.message : error);
      });
      sendJson(res, 200, { entity_id: entityId, logs: await configStore.readOperationLogs(entityId) });
    } catch {
      sendJson(res, 503, { error: 'device_logs_unavailable' });
    }
    return;
  }

  if (pathname === '/api/status' && req.method === 'GET') {
    const hasUrl = Boolean(process.env.HASS_URL || hassUrlFromFile);
    const tokenFile = process.env.HASS_TOKEN_FILE || HASS_TOKEN_FILE;
    const hasToken = Boolean((process.env.HASS_TOKEN || '').trim()) || await stat(tokenFile).then(() => true).catch(() => false);
    sendJson(res, 200, { hassConfigured: hasUrl && hasToken });
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
}

const server = createServer(async (req, res) => {
  try {
    if (!isClientAllowed(req)) {
      sendJson(res, 403, { error: 'network_not_allowed' });
      return;
    }
    const rawRequestUrl = req.url || '/';
    // Node 的 URL 解析器会把 `//management` 当成主机名，因此必须在解析前
    // 规范化重复前导斜杠，否则管理页会落到错误的根路径。
    const canonicalRequestUrl = rawRequestUrl.replace(/^\/{2,}/, '/');
    if (canonicalRequestUrl !== rawRequestUrl) {
      res.writeHead(308, {
        location: canonicalRequestUrl,
        'cache-control': 'no-store',
      });
      res.end();
      return;
    }
    const requestUrl = new URL(canonicalRequestUrl, 'http://localhost');
    const { pathname } = requestUrl;
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'method not allowed', { allow: 'GET, HEAD' });
      return;
    }

    const decoded = decodeURIComponent(pathname);
    const relative = normalize(decoded).replace(/^([/\\]|\.\.[/\\])+/, '');
    let file = resolve(DIST, relative);
    if (file !== DIST && !file.startsWith(`${DIST}${sep}`)) {
      send(res, 400, 'bad path');
      return;
    }
    let fileStat = await stat(file).catch(() => null);
    if (!fileStat?.isFile()) {
      file = join(DIST, 'index.html');
      fileStat = await stat(file).catch(() => null);
      if (!fileStat) {
        send(res, 404, 'not found');
        return;
      }
    }

    const ext = extname(file).toLowerCase();
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      vary: 'Accept-Encoding',
      'cache-control': file.endsWith('index.html')
        ? 'no-cache'
        : pathname.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
    };
    const raw = await readFile(file);
    if (req.method === 'HEAD') {
      send(res, 200, '', { ...headers, 'content-length': String(raw.length) });
    } else if (GZIP_EXTS.has(ext) && /\bgzip\b/i.test(req.headers['accept-encoding'] || '')) {
      send(res, 200, gzipSync(raw), { ...headers, 'content-encoding': 'gzip' });
    } else {
      send(res, 200, raw, headers);
    }
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error('[ha-dashboard] 服务器错误:', err);
    sendJson(res, status, { error: status === 500 ? 'server_error' : err.message });
  }
});

const haProxy = createHaProxy({
  hassUrlFile: HASS_URL_FILE,
  hassTokenFile: HASS_TOKEN_FILE,
  getAllowedEntities: (admin) => allowedEntities(admin),
  isAdminRequest: (req) => Boolean(sessionFor(req)),
  isAllowedOrigin: (req) => isSameOrigin(req, security.appOrigin, TRUST_PROXY),
  clientIp,
  audit,
  recordOperation: (entry) => configStore.appendOperationLog(entry).catch((error) => {
    console.warn('[ha-dashboard] 保存设备操作日志失败:', error instanceof Error ? error.message : error);
  }),
});

server.on('upgrade', (req, socket, head) => {
  if (!isClientAllowed(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  let pathname;
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname !== '/api/ha-websocket') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  haProxy.handleUpgrade(req, socket, head);
});

server.listen(PORT, () => {
  console.log(`[ha-dashboard] 监听 :${PORT}，PostgreSQL 配置存储已启用`);
});

// 启动后延迟首检 + 每 30 分钟定时体检(unref:不阻塞测试进程退出)
setInterval(() => { void healthService.ensureDeviceHealth(0); }, 30 * 60_000).unref();
setTimeout(() => { void healthService.ensureDeviceHealth(0); }, 20_000).unref();

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1_000;

function shutdown(signal) {
  audit('server_shutdown', { signal });
  haProxy.close();
  server.close(async () => {
    await configStore?.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
