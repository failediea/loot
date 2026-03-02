import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessionCredentials } from "@/lib/schema";
import { encrypt } from "@/lib/encryption";

export const dynamic = "force-dynamic";
import { eq, and } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { sessionPriv, sessionHash, sessionKeyGuid, ownerEip191, expiresAt } = await req.json();

    if (!sessionPriv || !sessionHash || !sessionKeyGuid || !ownerEip191 || !expiresAt) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const userId = parseInt(user.sub);

    // Deactivate any existing active credentials
    await db
      .update(sessionCredentials)
      .set({ isActive: false })
      .where(
        and(
          eq(sessionCredentials.userId, userId),
          eq(sessionCredentials.isActive, true)
        )
      );

    // Encrypt and store new credentials
    const encryptedPriv = encrypt(sessionPriv);

    await db.insert(sessionCredentials).values({
      userId,
      sessionPrivEnc: encryptedPriv,
      sessionHash,
      sessionKeyGuid,
      ownerEip191,
      expiresAt,
      isActive: true,
      createdAt: new Date(),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Session store error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [creds] = await db
    .select({
      id: sessionCredentials.id,
      expiresAt: sessionCredentials.expiresAt,
      isActive: sessionCredentials.isActive,
      createdAt: sessionCredentials.createdAt,
    })
    .from(sessionCredentials)
    .where(
      and(
        eq(sessionCredentials.userId, parseInt(user.sub)),
        eq(sessionCredentials.isActive, true)
      )
    )
    .limit(1);

  return NextResponse.json({
    hasSession: !!creds,
    expiresAt: creds?.expiresAt || null,
  });
}
