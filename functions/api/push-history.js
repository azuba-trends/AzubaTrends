// functions/api/push-history.js
import { requireAdmin } from "../../lib/auth.js";
import { getDocs } from "../../lib/firestore-rest.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    await requireAdmin(request, env);
  } catch (err) {
    return json({ error: "Unauthorized." }, 401);
  }

  try {
    const rows = await getDocs(env, "push_log");
    rows.sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));
    return json({ ok: true, rows: rows.slice(0, 50) });
  } catch (err) {
    console.error(err);
    return json({ error: "Couldn't load notification history." }, 500);
  }
}
