import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

export type ExportFile = { name: string; url: string };

export type ExportResult =
  | { status: 'ready'; files: ExportFile[]; counts: Record<string, number> }
  | { status: 'error'; message: string };

/**
 * "Take everything you own and go."
 *
 * PLAN.md's no-lock-in principle. A stylist whose client book is trapped inside
 * their landlord's app is a stylist whose landlord controls their business —
 * which is the behavioural-control problem the whole tenant model exists to
 * avoid. So this has to work, and it has to produce files a person can open.
 *
 * The files are written server-side and handed back as signed links rather than
 * downloaded into the app. That keeps this shippable over the air: saving a
 * file to the device would need `expo-file-system` and `expo-sharing`, both
 * native, and neither is worth a rebuild for an operation run once a year.
 */
export async function requestDataExport(tenantId: string): Promise<ExportResult> {
  const { data, error } = await supabase.functions.invoke('export-data', {
    body: { tenant_id: tenantId },
  });

  if (error) {
    const context = (error as { context?: Response })?.context;
    let detail: string | null = null;
    if (context && typeof context.json === 'function') {
      try {
        detail = (await context.json())?.error ?? null;
      } catch {
        // Not JSON; fall through to the generic message.
      }
    }
    return { status: 'error', message: detail ?? 'Could not build your export.' };
  }

  if (!data?.files?.length) {
    return { status: 'error', message: data?.error ?? 'Could not build your export.' };
  }

  return { status: 'ready', files: data.files, counts: data.counts ?? {} };
}

/** Opens one export file. Signed, so no auth header has to ride along. */
export async function openExportFile(url: string) {
  await WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'done' });
}
