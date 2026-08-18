import { Model } from '@nozbe/watermelondb';
import { date, field, text } from '@nozbe/watermelondb/decorators';

export class TimeBlock extends Model {
  static table = 'time_blocks';

  @text('server_id') serverId: string;
  @text('tenant_id') tenantId: string;
  @date('starts_at') startsAt: Date;
  @date('ends_at') endsAt: Date;
  @field('reason') reason: string | null;
}
