import { serviceClient, json } from '../_shared/auth.ts';
import { stripeV1 } from '../_shared/stripe.ts';

/**
 * Drains the money job queue.
 *
 * Runs on a schedule for the same reason `send-push` does: a database trigger
 * cannot make an HTTP request, and a slow payments API must never be able to
 * hold up a booking transaction. The negotiation decides what is owed and
 * commits; this carries it to Stripe afterwards.
 *
 * What it does NOT do is write the outcome. Capturing here and marking the
 * payment captured here would make this function a second source of truth that
 * can disagree with Stripe. It sends the instruction; the webhook records what
 * happened. If this succeeds and the webhook is late, the row is briefly stale
 * — which is correct — rather than briefly wrong.
 */
const BATCH = 20;

Deno.serve(async () => {
  const supabase = serviceClient();

  const { data: jobs, error } = await supabase.rpc('claim_payment_jobs', { p_limit: BATCH });
  if (error) return json({ error: error.message }, 500);
  if (!jobs?.length) return json({ processed: 0 });

  let done = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await perform(job);
      await supabase.rpc('finish_payment_job', { p_job_id: job.job_id, p_ok: true, p_error: null });
      done++;
    } catch (err) {
      // Never throw out of the loop: one stuck job must not strand the rest of
      // the batch in `processing`, where nothing would ever pick them up again.
      await supabase.rpc('finish_payment_job', {
        p_job_id: job.job_id,
        p_ok: false,
        p_error: String(err),
      });
      failed++;
    }
  }

  return json({ processed: jobs.length, done, failed });
});

type Job = {
  job_id: string;
  kind: string;
  payment_id: string;
  tenant_id: string;
  payment_intent_id: string;
  amount_cents: number | null;
  attempts: number;
  route: string;
  stripe_account_id: string | null;
};

async function perform(job: Job) {
  // Keyed on the job, so a retry of the same job is the same request to Stripe
  // rather than a second one. Without this a worker that times out after Stripe
  // has already captured would capture again on the next run.
  const idempotencyKey = `job-${job.job_id}`;

  // Rent runs on the platform against the chair's own saved card and resolves
  // its own destination, so none of the routing below applies to it.
  if (job.kind === 'collect_rent') {
    await collectRent(job, idempotencyKey);
    return;
  }

  // A direct charge lives ON the connected account, so the call has to act as
  // that account to find it. A destination charge lives on the platform and
  // must not carry the header — sending one is a 404 on a payment intent that
  // exists, which is a confusing way to fail.
  const onConnectedAccount = job.route === 'direct' || job.route === 'salon';
  const stripeAccount = onConnectedAccount ? (job.stripe_account_id ?? undefined) : undefined;

  if (onConnectedAccount && !stripeAccount) {
    throw new Error(`no connected account for tenant ${job.tenant_id}`);
  }

  switch (job.kind) {
    case 'capture': {
      const params: Record<string, string> = {};
      // Null means the whole hold. A partial capture is how a cancellation fee
      // smaller than the deposit gets taken.
      if (job.amount_cents !== null) params.amount_to_capture = String(job.amount_cents);

      const res = await stripeV1(
        `/payment_intents/${job.payment_intent_id}/capture`,
        params,
        { stripeAccount, idempotencyKey },
      );
      if (!res.ok) throw new Error(res.error);
      break;
    }

    case 'release': {
      const res = await stripeV1(
        `/payment_intents/${job.payment_intent_id}/cancel`,
        {},
        { stripeAccount, idempotencyKey },
      );
      // Already cancelled is the outcome we wanted. Treating it as a failure
      // would retry it five more times and then page a human about a hold that
      // is correctly gone.
      if (!res.ok && !/already canceled|already been canceled/i.test(res.error)) {
        throw new Error(res.error);
      }
      break;
    }

    case 'refund': {
      const params: Record<string, string> = { payment_intent: job.payment_intent_id };
      if (job.amount_cents !== null) params.amount = String(job.amount_cents);
      // Never keep a platform fee on a sale that got reversed.
      params.refund_application_fee = 'true';

      const res = await stripeV1('/refunds', params, { stripeAccount, idempotencyKey });
      if (!res.ok) throw new Error(res.error);
      break;
    }

    case 'submit_evidence': {
      await submitEvidence(job, stripeAccount, idempotencyKey);
      break;
    }

    default:
      throw new Error(`unknown job kind: ${job.kind}`);
  }
}

