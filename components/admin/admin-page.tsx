"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { AppHeader } from "@/components/shared/app-header";

type AdminOverview = {
  generatedAt: string;
  application: {
    version: string;
    commit: string | null;
    nodeVersion: string;
    uptimeSeconds: number;
    environment: string;
  };
  security: {
    authMode: "disabled" | "password";
    authenticationConfigured: boolean;
    activeSessions: number;
    sessionHours: number;
    secureTransport: boolean;
    secureCookiePolicy: string;
    allowedHostCount: number;
    warnings: string[];
  };
  configuration: {
    ready: boolean;
    missing: string[];
    gateway: string;
    visionModel: string | null;
    synthesisModel: string | null;
    imageDetail: string;
    reasoningEffort: string;
    retentionHours: number | null;
    taxonomy: { label: string; version: string; areas: number };
    promptVersions: string[];
    pricing: { status: string; catalogVersion: string | null; modelCount: number; currency: string };
  };
  database: {
    path: string;
    databaseBytes: number;
    walBytes: number;
    sharedMemoryBytes: number;
    journalMode: string;
    foreignKeys: boolean;
  };
  storage: {
    path: string;
    encryptedBytes: number;
    trackedPlaintextBytes: number;
    fileCount: number;
    volume: { totalBytes: number; availableBytes: number } | null;
    imageStates: Record<string, number>;
    expiredImages: number;
  };
  analysis: {
    reviewCount: number;
    runStates: Record<string, number>;
    recentFailures: Array<{
      id: string;
      reviewId: string;
      kind: string;
      errorCode: string;
      errorMessage: string;
      updatedAt: string;
    }>;
  };
  usage: {
    totals: {
      attempts: number;
      failedAttempts: number;
      inputTokens: number;
      cachedInputTokens: number;
      cacheWriteInputTokens: number;
      outputTokens: number;
      reasoningOutputTokens: number;
      totalTokens: number;
      estimatedCostMicroUsd: number;
      unpricedAttempts: number;
    };
    byModel: Array<{
      model: string;
      attempts: number;
      totalTokens: number;
      estimatedCostMicroUsd: number;
      unpricedAttempts: number;
    }>;
    byDay: Array<{
      day: string;
      attempts: number;
      totalTokens: number;
      estimatedCostMicroUsd: number;
    }>;
    note: string;
  };
};

type ActionState = { name: string; message: string; error: boolean } | null;

