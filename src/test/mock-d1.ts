type Row = Record<string, unknown>;

type StatementResult = {
  first?: Row | null;
  all?: Row[];
  lastRowId?: number | null;
};

type Handler = (sql: string, binds: unknown[]) => StatementResult | Promise<StatementResult>;

export type MockD1 = D1Database & {
  calls: Array<{ sql: string; binds: unknown[] }>;
};

export function createMockD1(handler: Handler = () => ({})): MockD1 {
  const calls: Array<{ sql: string; binds: unknown[] }> = [];

  const db = {
    calls,
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          calls.push({ sql, binds });
          const resolve = async () => handler(sql, binds);
          return {
            async first<T>() {
              const result = await resolve();
              return (result.first ?? null) as T | null;
            },
            async all<T>() {
              const result = await resolve();
              return { results: (result.all ?? []) as T[], success: true, meta: {} };
            },
            async run() {
              const result = await resolve();
              return {
                success: true,
                meta: {
                  changes: 1,
                  last_row_id: result.lastRowId ?? 0,
                  duration: 0,
                  size_after: 0,
                  rows_read: 0,
                  rows_written: 0,
                  changed_db: true,
                },
              };
            },
          };
        },
      };
    },
  };

  return db as unknown as MockD1;
}
