import { createHmac, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";

const ITERATIONS = 100_000;
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 8;

const JWT_SECRET_MISSING =
  "JWT_SECRET is not set. Generate one with: openssl rand -hex 32 — and set it in the environment. Without a stable secret every restart invalidates all issued tokens, and each replica signs with a different key.";

let cachedSecret: string | undefined;

/** The HS256 signing secret. Resolved on first use so a project without tokens still boots. */
function secret(): string {
  if (cachedSecret === undefined) {
    const configured = process.env.JWT_SECRET;
    if (!configured) throw new Error(JWT_SECRET_MISSING);
    cachedSecret = configured;
  }
  return cachedSecret;
}

function derive(password: string, salt: Buffer, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, 32, "sha256", (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** `pbkdf2$<iterations>$<salt>$<hash>`, base64 parts. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), Number(iterations));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A well-formed hash that no password matches, verified when the lookup found nothing so that "no such user" costs the same as "wrong password". Returning before the derivation skipped ~100k PBKDF2 rounds, which is a user-enumeration oracle on every generated login endpoint. */
export const NO_RECORD_PASSWORD_HASH =
  "pbkdf2$100000$23q2CC8EDlCE6IAE6AWUkA==$Sw3CSkd4xdMrJorbOsYSExuHZIb+3rvTGfKm/OS+pDw=";

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

/** An HS256 JWT carrying `payload` plus an expiry. */
export function signToken(payload: Record<string, unknown>): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS;
  const body = base64Url(JSON.stringify({ ...payload, exp }));
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}

/** What a guard reads from a token: the signed-in record's string `role` and its list of string `permissions`, and the `tenant_id` of the tenant its row belongs to, when it has them. */
export function accessClaims(record: object): Record<string, unknown> {
  const fields = record as Record<string, unknown>;
  const claims: Record<string, unknown> = {};
  if (typeof fields.tenantId === "string") claims.tenant_id = fields.tenantId;
  if (typeof fields.role === "string") claims.role = fields.role;
  if (Array.isArray(fields.permissions)) {
    claims.permissions = fields.permissions.filter((item) => typeof item === "string");
  }
  return claims;
}

/** The token's payload when its signature and expiry hold, otherwise undefined. */
export function verifyToken(token: string): Record<string, unknown> | undefined {
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) return undefined;
  const expected = Buffer.from(sign(`${header}.${body}`));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof payload.exp === "number" && payload.exp > Date.now() / 1000 ? payload : undefined;
  } catch {
    return undefined;
  }
}

const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";

/** The `Set-Cookie` value that signs a web client in: the token in an HttpOnly cookie page scripts cannot read. */
export function sessionCookie(token: string): string {
  return `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${COOKIE_SECURE ? "; Secure" : ""}`;
}

/** The `Set-Cookie` value that signs a web client out. */
export function clearedSessionCookie(): string {
  return `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${COOKIE_SECURE ? "; Secure" : ""}`;
}

export interface Authentication {
  /** The token's claims; absent when the request is refused. */
  payload?: Record<string, unknown>;
  /** 200 when the request is let through, else the 401 / 403 to answer with. */
  status: number;
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(", ") : (value ?? "");
}

function cookieValue(cookies: string, name: string): string | undefined {
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/**
 * Who sent a request: a valid Bearer token wins; otherwise the session cookie's token, which on a
 * method that changes data must come with the X-Requested-With header (403 without it). A missing or
 * invalid token is a 401.
 */
export function authenticate(
  headers: Record<string, string | string[] | undefined>,
  method: string,
): Authentication {
  const authorization = headerValue(headers.authorization);
  if (authorization.startsWith("Bearer ")) {
    const payload = verifyToken(authorization.slice(7));
    return payload ? { payload, status: 200 } : { status: 401 };
  }
  const token = cookieValue(headerValue(headers.cookie), "session");
  const payload = token ? verifyToken(token) : undefined;
  if (!payload) return { status: 401 };
  const readOnly = ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  return readOnly || headerValue(headers["x-requested-with"]) !== "" ? { payload, status: 200 } : { status: 403 };
}

export type BusinessRule = [field: string, kind: string, argument: string];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9]{7,15}$/;
const URL_TEXT = /^https?:\/\/[^\s/$.?#][^\s]*$/;
const MOMENT = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?)?$/;
const CLOCK = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** A value as the text a rule compares: a whole number without a fraction, a boolean as true or false. */
function plain(value: unknown): string {
  return String(value);
}

/** The moment (milliseconds) a text names: a date, or a date and time with an optional offset (UTC without one); null for anything else. */
function moment(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = MOMENT.exec(value.trim());
  if (!parts) return null;
  const [year = 0, month = 0, day = 0] = (parts[1] ?? "").split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
    return null;
  }
  const time = Date.parse(parts[1] + "T" + (parts[2] ?? "00:00") + (parts[3] ?? "Z"));
  return Number.isNaN(time) ? null : time;
}

