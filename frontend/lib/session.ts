import { apiRequest } from "./api";

/** True while the backend accepts the session cookie. */
export async function hasSession(): Promise<boolean> {
  try {
    await apiRequest("/auth/session");
    return true;
  } catch {
    return false;
  }
}

/** Signs out — the backend clears the cookie — and sends the browser to `redirectTo` (a full load, so no stale state survives). */
export async function signOut(redirectTo: string): Promise<void> {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } finally {
    if (typeof window !== "undefined") window.location.assign(redirectTo);
  }
}
