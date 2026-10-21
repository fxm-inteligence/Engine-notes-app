import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { hasSession } from "./session";

/** True once the backend accepts the session cookie; otherwise sends the browser to `redirectTo`. */
export function useRequireAuth(redirectTo: string): boolean {
  const router = useRouter();
  const redirect = useCallback((to: string) => router.replace(to), [router]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void hasSession().then((signedIn) => {
      if (!active) return;
      if (signedIn) setReady(true);
      else redirect(redirectTo);
    });
    return () => {
      active = false;
    };
  }, [redirect, redirectTo]);

  return ready;
}
