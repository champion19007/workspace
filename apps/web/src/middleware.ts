import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE_NAME = 'workspace_session';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect orgs and onboarding routes
  if (pathname.startsWith('/orgs') || pathname.startsWith('/onboarding')) {
    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionCookie) {
      const loginUrl = new URL('/auth/login', request.url);
      loginUrl.searchParams.set('returnTo', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/orgs/:path*', '/onboarding'],
};
