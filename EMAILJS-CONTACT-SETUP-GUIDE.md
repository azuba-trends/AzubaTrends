# Contact Form & Support Reply — EmailJS Setup Guide

You already have EmailJS wired up for checkout order emails. This adds
**two more templates** to the same EmailJS account — no new account, no new
backend. Total time: ~10 minutes.

---

## What you're setting up

| Template | Sent to | Sent when |
|---|---|---|
| **Contact Form Template** | You (admin) | A customer submits the Contact Us form |
| **Support Reply Template** | The customer | You click "Send Reply" on a ticket in Admin Panel → Support Tickets |

Even if you skip this entirely, **nothing is lost** — every Contact Us
submission is always saved as a ticket in Admin Panel → Support Tickets
and pinged to you on Telegram. These two templates just add email on top.

---

## Step 1 — Create the Contact Form template (emails you)

1. Go to [dashboard.emailjs.com](https://dashboard.emailjs.com) → **Email Templates** → **Create New Template**.
2. Name it something like `contact_form_to_admin`.
3. Set the **To email** field to your own inbox: `azubatrends@gmail.com`
4. Set **From name** to `{{from_name}}` and **Reply To** to `{{from_email}}` — this way, hitting "Reply" in Gmail replies straight to the customer, not to yourself.
5. Subject line, e.g.:
   ```
   New Contact Message: {{subject}}
   ```
6. Body, e.g.:
   ```
   New message from the AzubaTrends Contact Us form.

   Name: {{from_name}}
   Email: {{from_email}}
   Subject: {{subject}}

   Message:
   {{message}}

   ---
   Reply to this ticket from Admin Panel → Support Tickets.
   ```
7. Save the template, then copy its **Template ID** (looks like `template_abc123`).

## Step 2 — Create the Support Reply template (emails the customer)

1. **Create New Template** again.
2. Name it `support_reply_to_customer`.
3. Set **To email** to `{{to_email}}` (this will be filled with the customer's email automatically).
4. Set **From name** to `AzubaTrends Support` and **Reply To** to `azubatrends@gmail.com`.
5. Subject line, e.g.:
   ```
   Re: {{subject}} — AzubaTrends Support
   ```
6. Body, e.g.:
   ```
   Hi {{customer_name}},

   {{reply_message}}

   ---
   Your original message:
   {{original_message}}

   — AzubaTrends Support
   ```
7. Save, then copy its **Template ID**.

---

## Step 3 — Paste both Template IDs into the Admin Panel

1. Open **Admin Panel → Settings → Account** (same tab where your existing EmailJS Public Key / Service ID / Order templates already live).
2. Paste the Step 1 ID into **Contact Form Template ID**.
3. Paste the Step 2 ID into **Support Reply Template ID**.
4. Click **Save**.

That's it — no code changes needed. The site already has the public key
and service ID you set up earlier for order emails; these two templates
just reuse the same EmailJS account.

---

## How to test

1. Go to `/contact` on your live site, submit a test message.
   - You should see it appear instantly in **Admin Panel → Support Tickets → Open**.
   - Within a few seconds, an email should land in `azubatrends@gmail.com` (Step 1 template).
   - A Telegram alert should also fire (if Telegram is already connected).
2. Open that ticket in Support Tickets, type a reply, click **Send Reply**.
   - The reply is saved into the ticket thread either way.
   - If Step 2 is configured correctly, the customer's email inbox should receive your reply within a few seconds.

If the email doesn't arrive but the ticket/reply still saved correctly,
it just means a Template ID is missing or mistyped in Settings — nothing
is broken, no messages are lost, and you can fix the template ID any time.

---

## Note on your EmailJS free-tier limit

EmailJS's free plan caps you at **200 emails/month** across *all*
templates combined (order confirmations + status updates + these two new
ones). If you're already close to that limit from order emails, keep an
eye on your EmailJS dashboard usage — Support Tickets themselves have no
such limit since they're stored directly in Firestore either way.
