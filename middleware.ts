// creator.lottiepro.com/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

export async function middleware(request: NextRequest) {
  // Dev — skip auth entirely
  if (process.env.NODE_ENV === "development") {
    return NextResponse.next();
  }

  console.log("🍪 Cookies received:", request.cookies.getAll());

  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    console.log("📦 Session:", session ? "FOUND" : "NOT FOUND");

    if (!session) {
      const loginUrl = new URL("https://lottiepro.com/signin");
      loginUrl.searchParams.set("callbackURL", request.url);
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
  } catch (err) {
    console.error("Middleware error:", err);
    return NextResponse.redirect(new URL("https://lottiepro.com/signin"));
  }
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|api).*)"],
};
