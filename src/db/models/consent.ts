import { Model } from '@nozbe/watermelondb';
import { date, field, text } from '@nozbe/watermelondb/decorators';

/**
 * Consent decisions and outcomes only. There is deliberately no field for
 * medications, conditions, or pregnancy — see PLAN.md → Sensitive Data Policy.
 */
export class Consent extends Model {
  static table = 'consents';

  @text('server_id') serverId: string;
  @text('tenant_id') tenantId: string;
  @text('client_record_id') clientRecordId: string;
  @field('appointment_id') appointmentId: string | null;

  @text('kind') kind: string;
  @field('product_tested') productTested: string | null;
  @field('result') result: string | null;
  /** Boolean outcome only — the underlying answers are never stored. */
  @field('contraindications_disclosed') contraindicationsDisclosed: boolean | null;
  @field('proceeded') proceeded: boolean | null;

  @text('signed_by_name') signedByName: string;
  @field('signed_by_guardian') signedByGuardian: boolean;
  @text('document_version') documentVersion: string;
  @date('signed_at') signedAt: Date;
}
