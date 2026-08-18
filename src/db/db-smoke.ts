import { Q } from '@nozbe/watermelondb';

import { database } from './index';
import type { Appointment, ClientRecord, Service } from './models';

/**
 * Exercises the local database end to end: write, relate, query, update.
 *
 * Rendered by the dev screen so a preview proves the offline layer genuinely
 * works, rather than merely compiling. A schema that typechecks but cannot
 * write a row is a failure discovered far too late.
 */
export type SmokeResult = { step: string; ok: boolean; detail: string };

export async function runDbSmokeTest(): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];
  const record = (step: string, ok: boolean, detail: string) =>
    results.push({ step, ok, detail });

  try {
    // Start clean so repeated runs are deterministic.
    await database.write(async () => {
      await database.unsafeResetDatabase();
    });
    record('reset database', true, 'cleared');

    const tenantId = 'tenant-rae';
    let service: Service;
    let clientRecord: ClientRecord;
    let appointment: Appointment;

    await database.write(async () => {
      service = await database.get<Service>('services').create((s) => {
        s.serverId = 'srv-1';
        s.tenantId = tenantId;
        s.name = 'Balayage';
        s.durationMinutes = 180;
        s.priceCents = 28000;
        s.processingWindowMinutes = 45;
        s.processingStartsAfterMinutes = 60;
        s.requiresPatchTest = true;
        s.isActive = true;
        s.sortOrder = 0;
      });

      clientRecord = await database.get<ClientRecord>('client_records').create((r) => {
        r.serverId = 'cr-1';
        r.tenantId = tenantId;
        r.clientId = 'client-nina';
        r.visitCount = 0;
        r.noShowCount = 0;
        r.requiresPrepay = false;
      });

      const start = new Date('2026-09-01T14:00:00Z');
      const end = new Date('2026-09-01T17:00:00Z');
      appointment = await database.get<Appointment>('appointments').create((a) => {
        a.serverId = 'appt-1';
        a.tenantId = tenantId;
        a.stylistId = 'stylist-rae';
        a.clientId = 'client-nina';
        a._setRaw('client_record_id', clientRecord.id);
        a.startsAt = start;
        a.endsAt = end;
        a.bufferStartsAt = new Date(start.getTime() - 30 * 60000);
        a.bufferEndsAt = new Date(end.getTime() + 30 * 60000);
        a.status = 'confirmed';
        a.isForChild = false;
        a.totalPriceCents = 28000;
      });
    });
    record('create rows', true, 'service + client record + appointment');

    // Relations resolve
    const linked = await appointment!.clientRecord.fetch();
    record('relation resolves', linked?.id === clientRecord!.id, `clientRecord -> ${linked?.serverId}`);

    // Tenant-scoped query, mirroring how RLS filters server-side
    const mine = await database
      .get<ClientRecord>('client_records')
      .query(Q.where('tenant_id', tenantId))
      .fetch();
    const others = await database
      .get<ClientRecord>('client_records')
      .query(Q.where('tenant_id', 'tenant-dana'))
      .fetch();
    record('tenant scoping', mine.length === 1 && others.length === 0,
      `own=${mine.length} other=${others.length}`);

    // JSON field round-trip
    await database.write(async () => {
      await database.get('formulas').create((f: any) => {
        f.serverId = 'f-1';
        f.tenantId = tenantId;
        f._setRaw('appointment_id', appointment.id);
        f.clientRecordId = clientRecord.id;
        f.components = [{ product: 'Shades EQ 09V', grams: 60 }];
        f.developerVolume = '20';
        f.createdAt = new Date();
      });
    });
    const formulas = await appointment!.formulas.fetch();
    const comps = (formulas[0] as any)?.components;
    record('json field round-trip', Array.isArray(comps) && comps[0]?.grams === 60,
      JSON.stringify(comps));

    // Update + derived getter
    await database.write(async () => {
      await appointment!.update((a) => {
        a.serviceStartedAt = new Date('2026-09-01T14:05:00Z');
        a.serviceEndedAt = new Date('2026-09-01T16:00:00Z');
      });
    });
    record('actual duration computed', appointment!.actualDurationMinutes === 115,
      `${appointment!.actualDurationMinutes} min (booked 180)`);

    const count = await database.get('appointments').query().fetchCount();
    record('query count', count === 1, `${count} appointment(s)`);
  } catch (error) {
    record('EXCEPTION', false, error instanceof Error ? error.message : String(error));
  }

  return results;
}
