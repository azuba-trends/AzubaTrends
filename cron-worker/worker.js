// cron-worker/worker.js
//
// A tiny, separate Cloudflare Worker whose ONLY job is: once a day, call
// your Pages site's /api/cron-daily-digest endpoint.
//
// WHY THIS SEPARATE WORKER EXISTS
// Cloudflare Pages Functions (the functions/ folder in the main project)
// cannot have a Cron Trigger — there's no [triggers] crons = [...]
// equivalent for a Pages project. Only a plain Cloudflare Worker (like
// this one) can have a Cron Trigger. So this worker does nothing except
// wake up once a day and fetch your real endpoint with the shared secret
// — all the actual digest logic still lives in
// functions/api/cron-daily-digest.js on the main site, unchanged.
//
// SETUP (one-time)
// 1. Deploy this worker:
//      cd cron-worker
//      npx wrangler deploy
// 2. Set two secrets on THIS worker (not the Pages project):
//      npx wrangler secret put SITE_URL
//        -> paste your live site's origin, e.g. https://azubatrends.pages.dev
//           (or your custom domain once you attach one)
//      npx wrangler secret put CRON_SECRET
//        -> paste the SAME value you already set (or are about to set) as
//           CRON_SECRET on the Pages project itself (Pages -> Settings ->
//           Environment variables). They must match exactly — this
//           worker sends it, cron-daily-digest.js checks it.
// 3. That's it. wrangler.toml below already schedules this for 03:00 UTC
//    daily (adjust the cron expression if you want a different time —
//    Cloudflare Cron Triggers use UTC).
//
// To test it fires correctly without waiting for the schedule, you can
// manually curl the live endpoint yourself:
//   curl -H "Authorization: Bearer <your CRON_SECRET>" \
//        https://azubatrends.pages.dev/api/cron-daily-digest

export default {
  async scheduled(event, env, ctx) {
    const siteUrl = env.SITE_URL;
    const cronSecret = env.CRON_SECRET;

    if (!siteUrl || !cronSecret) {
      console.error("cron-worker: missing SITE_URL or CRON_SECRET secret — nothing to call.");
      return;
    }

    const target = `${siteUrl.replace(/\/$/, "")}/api/cron-daily-digest`;

    try {
      const resp = await fetch(target, {
        method: "GET",
        headers: { Authorization: `Bearer ${cronSecret}` }
      });
      const bodyText = await resp.text();
      if (!resp.ok) {
        console.error(`cron-worker: digest call failed (${resp.status}): ${bodyText}`);
      } else {
        console.log(`cron-worker: digest call OK: ${bodyText}`);
      }
    } catch (err) {
      console.error("cron-worker: digest call threw:", err.message);
    }
  },

  // Lets you hit this worker's own URL directly (GET) to trigger the same
  // logic on demand, for testing — without waiting for the 03:00 UTC
  // schedule. Not required for the cron itself to work.
  async fetch(request, env, ctx) {
    await this.scheduled(null, env, ctx);
    return new Response("Triggered the daily digest call manually. Check this worker's logs (wrangler tail) for the result.");
  }
};
