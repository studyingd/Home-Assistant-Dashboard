import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const HERE = dirname(fileURLToPath(import.meta.url));

function readText(path) {
  return path ? readFile(path, 'utf8').then((value) => value.trim()).catch(() => '') : Promise.resolve('');
}

async function atomicJsonWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

async function atomicTextWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, value, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

function normalizeConnection(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('PostgreSQL 连接参数无效');
  const host = String(raw.host || '').trim();
  const port = Number(raw.port || 5432);
  const database = String(raw.database || '').trim();
  const user = String(raw.user || '').trim();
  const password = typeof raw.password === 'string' ? raw.password : '';
  if (!host || !/^[a-zA-Z0-9._:-]{1,253}$/.test(host)) throw new Error('PostgreSQL 主机地址无效');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PostgreSQL 端口无效');
  if (!database || !/^[a-zA-Z0-9_$-]{1,63}$/.test(database)) throw new Error('数据库名称无效');
  if (!user || user.length > 128) throw new Error('数据库用户名无效');
  if (!password || password.length > 1024) throw new Error('数据库密码不能为空或过长');
  return { host, port, database, user, password, ssl: raw.ssl === true };
}

function publicConnection(config, status) {
  return config
    ? { configured: true, host: config.host, port: config.port, database: config.database, user: config.user, ssl: config.ssl === true, connected: status === 'connected' }
    : { configured: false, connected: false };
}

