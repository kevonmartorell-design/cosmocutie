import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

export class BusinessHour extends Model {
  static table = 'business_hours';

  @text('server_id') serverId: string;
  @text('tenant_id') tenantId: string;
  @field('weekday') weekday: number;
  @text('opens_at') opensAt: string;
  @text('closes_at') closesAt: string;
}
