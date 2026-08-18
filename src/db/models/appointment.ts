import { Model, Query, Relation } from '@nozbe/watermelondb';
import { children, date, field, relation, text } from '@nozbe/watermelondb/decorators';

import type { AppointmentService } from './appointment-service';
import type { ClientRecord } from './client-record';
import type { Formula } from './formula';

export class Appointment extends Model {
  static table = 'appointments';
  static associations = {
    client_records: { type: 'belongs_to', key: 'client_record_id' },
    appointment_services: { type: 'has_many', foreignKey: 'appointment_id' },
    formulas: { type: 'has_many', foreignKey: 'appointment_id' },
  } as const;

  @text('server_id') serverId: string;
  @text('tenant_id') tenantId: string;
  @text('stylist_id') stylistId: string;
  @text('client_id') clientId: string;

  @date('starts_at') startsAt: Date;
  @date('ends_at') endsAt: Date;
  /** Service time plus buffers — what the calendar actually blocks out. */
  @date('buffer_starts_at') bufferStartsAt: Date;
  @date('buffer_ends_at') bufferEndsAt: Date;

  @text('status') status: string;

  @field('is_for_child') isForChild: boolean;
  @field('child_first_name') childFirstName: string | null;
  @field('child_age') childAge: number | null;

  // Stylist-side timeline. Actual vs booked duration is what lets future
  // bookings be padded from real data instead of optimism.
  @date('arrived_at') arrivedAt: Date | null;
  @date('service_started_at') serviceStartedAt: Date | null;
  @date('service_ended_at') serviceEndedAt: Date | null;

  @field('total_price_cents') totalPriceCents: number;

  @relation('client_records', 'client_record_id') clientRecord: Relation<ClientRecord>;
  @children('appointment_services') services: Query<AppointmentService>;
  @children('formulas') formulas: Query<Formula>;

  /** Minutes the service actually took, once checked out. */
  get actualDurationMinutes(): number | null {
    if (!this.serviceStartedAt || !this.serviceEndedAt) return null;
    return Math.round(
      (this.serviceEndedAt.getTime() - this.serviceStartedAt.getTime()) / 60000,
    );
  }
}
