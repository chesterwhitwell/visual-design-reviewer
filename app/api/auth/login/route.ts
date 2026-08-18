import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  AUTH_COOKIE_NAME,
  assertLoginAllowed,
  clearLoginFailures,
  createPasswordSession,
  recordLoginFailure,
  secureCookieForRequest,
  verifyPassword,
} from "@/lib/auth";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { AppError } from "@/lib/http/errors";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedOrigin } from "@/lib/security/request";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(1_024),
}).strict();

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request, true);
    assertLoginAllowed(request);
    const config = getRuntimeConfig();
    if (config.auth.mode !== "password") {
      throw new AppError("configuration_error", "Password authentication is not enabled.");
    }
    if (!config.auth.passwordHash || !config.auth.sessionSecret) {
      throw new AppError(
        "configuration_error",
        "Password authentication is enabled but its server configuration is incomplete.",
      );
    }
    const body = loginSchema.parse(await request.json());
    const passwordMatches = await verifyPassword(body.password, config.auth.passwordHash);
    if (!passwordMatches || !secureTextEqual(body.username, config.auth.username)) {
      recordLoginFailure(request);
      throw new AppError("unauthorized", "The username or password is incorrect.");
    }

    clearLoginFailures(request);
    const session = createPasswordSession();
    const response = privateJson({
      authenticated: true,
      principal: session.principal,
    });
    response.cookies.set(AUTH_COOKIE_NAME, session.cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookieForRequest(request),
      path: "/",
      expires: session.expiresAt,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

function secureTextEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
