import { randomUUID } from "node:crypto";

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

/** The lowest level written: LOG_LEVEL when it names one, else the level of the Logging block. */
function minimum(): number {
  const given = (process.env.LOG_LEVEL ?? "").trim().toLowerCase();
  const index = LEVELS.indexOf(given as Level);
  return index >= 0 ? index : LEVELS.indexOf("info");
}

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** The id the caller sent in X-Request-Id when it is short and plain, else a new one. */
function requestIdOf(header: string | string[] | undefined): string {
  return typeof header === "string" && REQUEST_ID.test(header) ? header : randomUUID();
}

/** `/orders/:id` is written `/orders/{id}`, the way the API documentation writes it. */
function pattern(route: string): string {
  return route.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

/** Writes the line of one answered request to the standard output; `route` is nothing when no route answered it. */
function record(
  method: string,
  route: string | undefined,
  url: string,
  status: number,
  millis: number,
  requestId: string,
): void {
  const path = url.split("?")[0] ?? "";
  if (path === "/health") return;
  const level: Level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  if (LEVELS.indexOf(level) < minimum()) return;
  process.stdout.write(
    JSON.stringify({
      time: new Date().toISOString(),
      level,
      message: "request",
      method,
      route: route === undefined ? "unmatched" : pattern(route),
      path,
      status,
      durationMs: Math.round(millis * 10) / 10,
      requestId,
    }) + "\n",
  );
}

interface LogRequest {
  method?: string;
  baseUrl?: string;
  originalUrl?: string;
  url?: string;
  route?: { path?: unknown };
  headers: Record<string, string | string[] | undefined>;
}
interface LogResponse {
  statusCode: number;
  once(event: "finish", listener: () => void): unknown;
  setHeader(name: string, value: string): unknown;
}

/** Express middleware: gives the request an id and writes its line once the answer is sent. The route is known by then. */
export function requestLogging(req: LogRequest, res: LogResponse, next: () => void): void {
  const started = process.hrtime.bigint();
  const requestId = requestIdOf(req.headers["x-request-id"]);
  res.setHeader("X-Request-Id", requestId);
  res.once("finish", () => {
    const path = req.route?.path;
    record(
      req.method ?? "GET",
      typeof path === "string" ? (req.baseUrl ?? "") + path : undefined,
      req.originalUrl ?? req.url ?? "",
      res.statusCode,
      Number(process.hrtime.bigint() - started) / 1e6,
      requestId,
    );
  });
  next();
}
