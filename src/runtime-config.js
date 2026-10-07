import { getSetting, setSetting, isPersistenceEnabled, persistenceBackend, isSupabaseEnabled, isPostgresEnabled } from './supabase-sync.js';

const defaults = Object.freeze({
  aiProvider: String(process.env.AI_PROVIDER || 'auto').trim().toLowerCase() || 'auto',
  personality: String(process.env.AUTO_REPLY_STYLE || '').trim(),
  groqModel: String(process.env.GROQ_REPLY_MODEL || 'openai/gpt-oss-20b').trim(),
  geminiModel: String(process.env.GEMINI_REPLY_MODEL || 'gemini-3.5-flash-lite').trim(),
  nvidiaModel: String(process.env.NVIDIA_REPLY_MODEL || 'openai/gpt-oss-20b').trim(),
  temperature: Number.isFinite(Number(process.env.AI_TEMPERATURE)) ? Number(process.env.AI_TEMPERATURE) : 0.82
});

let current = { ...defaults };
let loaded = false;

function sanitize(input = {}) {
  const next = {};
  if (input.aiProvider !== undefined) {
    const provider = String(input.aiProvider).trim().toLowerCase();
    if (!['auto', 'groq', 'gemini', 'nvidia'].includes(provider)) throw new Error('aiProvider must be auto, groq, gemini or nvidia');
    next.aiProvider = provider;
  }
  if (input.personality !== undefined) next.personality = String(input.personality || '').trim().slice(0, 8000);
  for (const key of ['groqModel', 'geminiModel', 'nvidiaModel']) {
    if (input[key] !== undefined) {
      const value = String(input[key] || '').trim().slice(0, 200);
      if (!value) throw new Error(`${key} cannot be empty`);
      next[key] = value;
    }
  }
  if (input.temperature !== undefined) {
    const value = Number(input.temperature);
    if (!Number.isFinite(value) || value < 0 || value > 2) throw new Error('temperature must be between 0 and 2');
    next.temperature = value;
  }
  return next;
}

export async function loadRuntimeConfig() {
  if (loaded) return { ...current };
  loaded = true;
  if (isPersistenceEnabled()) {
    try {
      const remote = await getSetting('runtime_config');
      if (remote && typeof remote === 'object') current = { ...current, ...sanitize(remote) };
      console.log(`[RuntimeConfig] Loaded from ${persistenceBackend()}.`);
    } catch (error) {
      console.warn('[RuntimeConfig] remote load failed:', error?.message || error);
    }
  }
  return { ...current };
}

export function getRuntimeConfig() {
  return { ...current };
}

export async function updateRuntimeConfig(patch) {
  const safe = sanitize(patch);
  current = { ...current, ...safe };
  if (isPersistenceEnabled()) {
    await setSetting('runtime_config', current);
  }
  return { ...current, persisted: isPersistenceEnabled(), backend: persistenceBackend() };
}

export function runtimeConfigStatus() {
  return {
    ...current,
    persistenceBackend: persistenceBackend(),
    supabaseEnabled: isSupabaseEnabled(),
    postgresEnabled: isPostgresEnabled(),
    keys: {
      groq: Boolean(process.env.GROQ_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      nvidia: Boolean(process.env.NVIDIA_API_KEY)
    }
  };
}
