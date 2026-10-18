export interface DiffRow {
  path: string;
  before: string;
  after: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function collect(value: unknown, prefix: string, out: Map<string, unknown>) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.set(prefix || "(root)", value);
      return;
    }
    value.forEach((item, index) => collect(item, `${prefix}[${index}]`, out));
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out.set(prefix || "(root)", value);
      return;
    }
    for (const key of keys) collect(value[key], prefix ? `${prefix}.${key}` : key, out);
    return;
  }
  out.set(prefix || "(root)", value);
}

export function formatDiffValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Flat before/after rows, changed paths first. */
export function diffRecords(before: unknown, after: unknown): DiffRow[] {
  const left = new Map<string, unknown>();
  const right = new Map<string, unknown>();
  collect(before ?? null, "", left);
  collect(after ?? null, "", right);
  const paths = Array.from(new Set([...left.keys(), ...right.keys()])).sort();
  const rows = paths.map((path) => ({
    path: path || "(root)",
    before: formatDiffValue(left.has(path) ? left.get(path) : undefined),
    after: formatDiffValue(right.has(path) ? right.get(path) : undefined),
  }));
  return rows.sort((a, b) => {
    const ac = a.before === a.after ? 1 : 0;
    const bc = b.before === b.after ? 1 : 0;
    return ac - bc || a.path.localeCompare(b.path);
  });
}
