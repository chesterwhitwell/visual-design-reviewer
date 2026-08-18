import { AppError } from "@/lib/http/errors";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { requireAuthenticatedRequest, type AuthPrincipal } from "@/lib/auth";

function normaliseHost(value: string): string {
  return value.trim().toLowerCase();
}

function isAllowedHost(host: string, allowedHosts: string[]): boolean {
  if (allowedHosts.includes("*")) {
    return true;
  }

  const normalised = normaliseHost(host);
  const hostname = normalised.startsWith("[")
    ? normalised.slice(0, normalised.indexOf("]") + 1)
    : normalised.split(":")[0];

  return allowedHosts.includes(normalised) || allowedHosts.includes(hostname);
}

export function assertTrustedOrigin(request: Request, mutation = false): void {
  const config = getRuntimeConfig();
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host") ?? requestUrl.host;

  if (!isAllowedHost(host, config.allowedHosts)) {
    throw new AppError("forbidden", "This host is not allowed by the server configuration.");
  }

  if (!mutation) {
    return;
  }

  if (request.headers.get("x-vdr-request") !== "1") {
    throw new AppError("forbidden", "The request is missing the same-origin marker.");
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    throw new AppError("forbidden", "The request origin is required.");
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new AppError("forbidden", "The request origin is invalid.");
  }

  if (
    originUrl.protocol !== requestUrl.protocol ||
    normaliseHost(originUrl.host) !== normaliseHost(host)
  ) {
    throw new AppError("forbidden", "Cross-origin requests are not allowed.");
  }
}

export function assertTrustedRequest(request: Request, mutation = false): AuthPrincipal {
  assertTrustedOrigin(request, mutation);
  return requireAuthenticatedRequest(request);
}
