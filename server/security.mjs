import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SECRET_DIR = join(HERE, '..', 'secrets');
const SESSION_COOKIE = '__Host-ha_dashboard_session';
const DEV_SESSION_COOKIE = 'ha_dashboard_session_dev';
const configuredTtl = Number(process.env.SESSION_TTL_SECONDS || 8 * 60 * 60);
const SESSION_TTL_SECONDS = Number.isFinite(configuredTtl)
  ? Math.min(Math.max(Math.floor(configuredTtl), 300), 24 * 60 * 60)
  : 8 * 60 * 60;
let passwordWorkers = 0;
const passwordQueue = [];

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromBase64url(input) {
  return Buffer.from(input, 'base64url');
}

async function readSecret(fileEnv, valueEnv, defaultFile = '') {
  const file = process.env[fileEnv] || defaultFile;
  if (file) return (await readFile(file, 'utf8').catch(() => '')).trim();
  return (process.env[valueEnv] || '').trim();
}

export async function loadSecurityConfig() {
  const configuredSecret = await readSecret(
    'SESSION_SECRET_FILE',
    'SESSION_SECRET',
    join(DEFAULT_SECRET_DIR, 'session-secret'),
  );
  const sessionSecret = configuredSecret || randomBytes(32).toString('base64url');
  if (!configuredSecret) {
    console.warn('[ha-dashboard] 未配置 SESSION_SECRET，重启后现有管理会话将失效');
  }

  return {
    adminUsername: (process.env.ADMIN_USERNAME || 'admin').trim(),
    adminPasswordHash: await readSecret(
      'ADMIN_PASSWORD_HASH_FILE',
      'ADMIN_PASSWORD_HASH',
      join(DEFAULT_SECRET_DIR, 'admin-password-hash'),
    ),
    appOrigin: (process.env.APP_ORIGIN || '').replace(/\/$/, ''),
    // 本项目默认以内网 HTTP 运行；若部署到 HTTPS，可通过固定部署配置启用 Secure Cookie。
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    sessionSecret,
    sessionSecretConfigured: Boolean(configuredSecret),
  };
}

export async function verifyPassword(password, encoded) {
  if (!encoded || typeof password !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 7 || parts[1] !== 'scrypt') return false;
  const n = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n < 16_384 || n > 1_048_576 || r < 8 || r > 32 || p < 1 || p > 8) return false;

  let salt;
  let expected;
  try {
    salt = fromBase64url(parts[5]);
    expected = fromBase64url(parts[6]);
  } catch {
    return false;
  }
  if (salt.length < 16 || expected.length !== 32) return false;

  await acquirePasswordWorker();
  try {
    const actual = await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 128 * 1024 * 1024,
    });
    return timingSafeEqual(Buffer.from(actual), expected);
  } finally {
    releasePasswordWorker();
  }
}

function acquirePasswordWorker() {
  if (passwordWorkers < 2) {
    passwordWorkers += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => passwordQueue.push(resolve));
}

function releasePasswordWorker() {
  const next = passwordQueue.shift();
  if (next) next();
  else passwordWorkers -= 1;
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('密码至少需要 12 个字符');
  }
  const n = 65_536;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32, {
    N: n,
    r,
    p,
    maxmem: 128 * 1024 * 1024,
  });
  return `$scrypt$${n}$${r}$${p}$${base64url(salt)}$${base64url(derived)}`;
}

function signPayload(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSession(secret, username) {
  const now = Math.floor(Date.now() / 1000);
  const session = {
    sub: username,
    role: 'admin',
    csrf: randomBytes(24).toString('base64url'),
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const payload = base64url(JSON.stringify(session));
  return { session, token: `${payload}.${signPayload(payload, secret)}` };
}

export function parseSession(req, secret) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE] || cookies[DEV_SESSION_COOKIE];
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = signPayload(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(fromBase64url(payload).toString('utf8'));
    if (
      session?.role !== 'admin' ||
      typeof session.sub !== 'string' ||
      typeof session.csrf !== 'string' ||
      !Number.isFinite(session.exp) ||
      session.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function sessionCookie(token, secure) {
  return [
    `${secure ? SESSION_COOKIE : DEV_SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
    'Priority=High',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearSessionCookie(secure) {
  return [
    `${secure ? SESSION_COOKIE : DEV_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
    'Max-Age=0',
  ]
    .filter(Boolean)
    .join('; ');
}

export function requestOrigin(req, trustProxy = false) {
  if (trustProxy) {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    if (proto && host) return `${proto}://${host}`;
  }
  const host = req.headers.host;
  if (!host) return '';
  return `${req.socket.encrypted ? 'https' : 'http'}://${host}`;
}

export function isSameOrigin(req, configuredOrigin, trustProxy = false) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const expected = configuredOrigin || requestOrigin(req, trustProxy);
  return origin === expected;
}

export class SlidingWindowLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.entries = new Map();
  }

  take(key) {
    const now = Date.now();
    const recent = (this.entries.get(key) || []).filter((time) => now - time < this.windowMs);
    recent.push(now);
    this.entries.set(key, recent);
    if (this.entries.size > 5_000) {
      for (const [entryKey, times] of this.entries) {
        if (times.every((time) => now - time >= this.windowMs)) this.entries.delete(entryKey);
      }
    }
    return recent.length <= this.limit;
  }
}
