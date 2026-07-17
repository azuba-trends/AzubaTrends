# Service Account Setup Guide (one-time, ~10 minutes)

This is the ONE thing you need to do manually in Firebase + Vercel dashboards
before Telegram notifications (and stock auto-decrement) will work. Nothing
in the Admin Panel can do this step for you — it's account-level access, not
data, so it has to be set up outside the app once.

## Why this is needed

Telegram bot tokens are stored in Firestore's `telegram_bots` collection,
which is locked to admin-only access (see firestore.rules). Your serverless
functions (`api/place-order.js`, `api/telegram-notify.js`,
`api/cron-daily-digest.js`) run on Vercel with nobody logged in — they need a
way to read that admin-only collection anyway. A **service account** is
Firebase's way of giving a specific piece of server code full trusted access,
bypassing the normal security rules entirely. It's the correct way to do
this — much safer than making bot tokens publicly readable.

---

## Step 1 — Generate the service account key (Firebase Console)

1. Go to https://console.firebase.google.com and open your **AzubaTrends**
   project (`azubatrends-32349`).
2. Click the **gear icon** (top-left, next to "Project Overview") →
   **Project settings**.
3. Go to the **Service accounts** tab.
4. You'll see "Firebase Admin SDK" already selected. Click
   **Generate new private key**.
5. A confirmation popup appears — click **Generate key**.
6. A `.json` file downloads automatically (something like
   `azubatrends-32349-firebase-adminsdk-xxxxx.json`). **Keep this file
   private — do not commit it to GitHub, do not share it, do not upload it
   anywhere public.** Anyone with this file has full admin access to your
   entire Firestore database.

## Step 2 — Convert it to a single-line value

The downloaded file is JSON with real line breaks in it, which environment
variables don't handle well. Convert it to base64 (a safe single-line
string) using ONE of these:

**On Windows (PowerShell):**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\your-downloaded-file.json")) | Set-Clipboard
```
This copies the base64 value straight to your clipboard.

**On Mac/Linux (Terminal):**
```bash
base64 -i /path/to/your-downloaded-file.json | tr -d '\n' | pbcopy
```
(On Linux, replace `pbcopy` with `xclip -selection clipboard` if you have
`xclip` installed, or just drop the pipe and copy the printed output
manually.)

**No terminal handy?** Any online "file to base64" converter works too
(search "base64 encode file online") — just don't use one that stores your
file, and delete the result from that site's history afterward if it keeps
one. When in doubt, prefer the PowerShell/Terminal method above since it
never leaves your computer.

## Step 3 — Add it to Vercel as an environment variable

1. Go to https://vercel.com/dashboard → open your **AzubaTrends** project.
2. Go to **Settings → Environment Variables**.
3. Add a new variable:
   - **Key**: `FIREBASE_SERVICE_ACCOUNT_KEY`
   - **Value**: paste the base64 string from Step 2
   - **Environments**: check all three — Production, Preview, Development
4. Click **Save**.

## Step 4 — Add the two other env vars this update needs

While you're there, add these two as well (both are just secrets you make up
yourself — any random string works):

- **Key**: `TELEGRAM_NOTIFY_API_KEY`
  **Value**: any random string you make up, e.g. `azuba-tg-8f3a91c2` — this
  is a lightweight abuse-throttle for the notify endpoint (so random
  strangers on the internet can't spam your Telegram group through it), not
  a high-security secret. Generate one however you like.

- **Key**: `CRON_SECRET`
  **Value**: leave this one — **Vercel sets it automatically** once you add
  a `crons` entry to `vercel.json` and redeploy. You don't need to create it
  yourself; it'll just appear in your Environment Variables list after the
  first deploy with cron jobs configured. Only add it manually if for some
  reason it isn't there after deploying.

## Step 5 — Redeploy

Environment variable changes only take effect on a **new deployment**. Push
any commit (even a trivial one), or in Vercel go to **Deployments → (latest)
→ ⋯ → Redeploy**.

## Step 6 — Verify it worked

Once redeployed:
1. Go to Admin Panel → Settings → **Telegram Integration** (new tab).
2. Add a bot (name + token + chat ID), click **Test**.
3. If you get a ✅ success message and a real Telegram message shows up in
   your chat/group, the service account is working correctly.
4. If you get an error mentioning "FIREBASE_SERVICE_ACCOUNT_KEY" — the env
   var either wasn't saved correctly (re-check Step 3) or you haven't
   redeployed since adding it (repeat Step 5).

---

## Getting a Telegram Bot Token + Chat ID (if you don't have these yet)

1. Open Telegram, search for **@BotFather**, start a chat.
2. Send `/newbot`, follow the prompts (give it a name + a username ending in
   `bot`). BotFather replies with your **token** — looks like
   `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.
3. Create a Telegram **group** (or use an existing one), add your new bot to
   it as a member.
4. Send any message in that group (e.g. "hi").
5. In the Admin Panel's Telegram Integration tab, paste the token, click
   **Fetch Chat ID** — it'll read the group's ID automatically from that
   message you just sent. (If it comes back empty, send another message in
   the group and try Fetch again — Telegram only remembers recent messages
   for this.)

If you want order notifications and stock alerts in different chats, create
a second bot (or reuse the same bot token, just enter it again as a
different bot entry with a different Chat ID) and pick different events for
each — the Telegram Integration tab lets you choose per bot which events it
should receive.
