// functions/api/next-email-account.js
//
// Picks WHICH configured EmailJS account (see Settings > Email) the
// browser should send a given email through, round-robining across every
// enabled account that has a template set for that purpose — so if the
// admin adds several free EmailJS accounts (200 emails/month each), load
// spreads evenly instead of one account hitting its cap while the others
// sit unused.
//
// EmailJS sends happen entirely client-side (see js/emailjs-integration.js's
// big comment on why — no backend, no real secret to protect here; the
// keys returned below are exactly as "public" as SITE_CONFIG.emailjs
// already was). This endpoint's ONLY job is fairness: which of possibly
// several equally-valid accounts gets used THIS time. That needs a
// server-side counter because two different customers' browsers placing
// orders seconds apart have no way to coordinate "whose turn is it" on
// their own — this is the shared, persistent tie-breaker.
//
// `purpose` must be one of the 5 keys under an account's `templates`
// object (see js/admin.js's Settings > Email UI): newOrderAdmin,
// customerOrderConfirm, orderStatusUpdate, contactForm, supportReply.
// Only accounts with `enabled: true` AND a non-blank template for that
// exact purpose are eligible — that's how "which accounts handle which
// purpose" is decided, no separate tagging needed beyond filling in the
// field.

import { getDoc, runTransaction, increment } from "../../lib/firestore-rest.js";

const VALID_PURPOSES = ["newOrderAdmin", "customerOrderConfirm", "orderStatusUpdate", "contactForm", "supportReply"];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Invalid request body." }, 400);
  }

  try {
    const { purpose, excludeIds } = body || {};
    if (!VALID_PURPOSES.includes(purpose)) {
      return json({ error: "Unknown or missing 'purpose'." }, 400);
    }
    const exclude = new Set(Array.isArray(excludeIds) ? excludeIds : []);

    const settingsDoc = await getDoc(env, "settings/store_config");
    const accounts = (settingsDoc && Array.isArray(settingsDoc.emailAccounts)) ? settingsDoc.emailAccounts : [];

    const eligible = accounts.filter((a) =>
      a && a.enabled !== false && a.templates && a.templates[purpose] && !exclude.has(a.id)
    );

    if (eligible.length === 0) {
      return json({ error: `No enabled email account has a template configured for "${purpose}".` }, 404);
    }

    // Rotate — a single doc with one counter field per purpose, updated
    // via a real Firestore transaction so two near-simultaneous requests
    // for the same purpose still land on different accounts instead of a
    // race both picking index 0.
    const nextIndex = await runTransaction(env, async (tx) => {
      const rotationDoc = await tx.get("settings/email_rotation");
      const current = (rotationDoc && Number.isFinite(Number(rotationDoc[purpose]))) ? Number(rotationDoc[purpose]) : 0;
      tx.update("settings/email_rotation", { [purpose]: increment(1) });
      return current;
    });

    const picked = eligible[nextIndex % eligible.length];
    return json({
      ok: true,
      accountId: picked.id,
      publicKey: picked.publicKey,
      serviceId: picked.serviceId,
      templateId: picked.templates[purpose]
    });
  } catch (err) {
    console.error(err);
    return json({ error: "Couldn't pick an email account. Please try again." }, 500);
  }
}
