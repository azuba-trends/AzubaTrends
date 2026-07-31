// functions/api/cron-daily-digest.js
//
// Runs once a day. Originally triggered by Vercel's Hobby-plan cron
// (see vercel.json -> crons, and SERVICE-ACCOUNT-SETUP-GUIDE.md /
// CHANGELOG-updates.md), which only allows once-per-day schedules on the
// free plan. That's why the three related things this checks are combined
// into ONE job instead of three separate more-frequent ones: a real-time
// "this UPI order has been pending 30 minutes" reminder isn't possible on
// a once-daily schedule, so this gives a once-daily rollup instead, which
// still catches anything that slipped through.
//
// *** IMPORTANT — CLOUDFLARE CRON DESIGN NOTE ***
// Cloudflare Pages Functions (this file/folder) do NOT support Cron
// Triggers the way a plain Cloudflare Worker does — there is no
// `[triggers] crons = [...]` equivalent for a Pages Functions project.
// This file is only reachable as a normal HTTP endpoint; something
// EXTERNAL to this Pages project has to call it once a day. See
// REPORT.md for the full write-up of the options and the recommendation
// — the short version is: a small separate Cloudflare Worker with its own
// Cron Trigger, that does nothing but `fetch()` this URL with the
// `Authorization: Bearer <CRON_SECRET>` header. The Manager needs to wire
// that piece up; it isn't something this Pages project can do by itself.
//
// This still checks the same secret the Vercel version did (previously
// auto-set by Vercel Cron as CRON_SECRET; on Cloudflare it needs to be set
// manually as a Pages environment variable/secret, and whatever calls this
// URL — the Worker or the external cron service — needs to be configured
// to send it).

import { getDocs } from "../../lib/firestore-rest.js";
import { dispatchTelegramEvent } from "../../lib/telegram.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export async function onRequestGet(context) {
  return handle(context);
}

export async function onRequestPost(context) {
  return handle(context);
}

async function handle({ request, env }) {
  // Whatever calls this (a Cron-Trigger Worker, or an external cron
  // service) sends this the same way Vercel Cron used to.
  const auth = request.headers.get("authorization");
  if (env.CRON_SECRET && auth !== `Bearer ${env.CRON_SECRET}`) {
    return json({ error: "Unauthorized." }, 401);
  }

  try {
    const today = todayString();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const orders = await getDocs(env, "orders");
    let ordersToday = 0;
    let revenueToday = 0;
    const pendingUpiOrders = [];

    for (const o of orders || []) {
      const createdAt = o.createdAt ? new Date(o.createdAt) : null;
      if (createdAt && createdAt >= startOfToday && o.status !== "Cancelled") {
        ordersToday += 1;
        revenueToday += Number(o.finalTotal) || 0;
      }
      // Any UPI order still "Pending" regardless of when it was placed —
      // catches ones that slipped through past midnight too.
      if (o.paymentMethod === "UPI" && o.status === "Pending") {
        pendingUpiOrders.push({ orderId: o.orderId, finalTotal: o.finalTotal, paymentScreenshotUrl: o.paymentScreenshotUrl, autoPlaced: o.autoPlaced });
      }
    }

    const coupons = await getDocs(env, "coupons");
    const in2Days = new Date();
    in2Days.setDate(in2Days.getDate() + 2);
    const in2DaysStr = `${in2Days.getFullYear()}-${String(in2Days.getMonth() + 1).padStart(2, "0")}-${String(in2Days.getDate()).padStart(2, "0")}`;
    const couponsExpiringSoon = [];
    for (const c of coupons || []) {
      if (c.active && c.expiryDate && c.expiryDate >= today && c.expiryDate <= in2DaysStr) {
        couponsExpiringSoon.push({ code: c.code, expiryDate: c.expiryDate });
      }
    }

    const results = await dispatchTelegramEvent(env, "daily_digest", {
      date: today,
      ordersToday,
      revenueToday,
      pendingUpiOrders,
      couponsExpiringSoon
    });

    return json({ ok: true, ordersToday, revenueToday, pendingUpiCount: pendingUpiOrders.length, results });
  } catch (err) {
    console.error("cron-daily-digest failed:", err.message);
    // Return 200 even on internal failure, same as the Vercel version —
    // whatever's calling this on a schedule shouldn't log a hard failure
    // for something that isn't actionable (e.g. service account not set
    // up yet during initial setup).
    return json({ ok: false, error: err.message });
  }
}
