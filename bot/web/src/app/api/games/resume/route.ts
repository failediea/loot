import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { gameRequests } from "@/lib/schema";
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
    const { gameRequestId, gameId } = body;
    const userId = parseInt(authUser.sub);

    if (!gameRequestId && !gameId) {
      return NextResponse.json({ error: "gameRequestId or gameId required" }, { status: 400 });
    }

    // Check no other game is currently running/queued
    const [running] = await db
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

    if (running) {
      return NextResponse.json(
        { error: "You already have a game in progress", gameRequestId: running.id },
        { status: 409 }
      );
    }

    let resolvedGameRequestId: number;

    if (gameRequestId) {
      // Resume a tracked game (existing flow)
      const [request] = await db
        .select()
        .from(gameRequests)
        .where(
          and(
            eq(gameRequests.id, gameRequestId),
            eq(gameRequests.userId, userId),
            eq(gameRequests.status, "failed")
          )
        )
        .limit(1);

      if (!request) {
        return NextResponse.json({ error: "Game request not found or not resumable" }, { status: 404 });
      }

      if (!request.gameId) {
        return NextResponse.json({ error: "Game never started on-chain, cannot resume" }, { status: 400 });
      }

      resolvedGameRequestId = gameRequestId;
    } else {
      // Resume an untracked game — create a new game_requests row
      const [inserted] = await db
        .insert(gameRequests)
        .values({
          userId,
          status: "failed", // Will be set to "running" by workerManager.resumeGame
          gameId: gameId,
          errorMessage: "Recovered from untracked game",
        })
        .returning({ id: gameRequests.id });

      resolvedGameRequestId = inserted.id;
    }

    // Resume the game
    await workerManager.resumeGame(resolvedGameRequestId);

    return NextResponse.json({
      success: true,
      gameRequestId: resolvedGameRequestId,
      gameId: gameId || null,
    });
  } catch (error: any) {
    console.error("Game resume error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