/** Which of two values comes first (-1, 0, 1): numbers by size, dates and times by moment, clock times by the clock; null when they cannot be compared. */
function ordered(left: unknown, right: unknown): number | null {
  if (typeof left === "number" && typeof right === "number") return Math.sign(left - right);
  if (typeof left !== "string" || typeof right !== "string") return null;
  const a = moment(left);
  const b = moment(right);
  if (a !== null && b !== null) return Math.sign(a - b);
  const x = CLOCK.exec(left.trim());
  const y = CLOCK.exec(right.trim());
  if (!x || !y) return null;
  const seconds = (parts: RegExpExecArray) =>
    Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3] ?? 0);
  return Math.sign(seconds(x) - seconds(y));
}

/** The problems record has against rules; partial skips absent values (a PATCH). */
export function checkRules(record: object, rules: BusinessRule[], partial: boolean): string[] {
  const values = record as Record<string, unknown>;
  const problems: string[] = [];
  for (const [field, kind, argument] of rules) {
    const value = values[field];
    const present = value !== undefined && value !== null;
    if (kind === "required") {
      if (present ? typeof value === "string" && value.trim() === "" : !partial) {
        problems.push(field + " is required");
      }
      continue;
    }
    if (kind === "requiredIf") {
      const at = argument.indexOf("=");
      const other = values[argument.slice(0, at)];
      const expected = argument.slice(at + 1);
      const applies = other !== undefined && other !== null && plain(other) === expected;
      if (applies && (present ? typeof value === "string" && value.trim() === "" : !partial)) {
        problems.push(field + " is required when " + argument.slice(0, at) + " is " + expected);
      }
      continue;
    }
    if (!present) continue;
    const text = String(value);
    const limit = Number(argument);
    if (kind === "min" && Number(value) < limit) {
      problems.push(field + " must be at least " + argument);
    } else if (kind === "max" && Number(value) > limit) {
      problems.push(field + " must be at most " + argument);
    } else if (kind === "minLength" && text.length < limit) {
      problems.push(field + " must be at least " + argument + " characters long");
    } else if (kind === "maxLength" && text.length > limit) {
      problems.push(field + " must be at most " + argument + " characters long");
    } else if (kind === "pattern" && !new RegExp(argument).test(text)) {
      problems.push(field + " is invalid");
    } else if (kind === "email" && !EMAIL.test(text)) {
      problems.push(field + " must be a valid email");
    } else if (kind === "phone" && !PHONE.test(text.replace(/[\s().-]/g, ""))) {
      problems.push(field + " must be a valid phone number");
    } else if (kind === "url" && !URL_TEXT.test(text)) {
      problems.push(field + " must be a valid URL");
    } else if (kind === "future" || kind === "past") {
      const time = moment(value);
      if (time === null) problems.push(field + " must be a valid date");
      else if (kind === "future" ? time <= Date.now() : time >= Date.now()) {
        problems.push(field + " must be in the " + kind);
      }
    } else if (kind === "after" || kind === "before") {
      const other = values[argument];
      const order = other === undefined || other === null ? null : ordered(value, other);
      if (order !== null && (kind === "after" ? order <= 0 : order >= 0)) {
        problems.push(field + " must be " + kind + " " + argument);
      }
    }
  }
  return problems;
}

const SPACES = /^[ \t\r\n]+|[ \t\r\n]+$/g;
const NUMBER_TEXT = /^-?[0-9]+(?:\.[0-9]+)?$/;

/** The number a value stands for: a number, or text written as one; null for anything else. */
function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return typeof value === "string" && NUMBER_TEXT.test(value) ? Number(value) : null;
}

/** The text after one of the functions a computed rule names: trim, lower, upper or slug. */
function textFunction(name: string, text: string): string {
  if (name === "trim") return text.replace(SPACES, "");
  if (name === "lower") return text.toLowerCase();
  if (name === "upper") return text.toUpperCase();
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** The values the computed rules ("set" and "fill") give record's fields, each seeing the ones before it; partial is a PATCH. */
export function computeFields(
  record: object,
  rules: BusinessRule[],
  partial: boolean,
): Record<string, unknown> {
  const values = { ...(record as Record<string, unknown>) };
  const changes: Record<string, unknown> = {};
  for (const [field, kind, argument] of rules) {
    const current = values[field];
    const present = current !== undefined && current !== null;
    if (kind === "fill" && (present ? typeof current !== "string" || current.trim() !== "" : partial)) {
      continue;
    }
    const [form, ...parts] = argument.split(" ");
    let result: unknown;
    if (form === "now") {
      result = new Date().toISOString();
    } else if (form === "pipe") {
      const source = values[parts[0] ?? ""];
      if (typeof source !== "string") continue;
      result = parts.slice(1).reduce((text, name) => textFunction(name, text), source);
    } else if (form === "calc") {
      const operand = (token: string | undefined) =>
        NUMBER_TEXT.test(token ?? "") ? Number(token) : numeric(values[token ?? ""]);
      const left = operand(parts[0]);
      const right = operand(parts[2]);
      if (left === null || right === null) continue;
      let number = parts[1] === "+" ? left + right : parts[1] === "-" ? left - right : left * right;
      if (parts[1] === "/") number = left / right;
      if (parts.length === 5) {
        let scale = 1;
        for (let digit = 0; digit < Number(parts[4]); digit++) scale *= 10;
        number = Math.floor(number * scale + 0.5) / scale;
      }
      if (!Number.isFinite(number)) continue;
      result = number;
    } else {
      continue;
    }
    values[field] = result;
    changes[field] = result;
  }
  return changes;
}
