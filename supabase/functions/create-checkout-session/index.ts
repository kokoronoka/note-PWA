// Creates a Stripe Checkout session for the signed-in caller.
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_BUSINESS, ALLOWED_RETURN_URLS
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.)
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  httpClient: Stripe.createFetchHttpClient(),
});

const PRICE_BY_PLAN: Record<string, string | undefined> = {
  pro: Deno.env.get('STRIPE_PRICE_PRO'),
  business: Deno.env.get('STRIPE_PRICE_BUSINESS'),
};

// Comma-separated prefixes, e.g. "https://you.github.io/note-PWA/,http://localhost:8000/".
// The client's returnUrl must start with one of these — otherwise Checkout
// would happily redirect a paying user to any URL an attacker supplied.
const ALLOWED_RETURN_URLS = (Deno.env.get('ALLOWED_RETURN_URLS') ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Not signed in' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Not signed in' }, 401);

    const { plan, returnUrl } = await req.json().catch(() => ({}));
    const price = PRICE_BY_PLAN[plan];
    if (!price) return json({ error: 'Unknown plan' }, 400);
    if (typeof returnUrl !== 'string' || !ALLOWED_RETURN_URLS.some(p => returnUrl.startsWith(p))) {
      return json({ error: 'Return URL not allowed' }, 400);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('subscription_tier, stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    // Blocks a second parallel subscription; plan changes belong in the
    // Stripe customer portal (Phase B), not a new Checkout.
    if (profile && profile.subscription_tier !== 'free') {
      return json({ error: 'You already have an active subscription' }, 409);
    }

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      const { error: upsertError } = await admin
        .from('profiles')
        .upsert({ id: user.id, stripe_customer_id: customerId, updated_at: new Date().toISOString() });
      if (upsertError) throw upsertError;
    }

    const sep = returnUrl.includes('?') ? '&' : '?';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { supabase_user_id: user.id } },
      success_url: `${returnUrl}${sep}checkout=success`,
      cancel_url: `${returnUrl}${sep}checkout=cancel`,
      allow_promotion_codes: true,
    });

    return json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session failed:', err);
    return json({ error: 'Could not start checkout' }, 500);
  }
});
