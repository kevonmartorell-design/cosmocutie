import { Model, Relation } from '@nozbe/watermelondb';
import { field, relation, text } from '@nozbe/watermelondb/decorators';

import type { Appointment } from './appointment';

/**
 * One service within an appointment. Price and duration are snapshots, so a
 * later edit to the service menu cannot rewrite historical appointments.
 */
export class AppointmentService extends Model {
  static table = 'appointment_services';
  static associations = {
    appointments: { type: 'belongs_to', key: 'appointment_id' },
  } as const;

  @text('server_id') serverId: string;
  @text('tenant_id') tenantId: string;
  @text('service_id') serviceId: string;
  @field('price_cents') priceCents: number;
  @field('duration_minutes') durationMinutes: number;
  @field('processing_window_minutes') processingWindowMinutes: number;
  @field('sort_order') sortOrder: number;

  @relation('appointments', 'appointment_id') appointment: Relation<Appointment>;
}