const SCHEMA_MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS dashboard_meta (id smallint PRIMARY KEY CHECK (id=1),title text NOT NULL,schema_version integer NOT NULL DEFAULT 2,updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS dashboard_regions (id text PRIMARY KEY,name text NOT NULL,icon text,hidden_from_users boolean NOT NULL DEFAULT false,sort_order integer NOT NULL);
      CREATE TABLE IF NOT EXISTS dashboard_blocks (id text PRIMARY KEY,region_id text NOT NULL REFERENCES dashboard_regions(id) ON DELETE CASCADE,name text NOT NULL,icon text,hidden_from_users boolean NOT NULL DEFAULT false,sort_order integer NOT NULL);
      CREATE TABLE IF NOT EXISTS dashboard_devices (entity_id text NOT NULL,block_id text NOT NULL REFERENCES dashboard_blocks(id) ON DELETE CASCADE,type text NOT NULL,name text,icon text,cover_variant text,hidden_from_users boolean NOT NULL DEFAULT false,sort_order integer NOT NULL,PRIMARY KEY (block_id,entity_id));
      CREATE TABLE IF NOT EXISTS dashboard_operation_logs (
        id bigserial PRIMARY KEY,
        entity_id text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        action text NOT NULL,
        source text NOT NULL DEFAULT 'manual',
        actor text,
        automation_name text,
        success boolean NOT NULL DEFAULT true,
        error_message text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        external_key text UNIQUE
      );
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE dashboard_meta ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE dashboard_regions ADD COLUMN IF NOT EXISTS hidden_from_users boolean NOT NULL DEFAULT false;
      ALTER TABLE dashboard_blocks ADD COLUMN IF NOT EXISTS hidden_from_users boolean NOT NULL DEFAULT false;
      ALTER TABLE dashboard_devices ADD COLUMN IF NOT EXISTS hidden_from_users boolean NOT NULL DEFAULT false;
      ALTER TABLE dashboard_operation_logs ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
      CREATE INDEX IF NOT EXISTS dashboard_operation_logs_entity_time_idx ON dashboard_operation_logs (entity_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS dashboard_operation_logs_time_idx ON dashboard_operation_logs (occurred_at DESC);
    `,
  },
];

async function runMigrations(targetPool) {
  await targetPool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const migration of SCHEMA_MIGRATIONS) {
    const result = await targetPool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [migration.version]);
    if (result.rowCount > 0) continue;
    const client = await targetPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function writeConfigWithPool(targetPool, config) {
  const client = await targetPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM dashboard_devices');
    await client.query('DELETE FROM dashboard_blocks');
    await client.query('DELETE FROM dashboard_regions');
    await client.query('INSERT INTO dashboard_meta (id,title,schema_version,updated_at) VALUES (1,$1,$2,now()) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,schema_version=EXCLUDED.schema_version,updated_at=now()', [config.title, config.schemaVersion]);
    for (const [ri, region] of config.regions.entries()) {
      await client.query('INSERT INTO dashboard_regions (id,name,icon,hidden_from_users,sort_order) VALUES ($1,$2,$3,$4,$5)', [region.id, region.name, region.icon ?? null, region.hiddenFromUsers === true, ri]);
      for (const [bi, block] of region.blocks.entries()) {
        await client.query('INSERT INTO dashboard_blocks (id,region_id,name,icon,hidden_from_users,sort_order) VALUES ($1,$2,$3,$4,$5,$6)', [block.id, region.id, block.name, block.icon ?? null, block.hiddenFromUsers === true, bi]);
        for (const [di, device] of block.devices.entries()) await client.query('INSERT INTO dashboard_devices (entity_id,block_id,type,name,icon,cover_variant,hidden_from_users,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [device.entity_id, block.id, device.type, device.name ?? null, device.icon ?? null, device.coverVariant ?? null, device.hiddenFromUsers === true, di]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function appendOperationLogWithPool(targetPool, entry) {
  await targetPool.query(
    `INSERT INTO dashboard_operation_logs
      (entity_id, occurred_at, action, source, actor, automation_name, success, error_message, metadata, external_key)
     VALUES ($1, COALESCE($2::timestamptz, now()), $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     ON CONFLICT (external_key) DO UPDATE SET
       occurred_at = EXCLUDED.occurred_at,
       action = EXCLUDED.action,
       source = EXCLUDED.source,
       actor = EXCLUDED.actor,
       automation_name = EXCLUDED.automation_name,
       success = EXCLUDED.success,
       error_message = EXCLUDED.error_message,
       metadata = EXCLUDED.metadata`,
    [
      entry.entity_id,
      entry.occurred_at ?? null,
      entry.action,
      entry.source ?? 'manual',
      entry.actor ?? null,
      entry.automation_name ?? null,
      entry.success !== false,
      entry.error_message ?? null,
      JSON.stringify(entry.metadata ?? {}),
      entry.external_key ?? null,
    ],
  );
}

export async function createConfigStore({ importFile, connectionFile, passwordFile }) {
  const resolvedPasswordFile = passwordFile || join(dirname(connectionFile), 'postgres-connection-password');
  let pool = null;
  let connection = null;
  let status = 'unconfigured';

  async function connect(raw, persist = false, bootstrapConfig = null) {
    const next = normalizeConnection(raw);
    const nextPool = new Pool({
      host: next.host,
      port: next.port,
      database: next.database,
      user: next.user,
      password: next.password,
      ssl: next.ssl ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      query_timeout: 10_000,
      statement_timeout: 10_000,
    });
    nextPool.on('error', (error) => {
      console.error('[ha-dashboard] PostgreSQL 连接池错误:', error instanceof Error ? error.message : error);
      if (pool === nextPool) status = 'error';
    });
    try {
      await runMigrations(nextPool);
      const existing = await nextPool.query('SELECT id FROM dashboard_meta WHERE id=1');
      if (existing.rowCount === 0) {
        let source = null;
        try { source = await readFile(importFile, 'utf8'); }
        catch (error) { if (error?.code !== 'ENOENT') throw error; }
        if (bootstrapConfig) {
          await writeConfigWithPool(nextPool, bootstrapConfig);
        } else if (source) {
          let rawConfig;
          try { rawConfig = JSON.parse(source); } catch { throw new Error(`配置导入文件 JSON 无效: ${importFile}`); }
          if (rawConfig?.schemaVersion !== 2 || !Array.isArray(rawConfig.regions)) throw new Error(`配置导入文件格式无效: ${importFile}`);
          await writeConfigWithPool(nextPool, rawConfig);
        }
      }
      if (persist) {
        // 连接文件只保存非敏感参数，数据库密码单独以 0600 文件落盘。
        const safeConnection = { ...next };
        delete safeConnection.password;
        await atomicJsonWrite(connectionFile, safeConnection);
        await atomicTextWrite(resolvedPasswordFile, password);
      }
      const oldPool = pool;
      pool = nextPool;
      connection = next;
      status = 'connected';
      await oldPool?.end().catch(() => {});
    } catch (error) {
      await nextPool.end().catch(() => {});
      throw error;
    }
  }

  const saved = await readText(connectionFile);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const password = await readText(resolvedPasswordFile);
      // 兼容一次性迁移旧版明文 password 字段，并立即拆分保存。
      await connect({ ...parsed, password: password || parsed.password });
      if (!password && parsed.password) {
        const legacyPassword = parsed.password;
        const safeConnection = { ...parsed };
        delete safeConnection.password;
        await atomicJsonWrite(connectionFile, safeConnection);
        await atomicTextWrite(resolvedPasswordFile, legacyPassword);
      }
    }
    catch (error) { status = 'error'; console.error('[ha-dashboard] 保存的 PostgreSQL 连接失败:', error.message); }
  } else {
    const envPassword = await readText(process.env.PGPASSWORD_FILE || '');
    if (process.env.PGHOST && (envPassword || process.env.PGPASSWORD)) {
      try { await connect({ host: process.env.PGHOST, port: process.env.PGPORT, database: process.env.PGDATABASE || 'ha_dashboard', user: process.env.PGUSER || 'ha_dashboard', password: envPassword || process.env.PGPASSWORD, ssl: process.env.PGSSLMODE === 'require' }); }
      catch (error) { status = 'error'; console.error('[ha-dashboard] PostgreSQL 连接失败:', error.message); }
    } else if (process.env.NODE_ENV !== 'production') {
      // 本地开发默认连接项目随附的 PostgreSQL 容器，不依赖 .env 或手工导出环境变量。
      // 服务器 Docker 部署仍优先使用上面的 PGHOST/PGPASSWORD_FILE 配置。
      const localPassword = await readText(join(HERE, '..', 'secrets', 'postgres-password'));
      if (localPassword) {
        try {
          await connect({ host: '127.0.0.1', port: 5432, database: 'ha_dashboard', user: 'ha_dashboard', password: localPassword });
          console.log('[ha-dashboard] 已连接本地 PostgreSQL (127.0.0.1:5432)');
        } catch (error) {
          status = 'error';
          console.error('[ha-dashboard] 本地 PostgreSQL 连接失败:', error.message);
        }
      }
    } else {
      // 生产环境支持通过管理员页面首次配置数据库，不尝试连接容器自身的 127.0.0.1。
      status = 'unconfigured';
    }
  }

  async function readConfig() {
    if (!pool) throw Object.assign(new Error('PostgreSQL 尚未配置'), { code: 'DB_NOT_CONFIGURED' });
    const [meta, regions, blocks, devices] = await Promise.all([
      pool.query('SELECT title,schema_version FROM dashboard_meta WHERE id=1'),
      pool.query('SELECT id,name,icon,hidden_from_users,sort_order FROM dashboard_regions ORDER BY sort_order,id'),
      pool.query('SELECT id,region_id,name,icon,hidden_from_users,sort_order FROM dashboard_blocks ORDER BY sort_order,id'),
      pool.query('SELECT entity_id,block_id,type,name,icon,cover_variant,hidden_from_users,sort_order FROM dashboard_devices ORDER BY sort_order,entity_id'),
    ]);
    if (meta.rowCount === 0) return null;
    const blockMap = new Map(blocks.rows.map((row) => [row.id, { id: row.id, name: row.name, ...(row.icon ? { icon: row.icon } : {}), ...(row.hidden_from_users ? { hiddenFromUsers: true } : {}), devices: [] }]));
    for (const row of devices.rows) blockMap.get(row.block_id)?.devices.push({ entity_id: row.entity_id, type: row.type, ...(row.name ? { name: row.name } : {}), ...(row.icon ? { icon: row.icon } : {}), ...(row.cover_variant ? { coverVariant: row.cover_variant } : {}), ...(row.hidden_from_users ? { hiddenFromUsers: true } : {}) });
    return { schemaVersion: Number(meta.rows[0].schema_version), title: meta.rows[0].title, regions: regions.rows.map((row) => ({ id: row.id, name: row.name, ...(row.icon ? { icon: row.icon } : {}), ...(row.hidden_from_users ? { hiddenFromUsers: true } : {}), blocks: blocks.rows.filter((block) => block.region_id === row.id).map((block) => blockMap.get(block.id)).filter(Boolean) })) };
  }

  return {
    readConfig,
    writeConfig: async (config) => { if (!pool) throw Object.assign(new Error('PostgreSQL 尚未配置'), { code: 'DB_NOT_CONFIGURED' }); await writeConfigWithPool(pool, config); },
    appendOperationLog: async (entry) => {
      if (!pool) return;
      await appendOperationLogWithPool(pool, entry);
    },
    readOperationLogs: async (entityId, limit = 200) => {
      if (!pool) throw Object.assign(new Error('PostgreSQL 尚未配置'), { code: 'DB_NOT_CONFIGURED' });
      const result = await pool.query(
        `SELECT id, entity_id, occurred_at, action, source, actor, automation_name, success, error_message, metadata
         FROM dashboard_operation_logs
         WHERE entity_id = $1
         ORDER BY occurred_at DESC, id DESC LIMIT $2`,
        [entityId, Math.min(Math.max(Number(limit) || 200, 1), 500)],
      );
      return result.rows;
    },
    configure: async (raw) => {
      let currentConfig = null;
      if (pool) { try { currentConfig = await readConfig(); } catch { /* target connection test can proceed */ } }
      await connect(raw, true, currentConfig);
      return publicConnection(connection, status);
    },
    getConnectionStatus: () => publicConnection(connection, status),
    close: async () => { await pool?.end().catch(() => {}); pool = null; status = 'unconfigured'; },
  };
}
