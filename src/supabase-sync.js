import fs from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_ADMIN_KEY = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const MAX_AUTH_FILE_BYTES = 2 * 1024 * 1024;

export function isSupabaseEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_ADMIN_KEY);
}

function authHeaders(extra = {}) {
  const headers = {
    apikey: SUPABASE_ADMIN_KEY,
    'content-type': 'application/json',
    ...extra
  };
  // Legacy service_role keys are JWTs and may be used as Bearer tokens.
  // New sb_secret_* keys must be sent as apikey, not Authorization Bearer.
  if (SUPABASE_ADMIN_KEY.startsWith('eyJ')) {
    headers.authorization = `Bearer ${SUPABASE_ADMIN_KEY}`;
  }
  return headers;
}

async function rest(table, { method = 'GET', query = '', body, prefer, headers: extraHeaders = {} } = {}) {
  if (!isSupabaseEnabled()) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY not configured');
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

export async function getSetting(key) {
  if (!isSupabaseEnabled()) return null;
  const rows = await rest('mcpwhats_settings', {
    query: `key=eq.${encodeURIComponent(String(key))}&select=value&limit=1`
  });
  return Array.isArray(rows) && rows.length ? rows[0].value : null;
}

export async function setSetting(key, value) {
  if (!isSupabaseEnabled()) return false;
  await rest('mcpwhats_settings', {
    method: 'POST',
    query: 'on_conflict=key',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { key: String(key), value, updated_at: new Date().toISOString() }
  });
  return true;
}

export async function getState(namespace, key) {
  if (!isSupabaseEnabled()) return null;
  const rows = await rest('mcpwhats_state', {
    query: `namespace=eq.${encodeURIComponent(String(namespace))}&key=eq.${encodeURIComponent(String(key))}&select=value&limit=1`
  });
  return Array.isArray(rows) && rows.length ? rows[0].value : null;
}

export async function setState(namespace, key, value) {
  if (!isSupabaseEnabled()) return false;
  await rest('mcpwhats_state', {
    method: 'POST',
    query: 'on_conflict=namespace,key',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { namespace: String(namespace), key: String(key), value, updated_at: new Date().toISOString() }
  });
  return true;
}

export async function listState(namespace, limit = 5000) {
  if (!isSupabaseEnabled()) return [];
  const max = Math.max(1, Math.min(Number(limit) || 5000, 20000));
  const pageSize = 500;
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
  if (!isSupabaseEnabled()) return { enabled: false, restored: 0 };
  const rows = await rest('mcpwhats_state', {
    query: 'namespace=eq.baileys_auth&select=key,value&limit=1000'
  });
  if (!Array.isArray(rows) || !rows.length) return { enabled: true, restored: 0 };
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
  console.log(`[Supabase] Restored ${restored} Baileys auth file(s).`);
  return { enabled: true, restored };
}

export async function backupAuthDirectory(authDir) {
  if (!isSupabaseEnabled()) return { enabled: false, backedUp: 0 };
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
  if (backedUp) console.log(`[Supabase] Backed up ${backedUp} Baileys auth file(s).`);
  return { enabled: true, backedUp };
}

export function startAuthBackupLoop(authDir, intervalMs = Number(process.env.SUPABASE_AUTH_BACKUP_INTERVAL_MS || 120000)) {
  if (!isSupabaseEnabled()) {
    console.log('[Supabase] Sync disabled; configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    return () => {};
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await backupAuthDirectory(authDir); }
    catch (error) { console.warn('[Supabase] Auth backup failed:', error?.message || error); }
    finally { running = false; }
  };
  const first = setTimeout(() => void run(), 15000);
  first.unref?.();
  const timer = setInterval(() => void run(), Math.max(30000, intervalMs));
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
