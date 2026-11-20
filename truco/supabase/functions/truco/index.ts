// Edge Function: API do truco. Todo o estado fica na tabela truco_rooms (sem
// acesso público); os jogadores só enxergam o que viewFor() devolve.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleRequest } from "./game.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const store = {
  async get(code: string) {
    const { data, error } = await db.from("truco_rooms").select("state, version").eq("code", code).maybeSingle();
    if (error) throw error;
    return data;
  },
  async insert(code: string, state: { v: number }) {
    // Aproveita a criação de sala para limpar as salas abandonadas.
    await db.from("truco_rooms").delete().lt("updated_at", new Date(Date.now() - 2 * 86400e3).toISOString());
    const { error } = await db.from("truco_rooms").insert({ code, state, version: state.v });
    if (error?.code === "23505") return false;
    if (error) throw error;
    return true;
  },
  async update(code: string, state: { v: number }, expected: number) {
    const { data, error } = await db.from("truco_rooms")
      .update({ state, version: state.v, updated_at: new Date().toISOString() })
      .eq("code", code).eq("version", expected).select("code");
    if (error) throw error;
    return data.length === 1;
  },
};

// Avisa os jogadores da sala que o estado mudou (sem dados do jogo).
async function notify(code: string, v: number) {
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ messages: [{ topic: `truco-${code}`, event: "u", payload: { v } }] }),
    });
  } catch (_) { /* os clientes também fazem polling */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);
  try {
    const body = await req.json().catch(() => null);
    const res = await handleRequest(body, store);
    if (res.changed) await notify(res.code, res.state.v);
    return json(res);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: "Erro no servidor" }, 500);
  }
});
