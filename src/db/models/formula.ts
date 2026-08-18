import { Model, Relation } from '@nozbe/watermelondb';
import { date, field, json, relation, text } from '@nozbe/watermelondb/decorators';

import type { Appointment } from './appointment';

export type FormulaComponent = {
  product: string;
  grams?: number;
  developerVolume?: string;
};

const sanitizeComponents = (raw: unknown): FormulaComponent[] =>
  Array.isArray(raw) ? (raw as FormulaComponent[]) : [];

export class Formula extends Model {
  static table = 'formulas';
  static associations = {
    appointments: { type: 'belongs_to', key: 'appointment_id' },
  } as const;

  @text('server_id') serverId: string;
  @text('tenant_id') tenantId: string;
  @text('client_record_id') clientRecordId: string;

  @json('components_json', sanitizeComponents) components: FormulaComponent[];
  @field('developer_volume') developerVolume: string | null;
  @field('processing_time_minutes') processingTimeMinutes: number | null;
  @field('technique_notes') techniqueNotes: string | null;
  @date('created_at') createdAt: Date;

  @relation('appointments', 'appointment_id') appointment: Relation<Appointment>;
}
