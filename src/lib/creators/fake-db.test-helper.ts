type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export interface FakeDb {
  tables: Record<string, Row[]>;
  failNext: (table: string, op: "select" | "update" | "insert" | "upsert", code?: string) => void;
  rpcCalls: { fn: string; args: unknown }[];
  rpcResult: (fn: string, result: { data?: unknown; error?: unknown }) => void;
  client: unknown;
}

function parseOr(expr: string): Filter {
  const parts = expr.split(",").map((part) => {
    const [col, op, ...rest] = part.split(".");
    const value = rest.join(".");
    if (op === "is" && value === "null") return (row: Row) => row[col] === null || row[col] === undefined;
    if (op === "eq") return (row: Row) => String(row[col]) === value;
    if (op === "lt") return (row: Row) => String(row[col]) < value;
    throw new Error(`fake-db: operador or no soportado: ${part}`);
  });
  return (row) => parts.some((f) => f(row));
}

export function createFakeDb(initial: Record<string, object[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...(r as Row) }));
  const failures: { table: string; op: string; code: string }[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const rpcResults = new Map<string, { data?: unknown; error?: unknown }>();

  function takeFailure(table: string, op: string): { code: string } | null {
    const index = failures.findIndex((f) => f.table === table && f.op === op);
    if (index === -1) return null;
    const [failure] = failures.splice(index, 1);
    return { code: failure.code };
  }

  function builder(table: string) {
    const filters: Filter[] = [];
    let op: "select" | "update" | "insert" | "upsert" = "select";
    let payload: Row | Row[] | null = null;
    let onConflict: string[] = [];
    let returning = false;
    let limitN: number | null = null;
    let order: { col: string; asc: boolean } | null = null;
    let single: "maybe" | "one" | null = null;
    let countHead = false;

    const api: Record<string, unknown> = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (op !== "select") returning = true;
        if (opts?.head) countHead = true;
        return api;
      },
      insert(values: Row | Row[]) {
        op = "insert";
        payload = values;
        return api;
      },
      upsert(values: Row | Row[], opts?: { onConflict?: string }) {
        op = "upsert";
        payload = values;
        onConflict = (opts?.onConflict ?? "id").split(",");
        return api;
      },
      update(values: Row) {
        op = "update";
        payload = values;
        return api;
      },
      eq(col: string, value: unknown) {
        filters.push((row) => row[col] === value);
        return api;
      },
      neq(col: string, value: unknown) {
        filters.push((row) => row[col] !== value);
        return api;
      },
      in(col: string, values: unknown[]) {
        filters.push((row) => values.includes(row[col]));
        return api;
      },
      is(col: string, value: null) {
        filters.push((row) => (row[col] ?? null) === value);
        return api;
      },
      lte(col: string, value: string) {
        filters.push((row) => row[col] !== null && row[col] !== undefined && String(row[col]) <= value);
        return api;
      },
      lt(col: string, value: string) {
        filters.push((row) => row[col] !== null && row[col] !== undefined && String(row[col]) < value);
        return api;
      },
      not(col: string, operator: string, value: unknown) {
        if (operator === "is" && value === null) filters.push((row) => row[col] !== null && row[col] !== undefined);
        else throw new Error(`fake-db: not.${operator} no soportado`);
        return api;
      },
      or(expr: string) {
        filters.push(parseOr(expr));
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        order = { col, asc: opts?.ascending ?? true };
        return api;
      },
      limit(n: number) {
        limitN = n;
        return api;
      },
      maybeSingle() {
        single = "maybe";
        return api;
      },
      single() {
        single = "one";
        return api;
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };

    function run(): { data: unknown; error: unknown; count?: number } {
      const failure = takeFailure(table, op);
      if (failure) return { data: null, error: failure };
      const rows = (tables[table] ??= []);
      const matches = () => rows.filter((row) => filters.every((f) => f(row)));

      if (op === "insert" || op === "upsert") {
        const list = Array.isArray(payload) ? payload : [payload as Row];
        const out: Row[] = [];
        for (const value of list) {
          if (op === "upsert") {
            const existing = rows.find((row) => onConflict.every((c) => row[c] === value[c]));
            if (existing) {
              Object.assign(existing, value);
              out.push(existing);
              continue;
            }
          }
          const row = { id: value.id ?? `${table}-${rows.length + 1}`, ...value };
          rows.push(row);
          out.push(row);
        }
        const data = returning ? (single ? out[0] ?? null : out) : null;
        return { data, error: null };
      }

      if (op === "update") {
        const hit = matches();
        for (const row of hit) Object.assign(row, payload);
        const data = returning ? (single ? hit[0] ?? null : hit.map((r) => ({ ...r }))) : null;
        return { data, error: null };
      }

      let result = matches().map((r) => ({ ...r }));
      if (order) {
        const { col, asc } = order;
        result.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      if (limitN !== null) result = result.slice(0, limitN);
      if (countHead) return { data: null, error: null, count: result.length };
      if (single === "maybe") return { data: result[0] ?? null, error: null };
      if (single === "one") {
        return result[0] ? { data: result[0], error: null } : { data: null, error: { code: "PGRST116" } };
      }
      return { data: result, error: null };
    }

    return api;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcResults.get(fn) ?? { data: null, error: null };
    },
  };

  return {
    tables,
    failNext: (table, op, code = "XX000") => failures.push({ table, op, code }),
    rpcCalls,
    rpcResult: (fn, result) => rpcResults.set(fn, result),
    client,
  };
}
