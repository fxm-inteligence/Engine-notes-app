type Query = Record<string, unknown>;

/** A parsed list query: what a Repository's `findPage` turns into one database query. */
export interface ListQuery {
  search?: string;
  sort?: { field: string; descending: boolean };
  offset: number;
  limit?: number;
}

/** One page of rows and the number of rows that matched before the page was cut. */
export interface Page<T> {
  items: T[];
  total: number;
}

export const TOTAL_COUNT_HEADER = "X-Total-Count";

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

const count = (value: unknown): number | undefined => {
  const parsed = Number(first(value));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/** Reads the `q`, `sort`, `offset` and `limit` query parameters; one that is missing or invalid is left out. */
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
  };
}
