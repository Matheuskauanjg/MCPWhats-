import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isPersistenceEnabled, persistenceBackend, setState as setRemoteState, listState as listRemoteState } from './supabase-sync.js';

function envInt(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

const REMOTE_MIRROR_CONCURRENCY = envInt('REMOTE_MIRROR_CONCURRENCY', 2, 1, 8);
const REMOTE_MIRROR_MAX_QUEUE = envInt('REMOTE_MIRROR_MAX_QUEUE', 400, 50, 5000);
const REMOTE_MIRROR_RETRIES = envInt('REMOTE_MIRROR_RETRIES', 2, 0, 5);
const REMOTE_HYDRATE_CHATS = envInt('REMOTE_HYDRATE_CHATS', 500, 1, 2000);
const REMOTE_HYDRATE_CONTACTS = envInt('REMOTE_HYDRATE_CONTACTS', 1500, 1, 5000);
const REMOTE_HYDRATE_MESSAGES = envInt('REMOTE_HYDRATE_MESSAGES', 1500, 1, 5000);
const REMOTE_HYDRATE_MAPPINGS = envInt('REMOTE_HYDRATE_MAPPINGS', 2000, 1, 5000);
const MAX_REMOTE_RAW_MESSAGE_BYTES = envInt('MAX_REMOTE_RAW_MESSAGE_BYTES', 32768, 0, 262144);

function safeJson(value) {
  try {
    return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
  } catch {
    return null;
  }
}

function parseJson(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
}

function boolInt(value) {
  return value ? 1 : 0;
}

function normalizeMapping(lid, pn) {
  const a = String(lid || '').trim();
  const b = String(pn || '').trim();
  if (a.endsWith('@lid') && b.endsWith('@s.whatsapp.net')) return { lid: a, pn: b };
  if (b.endsWith('@lid') && a.endsWith('@s.whatsapp.net')) return { lid: b, pn: a };
  return null;
}

export function createPersistentStore(dbPath) {
  const mirrorQueue = new Map();
  let mirrorActive = 0;
  let mirrorTimer = null;
  let mirrorDropped = 0;
  let mirrorFailed = 0;

  function scheduleMirrorPump(delayMs = 0) {
    if (mirrorTimer) return;
    mirrorTimer = setTimeout(() => {
      mirrorTimer = null;
      pumpMirrorQueue();
    }, Math.max(0, delayMs));
    mirrorTimer.unref?.();
  }

  function queueMirrorJob(jobId, job) {
    if (mirrorQueue.has(jobId)) {
      // Coalesce repeated updates for the same row; keep only the newest value.
      mirrorQueue.delete(jobId);
    } else if (mirrorQueue.size >= REMOTE_MIRROR_MAX_QUEUE) {
      const oldest = mirrorQueue.keys().next().value;
      if (oldest) mirrorQueue.delete(oldest);
      mirrorDropped += 1;
      if (mirrorDropped === 1 || mirrorDropped % 100 === 0) {
        console.warn(`[Persistence] Remote mirror queue full; dropped ${mirrorDropped} stale pending update(s).`);
      }
    }
    mirrorQueue.set(jobId, job);
    scheduleMirrorPump();
  }

  function pumpMirrorQueue() {
    if (!isPersistenceEnabled()) {
      mirrorQueue.clear();
      return;
    }

    while (mirrorActive < REMOTE_MIRROR_CONCURRENCY && mirrorQueue.size) {
      const next = mirrorQueue.entries().next().value;
      if (!next) break;
      const [jobId, job] = next;
      mirrorQueue.delete(jobId);
      mirrorActive += 1;

      void setRemoteState(job.namespace, job.key, job.value)
        .catch(error => {
          if ((job.attempt || 0) < REMOTE_MIRROR_RETRIES && mirrorQueue.size < REMOTE_MIRROR_MAX_QUEUE) {
            queueMirrorJob(jobId, { ...job, attempt: (job.attempt || 0) + 1 });
            return;
          }
          mirrorFailed += 1;
          console.warn(`[Persistence] Mirror ${job.namespace}/${job.key} failed:`, error?.message || error);
        })
        .finally(() => {
          mirrorActive -= 1;
          scheduleMirrorPump();
        });
    }
  }

  function mirrorState(namespace, key, value) {
    if (!isPersistenceEnabled()) return;
    const ns = String(namespace);
    const itemKey = String(key);
    queueMirrorJob(`${ns}\u0000${itemKey}`, {
      namespace: ns,
      key: itemKey,
      value,
      attempt: 0
    });
  }

  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const db = new DatabaseSync(resolved, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    PRAGMA foreign_keys=ON;

    CREATE TABLE IF NOT EXISTS chats (
      chat_id TEXT PRIMARY KEY,
      name TEXT,
      unread_count INTEGER NOT NULL DEFAULT 0,
      ts INTEGER,
      archived INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      jid TEXT PRIMARY KEY,
      name TEXT,
      notify TEXT,
      verified_name TEXT,
      raw_json TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      participant TEXT,
      from_me INTEGER NOT NULL DEFAULT 0,
      text TEXT,
      ts INTEGER,
      type TEXT,
      push_name TEXT,
      audio_json TEXT,
      raw_json TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_text ON messages(text);

    CREATE TABLE IF NOT EXISTS jid_mapping (
      lid TEXT PRIMARY KEY,
      pn TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_jid_mapping_pn ON jid_mapping(pn);
  `);

  const upsertChatStmt = db.prepare(`
    INSERT INTO chats(chat_id, name, unread_count, ts, archived, pinned, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      name=COALESCE(excluded.name, chats.name),
      unread_count=excluded.unread_count,
      ts=CASE WHEN excluded.ts IS NULL THEN chats.ts ELSE MAX(COALESCE(chats.ts, 0), excluded.ts) END,
      archived=excluded.archived,
      pinned=excluded.pinned,
      updated_at=excluded.updated_at
  `);

  const upsertContactStmt = db.prepare(`
    INSERT INTO contacts(jid, name, notify, verified_name, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET
      name=COALESCE(excluded.name, contacts.name),
      notify=COALESCE(excluded.notify, contacts.notify),
      verified_name=COALESCE(excluded.verified_name, contacts.verified_name),
      raw_json=COALESCE(excluded.raw_json, contacts.raw_json),
      updated_at=excluded.updated_at
  `);

  const upsertMessageStmt = db.prepare(`
    INSERT INTO messages(chat_id, message_id, participant, from_me, text, ts, type, push_name, audio_json, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, message_id) DO UPDATE SET
      participant=COALESCE(excluded.participant, messages.participant),
      from_me=excluded.from_me,
      text=CASE WHEN excluded.text IS NULL OR excluded.text='' THEN messages.text ELSE excluded.text END,
      ts=COALESCE(excluded.ts, messages.ts),
      type=COALESCE(excluded.type, messages.type),
      push_name=COALESCE(excluded.push_name, messages.push_name),
      audio_json=COALESCE(excluded.audio_json, messages.audio_json),
      raw_json=COALESCE(excluded.raw_json, messages.raw_json),
      updated_at=excluded.updated_at
  `);

  const upsertMappingStmt = db.prepare(`
    INSERT INTO jid_mapping(lid, pn, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(lid) DO UPDATE SET pn=excluded.pn, updated_at=excluded.updated_at
  `);

  function upsertChat(chat, mirrorRemote = true) {
    const id = String(chat?.id || chat?.chatId || '').trim();
    if (!id) return;
    const now = Date.now();
    upsertChatStmt.run(
      id,
      chat?.name ?? null,
      Number(chat?.unreadCount || 0),
      Number.isFinite(Number(chat?.timestamp)) ? Number(chat.timestamp) : null,
      boolInt(chat?.archived),
      boolInt(chat?.pinned),
      now
    );
    if (mirrorRemote) mirrorState('chat', id, {
      id,
      name: chat?.name ?? null,
      unreadCount: Number(chat?.unreadCount || 0),
      timestamp: Number.isFinite(Number(chat?.timestamp)) ? Number(chat.timestamp) : null,
      archived: Boolean(chat?.archived),
      pinned: Boolean(chat?.pinned)
    });
  }

  function upsertContact(contact, mirrorRemote = true) {
    const id = String(contact?.id || '').trim();
    if (!id) return;
    upsertContactStmt.run(
      id,
      contact?.name ?? null,
      contact?.notify ?? null,
      contact?.verifiedName ?? null,
      safeJson(contact),
      Date.now()
    );
    if (mirrorRemote) mirrorState('contact', id, {
      id,
      name: contact?.name ?? null,
      notify: contact?.notify ?? null,
      verifiedName: contact?.verifiedName ?? null
    });
  }

  function upsertMessage(serialized, rawMessage = null, mirrorRemote = true) {
    const chatId = String(serialized?.chatId || '').trim();
    const messageId = String(serialized?.id || '').trim();
    if (!chatId || !messageId) return;
    const rawForStorage = rawMessage ? {
      key: rawMessage.key || null,
      message: rawMessage.message || null,
      pushName: rawMessage.pushName || null,
      messageTimestamp: serialized.timestamp ?? null
    } : null;
    const rawJson = safeJson(rawForStorage);
    const rawBytes = rawJson ? Buffer.byteLength(rawJson) : 0;
    const rawForRemote = MAX_REMOTE_RAW_MESSAGE_BYTES > 0 && rawBytes <= MAX_REMOTE_RAW_MESSAGE_BYTES
      ? rawForStorage
      : null;
    upsertMessageStmt.run(
      chatId,
      messageId,
      serialized?.participant ?? null,
      boolInt(serialized?.fromMe),
      serialized?.text ?? '',
      Number.isFinite(Number(serialized?.timestamp)) ? Number(serialized.timestamp) : null,
      serialized?.type ?? null,
      serialized?.pushName ?? null,
      safeJson(serialized?.audio ?? null),
      rawJson,
      Date.now()
    );
    if (mirrorRemote) mirrorState('message', `${chatId}|${messageId}`, {
      serialized: {
        id: messageId,
        chatId,
        participant: serialized?.participant ?? null,
        fromMe: Boolean(serialized?.fromMe),
        text: serialized?.text ?? '',
        timestamp: Number.isFinite(Number(serialized?.timestamp)) ? Number(serialized.timestamp) : null,
        type: serialized?.type ?? null,
        pushName: serialized?.pushName ?? null,
        audio: serialized?.audio ?? null
      },
      rawMessage: rawForRemote
    });
  }

  function upsertLidMapping(lid, pn, mirrorRemote = true) {
    const mapping = normalizeMapping(lid, pn);
    if (!mapping) return false;
    upsertMappingStmt.run(mapping.lid, mapping.pn, Date.now());
    if (mirrorRemote) mirrorState('jid_mapping', mapping.lid, mapping);
    return true;
  }

  function inferAndStoreMappings(key, mirrorRemote = true) {
    if (!key || typeof key !== 'object') return;
    const pairs = [
      [key.remoteJid, key.remoteJidAlt],
      [key.participant, key.participantAlt]
    ];
    for (const [a, b] of pairs) upsertLidMapping(a, b, mirrorRemote);
  }

  function rowToMessage(row) {
    return {
      id: row.message_id,
      chatId: row.chat_id,
      participant: row.participant || null,
      fromMe: Boolean(row.from_me),
      text: row.text || '',
      timestamp: row.ts == null ? null : Number(row.ts),
      type: row.type || null,
      pushName: row.push_name || null,
      audio: parseJson(row.audio_json, null)
    };
  }

  function listChats(limit = 100) {
    return db.prepare(`
      SELECT chat_id, name, unread_count, ts, archived, pinned
      FROM chats
      ORDER BY COALESCE(ts, 0) DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(Number(limit) || 100, 500))).map(row => ({
      id: row.chat_id,
      name: row.name || null,
      unreadCount: Number(row.unread_count || 0),
      timestamp: row.ts == null ? null : Number(row.ts),
      archived: Boolean(row.archived),
      pinned: Boolean(row.pinned)
    }));
  }

  function listMessages(chatId, limit = 100) {
    const rows = db.prepare(`
      SELECT * FROM messages
      WHERE chat_id=?
      ORDER BY COALESCE(ts, 0) DESC, updated_at DESC
      LIMIT ?
    `).all(String(chatId), Math.max(1, Math.min(Number(limit) || 100, 500)));
    return rows.reverse().map(rowToMessage);
  }

  function searchMessages(query, limit = 100) {
    const q = String(query || '').trim();
    if (!q) return [];
    return db.prepare(`
      SELECT * FROM messages
      WHERE text LIKE ? ESCAPE '\\'
      ORDER BY COALESCE(ts, 0) DESC
      LIMIT ?
    `).all(`%${q.replace(/[\\%_]/g, value => `\\${value}`)}%`, Math.max(1, Math.min(Number(limit) || 100, 500)))
      .map(row => ({ chatId: row.chat_id, message: rowToMessage(row) }));
  }

  function getMessage(chatId, messageId) {
    const row = db.prepare(`SELECT * FROM messages WHERE chat_id=? AND message_id=?`).get(String(chatId), String(messageId));
    return row ? rowToMessage(row) : null;
  }

  function getQuotedMessage(chatId, messageId) {
    const row = db.prepare(`SELECT * FROM messages WHERE chat_id=? AND message_id=?`).get(String(chatId), String(messageId));
    if (!row) return null;
    const raw = parseJson(row.raw_json, null);
    if (raw?.key && raw?.message) return raw;
    const key = {
      remoteJid: row.chat_id,
      id: row.message_id,
      fromMe: Boolean(row.from_me),
      ...(row.participant ? { participant: row.participant } : {})
    };
    return {
      key,
      pushName: row.push_name || undefined,
      messageTimestamp: row.ts || undefined,
      message: { conversation: row.text || '' }
    };
  }

  function getMessageAuthor(chatId, messageId) {
    const message = getMessage(chatId, messageId);
    if (!message) return null;
    return message.participant || message.chatId || null;
  }

  function resolvePreferredJid(jid) {
    const value = String(jid || '').trim();
    if (!value) return value;
    if (value.endsWith('@lid')) {
      const row = db.prepare(`SELECT pn FROM jid_mapping WHERE lid=?`).get(value);
      if (row?.pn) return row.pn;
    }
    return value;
  }

  function stats() {
    const messages = db.prepare('SELECT COUNT(*) AS count FROM messages').get()?.count || 0;
    const chats = db.prepare('SELECT COUNT(*) AS count FROM chats').get()?.count || 0;
    const mappings = db.prepare('SELECT COUNT(*) AS count FROM jid_mapping').get()?.count || 0;
    return {
      path: resolved,
      messages: Number(messages),
      chats: Number(chats),
      jidMappings: Number(mappings),
      remoteMirror: {
        backend: persistenceBackend(),
        queued: mirrorQueue.size,
        active: mirrorActive,
        concurrency: REMOTE_MIRROR_CONCURRENCY,
        maxQueue: REMOTE_MIRROR_MAX_QUEUE,
        dropped: mirrorDropped,
        failed: mirrorFailed
      }
    };
  }

  function close() {
    if (mirrorTimer) clearTimeout(mirrorTimer);
    try { db.close(); } catch {}
  }

  return {
    path: resolved,
    upsertChat,
    upsertContact,
    upsertMessage,
    upsertLidMapping,
    inferAndStoreMappings,
    listChats,
    listMessages,
    searchMessages,
    getMessage,
    getQuotedMessage,
    getMessageAuthor,
    resolvePreferredJid,
    stats,
    close
  };
}


export async function hydratePersistentStoreFromSupabase(store) {
  if (!isPersistenceEnabled() || !store) return { enabled: false, chats: 0, contacts: 0, messages: 0, mappings: 0 };

  async function hydrateNamespace(namespace, limit, apply) {
    const rows = await listRemoteState(namespace, limit);
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row?.value) apply(row.value);
    }
    return rows.length;
  }

  // Hydrate one namespace at a time to avoid holding every remote dataset in RAM simultaneously.
  const chats = await hydrateNamespace('chat', REMOTE_HYDRATE_CHATS, value => store.upsertChat(value, false));
  const contacts = await hydrateNamespace('contact', REMOTE_HYDRATE_CONTACTS, value => store.upsertContact(value, false));
  const messages = await hydrateNamespace('message', REMOTE_HYDRATE_MESSAGES, value => {
    if (value?.serialized) store.upsertMessage(value.serialized, value.rawMessage || null, false);
  });
  const mappings = await hydrateNamespace('jid_mapping', REMOTE_HYDRATE_MAPPINGS, value => {
    if (value?.lid && value?.pn) store.upsertLidMapping(value.lid, value.pn, false);
  });

  const result = { enabled: true, chats, contacts, messages, mappings };
  console.log(`[Persistence] Hydrated persistent WhatsApp cache from ${persistenceBackend()}:`, result);
  return result;
}
