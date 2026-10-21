import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fillRoutePath } from "./api";
import { onSynced, readRequest, writeRequest } from "./offline";

/** `path` with its `/:param` segments filled from the current route. */
function useRoutePath(path: string): string {
  const params = (useParams() ?? {}) as Record<string, unknown>;
  return fillRoutePath(path, params);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Fetches `path` once on mount; `reload` fetches it again. With `offline` the last answer is kept and shown while the network is down (see offline.ts). */
export function useApiData<T = unknown>(pathTemplate: string, offline = false) {
  const path = useRoutePath(pathTemplate);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await readRequest<T>(path, offline));
      setError(null);
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setLoading(false);
    }
  }, [path, offline]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Changes made offline reach the backend later; the page reads again once they have.
  useEffect(() => (offline ? onSynced(() => void reload()) : undefined), [offline, reload]);

  return { data, loading, error, reload };
}

/** Sends a request with `run(body)`; the last failure stays in `error`. With a `syncUrl` a request the network never carried is queued instead (see offline.ts). */
export function useApiWrite<TResult = unknown>(
  pathTemplate: string,
  method: string,
  syncUrl?: string,
) {
  const path = useRoutePath(pathTemplate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async (body?: unknown) => {
      setLoading(true);
      try {
        const result = await writeRequest<TResult>(path, method, body, pathTemplate, syncUrl);
        setError(null);
        return result;
      } catch (caught) {
        setError(toError(caught));
        throw caught;
      } finally {
        setLoading(false);
      }
    },
    [path, method, pathTemplate, syncUrl],
  );

  return { run, loading, error };
}
