import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_ADMIN_KEY = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_SYNC_SECRET = String(process.env.MCPWHATS_SYNC_SECRET || '').trim();
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const MAX_AUTH_FILE_BYTES = 2 * 1024 * 1024;
const SETTINGS_NAMESPACE = '__settings__';

let pgPool = null;
let pgReady = null;

export function isSupabaseDirectEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_ADMIN_KEY);
}

export function isSupabaseProxyEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_SYNC_SECRET);
}

export function isSupabaseEnabled() {
  return isSupabaseDirectEnabled() || isSupabaseProxyEnabled();
}

export function isPostgresEnabled() {
  return Boolean(DATABASE_URL);
}

export function isPersistenceEnabled() {
  return isSupabaseEnabled() || isPostgresEnabled();
}

export function persistenceBackend() {
  if (isSupabaseDirectEnabled()) return 'supabase';
  if (isSupabaseProxyEnabled()) return 'supabase-proxy';
  if (isPostgresEnabled()) return 'postgres';
  return 'local-only';
}

function authHeaders(extra = {}) {
  const headers = {
    apikey: SUPABASE_ADMIN_KEY,
    'content-type': 'application/json',
    ...extra
  };
  if (SUPABASE_ADMIN_KEY.startsWith('eyJ')) {
    headers.authorization = `Bearer ${SUPABASE_ADMIN_KEY}`;
  }
  return headers;
}

async function rest(table, { method = 'GET', query = '', body, prefer, headers: extraHeaders = {} } = {}) {
  if (!isSupabaseDirectEnabled()) throw new Error('Direct Supabase backend is not configured');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method,
    headers: authHeaders({ ...extraHeaders, ...(prefer ? { prefer } : {}) }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`Supabase ${table} HTTP ${response.status}: ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data)}`);
  return data;
}

