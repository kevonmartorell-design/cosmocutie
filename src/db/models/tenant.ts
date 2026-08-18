import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

export class Tenant extends Model {
  static table = 'tenants';

  @text('server_id') serverId: string;
  @text('kind') kind: 'salon' | 'stylist';
  @text('name') name: string;
  @field('parent_salon_id') parentSalonId: string | null;
  @text('timezone') timezone: string;
}
