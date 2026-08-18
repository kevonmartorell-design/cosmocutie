import type { DatabaseAdapter } from '@nozbe/watermelondb/adapters/type';

/**
 * Metro resolves `./adapter` to adapter.native.ts or adapter.web.ts at build
 * time. TypeScript cannot follow platform suffixes, so the contract both files
 * satisfy is declared here.
 */
export declare const adapter: DatabaseAdapter;
