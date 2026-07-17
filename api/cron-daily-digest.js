// api/cron-daily-digest.js
//
// Runs once a day (see vercel.json -> crons). Vercel's Hobby (free) plan
// only allows cron jobs to run once per day — see the note in
// SERVICE-ACCOUNT-SETUP-GUIDE.md and CHANGELOG-updates.md. That's why the
// three related things this checks are combined into ONE job instead of
// three separate more-frequent ones: a real-time "this UPI order has been
// pending 30 minutes" reminder isn't possible on the free plan, so this
// gives you a once-daily rollup instead, which still catches anything that
// slipped through.
//
// Vercel automatically protects cron routes with a CRON_SECRET it sets
// for you — this checks it so nobody else can trigger your Telegram
// messages by just visiting this URL.

import { getDb } from "../lib/firebase-admin.js";
import { dispatchTelegramEvent } from "../lib/telegram.js";

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default async function handler(req, res) {
  // Vercel sends this header automatically for cron-triggered requests.
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const db = getDb();
    const today = todayString();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const ordersSnap = await db.collection("orders").get();
    let ordersToday = 0;
    let revenueToday = 0;
    const pendingUpiOrders = [];

    ordersSnap.forEach((doc) => {
      const o = doc.data();
      const createdAt = o.createdAt ? new Date(o.createdAt) : null;
      if (createdAt && createdAt >= startOfToday && o.status !== "Cancelled") {
        ordersToday += 1;
        revenueToday += Number(o.finalTotal) || 0;
      }
      // Any UPI order still "Pending" regardless of when it was placed —
      // catches ones that slipped through past midnight too.
      if (o.paymentMethod === "UPI" && o.status === "Pending") {
        pendingUpiOrders.push({ orderId: o.orderId, finalTotal: o.finalTotal, upiTxnRef: o.upiTxnRef });
      }
    });

    const couponsSnap = await db.collection("coupons").get();
    const in2Days = new Date();
    in2Days.setDate(in2Days.getDate() + 2);
    const in2DaysStr = `${in2Days.getFullYear()}-${String(in2Days.getMonth() + 1).padStart(2, "0")}-${String(in2Days.getDate()).padStart(2, "0")}`;
    const couponsExpiringSoon = [];
    couponsSnap.forEach((doc) => {
      const c = doc.data();
      if (c.active && c.expiryDate && c.expiryDate >= today && c.expiryDate <= in2DaysStr) {
        couponsExpiringSoon.push({ code: c.code, expiryDate: c.expiryDate });
      }
    });

    const results = await dispatchTelegramEvent(db, "daily_digest", {
      date: today,
      ordersToday,
      revenueToday,
      pendingUpiOrders,
      couponsExpiringSoon
    });

    return res.status(200).json({ ok: true, ordersToday, revenueToday, pendingUpiCount: pendingUpiOrders.length, results });
  } catch (err) {
    console.error("cron-daily-digest failed:", err.message);
    // Cron jobs should return 200 even on internal failure, otherwise
    // Vercel logs it as a failed invocation for something that isn't
    // actionable (e.g. service account not set up yet during initial setup).
    return res.status(200).json({ ok: false, error: err.message });
  }
}
