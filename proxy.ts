import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME, decodeSessionCookie } from "@/lib/auth/cookie";

export function proxy(request: NextRequest) {
  if (process.env.AUTH_MODE !== "password") return NextResponse.next();
  if (request.nextUrl.pathname === "/login") return NextResponse.next();

  const secret = process.env.AUTH_SESSION_SECRET;
  const value = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (secret && decodeSessionCookie(value, secret)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (returnTo !== "/") loginUrl.searchParams.set("returnTo", returnTo);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
