import { Database } from '@nozbe/watermelondb';

import { adapter } from './adapter';
import * as models from './models';

/**
 * The local database.
 *
 * The adapter is resolved per platform by Metro (`adapter.native.ts` /
 * `adapter.web.ts`). Both satisfy the same API, so screens are written once —
 * but offline behaviour verified in a browser does NOT prove the native path
 * works, because the storage engines differ. Offline testing belongs on a
 * device (PLAN.md → Phase 6).
 */
export const database = new Database({
  adapter,
  modelClasses: [
    models.Tenant,
    models.Stylist,
    models.Client,
    models.ClientRecord,
    models.ClientTag,
    models.Service,
    models.Appointment,
    models.AppointmentService,
    models.Formula,
    models.Consent,
    models.BusinessHour,
    models.TimeBlock,
    models.StylistSettings,
    models.InventoryItem,
  ],
});

export { schema } from './schema';
export * from './models';
