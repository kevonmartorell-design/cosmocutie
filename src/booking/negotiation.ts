import type { Database } from '@/lib/database.types';

export type RequestStatus = Database['public']['Enums']['booking_request_status'];
export type NegotiationAction = Database['public']['Enums']['negotiation_action'];

/**
 * Which actions are open to whom, given the state of a negotiation.
 *
 * Mirrors the rules the database enforces (PLAN.md → Booking Negotiation).
 * The server is authoritative — this only decides which buttons to draw, so a
 * client can never be offered a move that would be rejected.
 */
export function availableActions(opts: {
  status: RequestStatus;
  isStylist: boolean;
  stylistOffersUsed: number;
  clientCountersUsed: number;
}): NegotiationAction[] {
  const { status, isStylist, stylistOffersUsed, clientCountersUsed } = opts;

  if (isStylist) {
    if (status !== 'awaiting_stylist') return [];
    // Once both offers are spent this is the final round, and it is binary —
    // which is what makes the stylist the one who closes.
    return stylistOffersUsed < 2
      ? ['accept', 'reschedule', 'decline']
      : ['accept', 'decline'];
  }

  if (status !== 'awaiting_client') return [];
  return clientCountersUsed < 2 ? ['accept', 'counter', 'cancel'] : ['accept', 'cancel'];
}

export const ACTION_LABELS: Record<string, string> = {
  request: 'Requested',
  accept: 'Accept',
  decline: 'Decline',
  cancel: 'Cancel',
  reschedule: 'Suggest another time',
  counter: 'Suggest another time',
  expire: 'Expired',
  hold_released: 'Hold released',
};

/** Human-readable countdown for the step deadline. */
export function timeLeft(deadline: string): string {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h left to respond`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left to respond`;
}

export function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
