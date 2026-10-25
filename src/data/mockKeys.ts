import type { MockSchema, MockTableSchema } from "../core/types";

/**
 * Mock schemas historically accepted `keys: string[]`. Power BI TMDL cannot
 * refresh a model with `isKey` declarations, so the key is retained only as
 * internal metadata (for dimension-candidate filtering). Use the first entry
 * and warn about the rest.
 */
export function primaryMockKey(table: MockTableSchema): string | undefined {
  return table.keys?.[0];
}

export function mockKeyWarnings(schema: MockSchema): string[] {
  return schema.tables.flatMap((table) => {
    if ((table.keys?.length ?? 0) <= 1) return [];
    const [first, ...ignored] = table.keys!;
    return [
      `Table "${table.name}" declares ${table.keys!.length} keys; only "${first}" is retained as internal metadata. Ignored: ${ignored.join(", ")}.`,
    ];
  });
}
