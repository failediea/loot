import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { gameRequests, sessionCredentials } from "@/lib/schema";
import { eq, and, or } from "drizzle-orm";

export const dynamic = "force-dynamic";
import { workerManager } from "@/lib/worker-manager";

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser();
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const botName = body.botName || "BOT";
    const userId = parseInt(authUser.sub);

    // Check for active session credentials
    const [creds] = await db
      .select()
      .from(sessionCredentials)
      .where(
        and(
          eq(sessionCredentials.userId, userId),
          eq(sessionCredentials.isActive, true)
        )
      )
      .limit(1);

    if (!creds) {
      return NextResponse.json(
        { error: "No active session credentials. Please set up a session first." },
        { status: 400 }
      );
    }

    if (creds.expiresAt < Math.floor(Date.now() / 1000)) {
      return NextResponse.json(
        { error: "Session credentials have expired. Please create a new session." },
        { status: 400 }
      );
    }

    // Check no existing running or queued game
    const [existing] = await db
      .select()
      .from(gameRequests)
      .where(
        and(
          eq(gameRequests.userId, userId),
          or(
            eq(gameRequests.status, "running"),
            eq(gameRequests.status, "queued")
          )
        )
      )
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: "You already have a game in progress", gameRequestId: existing.id },
        { status: 409 }
      );
    }

    // TODO: Payment check for non-owner users
    // For now, allow owner to play for free, require payment setup for others

    // Create game request
    const result = await db.insert(gameRequests).values({
      userId,
      status: "queued",
      botName,
      createdAt: new Date(),
    });

    const gameRequestId = Number(result.lastInsertRowid);

    // Start the game worker
    await workerManager.startGame(gameRequestId);

    return NextResponse.json({
      success: true,
      gameRequestId,
      queuePosition: workerManager.getQueueLength(),
    });
  } catch (error: any) {
    console.error("Game request error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
