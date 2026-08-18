import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

export class StylistSettings extends Model {
  static table = 'stylist_settings';

  @text('tenant_id') tenantId: string;
  /** Defaults false server-side: stylists opt IN to deposits. */
  @field('requires_deposit') requiresDeposit: boolean;
  @field('deposit_percent') depositPercent: number;
  @field('deposit_min_cents') depositMinCents: number;
  /** Dead time BETWEEN appointments. */
  @field('buffer_minutes') bufferMinutes: number;
  /** Smaller buffer used inside a processing window. */
  @field('gap_buffer_minutes') gapBufferMinutes: number;
  @text('arrival_note') arrivalNote: string;
  @field('free_cancel_hours') freeCancelHours: number;
  @field('late_cancel_hours') lateCancelHours: number;
  @field('no_show_grace_minutes') noShowGraceMinutes: number;
  @field('prepay_after_no_shows') prepayAfterNoShows: number;
  @field('redo_window_days') redoWindowDays: number;
}
