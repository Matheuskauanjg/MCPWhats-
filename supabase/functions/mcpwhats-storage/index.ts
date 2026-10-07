import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const headers = { "content-type": "application/json; charset=utf-8" };

function adminKey() {
  const legacy = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (legacy) return legacy;
  try {
    const parsed = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const values = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    return String(values.find((value) => typeof value === "string" && value.startsWith("sb_secret_")) || "");
  } catch {
    return "";
  }
}

async function dbFetch(path: string, init: RequestInit = {}) {
  const base = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const key = adminKey();
  if (!base || !key) throw new Error("Supabase runtime admin credentials unavailable");
  const requestHeaders = new Headers(init.headers || {});
  requestHeaders.set("apikey", key);
  if (key.startsWith("eyJ")) requestHeaders.set("authorization", `Bearer ${key}`);
  if (!requestHeaders.has("content-type")) requestHeaders.set("content-type", "application/json");
  return fetch(`${base}/rest/v1/${path}`, { ...init, headers: requestHeaders });
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function setting(key: string) {
  const r = await dbFetch(`mcpwhats_settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`);
  if (!r.ok) throw new Error(`settings lookup failed: ${r.status}`);
  const rows = await r.json();
  return rows?.[0]?.value ?? null;
}

async function authorize(req: Request) {
  const supplied = String(req.headers.get("x-mcpwhats-sync-secret") || "");
  if (!supplied) return false;
  const expectedHash = String(await setting("sync_secret_sha256") || "");
  return Boolean(expectedHash && (await sha256(supplied)) === expectedHash);
}

function safeText(value: unknown, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers });
  }

  try {
    if (!(await authorize(req))) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
    }

    const body = await req.json().catch(() => ({}));
    const op = safeText(body?.op, 64);

    if (op === "get_setting") {
      const key = safeText(body?.key);
      return new Response(JSON.stringify({ value: await setting(key) }), { headers });
    }

    if (op === "set_setting") {
      const key = safeText(body?.key);
      if (!key) return new Response(JSON.stringify({ error: "key required" }), { status: 400, headers });
      const r = await dbFetch("mcpwhats_settings?on_conflict=key", {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ key, value: body?.value ?? null, updated_at: new Date().toISOString() })
      });
      if (!r.ok) throw new Error(`set_setting failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    if (op === "get_state") {
      const namespace = safeText(body?.namespace);
      const key = safeText(body?.key, 2048);
      const r = await dbFetch(
        `mcpwhats_state?namespace=eq.${encodeURIComponent(namespace)}&key=eq.${encodeURIComponent(key)}&select=value&limit=1`
      );
      if (!r.ok) throw new Error(`get_state failed: ${r.status}`);
      const rows = await r.json();
      return new Response(JSON.stringify({ value: rows?.[0]?.value ?? null }), { headers });
    }

    if (op === "set_state") {
      const namespace = safeText(body?.namespace);
      const key = safeText(body?.key, 2048);
      if (!namespace || !key) return new Response(JSON.stringify({ error: "namespace and key required" }), { status: 400, headers });
      const r = await dbFetch("mcpwhats_state?on_conflict=namespace,key", {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          namespace,
          key,
          value: body?.value ?? null,
          updated_at: new Date().toISOString()
        })
      });
      if (!r.ok) throw new Error(`set_state failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    if (op === "list_state") {
      const namespace = safeText(body?.namespace);
      const limit = Math.max(1, Math.min(Number(body?.limit) || 500, 500));
      const offset = Math.max(0, Number(body?.offset) || 0);
      const r = await dbFetch(
        `mcpwhats_state?namespace=eq.${encodeURIComponent(namespace)}&select=key,value,updated_at&order=updated_at.desc&limit=${limit}&offset=${offset}`
      );
      if (!r.ok) throw new Error(`list_state failed: ${r.status}`);
      return new Response(JSON.stringify({ rows: await r.json() }), { headers });
    }

    return new Response(JSON.stringify({ error: "unknown operation" }), { status: 400, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[mcpwhats-storage]", message);
    return new Response(JSON.stringify({ error: "storage operation failed" }), { status: 500, headers });
  }
});
