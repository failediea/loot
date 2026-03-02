import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { gameRequests, gameQueues, sessionCredentials } from "@/lib/schema";
import { eq, and, or } from "drizzle-orm";
import { workerManager } from "@/lib/worker-manager";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser();
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const count = Math.max(1, Math.min(20, body.count || 1));
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

    // Check no existing running/queued game or active queue
    const [existingGame] = await db
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

    if (existingGame) {
      return NextResponse.json(
        { error: "You already have a game in progress" },
        { status: 409 }
      );
    }

    const [existingQueue] = await db
      .select()
      .from(gameQueues)
      .where(
        and(
          eq(gameQueues.userId, userId),
          eq(gameQueues.status, "active")
        )
      )
      .limit(1);

    if (existingQueue) {
      return NextResponse.json(
        { error: "You already have an active queue" },
        { status: 409 }
      );
    }

    // Create queue
    const queueResult = await db.insert(gameQueues).values({
      userId,
      totalGames: count,
      completedGames: 0,
      status: "active",
      createdAt: new Date(),
    });

    const queueId = Number(queueResult.lastInsertRowid);

    // Create first game request
    const gameResult = await db.insert(gameRequests).values({
      userId,
      queueId,
      status: "queued",
      botName,
      createdAt: new Date(),
    });

    const gameRequestId = Number(gameResult.lastInsertRowid);

    // Update queue with current game request
    await db
      .update(gameQueues)
      .set({ currentGameRequestId: gameRequestId })
      .where(eq(gameQueues.id, queueId));

    // Start the game worker
    await workerManager.startGame(gameRequestId);

    return NextResponse.json({
      success: true,
      queueId,
      gameRequestId,
      totalGames: count,
    });
  } catch (error: any) {
    console.error("Queue create error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function GET() {
  const authUser = await getAuthUser();
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(authUser.sub);

  const [queue] = await db
    .select()
    .from(gameQueues)
    .where(
      and(
        eq(gameQueues.userId, userId),
        eq(gameQueues.status, "active")
      )
    )
    .limit(1);

  return NextResponse.json({ queue: queue || null });
}
