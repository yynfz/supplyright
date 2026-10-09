import { NextRequest, NextResponse } from "next/server";

export const AUTH_COOKIE = "supplyright.authenticated";

const PUBLIC_ROUTES = new Set(["/", "/auth", "/verify"]);

function isPublicPath(pathname: string) {
  return (
    PUBLIC_ROUTES.has(pathname) ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/verify/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  );
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const authenticated = request.cookies.get(AUTH_COOKIE)?.value === "1";

  // Redirect authenticated users away from the auth page
  if ((pathname === "/auth" || pathname.startsWith("/auth/")) && authenticated) {
    const nextParam = request.nextUrl.searchParams.get("next");
    const target =
      nextParam &&
      nextParam.startsWith("/") &&
      !nextParam.startsWith("//") &&
      !nextParam.startsWith("/auth")
        ? nextParam
        : "/dashboard";
    return NextResponse.redirect(new URL(target, request.url));
  }

  // Any navigation to non-public routes requires auth: redirect unauthenticated users to /auth
  if (!isPublicPath(pathname) && !authenticated) {
    const authUrl = new URL("/auth", request.url);
    authUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(authUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