async function proxyCall(op, payload = {}) {
  if (!isSupabaseProxyEnabled()) throw new Error('Supabase proxy backend is not configured');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/mcpwhats-storage`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-mcpwhats-sync-secret': SUPABASE_SYNC_SECRET
    },
    body: JSON.stringify({ op, ...payload })
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    throw new Error(`Supabase proxy HTTP ${response.status}: ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data)}`);
  }
  return data;
}

async function ensurePostgres() {
  if (!isPostgresEnabled()) return null;
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false }
    });
  }
  if (!pgReady) {
    pgReady = pgPool.query(`
      create table if not exists mcpwhats_kv (
        namespace text not null,
        key text not null,
        value jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now(),
        primary key (namespace, key)
      );
      create index if not exists mcpwhats_kv_namespace_updated_idx
        on mcpwhats_kv(namespace, updated_at desc);
    `).then(() => true).catch(error => {
      pgReady = null;
      throw error;
    });
  }
  await pgReady;
  return pgPool;
}

async function pgGet(namespace, key) {
  const pool = await ensurePostgres();
  if (!pool) return null;
  const result = await pool.query(
    'select value from mcpwhats_kv where namespace=$1 and key=$2 limit 1',
    [String(namespace), String(key)]
  );
  return result.rows?.[0]?.value ?? null;
}

async function pgSet(namespace, key, value) {
  const pool = await ensurePostgres();
  if (!pool) return false;
  await pool.query(
    `insert into mcpwhats_kv(namespace, key, value, updated_at)
     values ($1, $2, $3::jsonb, now())
     on conflict(namespace, key)
     do update set value=excluded.value, updated_at=excluded.updated_at`,
    [String(namespace), String(key), JSON.stringify(value)]
  );
  return true;
}

async function pgList(namespace, limit = 5000) {
  const pool = await ensurePostgres();
  if (!pool) return [];
  const max = Math.max(1, Math.min(Number(limit) || 5000, 20000));
  const result = await pool.query(
    'select key, value, updated_at from mcpwhats_kv where namespace=$1 order by updated_at desc limit $2',
    [String(namespace), max]
  );
  return result.rows || [];
}

export async function getSetting(key) {
  if (isSupabaseDirectEnabled()) {
    const rows = await rest('mcpwhats_settings', {
      query: `key=eq.${encodeURIComponent(String(key))}&select=value&limit=1`
    });
    return Array.isArray(rows) && rows.length ? rows[0].value : null;
  }
  if (isSupabaseProxyEnabled()) {
    const result = await proxyCall('get_setting', { key: String(key) });
    return result?.value ?? null;
  }
  return pgGet(SETTINGS_NAMESPACE, key);
}

export async function setSetting(key, value) {
  if (isSupabaseDirectEnabled()) {
    await rest('mcpwhats_settings', {
      method: 'POST',
      query: 'on_conflict=key',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: { key: String(key), value, updated_at: new Date().toISOString() }
    });
    return true;
  }
  if (isSupabaseProxyEnabled()) {
    await proxyCall('set_setting', { key: String(key), value });
    return true;
  }
  return pgSet(SETTINGS_NAMESPACE, key, value);
}

export async function getState(namespace, key) {
  if (isSupabaseDirectEnabled()) {
    const rows = await rest('mcpwhats_state', {
      query: `namespace=eq.${encodeURIComponent(String(namespace))}&key=eq.${encodeURIComponent(String(key))}&select=value&limit=1`
    });
    return Array.isArray(rows) && rows.length ? rows[0].value : null;
  }
  if (isSupabaseProxyEnabled()) {
    const result = await proxyCall('get_state', { namespace: String(namespace), key: String(key) });
    return result?.value ?? null;
  }
  return pgGet(namespace, key);
}

export async function setState(namespace, key, value) {
  if (isSupabaseDirectEnabled()) {
    await rest('mcpwhats_state', {
      method: 'POST',
      query: 'on_conflict=namespace,key',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: { namespace: String(namespace), key: String(key), value, updated_at: new Date().toISOString() }
    });
    return true;
  }
  if (isSupabaseProxyEnabled()) {
    await proxyCall('set_state', { namespace: String(namespace), key: String(key), value });
    return true;
  }
  return pgSet(namespace, key, value);
}

export async function listState(namespace, limit = 5000) {
  const max = Math.max(1, Math.min(Number(limit) || 5000, 20000));
  const pageSize = 500;
  if (isSupabaseDirectEnabled()) {
    const rows = [];
    for (let start = 0; start < max; start += pageSize) {
      const end = Math.min(start + pageSize - 1, max - 1);
      const page = await rest('mcpwhats_state', {
        query: `namespace=eq.${encodeURIComponent(String(namespace))}&select=key,value,updated_at&order=updated_at.desc`,
        headers: { range: `${start}-${end}`, 'range-unit': 'items' }
      });
      if (!Array.isArray(page) || !page.length) break;
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows.slice(0, max);
  }
  if (isSupabaseProxyEnabled()) {
    const rows = [];
    for (let offset = 0; offset < max; offset += pageSize) {
      const page = await proxyCall('list_state', {
        namespace: String(namespace),
        offset,
        limit: Math.min(pageSize, max - offset)
      });
      const items = Array.isArray(page?.rows) ? page.rows : [];
      if (!items.length) break;
      rows.push(...items);
      if (items.length < pageSize) break;
    }
    return rows.slice(0, max);
  }
  return pgList(namespace, limit);
}

async function walkFiles(root, current = root, out = []) {
  let entries = [];
  try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) await walkFiles(root, absolute, out);
    else if (entry.isFile()) out.push({ absolute, relative: path.relative(root, absolute).replaceAll('\\', '/') });
  }
  return out;
}

function safeRelative(value) {
  const normalized = path.posix.normalize(String(value || '').replaceAll('\\', '/'));
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || path.posix.isAbsolute(normalized)) return null;
  return normalized;
}

export async function restoreAuthDirectory(authDir) {
  if (!isPersistenceEnabled()) return { enabled: false, restored: 0, backend: persistenceBackend() };
  const rows = await listState('baileys_auth', 1000);
  if (!Array.isArray(rows) || !rows.length) return { enabled: true, restored: 0, backend: persistenceBackend() };
  await fs.mkdir(authDir, { recursive: true });
  let restored = 0;
  for (const row of rows) {
    const rel = safeRelative(row?.key);
    const base64 = row?.value?.base64;
    if (!rel || typeof base64 !== 'string') continue;
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length > MAX_AUTH_FILE_BYTES) continue;
    const destination = path.join(authDir, ...rel.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, buffer);
    restored += 1;
  }
  console.log(`[Persistence] Restored ${restored} Baileys auth file(s) from ${persistenceBackend()}.`);
  return { enabled: true, restored, backend: persistenceBackend() };
}

export async function backupAuthDirectory(authDir) {
  if (!isPersistenceEnabled()) return { enabled: false, backedUp: 0, backend: persistenceBackend() };
  const files = await walkFiles(authDir);
  let backedUp = 0;
  for (const file of files) {
    const stat = await fs.stat(file.absolute).catch(() => null);
    if (!stat || stat.size <= 0 || stat.size > MAX_AUTH_FILE_BYTES) continue;
    const content = await fs.readFile(file.absolute);
    await setState('baileys_auth', file.relative, {
      base64: content.toString('base64'),
      bytes: content.length,
      backedUpAt: new Date().toISOString()
    });
    backedUp += 1;
  }
  if (backedUp) console.log(`[Persistence] Backed up ${backedUp} Baileys auth file(s) to ${persistenceBackend()}.`);
  return { enabled: true, backedUp, backend: persistenceBackend() };
}

export function startAuthBackupLoop(authDir, intervalMs = Number(process.env.PERSISTENCE_BACKUP_INTERVAL_MS || process.env.SUPABASE_AUTH_BACKUP_INTERVAL_MS || 120000)) {
  if (!isPersistenceEnabled()) {
    console.log('[Persistence] Remote sync disabled; configure Supabase or DATABASE_URL.');
    return () => {};
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await backupAuthDirectory(authDir); }
    catch (error) { console.warn('[Persistence] Auth backup failed:', error?.message || error); }
    finally { running = false; }
  };
  const first = setTimeout(() => void run(), 15000);
  first.unref?.();
  const timer = setInterval(() => void run(), Math.max(30000, intervalMs));
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
