import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import { schema } from './schema';

/**
 * Native adapter: JSI-backed SQLite.
 *
 * This is the real storage engine, and the reason offline behaviour verified
 * in a browser proves nothing about the device: web runs LokiJS over
 * IndexedDB, which is a genuinely different engine with different semantics.
 */
export const adapter = new SQLiteAdapter({
  schema,
  dbName: 'cosmocutie',
  // Required for the New Architecture, which this app has enabled.
  jsi: true,
  onSetUpError: (error) => {
    console.error('[db] failed to open SQLite', error);
  },
});
