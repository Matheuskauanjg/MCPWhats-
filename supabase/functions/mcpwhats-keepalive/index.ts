import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

function adminKey() {
  const legacy = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (legacy) return legacy;
  try {
    const parsed = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const values = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    const candidate = values.find((value) => typeof value === "string" && value.startsWith("sb_secret_"));
    return String(candidate || "");
  } catch {
    return "";
  }
}

async function dbFetch(path: string, init: RequestInit = {}) {
  const base = Deno.env.get("SUPABASE_URL");
  const key = adminKey();
  if (!base || !key) throw new Error("Supabase runtime admin credentials unavailable");
  const headers = new Headers(init.headers || {});
  headers.set("apikey", key);
  if (key.startsWith("eyJ")) headers.set("authorization", `Bearer ${key}`);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${base}/rest/v1/${path}`, { ...init, headers });
}

async function getSetting(key: string) {
  const response = await dbFetch(`mcpwhats_settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`);
  if (!response.ok) throw new Error(`settings lookup failed: ${response.status}`);
  const rows = await response.json();
  return rows?.[0]?.value ?? null;
}

async function writeHealth(ok: boolean, status: number | null, latencyMs: number, detail: string) {
  await dbFetch("mcpwhats_health", {
    method: "POST",
    headers: { "prefer": "return=minimal" },
    body: JSON.stringify({
      source: "supabase-keepalive",
      ok,
      status,
      latency_ms: latencyMs,
      detail: detail.slice(0, 500)
    })
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: jsonHeaders });
  }

  const expectedSecret = String(await getSetting("ping_secret") || "");
  const receivedSecret = String(req.headers.get("x-mcpwhats-ping-secret") || "");
  if (!expectedSecret || receivedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: jsonHeaders });
  }

  const renderValue = await getSetting("render_service_url");
  const renderBase = String(typeof renderValue === "string" ? renderValue : renderValue?.url || "").trim().replace(/\/$/, "");
  if (!renderBase) {
    return new Response(JSON.stringify({ ok: false, configured: false, error: "render_service_url not configured" }), {
      status: 503,
      headers: jsonHeaders
    });
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(`${renderBase}/health?source=supabase-keepalive`, {
      headers: { "user-agent": "MCPWhats-Supabase-Keepalive/1.0" },
      signal: controller.signal,
      redirect: "follow"
    });
    const latencyMs = Date.now() - started;
    await writeHealth(response.ok, response.status, latencyMs, `GET /health => ${response.status}`);
    return new Response(JSON.stringify({ ok: response.ok, status: response.status, latencyMs }), {
      status: response.ok ? 200 : 502,
      headers: jsonHeaders
    });
  } catch (error) {
    const latencyMs = Date.now() - started;
    const detail = error instanceof Error ? error.message : String(error);
    await writeHealth(false, null, latencyMs, detail);
    return new Response(JSON.stringify({ ok: false, latencyMs, error: detail }), { status: 502, headers: jsonHeaders });
  } finally {
    clearTimeout(timeout);
  }
});
