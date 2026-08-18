import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

/** Identity only. Everything proprietary lives on ClientRecord. */
export class Client extends Model {
  static table = 'clients';

  @text('server_id') serverId: string;
  @text('full_name') fullName: string;
  @field('phone') phone: string | null;
  @field('email') email: string | null;
}