/**
 * Answers a chargeback with what the app already recorded.
 *
 * Every element is a by-product of running the business properly — the client
 * signed a consent, arrived at a time both sides agreed in writing, and the
 * service was logged as it happened. That is why the evidence is worth
 * assembling automatically: it exists whether or not anyone expected a dispute.
 */
async function submitEvidence(job: Job, stripeAccount: string | undefined, idempotencyKey: string) {
  const supabase = serviceClient();

  const { data: payment } = await supabase
    .from('payments')
    .select('appointment_id')
    .eq('stripe_dispute_id', job.payment_intent_id)
    .maybeSingle();

  if (!payment?.appointment_id) throw new Error('no appointment behind that dispute');

  const { data: evidence, error } = await supabase.rpc('dispute_evidence', {
    p_appointment_id: payment.appointment_id,
  });
  if (error) throw new Error(error.message);
  if (!evidence) throw new Error('no evidence assembled');

  const attendance = evidence.attendance ?? {};
  const consents = evidence.consents ?? [];

  const params: Record<string, string> = {
    'evidence[service_date]': String(evidence.appointment?.scheduled_for ?? ''),
    // Stripe reads these as free text. The structured record is more
    // persuasive than a narrative, so it goes in as JSON rather than prose.
    'evidence[uncategorized_text]': JSON.stringify({
      agreed_in_app: evidence.agreement,
      attendance,
      services: evidence.services,
      consents,
      cancellation_policy: evidence.policy_shown,
    }).slice(0, 20_000),
  };

  if (attendance.arrived_at) {
    params['evidence[customer_communication]'] =
      `Client checked in at ${attendance.arrived_at}; service completed at ${attendance.service_ended_at ?? 'n/a'}.`;
  }
  if (consents.length > 0) {
    params['evidence[customer_signature]'] = String(consents[0].signed_by ?? '');
  }

  const res = await stripeV1(`/disputes/${job.payment_intent_id}`, params, {
    stripeAccount,
    idempotencyKey,
  });
  if (!res.ok) throw new Error(res.error);
}

/**
 * Charges a chair its booth rent and settles it to the salon.
 *
 * The direction of this one is the opposite of everything else in this file:
 * money moves FROM the renter TO the landlord. That shape is not incidental. A
 * salon that collected a stylist's takings and handed back a share would be
 * running a commission split, which is the clearest single signal of an
 * employment relationship. A stylist who keeps everything and separately pays a
 * fixed rent is a tenant. So rent comes off the renter's OWN saved card, never
 * out of their earnings.
 *
 * Charged on the platform and transferred to the salon, rather than as a direct
 * charge on the salon's account — a direct charge would mean cloning the
 * renter's card onto their landlord's Stripe account, which is more machinery
 * and a worse answer to "whose payment instrument is that?".
 */
async function collectRent(job: Job, idempotencyKey: string) {
  const supabase = serviceClient();

  const { data: rows, error } = await supabase.rpc('rent_collection_context', {
    p_payment_id: job.payment_id,
  });
  if (error) throw new Error(error.message);

  const ctx = Array.isArray(rows) ? rows[0] : rows;
  if (!ctx) throw new Error('no booth rent payment behind that job');

  // Someone already settled it — a replay, or a manual correction. Not a
  // failure, and charging again would be the actual damage.
  if (ctx.already_paid) return;

  // Both of these are worth failing loudly on. A job that quietly succeeds
  // without moving money leaves the owner believing rent arrived.
  if (!ctx.payment_method_id || !ctx.stripe_customer_id) {
    throw new Error('this chair has not saved a payment method for rent yet');
  }
  if (!ctx.salon_account_id) {
    throw new Error('the salon has not finished Stripe onboarding, so rent has nowhere to land');
  }

  const res = await stripeV1<{ id: string }>(
    '/payment_intents',
    {
      amount: String(ctx.amount_cents),
      currency: 'usd',
      customer: ctx.stripe_customer_id,
      payment_method: ctx.payment_method_id,
      // Nobody is present when the cron fires, so the mandate saved at setup
      // time is what authorises this.
      off_session: 'true',
      confirm: 'true',
      description: 'Booth rent',
      // The rent payment row has no intent id yet, so the webhook settles it by
      // this instead.
      'metadata[payment_id]': job.payment_id,
      // Straight through to the salon. No application fee: the platform does
      // not take a cut of a landlord's rent.
      'transfer_data[destination]': ctx.salon_account_id,
    },
    { idempotencyKey },
  );

  if (!res.ok) {
    // A declined card is a real, expected outcome rather than a bug — the
    // message is Stripe's own and reaches both parties through booth_rents.
    throw new Error(res.error);
  }
}
