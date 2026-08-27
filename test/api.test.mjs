import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('public API status/session and origin protection', { timeout: 15_000 }, async () => {
  const port = await freePort();
  const temp = await mkdtemp(join(tmpdir(), 'ha-dashboard-test-'));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      APP_ORIGIN: origin,
      ADMIN_PASSWORD_HASH_FILE: join(temp, 'missing-admin-hash'),
      SESSION_SECRET_FILE: join(temp, 'missing-session-secret'),
      DB_CONNECTION_FILE: join(temp, 'connection.json'),
      DB_PASSWORD_FILE: join(temp, 'connection-password'),
      HASS_URL_FILE: join(temp, 'missing-ha-url'),
      HASS_TOKEN_FILE: join(temp, 'missing-ha-token'),
      PGPASSWORD_FILE: join(temp, 'missing-pg-password'),
      PGHOST: '',
      PGPASSWORD: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('测试服务器启动超时')), 8_000);
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('监听')) { clearTimeout(timer); resolve(); }
      });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`测试服务器提前退出: ${code}`)); });
    });

    const status = await fetch(`${origin}/api/status`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { hassConfigured: false });

    const session = await fetch(`${origin}/api/session`);
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { authenticated: false });

    const crossOriginLogin = await fetch(`${origin}/api/login`, {
      method: 'POST',
      headers: { origin: 'http://evil.invalid', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'invalid-password' }),
    });
    assert.equal(crossOriginLogin.status, 403);
    assert.deepEqual(await crossOriginLogin.json(), { error: 'origin_not_allowed' });
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(temp, { recursive: true, force: true });
  }
});
