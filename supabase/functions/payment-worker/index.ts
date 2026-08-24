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
  tenant_id: string;
  payment_intent_id: string;
  amount_cents: number | null;
  attempts: number;
  route: string;
  stripe_account_id: string | null;
};

async function perform(job: Job) {
  // A direct charge lives ON the connected account, so the call has to act as
  // that account to find it. A destination charge lives on the platform and
  // must not carry the header — sending one is a 404 on a payment intent that
  // exists, which is a confusing way to fail.
  const onConnectedAccount = job.route === 'direct' || job.route === 'salon';
  const stripeAccount = onConnectedAccount ? (job.stripe_account_id ?? undefined) : undefined;

  if (onConnectedAccount && !stripeAccount) {
    throw new Error(`no connected account for tenant ${job.tenant_id}`);
  }

  // Keyed on the job, so a retry of the same job is the same request to Stripe
  // rather than a second one. Without this a worker that times out after Stripe
  // has already captured would capture again on the next run.
  const idempotencyKey = `job-${job.job_id}`;

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

    case 'collect_rent':
      // Booth rent is raised as a payment row by the daily cron, but collecting
      // it needs a stored payment method on the chair, which stylist onboarding
      // does not yet capture. Failing loudly beats silently marking it done and
      // leaving the salon owner believing rent was taken.
      throw new Error('booth rent collection is not implemented yet');

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
