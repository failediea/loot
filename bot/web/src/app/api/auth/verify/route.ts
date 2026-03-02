import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { createToken, getAuthCookieName, getAuthUser } from "@/lib/auth";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { address } = await req.json();

    if (!address || typeof address !== "string") {
      return NextResponse.json({ error: "Missing address" }, { status: 400 });
    }

    // Cookie-based session restore: validate existing JWT
    if (address === "__cookie__") {
      const authUser = await getAuthUser();
      if (!authUser) {
        return NextResponse.json({ error: "No valid session" }, { status: 401 });
      }
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, parseInt(authUser.sub)))
        .limit(1);
      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 401 });
      }
      // Re-create token so frontend has it for WebSocket auth
      const restoreToken = await createToken({
        sub: String(user.id),
        addr: user.controllerAddr,
        isOwner: user.isOwner || false,
      });
      return NextResponse.json({
        success: true,
        token: restoreToken,
        user: {
          id: user.id,
          address: user.controllerAddr,
          isOwner: user.isOwner,
        },
      });
    }

    // Normalize StarkNet address: lowercase, strip leading zeros after 0x
    const normalizedAddr = "0x" + address.toLowerCase().replace(/^0x0*/, "");
    const ownerAddr = "0x" + (process.env.OWNER_ADDRESS || "").toLowerCase().replace(/^0x0*/, "");

    // Find or create user
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.controllerAddr, normalizedAddr))
      .limit(1);

    if (!user) {
      await db.insert(users).values({
        controllerAddr: normalizedAddr,
        isOwner: normalizedAddr === ownerAddr,
        createdAt: new Date(),
      });
      [user] = await db
        .select()
        .from(users)
        .where(eq(users.controllerAddr, normalizedAddr))
        .limit(1);
    }

    // Create JWT
    const token = await createToken({
      sub: String(user.id),
      addr: user.controllerAddr,
      isOwner: user.isOwner || false,
    });

    // Set httpOnly cookie
    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        address: user.controllerAddr,
        isOwner: user.isOwner,
      },
    });

    response.cookies.set(getAuthCookieName(), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    return response;
  } catch (error: any) {
    console.error("Auth error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
