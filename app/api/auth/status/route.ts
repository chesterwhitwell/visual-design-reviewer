import { authenticationConfigured, getOptionalPrincipal, secureCookieForRequest } from "@/lib/auth";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedOrigin } from "@/lib/security/request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertTrustedOrigin(request);
    const config = getRuntimeConfig();
    const configured = authenticationConfigured();
    const principal = configured ? getOptionalPrincipal(request) : null;
    return privateJson({
      mode: config.auth.mode,
      configured,
      authenticated: Boolean(principal),
      principal,
      sessionHours: config.auth.sessionHours,
      secureCookie: secureCookieForRequest(request),
      secureTransport: new URL(request.url).protocol === "https:" ||
        (config.auth.trustProxyHeaders &&
          request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
