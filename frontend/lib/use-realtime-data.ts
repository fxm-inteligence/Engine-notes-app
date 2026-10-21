import { useCallback, useEffect, useState } from "react";
import { sendRealtime, subscribeRealtime } from "./realtime";

export interface RealtimeData<T> {
  data: T | null;
  connected: boolean;
  send: (payload?: Record<string, unknown>) => void;
}

/** Subscribes to every push on `route`; the shared socket (see realtime.ts) opens lazily on first use. */
export function useRealtimeData<T = unknown>(route: string): RealtimeData<T> {
  const [data, setData] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(
    () => subscribeRealtime(route, (payload) => setData(payload as T), setConnected),
    [route],
  );

  const send = useCallback(
    (payload?: Record<string, unknown>) => sendRealtime(route, payload),
    [route],
  );

  return { data, connected, send };
}
