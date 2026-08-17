import Link from "next/link";

import { EyeMark, SettingsIcon } from "@/components/shared/icons";

export function AppHeader({ status = "Configuration needed" }: { status?: string }) {
  const ready = status === "API ready";

  return (
    <header className="app-header">
      <Link href="/" className="brand" aria-label="Visual Design Reviewer home">
        <span className="brand-mark">
          <EyeMark />
        </span>
        <span>Visual Design Reviewer</span>
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="status-chip" title="OpenAI server configuration status">
          <span className={`status-dot ${ready ? "ready" : "warning"}`} />
          {status}
        </span>
        <Link className="button button-ghost" href="/settings" aria-label="Settings">
          <SettingsIcon />
        </Link>
      </div>
    </header>
  );
}
