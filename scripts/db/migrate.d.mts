import type {Sql} from 'postgres';
export function applyMigrations(sql: Sql, options?: {log?: (message: string) => void}): Promise<void>;
