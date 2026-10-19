import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/**
 * Session refresh and role routing (Next.js `proxy` convention, formerly
 * `middleware`).
 *
 * Two jobs:
 *   1. Refresh the Supabase session cookie on every request, which is what
 *      keeps a signed-in user signed in across Server Components.
 *   2. Keep each role inside its own portal.
 *
 * This is navigation guarding, NOT authorisation. The database decides what a
 * user may read or write; a user who reaches another portal's URL still sees
 * nothing, because RLS refuses the queries. Removing this proxy would be a
 * usability regression, not a security hole — which is the property to aim for.
 */

/** Paths reachable without a session. */
const PUBLIC_PREFIXES = [
  "/login",
  "/activate",
  "/forgot-password",
  "/card", // the public QR digital ID card
  "/auth/callback",
];

const PORTAL_HOME = {
  authority_admin: "/authority",
  authority_staff: "/authority",
  teacher: "/teacher",
  student: "/student",
} as const;

type Role = keyof typeof PORTAL_HOME;

function portalPrefixFor(role: Role): string {
  return PORTAL_HOME[role];
}

export async function proxy(request: NextRequest) {
  const env = publicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() revalidates the token with Supabase. getSession() only reads the
  // cookie, which a client could have tampered with, so it is not used here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user) {
    if (isPublic) return response;
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.searchParams.set("next", pathname);
    return NextResponse.redirect(target);
  }

  // The profile carries the role and whether activation is still outstanding.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active, must_set_password")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    // Deactivated or profile-less account: end the session rather than leaving
    // it in a half-signed-in state.
    await supabase.auth.signOut();
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.searchParams.set("error", "account_inactive");
    return NextResponse.redirect(target);
  }

  // An account that has not finished OTP activation may only reach /activate.
  if (profile.must_set_password && !pathname.startsWith("/activate")) {
    const target = request.nextUrl.clone();
    target.pathname = "/activate";
    target.search = "";
    return NextResponse.redirect(target);
  }

  const home = portalPrefixFor(profile.role as Role);

  // Signed in and landing on a login page or the root: send them to their portal.
  if (pathname === "/" || pathname === "/login") {
    const target = request.nextUrl.clone();
    target.pathname = home;
    target.search = "";
    return NextResponse.redirect(target);
  }

  // Wandering into another portal's section: bounce to their own.
  const otherPortals = Object.values(PORTAL_HOME).filter((p) => p !== home);
  if (otherPortals.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const target = request.nextUrl.clone();
    target.pathname = home;
    target.search = "";
    return NextResponse.redirect(target);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. The public QR card page
     * is matched too, so its session cookie stays fresh for a signed-in user
     * who happens to scan a card, but PUBLIC_PREFIXES lets anonymous visitors
     * through.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
