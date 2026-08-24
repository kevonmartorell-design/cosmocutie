import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

/**
 * Client-side payment flows.
 *
 * Card details are collected by Stripe on a page Stripe hosts, opened in the
 * system browser. Nothing here ever sees a card number, which is the whole
 * reason the flow is shaped this way — and it keeps the app free of a native
 * payments module, so payments ship over the air rather than needing a build.
 */

export type CheckoutResult =
  | { status: 'held' }
  | { status: 'dismissed' }
  | { status: 'error'; message: string };

/**
 * Authorises the deposit for a booking request.
 *
 * The hold is confirmed by Stripe's webhook, not by this function: the browser
 * closing tells us the client finished the page, not that the money moved. So
 * after the browser closes we wait for the payment intent to appear on the
 * request, which is the database's own record that the hold exists.
 */
export async function holdDeposit(requestId: string): Promise<CheckoutResult> {
  const { data, error } = await supabase.functions.invoke('stripe-checkout', {
    body: { request_id: requestId },
  });

  if (error) {
    // Edge functions return the reason in the body on a non-2xx, and
    // FunctionsHttpError keeps it on `context` rather than in `error.message`.
    const detail = await readFunctionError(error);
    return { status: 'error', message: detail ?? 'Could not start the payment.' };
  }
  if (!data?.checkout_url) {
    return { status: 'error', message: data?.error ?? 'Could not start the payment.' };
  }

  const result = await WebBrowser.openBrowserAsync(data.checkout_url, {
    dismissButtonStyle: 'cancel',
  });

  // `dismiss` only means the browser closed. Whether that was after paying or
  // after backing out is a question only the database can answer.
  if (result.type !== 'opened' && result.type !== 'dismiss') {
    return { status: 'dismissed' };
  }

  return (await waitForHold(requestId)) ? { status: 'held' } : { status: 'dismissed' };
}

/**
 * Polls for the webhook to land.
 *
 * Stripe usually delivers within a second or two, but "usually" is not a
 * guarantee and the client is watching a spinner. Ten tries at 800ms covers the
 * normal case comfortably; beyond that the screen falls back to its unpaid
 * state, which is honest — the hold genuinely is not confirmed yet, and the
 * request will show it once the event arrives.
 */
async function waitForHold(requestId: string, tries = 10): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const { data } = await supabase
      .from('booking_requests')
      .select('stripe_payment_intent_id')
      .eq('id', requestId)
      .maybeSingle();

    if (data?.stripe_payment_intent_id) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

/**
 * Starts or resumes Stripe Connect onboarding for a chair.
 *
 * Stripe collects identity, bank details and tax information on its own hosted
 * pages; none of it passes through this app. Returns once the browser closes —
 * readiness is mirrored back by the `account.updated` webhook, not read here.
 */
export async function startPayoutOnboarding(tenantId: string): Promise<CheckoutResult> {
  const { data, error } = await supabase.functions.invoke('stripe-connect', {
    body: { tenant_id: tenantId },
  });

  if (error) {
    const detail = await readFunctionError(error);
    return { status: 'error', message: detail ?? 'Could not open payout setup.' };
  }
  if (!data?.onboarding_url) {
    return { status: 'error', message: data?.error ?? 'Could not open payout setup.' };
  }

  await WebBrowser.openBrowserAsync(data.onboarding_url, { dismissButtonStyle: 'done' });
  return { status: 'held' };
}

/** Pulls the real message out of a FunctionsHttpError rather than "non-2xx". */
async function readFunctionError(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
    } catch {
      // Body was not JSON; fall through to the generic message.
    }
  }
  const message = (error as { message?: string })?.message;
  return message ?? null;
}

/**
 * Takes the closing balance at the end of a service.
 *
 * Same hosted-page mechanism as the deposit, and settled the same way: the
 * browser closing means the client finished the page, and the webhook is what
 * confirms the money actually moved.
 */
export async function payBalance(paymentId: string): Promise<CheckoutResult> {
  const { data, error } = await supabase.functions.invoke('stripe-checkout', {
    body: { payment_id: paymentId },
  });

  if (error) {
    const detail = await readFunctionError(error);
    return { status: 'error', message: detail ?? 'Could not start the payment.' };
  }
  if (!data?.checkout_url) {
    return { status: 'error', message: data?.error ?? 'Could not start the payment.' };
  }

  await WebBrowser.openBrowserAsync(data.checkout_url, { dismissButtonStyle: 'cancel' });

  for (let i = 0; i < 10; i++) {
    const { data: row } = await supabase
      .from('payments')
      .select('status')
      .eq('id', paymentId)
      .maybeSingle();
    if (row?.status === 'captured') return { status: 'held' };
    await new Promise((r) => setTimeout(r, 800));
  }
  return { status: 'dismissed' };
}
