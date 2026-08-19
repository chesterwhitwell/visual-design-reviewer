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
  modelSettingSources: {
    visionModel: SettingSource;
    synthesisModel: SettingSource;
    reasoningEffort: SettingSource;
  };
  savedModelSettings: boolean;
  availableModels: string[];
  reasoningEffortOptions: string[];
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

type SettingSource = "application" | "environment" | "default" | "missing";

type AnalysisSettingsDraft = {
  visionModel: string;
  synthesisModel: string;
  reasoningEffort: string;
};

type ActionState =
  | { kind: "idle" }
  | { kind: "running"; action: "save" | "test" | "reset" }
  | { kind: "success" | "error"; message: string };

export function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<AnalysisSettingsDraft | null>(null);
  const [actionState, setActionState] = useState<ActionState>({ kind: "idle" });

  useEffect(() => {
    void fetch("/api/settings/status", { cache: "no-store" })
      .then(async (response) => {
        const nextStatus = (await response.json()) as Status;
        setStatus(nextStatus);
        setDraft(draftFromStatus(nextStatus));
      })
      .catch(() => setStatus(null));
  }, []);

  async function testConnection() {
    if (!draft) return;
    setActionState({ kind: "running", action: "test" });
    try {
      const response = await fetch("/api/settings/openai-test", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-VDR-Request": "1" },
        body: JSON.stringify(draft),
      });
      const body = (await response.json()) as {
        message?: string;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "The connection test failed.");
      setActionState({ kind: "success", message: body.message ?? "Connection succeeded." });
    } catch (error) {
      setActionState({
        kind: "error",
        message: error instanceof Error ? error.message : "The connection test failed.",
      });
    }
  }

  async function saveSettings() {
    if (!draft) return;
    await mutateSettings("save", "PUT", draft);
  }

  async function resetSettings() {
    await mutateSettings("reset", "DELETE");
  }

  async function mutateSettings(
    action: "save" | "reset",
    method: "PUT" | "DELETE",
    body?: AnalysisSettingsDraft,
  ) {
    setActionState({ kind: "running", action });
    try {
      const response = await fetch("/api/settings/analysis", {
        method,
        headers: {
          "X-VDR-Request": "1",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "The model settings could not be updated.");
      }
      const statusResponse = await fetch("/api/settings/status", { cache: "no-store" });
      if (!statusResponse.ok) throw new Error("The updated settings could not be reloaded.");
      const nextStatus = (await statusResponse.json()) as Status;
      setStatus(nextStatus);
      setDraft(draftFromStatus(nextStatus));
      setActionState({
        kind: "success",
        message:
          action === "save"
            ? "Model settings saved. New analyses will use this configuration."
            : "Saved overrides removed. Environment defaults are active again.",
      });
    } catch (error) {
      setActionState({
        kind: "error",
        message: error instanceof Error ? error.message : "The model settings could not be updated.",
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
            <section className="settings-card settings-card-wide">
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
              <DescriptionRow label="Image detail" value={status.imageDetail} />
              {draft ? (
                <div className="model-settings-form">
                  <ModelField
                    id="vision-model"
                    label="Vision model"
                    list="openai-model-options"
                    onChange={(visionModel) => setDraft({ ...draft, visionModel })}
                    source={status.modelSettingSources.visionModel}
                    value={draft.visionModel}
                  />
                  <ModelField
                    id="synthesis-model"
                    label="Synthesis model"
                    list="openai-model-options"
                    onChange={(synthesisModel) => setDraft({ ...draft, synthesisModel })}
                    source={status.modelSettingSources.synthesisModel}
                    value={draft.synthesisModel}
                  />
                  <label className="model-setting-field" htmlFor="reasoning-effort">
                    <span>
                      Reasoning effort
                      <SettingSourceBadge source={status.modelSettingSources.reasoningEffort} />
                    </span>
                    <select
                      id="reasoning-effort"
                      onChange={(event) => setDraft({ ...draft, reasoningEffort: event.target.value })}
                      value={draft.reasoningEffort}
                    >
                      {status.reasoningEffortOptions.map((effort) => (
                        <option
                          disabled={
                            effort === "minimal" &&
                            [draft.visionModel, draft.synthesisModel].some((model) =>
                              model.startsWith("gpt-5.6"),
                            )
                          }
                          key={effort}
                          value={effort}
                        >
                          {effort === "minimal" ? "minimal — legacy models" : effort}
                        </option>
                      ))}
                    </select>
                  </label>
                  <datalist id="openai-model-options">
                    {status.availableModels.map((model) => <option key={model} value={model} />)}
                  </datalist>
                </div>
              ) : null}
              <p className="model-settings-help">
                Saved values apply only to new analysis runs. The API key remains a protected
                server environment variable.
              </p>
              {status.missing.length ? (
                <div className="notice error-notice" style={{ marginTop: 18, marginBottom: 0 }}>
                  Missing: {status.missing.join(", ")}.
                </div>
              ) : null}
              <div className="model-settings-actions">
                <button
                  className="button button-primary"
                  disabled={
                    !draft ||
                    actionState.kind === "running" ||
                    !draftIsValid(draft) ||
                    !draftChanged(status, draft)
                  }
                  onClick={() => void saveSettings()}
                >
                  {actionState.kind === "running" && actionState.action === "save" ? "Saving…" : "Save model settings"}
                </button>
                <button
                  className="button button-secondary"
                  disabled={!draft || actionState.kind === "running" || !draftIsValid(draft)}
                  onClick={() => void testConnection()}
                >
                  {actionState.kind === "running" && actionState.action === "test" ? "Testing…" : "Test model access"}
                </button>
                <button
                  className="button button-ghost"
                  disabled={!status.savedModelSettings || actionState.kind === "running"}
                  onClick={() => void resetSettings()}
                >
                  {actionState.kind === "running" && actionState.action === "reset" ? "Restoring…" : "Restore environment defaults"}
                </button>
              </div>
              {actionState.kind === "success" || actionState.kind === "error" ? (
                <div
                  className={`notice ${actionState.kind === "error" ? "error-notice" : ""}`}
                  style={{ marginTop: 14, marginBottom: 0 }}
                >
                  {actionState.message}
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

function ModelField({
  id,
  label,
  list,
  onChange,
  source,
  value,
}: {
  id: string;
  label: string;
  list: string;
  onChange: (value: string) => void;
  source: SettingSource;
  value: string;
}) {
  return (
    <label className="model-setting-field" htmlFor={id}>
      <span>
        {label}
        <SettingSourceBadge source={source} />
      </span>
      <input
        autoCapitalize="none"
        autoComplete="off"
        id={id}
        list={list}
        maxLength={200}
        onChange={(event) => onChange(event.target.value)}
        placeholder="gpt-5.6-terra"
        spellCheck={false}
        type="text"
        value={value}
      />
    </label>
  );
}

function SettingSourceBadge({ source }: { source: SettingSource }) {
  const labels: Record<SettingSource, string> = {
    application: "Saved",
    environment: "Environment",
    default: "Default",
    missing: "Missing",
  };
  return <small className={`setting-source setting-source-${source}`}>{labels[source]}</small>;
}

function draftFromStatus(status: Status): AnalysisSettingsDraft {
  return {
    visionModel: status.visionModel ?? "",
    synthesisModel: status.synthesisModel ?? "",
    reasoningEffort: status.reasoningEffort,
  };
}

function draftChanged(status: Status, draft: AnalysisSettingsDraft): boolean {
  return (
    draft.visionModel.trim() !== (status.visionModel ?? "") ||
    draft.synthesisModel.trim() !== (status.synthesisModel ?? "") ||
    draft.reasoningEffort !== status.reasoningEffort ||
    !status.savedModelSettings
  );
}

function draftIsValid(draft: AnalysisSettingsDraft): boolean {
  return Boolean(
    draft.visionModel.trim() &&
    draft.synthesisModel.trim() &&
    !(
      draft.reasoningEffort === "minimal" &&
      [draft.visionModel, draft.synthesisModel].some((model) =>
        model.startsWith("gpt-5.6"),
      )
    ),
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
