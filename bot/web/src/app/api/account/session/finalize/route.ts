import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessionCredentials } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser();
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userId = parseInt(authUser.sub);
    const { ownerGuid, expiresAt, sessionKeyGuid, guardianKeyGuid, metadataHash } = await req.json();

    if (!ownerGuid || !expiresAt || !sessionKeyGuid) {
      return NextResponse.json({ error: "Missing session data" }, { status: 400 });
    }

    // Find the most recent pending (inactive) session for this user
    const [pending] = await db
      .select()
      .from(sessionCredentials)
      .where(
        and(
          eq(sessionCredentials.userId, userId),
          eq(sessionCredentials.isActive, false)
        )
      )
      .limit(1);

    if (!pending) {
      return NextResponse.json(
        { error: "No pending session found. Please start the setup again." },
        { status: 400 }
      );
    }

    // Finalize the session with data from keychain
    await db
      .update(sessionCredentials)
      .set({
        sessionHash: metadataHash || "0x0",
        sessionKeyGuid,
        ownerEip191: ownerGuid,
        expiresAt: parseInt(expiresAt),
        isActive: true,
      })
      .where(eq(sessionCredentials.id, pending.id));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Session finalize error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
