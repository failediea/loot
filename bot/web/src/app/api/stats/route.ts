import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { gameResults, gameRequests } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const authUser = await getAuthUser();
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(authUser.sub);

  const [stats] = await db
    .select({
      totalGames: sql<number>`count(*)`,
      bestLevel: sql<number>`max(${gameResults.level})`,
      avgLevel: sql<number>`round(avg(${gameResults.level}), 1)`,
      totalXp: sql<number>`sum(${gameResults.xp})`,
      bestXp: sql<number>`max(${gameResults.xp})`,
      totalGold: sql<number>`sum(${gameResults.gold})`,
    })
    .from(gameResults)
    .innerJoin(gameRequests, eq(gameResults.gameRequestId, gameRequests.id))
    .where(eq(gameRequests.userId, userId));

  return NextResponse.json({
    totalGames: stats?.totalGames || 0,
    bestLevel: stats?.bestLevel || 0,
    avgLevel: stats?.avgLevel || 0,
    totalXp: stats?.totalXp || 0,
    bestXp: stats?.bestXp || 0,
    totalGold: stats?.totalGold || 0,
  });
}
