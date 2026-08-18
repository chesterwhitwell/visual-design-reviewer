"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function AuthControls() {
  const router = useRouter();
  const [passwordSession, setPasswordSession] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const status = (await response.json()) as { mode: string; authenticated: boolean };
        setPasswordSession(status.mode === "password" && status.authenticated);
      })
      .catch(() => undefined);
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", headers: { "X-VDR-Request": "1" } });
    router.replace("/login");
    router.refresh();
  }

  return passwordSession ? (
    <button className="button button-ghost header-signout" type="button" onClick={() => void signOut()}>
      Sign out
    </button>
  ) : null;
}
