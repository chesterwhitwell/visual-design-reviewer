"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { EyeMark } from "@/components/shared/icons";

type AuthStatus = {
  mode: "disabled" | "password";
  configured: boolean;
  authenticated: boolean;
  secureTransport: boolean;
};

export function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/auth/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Authentication status could not be loaded.");
        const result = (await response.json()) as AuthStatus;
        setStatus(result);
        if (result.authenticated || result.mode === "disabled") router.replace("/");
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Authentication status could not be loaded.");
      });
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-VDR-Request": "1" },
        body: JSON.stringify({ username, password }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Sign in failed.");
      const returnTo = searchParams.get("returnTo");
      router.replace(returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Sign in failed.");
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand" aria-hidden="true"><EyeMark /></div>
        <p className="eyebrow">Visual Design Reviewer</p>
        <h1 id="login-title">Sign in</h1>
        <p className="login-intro">Enter the administrator credentials for this installation.</p>
        {status && !status.configured ? (
          <div className="notice error-notice">
            Password authentication is incomplete. Set the generated password hash and session
            secret in the container environment, then restart it.
          </div>
        ) : null}
        {status && !status.secureTransport ? (
          <div className="notice login-warning">
            This connection is not using HTTPS. Use a trusted LAN or an HTTPS reverse proxy.
          </div>
        ) : null}
        <form onSubmit={submit} className="login-form">
          <label>
            <span>Username</span>
            <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
          </label>
          <label>
            <span>Password</span>
            <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus />
          </label>
          {error ? <div className="notice error-notice">{error}</div> : null}
          <button className="button button-primary" disabled={submitting || status?.configured === false} type="submit">
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
