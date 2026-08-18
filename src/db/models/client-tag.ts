import { Model, Relation } from '@nozbe/watermelondb';
import { relation, text } from '@nozbe/watermelondb/decorators';

import type { ClientRecord } from './client-record';

/**
 * Structured operational tag. There is no free-text notes model by design —
 * see PLAN.md → Stylist Check-In / Check-Out & Client Notes.
 */
export class ClientTag extends Model {
  static table = 'client_tags';
  static associations = {
    client_records: { type: 'belongs_to', key: 'client_record_id' },
  } as const;

  @text('server_id') serverId: string;
  @text('tenant_id') tenantId: string;
  @text('tag') tag: string;

  @relation('client_records', 'client_record_id') clientRecord: Relation<ClientRecord>;
}
