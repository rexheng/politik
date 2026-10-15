// The few D1 members the data layer uses, declared locally so Node-side tests and `tsc`
// don't need `@cloudflare/workers-types`. A real `D1Database` is assignable to `D1Like`.

export type D1Value = string | number | null;

export interface D1StatementLike {
  bind(...values: D1Value[]): D1StatementLike;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(query: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown[]>;
}
