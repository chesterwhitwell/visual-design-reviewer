import { AUTH_COOKIE_NAME, secureCookieForRequest } from "@/lib/auth";
import { createRepositories } from "@/lib/db";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedRequest } from "@/lib/security/request";

export async function POST(request: Request) {
  try {
    assertTrustedRequest(request, true);
    const revoked = createRepositories().authSessions.revokeAll();
    const response = privateJson({ revoked });
    response.cookies.set(AUTH_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookieForRequest(request),
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
