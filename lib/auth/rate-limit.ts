import { AppError } from "@/lib/http/errors";
import { getRuntimeConfig } from "@/lib/config/runtime";

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const failures = new Map<string, number[]>();

export function assertLoginAllowed(request: Request): void {
  const key = sourceKey(request);
  const recent = recentFailures(key);
  if (recent.length >= MAX_FAILURES) {
    const retryAfterMs = Math.max(1_000, recent[0] + WINDOW_MS - Date.now());
    throw new AppError("rate_limited", "Too many unsuccessful login attempts. Try again later.", {
      retryable: true,
      details: { retryAfterMs },
    });
  }
}

export function recordLoginFailure(request: Request): void {
  const key = sourceKey(request);
  failures.set(key, [...recentFailures(key), Date.now()]);
}

export function clearLoginFailures(request: Request): void {
  failures.delete(sourceKey(request));
}

export function resetLoginRateLimitForTests(): void {
  failures.clear();
}

function recentFailures(key: string): number[] {
  const cutoff = Date.now() - WINDOW_MS;
  const recent = (failures.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length) failures.set(key, recent);
  else failures.delete(key);
  return recent;
}

function sourceKey(request: Request): string {
  const forwarded = getRuntimeConfig().auth.trustProxyHeaders
    ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    : undefined;
  return forwarded || "local";
}
