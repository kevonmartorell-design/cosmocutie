import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

export class InventoryItem extends Model {
  static table = 'inventory_items';

  @text('server_id') serverId: string;
  @text('tenant_id') tenantId: string;
  @text('name') name: string;
  @field('brand') brand: string | null;
  @text('kind') kind: 'backbar' | 'retail';
  @text('unit') unit: string;
  @field('quantity_on_hand') quantityOnHand: number;
  @field('reorder_point') reorderPoint: number | null;
  @field('is_active') isActive: boolean;
}
