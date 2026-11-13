/**
 * A small in-memory stand-in for the Supabase query builder, for route and
 * library tests. It supports the calls the MSP code makes (select, insert,
 * update, delete with eq / neq / in / limit, single / maybeSingle) and records
 * every write so a test can assert that nothing was changed.
 */

type Row = Record<string, unknown>;

export interface RecordedWrite {
  table: string;
  op: 'insert' | 'update' | 'delete';
  values?: Row;
  affected: number;
}

function read(row: Row, column: string): unknown {
  return column.split('.').reduce<unknown>((value, key) => (value as Row | undefined)?.[key], row);
}

class FakeQuery {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private values: Row | undefined;
  private filters: Array<(row: Row) => boolean> = [];
  private max: number | undefined;

  constructor(
    private readonly table: string,
    private readonly tables: Record<string, Row[]>,
    private readonly writes: RecordedWrite[]
  ) {}

  select() { return this; }
  insert(values: Row) { this.op = 'insert'; this.values = values; return this; }
  update(values: Row) { this.op = 'update'; this.values = values; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => read(row, column) === value); return this; }
  neq(column: string, value: unknown) { this.filters.push((row) => read(row, column) !== value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(read(row, column))); return this; }
  order() { return this; }
  limit(count: number) { this.max = count; return this; }

  private run(): Row[] {
    const rows = (this.tables[this.table] ??= []);
    const matches = (row: Row) => this.filters.every((filter) => filter(row));

    if (this.op === 'insert') {
      const row = { ...(this.values as Row) };
      rows.push(row);
      this.writes.push({ table: this.table, op: 'insert', values: this.values, affected: 1 });
      return [row];
    }

    const selected = rows.filter(matches);

    if (this.op === 'update') {
      for (const row of selected) Object.assign(row, this.values);
      this.writes.push({ table: this.table, op: 'update', values: this.values, affected: selected.length });
      return selected;
    }

    if (this.op === 'delete') {
      this.tables[this.table] = rows.filter((row) => !matches(row));
      this.writes.push({ table: this.table, op: 'delete', affected: selected.length });
      return selected;
    }

    return this.max === undefined ? selected : selected.slice(0, this.max);
  }

  async single() {
    const rows = this.run();
    return rows.length === 1
      ? { data: rows[0], error: null }
      : { data: null, error: { code: 'PGRST116', message: 'no single row' } };
  }

  async maybeSingle() {
    const rows = this.run();
    return { data: rows[0] ?? null, error: null };
  }

  then<T>(resolve: (value: { data: Row[]; error: null }) => T) {
    return Promise.resolve({ data: this.run(), error: null as null }).then(resolve);
  }
}

export function createFakeSupabase(tables: Record<string, Row[]>) {
  const writes: RecordedWrite[] = [];
  return {
    tables,
    writes,
    client: { from: (table: string) => new FakeQuery(table, tables, writes) },
  };
}
