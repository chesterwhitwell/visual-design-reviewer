import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { getRuntimeConfig } from "@/lib/config/runtime";
import { createRepositories } from "@/lib/db";
import { AppError } from "@/lib/http/errors";

import {
  AUTH_COOKIE_NAME,
  decodeSessionCookie,
  encodeSessionCookie,
  readCookieHeader,
} from "./cookie";

export type AuthPrincipal = {
  id: string;
  displayName: string;
  provider: "password" | "oidc" | "disabled";
  role: "admin";
};

export type CreatedAuthSession = {
  cookieValue: string;
  expiresAt: Date;
  principal: AuthPrincipal;
};

export function authenticationConfigured(): boolean {
  const { auth } = getRuntimeConfig();
  return auth.mode === "disabled" || Boolean(auth.passwordHash && auth.sessionSecret);
}

export function requireAuthenticatedRequest(request: Request): AuthPrincipal {
  const { auth } = getRuntimeConfig();
  if (auth.mode === "disabled") {
    return { id: "local-admin", displayName: "Local administrator", provider: "disabled", role: "admin" };
  }
  if (!auth.passwordHash || !auth.sessionSecret) {
    throw new AppError(
      "configuration_error",
      "Password authentication is enabled but its server configuration is incomplete.",
    );
  }
  const signedCookie = readCookieHeader(request.headers.get("cookie"), AUTH_COOKIE_NAME);
  const sessionId = decodeSessionCookie(signedCookie, auth.sessionSecret);
  if (!sessionId) throw unauthenticated();
  const tokenHash = hashSessionId(sessionId);
  const session = createRepositories().authSessions.getActive(tokenHash);
  if (!session) throw unauthenticated();
  if (Date.now() - Date.parse(session.lastSeenAt) > 5 * 60_000) {
    createRepositories().authSessions.touch(tokenHash);
  }
  return {
    id: session.principalId,
    displayName: session.displayName,
    provider: session.provider,
    role: "admin",
  };
}

export function getOptionalPrincipal(request: Request): AuthPrincipal | null {
  try {
    return requireAuthenticatedRequest(request);
  } catch (error) {
    if (error instanceof AppError && error.code === "unauthorized") return null;
    throw error;
  }
}

export function createPasswordSession(): CreatedAuthSession {
  const { auth } = getRuntimeConfig();
  if (auth.mode !== "password" || !auth.sessionSecret) {
    throw new AppError("configuration_error", "Password authentication is not configured.");
  }
  const sessionId = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + auth.sessionHours * 60 * 60_000);
  const sessions = createRepositories().authSessions;
  sessions.deleteExpired();
  sessions.create({
    tokenHash: hashSessionId(sessionId),
    principalId: `password:${auth.username}`,
    displayName: auth.username,
    provider: "password",
    expiresAt: expiresAt.toISOString(),
  });
  return {
    cookieValue: encodeSessionCookie(sessionId, auth.sessionSecret),
    expiresAt,
    principal: {
      id: `password:${auth.username}`,
      displayName: auth.username,
      provider: "password",
      role: "admin",
    },
  };
}

export function revokeRequestSession(request: Request): boolean {
  const { auth } = getRuntimeConfig();
  if (!auth.sessionSecret) return false;
  const signedCookie = readCookieHeader(request.headers.get("cookie"), AUTH_COOKIE_NAME);
  const sessionId = decodeSessionCookie(signedCookie, auth.sessionSecret);
  return sessionId ? createRepositories().authSessions.revoke(hashSessionId(sessionId)) : false;
}

export function secureCookieForRequest(request: Request): boolean {
  const { cookieSecure, trustProxyHeaders } = getRuntimeConfig().auth;
  if (cookieSecure === "always") return true;
  if (cookieSecure === "never") return false;
  const forwardedProtocol = trustProxyHeaders
    ? request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
    : undefined;
  return forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
}

function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

function unauthenticated(): AppError {
  return new AppError("unauthorized", "Authentication is required.");
}
