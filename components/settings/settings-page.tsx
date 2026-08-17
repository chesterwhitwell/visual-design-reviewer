"use client";

import { useEffect, useState } from "react";

import { AppHeader } from "@/components/shared/app-header";

type Status = {
  ready: boolean;
  label: string;
  gateway: "openai" | "fake";
  hasApiKey: boolean;
  hasEncryptionKey: boolean;
  visionModel: string | null;
  synthesisModel: string | null;
  imageDetail: string;
  reasoningEffort: string;
  dataMode: "standard" | "zdr";
  retentionMode: "review_session";
  retentionHours: number | null;
  databasePath: string;
  imageStoragePath: string;
  taxonomy: {
    id: string;
    label: string;
    version: string;
    areaCount: number;
  };
  promptVersions: string[];
  requestTimeoutMs: number;
  maximumOutputTokensPerPass: number;
  missing: string[];
  limits: Record<string, number>;
};

export function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [testState, setTestState] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "success" | "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    void fetch("/api/settings/status", { cache: "no-store" })
      .then(async (response) => setStatus((await response.json()) as Status))
      .catch(() => setStatus(null));
  }, []);

  async function testConnection() {
    setTestState({ kind: "running" });
    try {
      const response = await fetch("/api/settings/openai-test", {
        method: "POST",
        headers: { "X-VDR-Request": "1" },
      });
      const body = (await response.json()) as {
        message?: string;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "The connection test failed.");
      setTestState({ kind: "success", message: body.message ?? "Connection succeeded." });
    } catch (error) {
      setTestState({
        kind: "error",
        message: error instanceof Error ? error.message : "The connection test failed.",
      });
    }
  }

  return (
    <div className="app-shell">
      <AppHeader status={status?.ready ? "API ready" : status?.label} />
      <main className="settings-main">
        <div className="settings-heading">
          <p className="eyebrow">Local configuration</p>
          <h1>Settings and privacy</h1>
          <p>
            Secrets are read by the server process. They are never returned to this page or stored
            in browser JavaScript.
          </p>
        </div>

        {!status ? (
          <div className="settings-card"><div className="skeleton" style={{ height: 180 }} /></div>
        ) : (
          <div className="settings-grid">
            <section className="settings-card">
              <div className="settings-card-heading">
                <div>
                  <h2>OpenAI connection</h2>
                  <p>Responses API · server-side only</p>
                </div>
                <span className={`configuration-state ${status.ready ? "configured" : "missing"}`}>
                  {status.ready ? "Configured" : "Needs attention"}
                </span>
              </div>
              <DescriptionRow label="Gateway" value={status.gateway === "fake" ? "Test only" : "OpenAI"} />
              <DescriptionRow label="API key" value={status.hasApiKey ? "Present on server" : "Missing"} />
              <DescriptionRow label="Vision model" value={status.visionModel ?? "Not configured"} />
              <DescriptionRow label="Synthesis model" value={status.synthesisModel ?? "Not configured"} />
              <DescriptionRow label="Image detail" value={status.imageDetail} />
              <DescriptionRow label="Reasoning effort" value={status.reasoningEffort} />
              {status.missing.length ? (
                <div className="notice error-notice" style={{ marginTop: 18, marginBottom: 0 }}>
                  Missing: {status.missing.join(", ")}.
                </div>
              ) : null}
              <div style={{ marginTop: 20 }}>
                <button
                  className="button button-secondary"
                  disabled={testState.kind === "running"}
                  onClick={testConnection}
                >
                  {testState.kind === "running" ? "Testing…" : "Test API connection"}
                </button>
              </div>
              {testState.kind === "success" || testState.kind === "error" ? (
                <div
                  className={`notice ${testState.kind === "error" ? "error-notice" : ""}`}
                  style={{ marginTop: 14, marginBottom: 0 }}
                >
                  {testState.message}
                </div>
              ) : null}
            </section>

            <section className="settings-card">
              <div className="settings-card-heading">
                <div>
                  <h2>Data handling</h2>
                  <p>Declared application and API policy</p>
                </div>
              </div>
              <DescriptionRow
                label="OpenAI data mode"
                value={status.dataMode === "zdr" ? "ZDR — organisation declared" : "Standard API"}
              />
              <DescriptionRow
                label="Local encryption"
                value={status.hasEncryptionKey ? "Configured" : "Missing"}
              />
              <DescriptionRow
                label="Retention mode"
                value="Encrypted review-session retention"
              />
              <DescriptionRow
                label="Automatic purge"
                value={status.retentionHours ? `After ${status.retentionHours} hours` : "Manual only"}
              />
              <div className="privacy-callout">
                <strong>Important</strong>
                <p>
                  Setting the label to ZDR does not verify account eligibility. OpenAI must approve
                  Zero Data Retention for the API organisation or project. Every compatible request
                  still explicitly sends <code>store: false</code>.
                </p>
              </div>
            </section>

            <section className="settings-card">
              <div className="settings-card-heading">
                <div>
                  <h2>Versions and storage</h2>
                  <p>Immutable analysis and local deployment context</p>
                </div>
              </div>
              <DescriptionRow
                label="Taxonomy"
                value={`${status.taxonomy.label} · ${status.taxonomy.version} · ${status.taxonomy.areaCount} areas`}
              />
              <DescriptionRow
                label="Prompt set"
                value={status.promptVersions.join(", ") || "Not available"}
              />
              <DescriptionRow label="Database" value={status.databasePath} />
              <DescriptionRow label="Encrypted images" value={status.imageStoragePath} />
              <DescriptionRow
                label="Request timeout"
                value={`${Math.round(status.requestTimeoutMs / 1000)} seconds`}
              />
              <DescriptionRow
                label="Output cap"
                value={`${new Intl.NumberFormat("en-NZ").format(status.maximumOutputTokensPerPass)} tokens per pass`}
              />
            </section>

            <section className="settings-card settings-card-wide">
              <div className="settings-card-heading">
                <div>
                  <h2>Operational limits</h2>
                  <p>Server-enforced safeguards for this installation</p>
                </div>
              </div>
              <div className="limits-grid">
                {Object.entries(status.limits).map(([key, value]) => (
                  <div className="limit-item" key={key}>
                    <span>{humaniseKey(key)}</span>
                    <strong>{formatLimit(key, value)}</strong>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function DescriptionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="description-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function humaniseKey(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
}

function formatLimit(key: string, value: number) {
  if (key.toLowerCase().includes("bytes")) return `${Math.round(value / 1024 / 1024)} MB`;
  if (key.toLowerCase().includes("pixels")) return `${Math.round(value / 1_000_000)} MP`;
  return new Intl.NumberFormat("en-NZ").format(value);
}
