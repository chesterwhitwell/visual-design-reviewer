import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE_NAME = "vdr_session";

export function encodeSessionCookie(sessionId: string, secret: string): string {
  return `${sessionId}.${signature(sessionId, secret)}`;
}

export function decodeSessionCookie(value: string | undefined, secret: string): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;
  const sessionId = value.slice(0, separator);
  const supplied = value.slice(separator + 1);
  const expected = signature(sessionId, secret);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    return null;
  }
  return sessionId;
}

export function readCookieHeader(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function signature(sessionId: string, secret: string): string {
  return createHmac("sha256", secret).update(sessionId).digest("base64url");
}
