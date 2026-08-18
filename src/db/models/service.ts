import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

export class Service extends Model {
  static table = 'services';

  @text('server_id') serverId: string;
  @text('tenant_id') tenantId: string;
  @text('name') name: string;
  @field('description') description: string | null;
  @field('duration_minutes') durationMinutes: number;
  @field('price_cents') priceCents: number;
  /** Idle time inside this service where the stylist can take someone else. */
  @field('processing_window_minutes') processingWindowMinutes: number;
  @field('processing_starts_after_minutes') processingStartsAfterMinutes: number;
  @field('requires_patch_test') requiresPatchTest: boolean;
  @field('is_active') isActive: boolean;
  @field('sort_order') sortOrder: number;
}
