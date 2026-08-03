// functions/api/submit-contact.js
//
// Backs the Contact Us form (contact.html / js/contact-form.js). Same
// shape as api/submit-review.js and api/notify-stock.js: guests can
// never write the `contactTickets` collection directly from the browser
// (see firestore.rules) — this is the only path in, using server-side
// Firestore REST calls, so the honeypot + rate-limit below can't be
// bypassed by hitting Firestore directly from DevTools.
//
// What this does, in order:
//   1. Validate + sanitize the submitted fields.
//   2. Rate-limit by IP (same atomic increment() pattern as notify-stock.js).
//   3. Create a ticket doc in `contactTickets` (status: "open") — this is
//      what shows up in Admin Panel > Support Tickets.
//   4. Fire a Telegram alert (best-effort, never blocks the response).
//   5. Return { ok: true, id } so the browser can also fire its own
//      EmailJS email straight to the store owner's inbox (see
//      js/contact-form.js) — EmailJS only runs client-side, so it can't
//      be triggered from here.

import { createDoc, runTransaction, increment } from "../../lib/firestore-rest.js";
import { dispatchTelegramEvent } from "../../lib/telegram.js";

const MAX_REQUESTS_PER_IP_PER_DAY = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_SUBJECTS = ["General Query", "Order Related", "Payment Related", "Refund / Return", "Copyright / Product Issue", "Other"];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function getClientIp(request) {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function checkAndIncrementRateLimit(env, ip) {
  const today = new Date().toISOString().slice(0, 10);
  const ipHash = await sha256Hex(String(ip));
  const path = `contact_rate_limits/${ipHash.slice(0, 24)}_${today}`;

  return runTransaction(env, async (tx) => {
    const snap = await tx.get(path);
    const current = snap ? Number(snap.count || 0) : 0;
    if (current >= MAX_REQUESTS_PER_IP_PER_DAY) return { allowed: false };
    await tx.update(path, { count: increment(1), lastSubmittedAt: new Date().toISOString() });
    return { allowed: true };
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    const { name, email, subject, customSubject, message, website } = body || {};

    // Honeypot — a real visitor never fills this field in. Silently
    // "succeed" so a bot isn't tipped off that it was caught.
    if (website) return json({ ok: true });

    const trimmedName = String(name || "").trim().slice(0, 100);
    if (!trimmedName) {
      return json({ error: "Please enter your name." }, 400);
    }

    const trimmedEmail = String(email || "").trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      return json({ error: "Please enter a valid email address." }, 400);
    }

    let finalSubject = String(subject || "").trim();
    if (!ALLOWED_SUBJECTS.includes(finalSubject)) {
      return json({ error: "Please select a valid subject." }, 400);
    }
    if (finalSubject === "Other") {
      const custom = String(customSubject || "").trim().slice(0, 150);
      if (!custom) {
        return json({ error: "Please describe your subject." }, 400);
      }
      finalSubject = custom;
    }

    const trimmedMessage = String(message || "").trim();
    if (trimmedMessage.length < 5) {
      return json({ error: "Please write a message (at least a few words)." }, 400);
    }
    if (trimmedMessage.length > 5000) {
      return json({ error: "Message is too long (max 5000 characters)." }, 400);
    }

    const ip = getClientIp(request);
    const { allowed } = await checkAndIncrementRateLimit(env, ip);
    if (!allowed) {
      return json({ error: "Too many messages sent from this device today. Please try again tomorrow." }, 429);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await createDoc(env, "contactTickets", id, {
      name: trimmedName,
      email: trimmedEmail.toLowerCase(),
      subject: finalSubject,
      message: trimmedMessage,
      status: "open",
      replies: [],
      createdAt: now,
      updatedAt: now
    });

    // Best-effort — never blocks the response, ticket is already saved.
    const host = request.headers.get("host");
    await dispatchTelegramEvent(env, "new_contact_ticket", {
      ticketId: id,
      name: trimmedName,
      email: trimmedEmail,
      subject: finalSubject,
      message: trimmedMessage,
      adminUrl: host ? `https://${host}/admin#store-support-tickets` : null
    });

    return json({ ok: true, id });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
