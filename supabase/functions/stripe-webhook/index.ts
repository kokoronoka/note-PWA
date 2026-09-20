// Receives Stripe events and mirrors subscription state into public.profiles.
// Deploy with --no-verify-jwt: Stripe authenticates via its signature header,
// not a Supabase JWT.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO, STRIPE_PRICE_BUSINESS
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const TIER_BY_PRICE: Record<string, 'pro' | 'business'> = {};
const proPrice = Deno.env.get('STRIPE_PRICE_PRO');
const businessPrice = Deno.env.get('STRIPE_PRICE_BUSINESS');
if (proPrice) TIER_BY_PRICE[proPrice] = 'pro';
if (businessPrice) TIER_BY_PRICE[businessPrice] = 'business';

// past_due keeps access while Stripe retries the card; everything else
// (canceled, unpaid, incomplete, incomplete_expired, paused) drops to free.
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due']);

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

// Always re-fetches the subscription rather than trusting the event payload:
// Stripe doesn't guarantee delivery order, so an older "updated" event
// arriving after a "deleted" one must not resurrect a canceled plan.
async function syncSubscription(subscriptionId: string, fallbackUserId?: string | null) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId = idOf(sub.customer)!;
  const item = sub.items.data[0];
  const priceId = item?.price?.id;
  const knownTier = priceId ? TIER_BY_PRICE[priceId] : undefined;
  if (priceId && !knownTier) console.warn(`Unmapped price ${priceId} on ${sub.id}`);

  const entitled = ENTITLED_STATUSES.has(sub.status) && !!knownTier;
  // current_period_end lives on the item in newer Stripe API versions.
  const periodEnd = (item as { current_period_end?: number })?.current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end;

  const update = {
    subscription_tier: entitled ? knownTier : 'free',
    subscription_status: sub.status,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const userId = sub.metadata?.supabase_user_id || fallbackUserId;
  const query = userId
    ? admin.from('profiles').update(update).eq('id', userId)
    : admin.from('profiles').update(update).eq('stripe_customer_id', customerId);

  const { data, error } = await query.select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    // Throwing makes Stripe retry, which covers a profile row that doesn't exist yet.
    throw new Error(`No profile matched subscription ${sub.id} (user ${userId ?? '?'}, customer ${customerId})`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const signature = req.headers.get('Stripe-Signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  // Must be the raw body — re-serialized JSON would fail signature verification.
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', (err as Error).message);
    return new Response('Invalid signature', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const subId = idOf(session.subscription as string | Stripe.Subscription | null);
        if (session.mode === 'subscription' && subId) {
          await syncSubscription(subId, session.client_reference_id);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object.id);
        break;
      case 'invoice.payment_failed':
      case 'invoice.paid': {
        const invoice = event.data.object as unknown as {
          subscription?: string | { id: string } | null;
          parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
        };
        const subId = idOf(invoice.subscription) ?? idOf(invoice.parent?.subscription_details?.subscription);
        if (subId) await syncSubscription(subId);
        break;
      }
      default:
        break;
    }
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`Failed handling ${event.type} (${event.id}):`, err);
    return new Response('Webhook handler failed', { status: 500 });
  }
});
