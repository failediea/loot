import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { gameResults, gameRequests, users } from "@/lib/schema";
import { eq, sql, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      controllerAddr: users.controllerAddr,
      totalGames: sql<number>`count(*)`,
      bestLevel: sql<number>`max(${gameResults.level})`,
      avgLevel: sql<number>`round(avg(${gameResults.level}), 1)`,
      totalXp: sql<number>`sum(${gameResults.xp})`,
    })
    .from(gameResults)
    .innerJoin(gameRequests, eq(gameResults.gameRequestId, gameRequests.id))
    .innerJoin(users, eq(gameRequests.userId, users.id))
    .groupBy(users.id)
    .orderBy(desc(sql`max(${gameResults.level})`))
    .limit(50);

  return NextResponse.json({ leaderboard: rows });
}
