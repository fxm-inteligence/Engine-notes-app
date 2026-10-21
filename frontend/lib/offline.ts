import { apiRequest } from "./api";

type Row = Record<string, unknown>;

interface QueuedChange {
  clientId: string;
  operation: "create" | "update" | "delete";
  /** The Write's address without its parameter: `/posts/:id` is the collection `/posts`. */
  collection: string;
  syncUrl: string;
  id?: string;
  data?: Row;
}

/** A change the backend refused; repeating it would change nothing, so it is kept here instead of in the queue. */
export interface FailedChange extends QueuedChange {
  message: string;
}

interface SyncResult {
  clientId: string;
  status: "created" | "updated" | "deleted" | "notFound" | "failed";
  id?: unknown;
  message?: string;
}

const QUEUE_KEY = "fxm:offline:queue";
const FAILED_KEY = "fxm:offline:failed";
const CACHE_PREFIX = "fxm:offline:cache:";
const SYNCED_EVENT = "fxm:synced";
const RETRY_MS = 15000;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = storage()?.getItem(key);
    return raw === null || raw === undefined ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be full or blocked; the change then lives only until the page closes.
  }
}

/** A fetch that never reached the backend rejects with a TypeError; an answer with an error status does not. */
function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectionOf(path: string): string {
  return path.split("?")[0] ?? path;
}

/** Applies one change to a collection; `id` is the id a created record gets. */
function applyChange(rows: Row[], change: QueuedChange, id: string = change.clientId): Row[] {
  if (change.operation === "create") return [...rows, { ...change.data, id }];
  if (change.operation === "update") {
    return rows.map((row) => (String(row.id) === change.id ? { ...row, ...change.data } : row));
  }
  return rows.filter((row) => String(row.id) !== change.id);
}

/** A list with the changes still waiting in the queue applied; anything else is left as it is. */
function withQueued<T>(path: string, value: T): T {
  if (!Array.isArray(value)) return value;
  const collection = collectionOf(path);
  return load<QueuedChange[]>(QUEUE_KEY, [])
    .filter((change) => change.collection === collection)
    .reduce((rows, change) => applyChange(rows, change), value as Row[]) as T;
}

function cacheKeys(): string[] {
  const store = storage();
  if (!store) return [];
  return Array.from({ length: store.length }, (_unused, index) => store.key(index) ?? "").filter(
    (key) => key.startsWith(CACHE_PREFIX),
  );
}

