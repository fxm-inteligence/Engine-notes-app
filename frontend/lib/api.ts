// Read lazily, not as a module-level constant: Nuxt's `useRuntimeConfig()` needs an
// active Nuxt instance, which only exists once a component/composable is actually
// running — not yet when this module is first imported.
// It is then kept, so the offline queue — which flushes from a timer, outside any component —
// still knows where the backend is once a component has asked.
let resolvedApiBaseUrl: string | undefined;
function apiBaseUrl(): string {
  resolvedApiBaseUrl ??= process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
  return resolvedApiBaseUrl;
}


export function apiUrl(path: string): string {
  return path.startsWith("http://") || path.startsWith("https://") ? path : `${apiBaseUrl()}${path}`;
}

/** Fills a route-style path like `/posts/:id` from the current page's route params. */
export function fillRoutePath(path: string, params: Record<string, unknown>): string {
  return path.replace(new RegExp("/:([A-Za-z0-9_]+)", "g"), (_match, key: string) => {
    return "/" + encodeURIComponent(String(params[key] ?? ""));
  });
}

export interface ApiRequestOptions {
  method?: string;
  /** Sent as the JSON request body. */
  json?: unknown;
}

/** A backend that wraps its answer as `{ "data": ... }` is read the same as one that answers with the value itself. */
function unwrap(value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === "data") {
      return (value as { data: unknown }).data;
    }
  }
  return value;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  // The session cookie rides along with `credentials`; a cookie-authorized request that changes data
  // must also carry this header, which a cross-site form post cannot set.
  const headers: Record<string, string> = { "X-Requested-With": "fetch" };
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(apiUrl(path), {
    method: options.method ?? "GET",
    credentials: "include",
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const text = await response.text();
  return (text ? unwrap(JSON.parse(text)) : undefined) as T;
}
