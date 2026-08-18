import { Model, Query } from '@nozbe/watermelondb';
import { children, date, field, text } from '@nozbe/watermelondb/decorators';

import type { Appointment } from './appointment';
import type { ClientTag } from './client-tag';

/** One stylist's relationship with one client. The tenant-scoped book. */
export class ClientRecord extends Model {
  static table = 'client_records';
  static associations = {
    client_tags: { type: 'has_many', foreignKey: 'client_record_id' },
    appointments: { type: 'has_many', foreignKey: 'client_record_id' },
  } as const;

  @text('server_id') serverId: string;
  @text('tenant_id') tenantId: string;
  @text('client_id') clientId: string;
  @field('visit_count') visitCount: number;
  @field('no_show_count') noShowCount: number;
  @field('safety_flag') safetyFlag: string | null;
  @field('requires_prepay') requiresPrepay: boolean;
  @date('last_seen_at') lastSeenAt: Date | null;

  @children('client_tags') tags: Query<ClientTag>;
  @children('appointments') appointments: Query<Appointment>;
}