/** The changes the backend took are applied to every stored copy of their collection too. */
function patchCaches(change: QueuedChange, id: string): void {
  for (const key of cacheKeys()) {
    if (collectionOf(key.slice(CACHE_PREFIX.length)) !== change.collection) continue;
    const rows = load<unknown>(key, undefined);
    if (Array.isArray(rows)) save(key, applyChange(rows as Row[], change, id));
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
let flushing = false;
const inFlight = new Set<string>();

function pending(): QueuedChange[] {
  return load<QueuedChange[]>(QUEUE_KEY, []);
}

function keepRetrying(): void {
  if (pending().length === 0) {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  } else if (timer === undefined && storage()) {
    timer = setInterval(() => void flushQueue(), RETRY_MS);
  }
}

function enqueue(
  method: string,
  collection: string,
  syncUrl: string,
  id: string | undefined,
  data: Row,
): Row | undefined {
  const queue = pending();
  const clientId = `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let result: Row | undefined;
  if (method === "POST") {
    queue.push({ clientId, operation: "create", collection, syncUrl, data });
    result = { ...data, id: clientId };
  } else if (id !== undefined && method === "DELETE") {
    // A record that was never created needs no delete: its create and every change of it drop out.
    const created = queue.some((change) => change.clientId === id && !inFlight.has(id));
    const rest = queue.filter((change) => change.clientId !== id && change.id !== id);
    if (!created) rest.push({ clientId, operation: "delete", collection, syncUrl, id });
    queue.splice(0, queue.length, ...rest);
  } else if (id !== undefined) {
    const created = queue.find((change) => change.clientId === id && !inFlight.has(id));
    const earlier = queue.find((change) => change.operation === "update" && change.id === id);
    const target = created ?? earlier;
    if (target) target.data = { ...target.data, ...data };
    else queue.push({ clientId, operation: "update", collection, syncUrl, id, data });
    result = { ...data, id };
  }
  save(QUEUE_KEY, queue);
  keepRetrying();
  return result;
}

/** Sends every queued change to its Sync endpoint, one request per endpoint; what stays unanswered stays queued. */
export async function flushQueue(): Promise<void> {
  if (flushing || pending().length === 0) return;
  flushing = true;
  let settledAny = false;
  try {
    const batch = pending();
    for (const syncUrl of new Set(batch.map((change) => change.syncUrl))) {
      const sent = batch.filter((change) => change.syncUrl === syncUrl);
      for (const change of sent) inFlight.add(change.clientId);
      try {
        const answer = await apiRequest<{ results?: SyncResult[] }>(syncUrl, {
          method: "POST",
          json: {
            changes: sent.map(({ clientId, operation, id, data }) => ({
              clientId,
              operation,
              id,
              data,
            })),
          },
        });
        if (Array.isArray(answer?.results)) {
          settle(sent, answer.results);
          settledAny = true;
        }
      } catch {
        // The network or the backend is down: the changes wait for the next try.
      } finally {
        for (const change of sent) inFlight.delete(change.clientId);
      }
    }
  } finally {
    flushing = false;
    keepRetrying();
  }
  if (settledAny && typeof window !== "undefined") window.dispatchEvent(new Event(SYNCED_EVENT));
}

function settle(sent: QueuedChange[], results: SyncResult[]): void {
  const realIds = new Map<string, string>();
  const answered = new Set<string>();
  const failed = load<FailedChange[]>(FAILED_KEY, []);
  for (const result of results) {
    const change = sent.find((candidate) => candidate.clientId === result.clientId);
    if (!change) continue;
    answered.add(change.clientId);
    if (result.status === "failed") {
      failed.push({ ...change, message: result.message ?? "The change failed" });
      continue;
    }
    if (result.status === "created" && result.id !== undefined) {
      realIds.set(change.clientId, String(result.id));
    }
    if (result.status !== "notFound" || change.operation === "delete") {
      patchCaches(change, realIds.get(change.clientId) ?? change.clientId);
    }
  }
  // A change made while the request was out may still name a temporary id.
  const rest = pending()
    .filter((change) => !answered.has(change.clientId))
    .map((change) =>
      change.id !== undefined && realIds.has(change.id)
        ? { ...change, id: realIds.get(change.id) }
        : change,
    );
  save(QUEUE_KEY, rest);
  save(FAILED_KEY, failed);
}

/** Calls `listener` after a flush settled changes, so a page can read its data again. */
export function onSynced(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SYNCED_EVENT, listener);
  return () => window.removeEventListener(SYNCED_EVENT, listener);
}

/** The changes still waiting for the network. */
export function pendingChanges(): QueuedChange[] {
  return pending();
}

/** The changes the backend refused, oldest first. */
export function failedChanges(): FailedChange[] {
  return load<FailedChange[]>(FAILED_KEY, []);
}

/** Forgets the refused changes once the user has seen them. */
export function clearFailedChanges(): void {
  save(FAILED_KEY, []);
}

/** A Read: with `offline` its last answer is kept, and shown again while the network is down. */
export async function readRequest<T>(path: string, offline: boolean): Promise<T> {
  if (!offline) return apiRequest<T>(path);
  try {
    const value = await apiRequest<T>(path);
    save(`${CACHE_PREFIX}${path}`, value);
    return withQueued(path, value);
  } catch (error) {
    const kept = load<T | undefined>(`${CACHE_PREFIX}${path}`, undefined);
    if (!isNetworkFailure(error) || kept === undefined) throw error;
    return withQueued(path, kept);
  }
}

/**
 * A Write: with a `syncUrl` one that never reached the backend is queued instead of failing. `path`
 * is the address with its parameters filled, `pathTemplate` the Block's own (`/posts/:id`), whose
 * last segment tells the record a PUT, PATCH or DELETE is about.
 */
export async function writeRequest<T>(
  path: string,
  method: string,
  body: unknown,
  pathTemplate: string,
  syncUrl: string | undefined,
): Promise<T> {
  try {
    return await apiRequest<T>(path, { method, json: body });
  } catch (error) {
    if (!syncUrl || !isNetworkFailure(error)) throw error;
    const byId = method !== "POST";
    if (byId && !/\/:[A-Za-z0-9_]+$/.test(pathTemplate)) throw error;
    const cut = path.lastIndexOf("/");
    const collection = byId ? path.slice(0, cut) : collectionOf(path);
    const id = byId ? decodeURIComponent(path.slice(cut + 1)) : undefined;
    return enqueue(method, collection, syncUrl, id, isRow(body) ? body : {}) as T;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushQueue());
  keepRetrying();
  void flushQueue();
}
