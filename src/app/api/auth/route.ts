import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    // Check password against environment variable
    const correctPassword = process.env.VITO_PASSWORD;

    if (!correctPassword) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    if (password === correctPassword) {
      // Set secure cookie that expires in 24 hours
      const response = NextResponse.json({ success: true });
      response.cookies.set("vito-auth", "authenticated", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365, // 1 year
        path: "/",
      });

      return response;
    } else {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
  } catch (error) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
