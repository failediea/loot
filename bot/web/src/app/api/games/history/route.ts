import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { gameRequests, gameResults } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await db
    .select({
      requestId: gameRequests.id,
      gameId: gameRequests.gameId,
      status: gameRequests.status,
      botName: gameRequests.botName,
      createdAt: gameRequests.createdAt,
      completedAt: gameRequests.completedAt,
      level: gameResults.level,
      xp: gameResults.xp,
      gold: gameResults.gold,
      causeOfDeath: gameResults.causeOfDeath,
      statsJson: gameResults.statsJson,
    })
    .from(gameRequests)
    .leftJoin(gameResults, eq(gameResults.gameRequestId, gameRequests.id))
    .where(eq(gameRequests.userId, parseInt(user.sub)))
    .orderBy(desc(gameRequests.createdAt))
    .limit(50);

  return NextResponse.json({ games: results });
}
