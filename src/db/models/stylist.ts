import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

export class Stylist extends Model {
  static table = 'stylists';

  @text('server_id') serverId: string;
  @text('tenant_id') tenantId: string;
  @text('full_name') fullName: string;
  @field('avatar_url') avatarUrl: string | null;
  @text('role') role: 'admin' | 'stylist';
  @field('classification') classification: string | null;
}
