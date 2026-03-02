import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { gameQueues } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST() {
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

  if (!queue) {
    return NextResponse.json({ error: "No active queue to cancel" }, { status: 404 });
  }

  await db
    .update(gameQueues)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(gameQueues.id, queue.id));

  return NextResponse.json({ success: true, queueId: queue.id });
}
