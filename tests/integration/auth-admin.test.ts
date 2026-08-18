import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as authStatus } from "@/app/api/auth/status/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as adminOverview } from "@/app/api/admin/overview/route";
import { GET as exportDiagnostics } from "@/app/api/admin/diagnostics/export/route";
import { GET as listReviews } from "@/app/api/reviews/route";
import { GET as settingsStatus } from "@/app/api/settings/status/route";
import {
  DELETE as resetAnalysisSettings,
  PUT as updateAnalysisSettings,
} from "@/app/api/settings/analysis/route";
import { hashPassword } from "@/lib/auth/password";
import { resetLoginRateLimitForTests } from "@/lib/auth/rate-limit";
import { resetRuntimeConfigForTests } from "@/lib/config/runtime";
import { closeDatabase } from "@/lib/db";
import { resetPricingCatalogForTests } from "@/lib/openai/pricing";
import { resetTaxonomyConfigForTests } from "@/lib/taxonomy";

const environmentKeys = [
  "DATABASE_PATH",
  "IMAGE_STORAGE_PATH",
  "ALLOWED_HOSTS",
  "AUTH_MODE",
  "AUTH_USERNAME",
  "AUTH_PASSWORD_HASH",
  "AUTH_SESSION_SECRET",
  "AUTH_SESSION_HOURS",
  "AUTH_COOKIE_SECURE",
  "OPENAI_PRICING_PATH",
  "OPENAI_VISION_MODEL",
  "OPENAI_SYNTHESIS_MODEL",
  "OPENAI_REASONING_EFFORT",
] as const;

