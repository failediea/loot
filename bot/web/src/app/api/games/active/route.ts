import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { gameRequests, gameResults } from "@/lib/schema";
import { eq, and, or, isNotNull, desc } from "drizzle-orm";
import { RpcProvider, num } from "starknet";

export const dynamic = "force-dynamic";

const GAME_ADDRESS = "0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c";
const TORII_SQL_URL = "https://api.cartridge.gg/x/pg-mainnet-10/torii/sql";

interface AliveGame {
  gameId: number;
  hp: number;
  xp: number;
  gold: number;
  level: number;
}

/** Query Torii SQL indexer for all alive games owned by a controller address. */
async function discoverAliveGames(controllerAddr: string): Promise<AliveGame[]> {
  // Normalize address to full 66-char hex with 0x prefix
  const addr = "0x" + controllerAddr.replace(/^0x/, "").padStart(64, "0");

  const sql = `
    SELECT ge.adventurer_id,
      ge.[details.adventurer.health] as hp,
      ge.[details.adventurer.xp] as xp,
      ge.[details.adventurer.gold] as gold
    FROM [relayer_0_0_1-OwnersUpdate] ou
    INNER JOIN [ls_0_0_9-GameEvent] ge ON ge.adventurer_id = ou.token_id
    WHERE ou.owner = '${addr}'
      AND ge.[details.adventurer.health] > 0
    ORDER BY ge.internal_executed_at DESC
  `.trim();

  const url = `${TORII_SQL_URL}?query=${encodeURIComponent(sql)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

  if (!res.ok) {
    throw new Error(`Torii SQL returned ${res.status}: ${await res.text()}`);
  }

  const rows: Array<Record<string, string>> = await res.json();

  // Deduplicate by adventurer_id (keep first = most recent event)
  const seen = new Set<number>();
  const games: AliveGame[] = [];

  for (const row of rows) {
    const gameId = parseInt(row.adventurer_id, 16);
    if (seen.has(gameId)) continue;
    seen.add(gameId);

    const hp = parseInt(row.hp, 16) || parseInt(row.hp) || 0;
    const xp = parseInt(row.xp, 16) || parseInt(row.xp) || 0;
    const gold = parseInt(row.gold, 16) || parseInt(row.gold) || 0;
    const level = xp === 0 ? 1 : Math.floor(Math.sqrt(xp));

    if (hp > 0) {
      games.push({ gameId, hp, xp, gold, level });
    }
  }

  return games;
}

/** Check on-chain HP for a game via RPC. Returns { hp, xp, gold, level } or null on error. */
async function checkOnChainState(
  provider: RpcProvider,
  gameId: number
): Promise<{ hp: number; xp: number; gold: number; level: number } | null> {
  try {
    const r = await provider.callContract({
      contractAddress: GAME_ADDRESS,
      entrypoint: "get_game_state",
      calldata: [num.toHex(gameId)],
    });
    const hp = parseInt(r[0], 16);
    const xp = parseInt(r[1], 16);
    const gold = parseInt(r[2], 16);
    const level = xp === 0 ? 1 : Math.floor(Math.sqrt(xp));
    return { hp, xp, gold, level };
  } catch {
    return null;
  }
}

/** Fallback: DB-only discovery (original approach). */
async function fallbackDbDiscovery(userId: number) {
  const candidates = await db
    .select()
    .from(gameRequests)
    .where(
      and(
        eq(gameRequests.userId, userId),
        eq(gameRequests.status, "failed"),
        isNotNull(gameRequests.gameId)
      )
    )
    .orderBy(desc(gameRequests.id));

  const alive: Array<{ id: number; gameId: number; hp: number; xp: number; gold: number; level: number; status: string; errorMessage: string | null; createdAt: Date | null }> = [];

  if (candidates.length > 0) {
    const provider = new RpcProvider({
      nodeUrl: process.env.STARKNET_RPC_URL || "https://rpc.starknet.lava.build/",
    });

    const checks = await Promise.all(
      candidates.map(async (game) => {
        const state = await checkOnChainState(provider, game.gameId!);
        return { game, state };
      })
    );

    for (const { game, state } of checks) {
      if (state && state.hp > 0) {
        alive.push({
          id: game.id,
          gameId: game.gameId!,
          hp: state.hp,
          xp: state.xp,
          gold: state.gold,
          level: state.level,
          status: game.status!,
          errorMessage: game.errorMessage,
          createdAt: game.createdAt,
        });
      } else if (state && state.hp === 0) {
        // Only insert a recovered result if one doesn't already exist
        const existingResult = await db
          .select()
          .from(gameResults)
          .where(eq(gameResults.gameRequestId, game.id))
          .limit(1);
        if (existingResult.length === 0) {
          await db.insert(gameResults).values({
            gameRequestId: game.id,
            gameId: game.gameId!,
            level: state.level,
            xp: state.xp,
            gold: state.gold,
            causeOfDeath: "Died (recovered from crash)",
          });
        }
        await db
          .update(gameRequests)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(gameRequests.id, game.id));
      }
    }
  }

  return alive;
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(user.sub);
  const controllerAddr = user.addr;

  // Check for currently running/queued game
  const [active] = await db
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

  // Get the active game's gameId so we can exclude it from resumable
  const activeGameId = active?.gameId ?? null;

  // Try Torii discovery first, fall back to DB+RPC
  let resumable: Array<{
    id: number | null;
    gameId: number;
    hp: number;
    xp: number;
    gold: number;
    level: number;
    status: string;
    errorMessage: string | null;
    createdAt: string | null;
  }> = [];

  try {
    const aliveGames = await discoverAliveGames(controllerAddr);

    // Exclude the currently active game
    const nonActive = aliveGames.filter((g) => g.gameId !== activeGameId);

    // Get all failed game requests for this user (to cross-reference)
    const failedRequests = await db
      .select()
      .from(gameRequests)
      .where(
        and(
          eq(gameRequests.userId, userId),
          eq(gameRequests.status, "failed"),
          isNotNull(gameRequests.gameId)
        )
      );

    const failedByGameId = new Map(
      failedRequests.map((r) => [r.gameId!, r])
    );

    // Build resumable list
    const aliveGameIds = new Set(nonActive.map((g) => g.gameId));

    for (const game of nonActive) {
      const dbRow = failedByGameId.get(game.gameId);
      resumable.push({
        id: dbRow?.id ?? null,
        gameId: game.gameId,
        hp: game.hp,
        xp: game.xp,
        gold: game.gold,
        level: game.level,
        status: dbRow?.status ?? "untracked",
        errorMessage: dbRow?.errorMessage ?? null,
        createdAt: dbRow?.createdAt?.toISOString() ?? null,
      });
    }

    // Clean up dead games: DB entries marked "failed" but NOT alive on-chain
    for (const [gameId, dbRow] of failedByGameId) {
      if (!aliveGameIds.has(gameId) && gameId !== activeGameId) {
        // Game is dead on-chain — auto-complete it
        const provider = new RpcProvider({
          nodeUrl: process.env.STARKNET_RPC_URL || "https://rpc.starknet.lava.build/",
        });
        const state = await checkOnChainState(provider, gameId);
        if (state && state.hp === 0) {
          await db
            .update(gameRequests)
            .set({ status: "completed", completedAt: new Date() })
            .where(eq(gameRequests.id, dbRow.id));
          await db.insert(gameResults).values({
            gameRequestId: dbRow.id,
            gameId,
            level: state.level,
            xp: state.xp,
            gold: state.gold,
            causeOfDeath: "Died (recovered from crash)",
          });
        }
      }
    }
  } catch (err) {
    console.warn("[active] Torii discovery failed, falling back to DB+RPC:", err);
    const fallback = await fallbackDbDiscovery(userId);
    resumable = fallback.map((g) => ({
      ...g,
      createdAt: g.createdAt?.toISOString() ?? null,
    }));
  }

  return NextResponse.json({
    active: active || null,
    resumable,
  });
}
