declare module 'node-sqlite3-wasm' {
  export interface RunResult {
    changes: number;
    lastInsertRowid: number;
  }

  export class Database {
    constructor(path: string);
    exec(sql: string): void;
    run(sql: string, params?: unknown[]): RunResult;
    get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
    all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
    close(): void;
  }
}