export function AdminPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState<ActionState>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login?returnTo=/admin");
        return;
      }
      if (!response.ok) throw new Error("Administration data could not be loaded.");
      setOverview((await response.json()) as AdminOverview);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Administration data could not be loaded.");
    }
  }

  useEffect(() => {
    void fetch("/api/admin/overview", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/login?returnTo=/admin");
          return null;
        }
        if (!response.ok) throw new Error("Administration data could not be loaded.");
        return response.json() as Promise<AdminOverview>;
      })
      .then((result) => {
        if (result) setOverview(result);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : "Administration data could not be loaded.");
      });
  }, [router]);

  async function runAction(name: string, path: string) {
    setBusy(name);
    setAction(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "X-VDR-Request": "1" } });
      const body = (await response.json()) as Record<string, unknown> & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? `${name} failed.`);
      if (path.includes("sessions/revoke")) {
        router.replace("/login");
        return;
      }
      setAction({ name, message: actionMessage(path, body), error: false });
      await load();
    } catch (error) {
      setAction({ name, message: error instanceof Error ? error.message : `${name} failed.`, error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader status={overview?.configuration.ready ? "API ready" : "Needs attention"} />
      <main className="admin-main">
        <div className="admin-heading">
          <div>
            <p className="eyebrow">Installation administration</p>
            <h1>System overview</h1>
            <p>Private operational status, usage estimates, storage health, and access controls.</p>
          </div>
          <button className="button button-secondary" onClick={() => void load()}>Refresh</button>
        </div>

        {loadError ? <div className="notice error-notice">{loadError}</div> : null}
        {!overview ? <div className="admin-card"><div className="skeleton" style={{ height: 180 }} /></div> : (
          <>
            {overview.security.warnings.length ? (
              <section className="admin-warning-list" aria-label="Security warnings">
                {overview.security.warnings.map((warning) => <div className="notice" key={warning}>{warning}</div>)}
              </section>
            ) : null}

            <section className="admin-metrics" aria-label="Usage summary">
              <Metric label="Estimated API cost" value={formatUsd(overview.usage.totals.estimatedCostMicroUsd)} detail="Lifetime · USD" />
              <Metric label="Tokens" value={formatNumber(overview.usage.totals.totalTokens)} detail={`${formatNumber(overview.usage.totals.cachedInputTokens)} cached input`} />
              <Metric label="Analyses" value={formatNumber(sumStates(overview.analysis.runStates))} detail={`${formatNumber(overview.analysis.runStates.failed ?? 0)} failed`} />
              <Metric label="Reviews" value={formatNumber(overview.analysis.reviewCount)} detail={`${formatNumber(overview.storage.imageStates.retained ?? 0)} retained images`} />
            </section>

            <div className="admin-grid">
              <section className="admin-card admin-card-wide">
                <CardHeading title="Usage and cost" subtitle={overview.usage.note} />
                <div className="admin-usage-breakdown">
                  <Description label="Input tokens" value={formatNumber(overview.usage.totals.inputTokens)} />
                  <Description label="Cached input" value={formatNumber(overview.usage.totals.cachedInputTokens)} />
                  <Description label="Cache writes" value={formatNumber(overview.usage.totals.cacheWriteInputTokens)} />
                  <Description label="Output tokens" value={formatNumber(overview.usage.totals.outputTokens)} />
                  <Description label="Reasoning output" value={formatNumber(overview.usage.totals.reasoningOutputTokens)} />
                  <Description label="Attempts" value={`${formatNumber(overview.usage.totals.attempts)} (${formatNumber(overview.usage.totals.failedAttempts)} unsuccessful)`} />
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead><tr><th>Model</th><th>Attempts</th><th>Tokens</th><th>Estimated cost</th></tr></thead>
                    <tbody>
                      {overview.usage.byModel.length ? overview.usage.byModel.map((row) => (
                        <tr key={row.model}>
                          <td><code>{row.model}</code></td>
                          <td>{formatNumber(row.attempts)}</td>
                          <td>{formatNumber(row.totalTokens)}</td>
                          <td>{formatUsd(row.estimatedCostMicroUsd)}{row.unpricedAttempts ? <small> · {row.unpricedAttempts} unpriced</small> : null}</td>
                        </tr>
                      )) : <tr><td colSpan={4} className="muted">No metered attempts yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="admin-card">
                <CardHeading title="Access and security" subtitle="Single-administrator installation" />
                <Description label="Authentication" value={overview.security.authMode === "password" ? "Password" : "Disabled"} />
                <Description label="Configuration" value={overview.security.authenticationConfigured ? "Complete" : "Incomplete"} />
                <Description label="Active sessions" value={formatNumber(overview.security.activeSessions)} />
                <Description label="Session duration" value={`${overview.security.sessionHours} hours`} />
                <Description label="Transport" value={overview.security.secureTransport ? "HTTPS" : "HTTP"} />
                <Description label="Allowed hosts" value={formatNumber(overview.security.allowedHostCount)} />
                {overview.security.authMode === "password" ? (
                  <button className="button button-danger admin-action" disabled={Boolean(busy)} onClick={() => void runAction("Revoke sessions", "/api/admin/sessions/revoke")}>Revoke all sessions</button>
                ) : null}
              </section>

              <section className="admin-card">
                <CardHeading title="Configuration" subtitle="Secrets remain server-side" />
                <Description label="Vision model" value={overview.configuration.visionModel ?? "Missing"} />
                <Description label="Synthesis model" value={overview.configuration.synthesisModel ?? "Missing"} />
                <Description label="Image detail" value={overview.configuration.imageDetail} />
                <Description label="Reasoning" value={overview.configuration.reasoningEffort} />
                <Description label="Pricing catalogue" value={overview.configuration.pricing.catalogVersion ?? "Invalid"} />
                <Description label="Taxonomy" value={`${overview.configuration.taxonomy.version} · ${overview.configuration.taxonomy.areas} areas`} />
                {overview.configuration.missing.length ? <p className="admin-card-note">Missing: {overview.configuration.missing.join(", ")}.</p> : null}
                <div className="admin-actions">
                  <button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void runAction("OpenAI test", "/api/settings/openai-test")}>Test OpenAI connection</button>
                  <Link className="button button-ghost" href="/settings">Detailed settings</Link>
                </div>
              </section>

              <section className="admin-card">
                <CardHeading title="Database" subtitle={`${overview.database.journalMode.toUpperCase()} journal · foreign keys ${overview.database.foreignKeys ? "on" : "off"}`} />
                <Description label="Database" value={formatBytes(overview.database.databaseBytes)} />
                <Description label="Write-ahead log" value={formatBytes(overview.database.walBytes)} />
                <Description label="Shared memory" value={formatBytes(overview.database.sharedMemoryBytes)} />
                <p className="admin-path"><code>{overview.database.path}</code></p>
                <button className="button button-secondary admin-action" disabled={Boolean(busy)} onClick={() => void runAction("Database check", "/api/admin/database-check")}>Run database check</button>
              </section>

              <section className="admin-card">
                <CardHeading title="Encrypted image storage" subtitle={`${formatNumber(overview.storage.fileCount)} encrypted files`} />
                <Description label="Encrypted files" value={formatBytes(overview.storage.encryptedBytes)} />
                <Description label="Sanitised source data" value={formatBytes(overview.storage.trackedPlaintextBytes)} />
                <Description label="Retained" value={formatNumber(overview.storage.imageStates.retained ?? 0)} />
                <Description label="Purge pending" value={formatNumber(overview.storage.imageStates.purge_pending ?? 0)} />
                <Description label="Expired" value={formatNumber(overview.storage.expiredImages)} />
                <button className="button button-secondary admin-action" disabled={Boolean(busy)} onClick={() => void runAction("Retention sweep", "/api/admin/retention")}>Run retention sweep</button>
              </section>

              <section className="admin-card admin-card-wide">
                <CardHeading title="Recent analysis failures" subtitle="Safe operational errors only; no model output or image content" />
                {overview.analysis.recentFailures.length ? (
                  <div className="admin-failures">
                    {overview.analysis.recentFailures.map((failure) => (
                      <div key={failure.id}>
                        <strong>{failure.kind} · {failure.errorCode}</strong>
                        <span>{failure.errorMessage}</span>
                        <time>{new Date(failure.updatedAt).toLocaleString("en-NZ")}</time>
                      </div>
                    ))}
                  </div>
                ) : <p className="muted">No recorded analysis failures.</p>}
              </section>
            </div>

            {action ? <div className={`notice admin-action-result ${action.error ? "error-notice" : ""}`}><strong>{action.name}:</strong> {action.message}</div> : null}
            <footer className="admin-footer">
              <span>Version {overview.application.version} · Node {overview.application.nodeVersion} · uptime {formatDuration(overview.application.uptimeSeconds)}</span>
              <a className="button button-secondary" href="/api/admin/diagnostics/export">Download diagnostics</a>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="admin-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function CardHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="admin-card-heading"><h2>{title}</h2><p>{subtitle}</p></div>;
}

function Description({ label, value }: { label: string; value: string }) {
  return <div className="description-row"><span>{label}</span><strong>{value}</strong></div>;
}

function actionMessage(path: string, body: Record<string, unknown>) {
  if (path.includes("database-check")) return body.ok ? "SQLite reported ok." : "SQLite reported a problem.";
  if (path.includes("retention")) return `${String(body.purged ?? 0)} purged, ${String(body.failed ?? 0)} failed.`;
  if (path.includes("openai-test")) return String(body.message ?? "Connection succeeded.");
  return "Completed.";
}

function formatNumber(value: number) { return new Intl.NumberFormat("en-NZ").format(value); }
function formatUsd(microUsd: number) { return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(microUsd / 1_000_000); }
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}
function sumStates(states: Record<string, number>) { return Object.values(states).reduce((sum, value) => sum + value, 0); }
function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
