import "server-only";

import { existsSync, lstatSync, readdirSync, statSync, statfsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import packageMetadata from "@/package.json";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { createRepositories, getDatabaseHandle } from "@/lib/db";
import { getPricingCatalog } from "@/lib/openai/pricing";
import { getTaxonomyConfig } from "@/lib/taxonomy";
import { listPromptDefinitions } from "@/lib/analysis/prompts";

type CountRow = { state: string; count: number };
type UsageRow = {
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

export function getAdminOverview(request: Request) {
  const config = getRuntimeConfig();
  const handle = getDatabaseHandle();
  const sqlite = handle.sqlite;
  const now = new Date().toISOString();
  const runStates = sqlite.prepare(
    "select state, count(*) as count from analysis_runs group by state",
  ).all() as CountRow[];
  const imageStates = sqlite.prepare(
    "select retention_state as state, count(*) as count from image_assets group by retention_state",
  ).all() as CountRow[];
  const usage = sqlite.prepare(`
    select
      count(*) as attempts,
      coalesce(sum(case when state != 'completed' then 1 else 0 end), 0) as failedAttempts,
      coalesce(sum(input_tokens), 0) as inputTokens,
      coalesce(sum(cached_input_tokens), 0) as cachedInputTokens,
      coalesce(sum(cache_write_input_tokens), 0) as cacheWriteInputTokens,
      coalesce(sum(output_tokens), 0) as outputTokens,
      coalesce(sum(reasoning_output_tokens), 0) as reasoningOutputTokens,
      coalesce(sum(total_tokens), 0) as totalTokens,
      coalesce(sum(estimated_cost_micro_usd), 0) as estimatedCostMicroUsd,
      coalesce(sum(case when total_tokens is not null and total_tokens > 0 and estimated_cost_micro_usd is null and provider = 'openai' then 1 else 0 end), 0) as unpricedAttempts
    from pass_attempts
  `).get() as UsageRow;
  const byModel = sqlite.prepare(`
    select
      model,
      count(*) as attempts,
      coalesce(sum(total_tokens), 0) as totalTokens,
      coalesce(sum(estimated_cost_micro_usd), 0) as estimatedCostMicroUsd,
      coalesce(sum(case when total_tokens is not null and total_tokens > 0 and estimated_cost_micro_usd is null and provider = 'openai' then 1 else 0 end), 0) as unpricedAttempts
    from pass_attempts
    group by model
    order by estimatedCostMicroUsd desc, totalTokens desc
  `).all();
  const byDay = sqlite.prepare(`
    select
      substr(coalesce(completed_at, started_at), 1, 10) as day,
      count(*) as attempts,
      coalesce(sum(total_tokens), 0) as totalTokens,
      coalesce(sum(estimated_cost_micro_usd), 0) as estimatedCostMicroUsd
    from pass_attempts
    where coalesce(completed_at, started_at) >= datetime('now', '-30 days')
    group by day
    order by day desc
  `).all();
  const recentFailures = sqlite.prepare(`
    select id, review_id as reviewId, kind, safe_error_code as errorCode,
      safe_error_message as errorMessage, updated_at as updatedAt
    from analysis_runs
    where safe_error_code is not null
    order by updated_at desc
    limit 10
  `).all();
  const reviewCount = Number((sqlite.prepare("select count(*) as count from reviews").get() as { count: number }).count);
  const trackedImageBytes = Number((sqlite.prepare(
    "select coalesce(sum(byte_size), 0) as bytes from image_assets where retention_state != 'purged'",
  ).get() as { bytes: number }).bytes);
  const expiredImages = Number((sqlite.prepare(
    "select count(*) as count from image_assets where retention_state = 'retained' and expires_at is not null and expires_at <= ?",
  ).get(now) as { count: number }).count);
  const databaseFiles = databaseFileSizes(handle.path);
  const storage = directorySize(config.imageStoragePath);
  const volume = volumeStats(dirname(resolve(config.databasePath)));
  const secureTransport = isSecureTransport(request, config.auth.trustProxyHeaders);
  const missingConfiguration = [
    ...(!config.openaiApiKey && config.analysisGateway === "openai" ? ["OpenAI API key"] : []),
    ...(!config.openaiVisionModel ? ["Vision model"] : []),
    ...(!config.openaiSynthesisModel ? ["Synthesis model"] : []),
    ...(!config.imageEncryptionKey ? ["Image encryption key"] : []),
    ...(config.auth.mode === "password" && !config.auth.passwordHash ? ["Password hash"] : []),
    ...(config.auth.mode === "password" && !config.auth.sessionSecret ? ["Session secret"] : []),
  ];
  const warnings = [
    ...(config.auth.mode === "disabled" ? ["Authentication is disabled."] : []),
    ...(config.auth.mode === "password" && !secureTransport
      ? ["Password sessions are being served without HTTPS."]
      : []),
    ...(config.auth.cookieSecure === "never" ? ["Secure cookies are explicitly disabled."] : []),
    ...(config.allowedHosts.includes("*") ? ["ALLOWED_HOSTS permits every host."] : []),
    ...(storage.truncated ? ["Image storage measurement stopped at the safety limit."] : []),
  ];
  let pricing: { status: "ready"; catalogVersion: string; modelCount: number; currency: "USD" } |
    { status: "invalid"; catalogVersion: null; modelCount: 0; currency: "USD" };
  try {
    const catalog = getPricingCatalog();
    pricing = {
      status: "ready",
      catalogVersion: catalog.catalogVersion,
      modelCount: catalog.models.length,
      currency: catalog.currency,
    };
  } catch {
    pricing = { status: "invalid", catalogVersion: null, modelCount: 0, currency: "USD" };
    warnings.push("The OpenAI pricing catalogue could not be loaded; new usage may be unpriced.");
  }
  const taxonomy = getTaxonomyConfig();

  return {
    generatedAt: now,
    application: {
      name: "Visual Design Reviewer",
      version: packageMetadata.version,
      commit: process.env.APP_GIT_SHA ?? null,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      environment: config.nodeEnv,
    },
    security: {
      authMode: config.auth.mode,
      authenticationConfigured:
        config.auth.mode === "disabled" || Boolean(config.auth.passwordHash && config.auth.sessionSecret),
      activeSessions: createRepositories().authSessions.countActive(now),
      sessionHours: config.auth.sessionHours,
      secureTransport,
      secureCookiePolicy: config.auth.cookieSecure,
      trustProxyHeaders: config.auth.trustProxyHeaders,
      allowedHostCount: config.allowedHosts.length,
      warnings,
    },
    configuration: {
      ready: missingConfiguration.length === 0,
      missing: missingConfiguration,
      gateway: config.analysisGateway,
      visionModel: config.openaiVisionModel ?? null,
      synthesisModel: config.openaiSynthesisModel ?? null,
      imageDetail: config.openaiImageDetail,
      reasoningEffort: config.openaiReasoningEffort,
      retentionHours: config.imageRetentionHours ?? null,
      taxonomy: { label: taxonomy.label, version: taxonomy.version, areas: taxonomy.areas.length },
      promptVersions: [...new Set(listPromptDefinitions().map(({ version }) => version))],
      pricing,
    },
    database: {
      path: handle.path,
      ...databaseFiles,
      journalMode: sqlite.pragma("journal_mode", { simple: true }),
      foreignKeys: sqlite.pragma("foreign_keys", { simple: true }) === 1,
    },
    storage: {
      path: resolve(config.imageStoragePath),
      encryptedBytes: storage.bytes,
      trackedPlaintextBytes: trackedImageBytes,
      fileCount: storage.files,
      volume,
      imageStates: Object.fromEntries(imageStates.map(({ state, count }) => [state, count])),
      expiredImages,
    },
    analysis: {
      reviewCount,
      runStates: Object.fromEntries(runStates.map(({ state, count }) => [state, count])),
      recentFailures,
    },
    usage: {
      totals: usage,
      byModel,
      byDay,
      note: "Local estimates use the price snapshot captured for each attempt and may differ from the provider invoice.",
    },
  };
}

export function runDatabaseQuickCheck() {
  const rows = getDatabaseHandle().sqlite.pragma("quick_check") as Array<{ quick_check: string }>;
  const messages = rows.map((row) => row.quick_check);
  return { ok: messages.length === 1 && messages[0] === "ok", messages };
}

function databaseFileSizes(path: string) {
  return {
    databaseBytes: fileSize(path),
    walBytes: fileSize(`${path}-wal`),
    sharedMemoryBytes: fileSize(`${path}-shm`),
  };
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function directorySize(pathValue: string) {
  const root = resolve(pathValue);
  if (!existsSync(root)) return { bytes: 0, files: 0, truncated: false };
  const directories = [root];
  let bytes = 0;
  let files = 0;
  while (directories.length && files < 20_000) {
    const directory = directories.pop();
    if (!directory) break;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) directories.push(path);
      else if (entry.isFile()) {
        files += 1;
        bytes += lstatSync(path).size;
      }
      if (files >= 20_000) break;
    }
  }
  return { bytes, files, truncated: Boolean(directories.length) };
}

function volumeStats(path: string) {
  try {
    const stats = statfsSync(path);
    return {
      totalBytes: Number(stats.blocks) * Number(stats.bsize),
      availableBytes: Number(stats.bavail) * Number(stats.bsize),
    };
  } catch {
    return null;
  }
}

function isSecureTransport(request: Request, trustProxyHeaders: boolean): boolean {
  return new URL(request.url).protocol === "https:" ||
    (trustProxyHeaders &&
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https");
}
