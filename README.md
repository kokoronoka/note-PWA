# Welovenote

A note-taking PWA for writing and drawing. Offline-first, syncs across devices,
installable on desktop and mobile.

**Live:** https://kokoronoka.github.io/note-PWA/

---

## Project status

| Area | State |
|---|---|
| Notes, drawing, folders, export | Shipped |
| Cloud sync + realtime | Shipped |
| Auth (email, Google, guest) | Shipped |
| Subscription billing (Phase A) | Code complete — **external setup pending** |
| Feature gating (Phase B) | Not started |
| AI / sharing / collaboration (Phase C) | Not started |

Nothing is gated yet. Free and paid users currently get identical features,
which is intentional until billing is proven working end to end.

---

## Features

**Notes**
- Ink and text modes, switchable per note
- Pen, eraser, hand tools with stylus pressure support
- Pinch zoom, pan, undo
- Search, autosave

**Organisation**
- Folders with rename, delete, and move-note-into
- "All Folders" grid overview
- Notes fall back to unfoldered when their folder is deleted

**Sync**
- Supabase Postgres with row-level security
- Realtime updates across signed-in devices
- Offline queues for pending creates and deletes, flushed on reconnect
- Reconciliation so a local note is never lost to a sync race
- Clock-skew detection and RLS error recovery

**Accounts**
- Email/password and Google sign-in
- Guest mode — full local-only use with no account
- Local notes migrate into the account on first sign-in

**Export**
- TXT, PNG, and PDF

**PWA**
- Installable, offline-capable, network-first for code and cache-first for assets

---

## Architecture

The entire app is one file. This is deliberate: it removes a whole class of
stale-cache bugs where a separate `.js` file could be served from an old
service worker cache while `index.html` had moved on.

```
index.html       Everything — markup, styles, and all app logic
supabase.js      Project URL and publishable key
sw.js            Service worker (cache v6)
manifest.json    PWA manifest
setup.sql        Database schema — run manually in the Supabase SQL editor
supabase/functions/
  create-checkout-session/   Starts Stripe Checkout for the signed-in user
  stripe-webhook/            Mirrors subscription state into profiles
  _shared/cors.ts
```

Both Supabase keys in `supabase.js` are meant to be public. Row-level security
is what protects the data, not key secrecy.

---

## Subscription tiers (planned)

| | Free | Pro | Business |
|---|---|---|---|
| Notes, drawing, folders, TXT/PNG export | Yes | Yes | Yes |
| PDF export | No | Yes | Yes |
| Cloud sync | No | Yes | Yes |
| Templates, handwriting to text | Limited | Yes | Yes |
| AI summary and mind map | No | Yes | Yes |
| Sharing, version history | No | Yes | Yes |
| Collaboration, team folders | No | No | Yes |

---

## Billing setup (required before any payment works)

The code is committed but inert until these are done. The Upgrade button will
fail without them.

1. **Stripe** — create Pro and Business products with monthly prices in test
   mode, and copy both price IDs.
2. **Database** — run the subscriptions section at the bottom of `setup.sql`
   in the Supabase SQL editor.
3. **Secrets:**
   ```
   supabase secrets set STRIPE_SECRET_KEY=sk_test_... \
     STRIPE_PRICE_PRO=price_... STRIPE_PRICE_BUSINESS=price_... \
     ALLOWED_RETURN_URLS="https://kokoronoka.github.io/note-PWA/,http://localhost:8000/"
   ```
4. **Deploy:**
   ```
   supabase functions deploy create-checkout-session
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
   The webhook needs `--no-verify-jwt` because Stripe authenticates with its
   own signature, not a Supabase token.
5. **Webhook** — point Stripe at
   `https://dcufzmecjdnjymgksvmh.supabase.co/functions/v1/stripe-webhook`
   and subscribe it to `checkout.session.completed`,
   `customer.subscription.created` / `.updated` / `.deleted`,
   `invoice.paid`, and `invoice.payment_failed`. Then:
   ```
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```
6. **Test** — pay with card `4242 4242 4242 4242` and confirm the sidebar badge
   flips to Pro.

### How billing is kept safe

- `subscription_tier` is readable by its owner but writable only by the service
  role. RLS plus a `REVOKE` mean the browser cannot grant itself Pro.
- Prices are resolved server-side; the client only names a plan.
- Checkout return URLs are validated against an allowlist, so a paying user
  cannot be redirected somewhere forged.
- The webhook re-fetches the subscription from Stripe instead of trusting the
  event payload, because Stripe does not guarantee delivery order — a late
  "updated" event must not revive a canceled plan.

---

## Roadmap

**Phase B — gate what already exists**
- Decide the final free/Pro split (the table above puts cloud sync behind Pro,
  which meaningfully changes the free tier — confirm before shipping)
- Gate cloud sync and PDF export
- Upgrade modal and pricing page
- Stripe customer portal so subscribers can cancel or change plan
- Add a Business purchase button (the price exists; only Pro is buyable today)

**Phase C — one feature at a time, driven by real demand**
Easiest to hardest: version history, sharing, templates, AI summary, AI mind
map, handwriting to text, team folders, collaboration.

Do not start Phase C until Phase A and B work end to end. The AI and OCR
features carry ongoing per-use costs and should be funded by real revenue.

---

## Development

No build step. Open `index.html` directly, or serve it for service worker
testing (service workers do not register on `file://`):

```
python3 -m http.server 8000
```

`npm install` restores the Supabase CLI. `node_modules/` is gitignored.

### Known loose ends
- Leftover debug logging: `sw.js:66` and `index.html:2458`, both from
  since-fixed bugs
- Business tier is not purchasable yet
