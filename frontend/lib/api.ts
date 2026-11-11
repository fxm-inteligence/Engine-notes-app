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

/** An answer with an error status: `status` is the HTTP status, `message` the words to show the person. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** What a refusal says when the backend gave no words of its own. */
const REFUSALS: Record<number, string> = {
  403: "You are not allowed to do this.",
  409: "This conflicts with a record that is already there.",
  422: "The data was not accepted.",
};

/** The words in an error body: a text, the texts of a list, or the `message` of an object. */
function wordsOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(wordsOf).filter(Boolean).join("; ");
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return wordsOf(record.message ?? record.msg);
  }
  return "";
}

/**
 * The words of a failed request. Each backend puts its own text in a different key (`message`,
 * `detail`, `error`, `title`), so the first one that holds words is shown; with none, a plain
 * sentence for the refusals logic gives (403, 409, 422), else the bare status.
 */
async function refusalText(response: Response): Promise<string> {
  let words = "";
  if (response.status < 500) {
    try {
      const body: unknown = JSON.parse(await response.text());
      if (body !== null && typeof body === "object") {
        const record = body as Record<string, unknown>;
        words = [record.message, record.detail, record.error, record.title]
          .map(wordsOf)
          .find((candidate) => candidate.length > 0) ?? "";
      }
    } catch {
      // A body that is not JSON carries no words.
    }
  }
  return words || REFUSALS[response.status] || `Request failed with status ${response.status}`;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  // The session cookie rides along with `credentials`; a cookie-authorized request that changes data
  // must also carry this header, which a cross-site form post cannot set.
  const headers: Record<string, string> = { "X-Requested-With": "fetch" };
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  const captcha = typeof window === "undefined" ? undefined : (window as unknown as { captchaToken?: () => string }).captchaToken;
  const captchaToken = captcha && (options.method ?? "GET") === "POST" ? captcha() : "";
  if (captchaToken) headers["X-Captcha-Token"] = captchaToken;
  const locale = typeof document === "undefined" ? undefined : document.cookie.split("; ").find((entry) => entry.startsWith("locale="))?.slice(7);
  if (locale) headers["Accept-Language"] = locale;
  const response = await fetch(apiUrl(path), {
    method: options.method ?? "GET",
    credentials: "include",
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await refusalText(response));
  }
  const text = await response.text();
  return (text ? unwrap(JSON.parse(text)) : undefined) as T;
}
