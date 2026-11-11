type Query = Record<string, unknown>;

/** A parsed list query: what a Repository's `findPage` turns into one database query. */
export interface ListQuery {
  search?: string;
  sort?: { field: string; descending: boolean };
  offset: number;
  limit?: number;
  /** The other query parameters, as text: `readFilters` turns the ones that name a column into conditions. */
  filters?: Record<string, string>;
}

/** How a column's text is read: a String, an Integer, a Float or Double, a Boolean, a UUID or a DateTime. */
export type FilterKind = "text" | "integer" | "number" | "boolean" | "uuid" | "datetime";

/** One condition of a filter parameter: the column, how it compares, and the value — undefined when the text cannot be read as the column's kind, which keeps no row. */
export interface FilterCondition {
  field: string;
  operator: "equals" | "gte" | "lte";
  value: string | number | boolean | Date | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readFilterValue(kind: FilterKind, text: string): FilterCondition["value"] {
  switch (kind) {
    case "text":
      return text;
    case "uuid":
      return UUID.test(text) ? text : undefined;
    case "integer":
      return /^-?\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : undefined;
    case "number":
      return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text) && Number.isFinite(Number(text))
        ? Number(text)
        : undefined;
    case "boolean":
      return text === "true" ? true : text === "false" ? false : undefined;
    case "datetime": {
      const date = new Date(text);
      return Number.isNaN(date.getTime()) ? undefined : date;
    }
  }
}

const RANGES = [
  ["_from", "gte"],
  ["_to", "lte"],
] as const;

/** The conditions of the filters that name a column of `columns`: `name=value` equals it; `name_from` and `name_to` (inclusive) bound an Integer, Float or DateTime column. A name that is no column is left out. */
export function readFilters(
  filters: Record<string, string> | undefined,
  columns: ReadonlyMap<string, FilterKind>,
): FilterCondition[] {
  const conditions: FilterCondition[] = [];
  for (const [name, text] of Object.entries(filters ?? {})) {
    const kind = columns.get(name);
    if (kind !== undefined) {
      conditions.push({ field: name, operator: "equals", value: readFilterValue(kind, text) });
      continue;
    }
    for (const [suffix, operator] of RANGES) {
      const field = name.endsWith(suffix) ? name.slice(0, -suffix.length) : "";
      const rangeKind = columns.get(field);
      if (rangeKind === "integer" || rangeKind === "number" || rangeKind === "datetime") {
        conditions.push({ field, operator, value: readFilterValue(rangeKind, text) });
      }
    }
  }
  return conditions;
}

/** One page of rows and the number of rows that matched before the page was cut. */
export interface Page<T> {
  items: T[];
  total: number;
}

export const TOTAL_COUNT_HEADER = "X-Total-Count";

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

const RESERVED = new Set<string>(["q","sort","limit","offset"]);

const count = (value: unknown): number | undefined => {
  const parsed = Number(first(value));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/** A table of ready-made filters: the name a request asks for in `?query=`, and the parameters it stands for. */
export type NamedQueries = Record<string, Record<string, string>>;

/** The request with the ready-made filter that `?query=name` picks folded in: its conditions replace the request's own value of the same column, and its `sort` and `limit` are only defaults. A name that is not in the table leaves the request as it is. */
export function withNamedQuery(query: Query | undefined, queries: NamedQueries): Query | undefined {
  const name = first(query?.query);
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(queries, name)) return query;
  const merged: Query = { ...query };
  delete merged.query;
  for (const [key, value] of Object.entries(queries[name] ?? {})) {
    const given = first(merged[key]);
    if (!RESERVED.has(key) || given === undefined || given === "") merged[key] = value;
  }
  return merged;
}

/** Reads the `q`, `sort`, `offset` and `limit` query parameters and keeps every other one that holds text as a filter; one that is missing or invalid is left out. */
export function parseListQuery(query: Query | undefined): ListQuery {
  const search = first(query?.q);
  const sort = first(query?.sort);
  const descending = typeof sort === "string" && sort.startsWith("-");
  return {
    search: typeof search === "string" && search !== "" ? search : undefined,
    sort:
      typeof sort === "string" && sort.replace(/^-/, "") !== ""
        ? { field: descending ? sort.slice(1) : sort, descending }
        : undefined,
    offset: count(query?.offset) ?? 0,
    limit: count(query?.limit),
    filters: Object.fromEntries(
      Object.entries(query ?? {})
        .filter(([name]) => !RESERVED.has(name))
        .map(([name, value]) => [name, first(value)])
        .filter(([, value]) => typeof value === "string" && value !== ""),
    ) as Record<string, string>,
  };
}
