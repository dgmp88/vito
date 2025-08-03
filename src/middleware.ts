import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  // Skip auth for login page and auth API endpoint only
  if (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/api/auth') {
    return NextResponse.next()
  }

  // Check for auth cookie
  const authCookie = request.cookies.get('vito-auth')
  
  if (!authCookie || authCookie.value !== 'authenticated') {
    // For API routes, return 401 instead of redirect
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // For page routes, redirect to login
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}