import { apiUrl } from "./api";

export interface RealtimeMessage {
  route: string;
  data: unknown;
}

type MessageListener = (message: RealtimeMessage) => void;
type ConnectionListener = (connected: boolean) => void;

let socket: WebSocket | null = null;
const messageListeners = new Set<MessageListener>();
const connectionListeners = new Set<ConnectionListener>();

// Where the backend accepts sockets: `/ws` on the API's own port, unless the backend
// runs its WebSocket worker on a port of its own (then this line names that port).
const SOCKET_ADDRESS: { port?: number; path: string } = { path: "/ws" };

// `apiUrl("")` is just the API's own base URL; swapping the scheme turns it into
// the same host's WebSocket URL ("http" -> "ws", "https" -> "wss" since "https"
// already starts with the literal substring "http").
function socketUrl(): string {
  const base = apiUrl("").replace(/^http/, "ws");
  if (SOCKET_ADDRESS.port === undefined) return `${base}${SOCKET_ADDRESS.path}`;
  const url = new URL(base);
  url.port = String(SOCKET_ADDRESS.port);
  url.pathname = SOCKET_ADDRESS.path;
  return url.toString();
}

function ensureSocket(): WebSocket | null {
  if (typeof WebSocket === "undefined") return null;
  if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
    return socket;
  }

  const next = new WebSocket(socketUrl());
  next.addEventListener("open", () => {
    for (const notify of connectionListeners) notify(true);
  });
  next.addEventListener("close", () => {
    for (const notify of connectionListeners) notify(false);
  });
  next.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data)) as RealtimeMessage;
      for (const listener of messageListeners) listener(message);
    } catch {
      // Not a JSON push from a Data/Realtime gateway; ignore.
    }
  });
  socket = next;
  return next;
}

/**
 * Calls `onMessage` with every push on `route`; `onConnected` (when given)
 * tracks the shared socket's own open/close state. Returns the unsubscribe
 * function.
 */
export function subscribeRealtime(
  route: string,
  onMessage: (data: unknown) => void,
  onConnected?: (connected: boolean) => void,
): () => void {
  const messageListener: MessageListener = (message) => {
    if (message.route === route) onMessage(message.data);
  };
  messageListeners.add(messageListener);
  if (onConnected) connectionListeners.add(onConnected);

  const current = ensureSocket();
  onConnected?.(current?.readyState === WebSocket.OPEN);

  return () => {
    messageListeners.delete(messageListener);
    if (onConnected) connectionListeners.delete(onConnected);
  };
}

/** Sends `{ route, ...payload }` on the shared socket, waiting for it to open first if needed. */
export function sendRealtime(route: string, payload: Record<string, unknown> = {}): void {
  const current = ensureSocket();
  if (!current) return;
  const body = JSON.stringify({ route, ...payload });
  if (current.readyState === WebSocket.OPEN) {
    current.send(body);
  } else {
    current.addEventListener("open", () => current.send(body), { once: true });
  }
}
