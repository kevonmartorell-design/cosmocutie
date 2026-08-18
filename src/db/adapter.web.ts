import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { schema } from './schema';

/**
 * Web adapter: LokiJS over IndexedDB.
 *
 * Metro picks this file for web builds and `adapter.native.ts` for iOS and
 * Android. The split is not cosmetic — importing the SQLite adapter in a web
 * bundle drags in `better-sqlite3`, a Node binary that cannot resolve in a
 * browser and breaks the build outright.
 */
export const adapter = new LokiJSAdapter({
  schema,
  useWebWorker: false,
  useIncrementalIndexedDB: true,
  dbName: 'cosmocutie',
  onQuotaExceededError: (error) => {
    console.error('[db] IndexedDB quota exceeded', error);
  },
});