describe("password authentication and administration", () => {
  let directory: string;
  let previous: Partial<Record<(typeof environmentKeys)[number], string>>;
  let passwordHash: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "vdr-auth-"));
    previous = Object.fromEntries(environmentKeys.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]],
    ));
    passwordHash = await hashPassword("correct horse battery staple");
    process.env.DATABASE_PATH = join(directory, "auth.sqlite");
    process.env.IMAGE_STORAGE_PATH = join(directory, "images");
    process.env.ALLOWED_HOSTS = "localhost";
    process.env.AUTH_MODE = "password";
    process.env.AUTH_USERNAME = "admin";
    process.env.AUTH_PASSWORD_HASH = passwordHash;
    process.env.AUTH_SESSION_SECRET = "test-session-secret-that-is-long-and-random";
    process.env.AUTH_SESSION_HOURS = "12";
    process.env.AUTH_COOKIE_SECURE = "auto";
    process.env.OPENAI_PRICING_PATH = join(process.cwd(), "config/openai-pricing.v1.json");
    process.env.OPENAI_VISION_MODEL = "environment-vision";
    process.env.OPENAI_SYNTHESIS_MODEL = "environment-synthesis";
    process.env.OPENAI_REASONING_EFFORT = "medium";
    resetState();
  });

  afterEach(() => {
    resetState();
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it("protects application APIs and creates a revocable password session", async () => {
    expect((await listReviews(readRequest("/api/reviews"))).status).toBe(401);
    const before = await authStatus(readRequest("/api/auth/status"));
    await expect(before.json()).resolves.toMatchObject({
      mode: "password",
      configured: true,
      authenticated: false,
    });

    const rejected = await login(loginRequest("wrong password"));
    expect(rejected.status).toBe(401);

    const accepted = await login(loginRequest("correct horse battery staple"));
    expect(accepted.status).toBe(200);
    const setCookie = accepted.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("vdr_session=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie.toLowerCase()).not.toContain("secure");
    const cookie = setCookie.split(";")[0];

    expect((await listReviews(readRequest("/api/reviews", cookie))).status).toBe(200);
    const status = await authStatus(readRequest("/api/auth/status", cookie));
    await expect(status.json()).resolves.toMatchObject({
      authenticated: true,
      principal: { displayName: "admin", provider: "password", role: "admin" },
    });

    const ended = await logout(mutationRequest("/api/auth/logout", cookie));
    expect(ended.status).toBe(200);
    expect((await listReviews(readRequest("/api/reviews", cookie))).status).toBe(401);
  });

  it("returns redacted administration diagnostics only to an authenticated session", async () => {
    expect((await adminOverview(readRequest("/api/admin/overview"))).status).toBe(401);
    const accepted = await login(loginRequest("correct horse battery staple"));
    const cookie = (accepted.headers.get("set-cookie") ?? "").split(";")[0];
    const response = await adminOverview(readRequest("/api/admin/overview", cookie));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"authMode":"password"');
    expect(text).toContain('"estimatedCostMicroUsd":0');
    expect(text).not.toContain("correct horse battery staple");
    expect(text).not.toContain(passwordHash);
    expect(text).not.toContain(process.env.AUTH_SESSION_SECRET ?? "missing");

    const exported = await exportDiagnostics(readRequest("/api/admin/diagnostics/export", cookie));
    const exportedText = await exported.text();
    expect(exported.headers.get("content-disposition")).toContain("attachment");
    expect(exportedText).toContain('"path":"[redacted]"');
    expect(exportedText).not.toContain(directory);
  });

  it("stores authenticated model settings and restores environment defaults", async () => {
    const unauthenticated = await updateAnalysisSettings(jsonMutationRequest(
      "/api/settings/analysis",
      {
        visionModel: "gpt-5.6-sol",
        synthesisModel: "gpt-5.6-luna",
        reasoningEffort: "low",
      },
    ));
    expect(unauthenticated.status).toBe(401);

    const accepted = await login(loginRequest("correct horse battery staple"));
    const cookie = (accepted.headers.get("set-cookie") ?? "").split(";")[0];
    const saved = await updateAnalysisSettings(jsonMutationRequest(
      "/api/settings/analysis",
      {
        visionModel: "gpt-5.6-sol",
        synthesisModel: "gpt-5.6-luna",
        reasoningEffort: "low",
      },
      cookie,
    ));
    expect(saved.status).toBe(200);

    const status = await settingsStatus(readRequest("/api/settings/status", cookie));
    await expect(status.json()).resolves.toMatchObject({
      visionModel: "gpt-5.6-sol",
      synthesisModel: "gpt-5.6-luna",
      reasoningEffort: "low",
      savedModelSettings: true,
      modelSettingSources: {
        visionModel: "application",
        synthesisModel: "application",
        reasoningEffort: "application",
      },
    });

    const invalid = await updateAnalysisSettings(jsonMutationRequest(
      "/api/settings/analysis",
      {
        visionModel: "gpt-5.6-sol",
        synthesisModel: "gpt-5.6-luna",
        reasoningEffort: "minimal",
      },
      cookie,
    ));
    expect(invalid.status).toBe(400);

    const reset = await resetAnalysisSettings(new Request(
      "http://localhost/api/settings/analysis",
      {
        method: "DELETE",
        headers: {
          cookie,
          origin: "http://localhost",
          "x-vdr-request": "1",
        },
      },
    ));
    expect(reset.status).toBe(200);
    await expect(reset.json()).resolves.toMatchObject({
      settings: {
        visionModel: "environment-vision",
        synthesisModel: "environment-synthesis",
        reasoningEffort: "medium",
        savedOverride: false,
      },
    });
  });
});

function readRequest(path: string, cookie?: string) {
  return new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : undefined });
}

function mutationRequest(path: string, cookie?: string) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "x-vdr-request": "1",
      ...(cookie ? { cookie } : {}),
    },
  });
}

function loginRequest(password: string) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "x-vdr-request": "1",
      "content-type": "application/json",
    },
    body: JSON.stringify({ username: "admin", password }),
  });
}

function jsonMutationRequest(path: string, body: unknown, cookie?: string) {
  return new Request(`http://localhost${path}`, {
    method: "PUT",
    headers: {
      origin: "http://localhost",
      "x-vdr-request": "1",
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function resetState() {
  closeDatabase();
  resetRuntimeConfigForTests();
  resetTaxonomyConfigForTests();
  resetPricingCatalogForTests();
  resetLoginRateLimitForTests();
}
