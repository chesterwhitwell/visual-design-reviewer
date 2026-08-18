import { AUTH_COOKIE_NAME, revokeRequestSession, secureCookieForRequest } from "@/lib/auth";
import { errorResponse, privateJson } from "@/lib/http/response";
import { assertTrustedOrigin } from "@/lib/security/request";

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request, true);
    revokeRequestSession(request);
    const response = privateJson({ authenticated: false });
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
