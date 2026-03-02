import { fork, type ChildProcess } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "./db";
import { gameRequests, gameResults, gameQueues, sessionCredentials, users } from "./schema";
import { eq, or, and } from "drizzle-orm";
import { decrypt } from "./encryption";
import { signerToGuid } from "@cartridge/controller-wasm";
import { encode } from "starknet";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, "../workers/game-worker.ts");

const MAX_RETRIES = 3;

export interface WorkerMessage {
  type: "dashboard_event" | "game_started" | "game_resumed" | "game_complete" | "error";
  event?: any;
  gameId?: number;
  summary?: any;
  error?: string;
}

type EventCallback = (gameRequestId: number, event: any) => void;
type UserEventCallback = (userId: number, event: any) => void;

class WorkerManager {
  private workers = new Map<number, ChildProcess>(); // gameRequestId -> process
  private retries = new Map<number, number>(); // gameRequestId -> retry count
  private maxConcurrent: number;
  private queue: number[] = []; // gameRequestId FIFO
  private eventCallback: EventCallback | null = null;
  private userEventCallback: UserEventCallback | null = null;

  constructor() {
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_WORKERS || "20", 10);
  }

  onEvent(callback: EventCallback): void {
    this.eventCallback = callback;
  }

  onUserEvent(callback: UserEventCallback): void {
    this.userEventCallback = callback;
  }

  getActiveCount(): number {
    return this.workers.size;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  isGameRunning(gameRequestId: number): boolean {
    return this.workers.has(gameRequestId);
  }

  async startGame(gameRequestId: number): Promise<void> {
    if (this.workers.size >= this.maxConcurrent) {
      this.queue.push(gameRequestId);
      return;
    }
    this.retries.set(gameRequestId, 0);
    await this.spawnWorker(gameRequestId, "start");
  }

  async resumeGame(gameRequestId: number): Promise<void> {
    if (this.workers.has(gameRequestId)) {
      console.log(`[WorkerManager] Game ${gameRequestId} already has a running worker, skipping resume`);
      return;
    }
    if (this.workers.size >= this.maxConcurrent) {
      this.queue.push(gameRequestId);
      return;
    }
    await this.spawnWorker(gameRequestId, "resume");
  }

  /**
   * Called on server startup. Finds all game_requests stuck in "running" or "queued"
   * and attempts to resume them (if they have a gameId) or marks them failed.
   */
  async recoverOrphanedGames(): Promise<void> {
    const orphaned = await db
      .select()
      .from(gameRequests)
      .where(
        or(
          eq(gameRequests.status, "running"),
          eq(gameRequests.status, "queued")
        )
      );

    if (orphaned.length === 0) {
      console.log("[WorkerManager] No orphaned games to recover");
      return;
    }

    console.log(`[WorkerManager] Found ${orphaned.length} orphaned game(s), attempting recovery...`);

    for (const game of orphaned) {
      if (game.gameId) {
        // Game was purchased — try to resume it
        console.log(`[WorkerManager] Resuming game request #${game.id} (gameId: ${game.gameId})`);
        this.retries.set(game.id, 0);
        await this.spawnWorker(game.id, "resume");
      } else {
        // Game never got a gameId — worker died before purchasing. Mark as failed.
        console.log(`[WorkerManager] Game request #${game.id} has no gameId, marking as failed`);
        await db
          .update(gameRequests)
          .set({
            status: "failed",
            errorMessage: "Server restarted before game could be purchased",
            completedAt: new Date(),
          })
          .where(eq(gameRequests.id, game.id));
      }
    }
  }

  private async getCredsForRequest(gameRequestId: number) {
    const [request] = await db
      .select()
      .from(gameRequests)
      .where(eq(gameRequests.id, gameRequestId))
      .limit(1);

    if (!request) return null;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, request.userId))
      .limit(1);

    const controllerAddr = user?.controllerAddr || "";

    const [creds] = await db
      .select()
      .from(sessionCredentials)
      .where(eq(sessionCredentials.userId, request.userId))
      .limit(1);

    if (!creds) return null;

    let sessionPriv: string;
    try {
      sessionPriv = decrypt(creds.sessionPrivEnc);
    } catch {
      return null;
    }

    let sessionKeyGuid = creds.sessionKeyGuid;
    if (!sessionKeyGuid || sessionKeyGuid === "0x0") {
      sessionKeyGuid = signerToGuid({ starknet: { privateKey: encode.addHexPrefix(sessionPriv) } });
    }

    return {
      request,
      creds: {
        controller: controllerAddr,
        sessionPriv,
        sessionKeyGuid,
        wildcardRoot: "0x77696c64636172642d706f6c696379",
        ownerGuid: creds.ownerEip191,
        sessionExpires: creds.expiresAt,
      },
    };
  }

  private async spawnWorker(gameRequestId: number, mode: "start" | "resume"): Promise<void> {
    const data = await this.getCredsForRequest(gameRequestId);

    if (!data) {
      console.error(`[WorkerManager] Cannot spawn worker for game ${gameRequestId}: missing request or credentials`);
      await db
        .update(gameRequests)
        .set({ status: "failed", errorMessage: "Missing credentials", completedAt: new Date() })
        .where(eq(gameRequests.id, gameRequestId));
      return;
    }

    const { request, creds } = data;

    // Spawn child process
    const child = fork(WORKER_PATH, [], {
      execArgv: ["--import", "tsx/esm", "--experimental-wasm-modules"],
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    if (mode === "start") {
      child.send({
        type: "start",
        gameRequestId,
        creds,
        botName: request.botName || "BOT",
      });

      // Update status
      await db
        .update(gameRequests)
        .set({
          status: "running",
          workerPid: child.pid,
          startedAt: new Date(),
        })
        .where(eq(gameRequests.id, gameRequestId));
    } else {
      child.send({
        type: "resume",
        gameRequestId,
        gameId: request.gameId!,
        creds,
      });

      // Update status — keep as running, just update the PID
      await db
        .update(gameRequests)
        .set({
          status: "running",
          workerPid: child.pid,
        })
        .where(eq(gameRequests.id, gameRequestId));
    }

    child.on("message", (msg: WorkerMessage) => {
      this.handleWorkerMessage(gameRequestId, msg);
    });

    child.on("exit", (code) => {
      this.handleWorkerExit(gameRequestId, code);
    });

    // Log stdout/stderr
    child.stdout?.on("data", (data: Buffer) => {
      console.log(`[Worker ${gameRequestId}] ${data.toString().trim()}`);
    });
    child.stderr?.on("data", (data: Buffer) => {
      console.error(`[Worker ${gameRequestId}] ${data.toString().trim()}`);
    });

    this.workers.set(gameRequestId, child);
  }

  private async handleWorkerMessage(gameRequestId: number, msg: WorkerMessage): Promise<void> {
    switch (msg.type) {
      case "dashboard_event":
        if (this.eventCallback && msg.event) {
          this.eventCallback(gameRequestId, msg.event);
        }
        break;

      case "game_started":
        if (msg.gameId) {
          await db
            .update(gameRequests)
            .set({ gameId: msg.gameId })
            .where(eq(gameRequests.id, gameRequestId));
        }
        break;

      case "game_resumed":
        // Worker confirmed the game is alive — reset retry count
        this.retries.set(gameRequestId, 0);
        console.log(`[WorkerManager] Game ${gameRequestId} resumed successfully (gameId: ${msg.gameId})`);
        break;

      case "game_complete":
        // Success — clear retries
        this.retries.delete(gameRequestId);

        if (msg.summary) {
          await db
            .update(gameRequests)
            .set({ status: "completed", completedAt: new Date() })
            .where(eq(gameRequests.id, gameRequestId));

          await db.insert(gameResults).values({
            gameRequestId,
            gameId: msg.summary.gameId,
            level: msg.summary.level,
            xp: msg.summary.xp,
            gold: msg.summary.gold,
            causeOfDeath: msg.summary.causeOfDeath,
            statsJson: JSON.stringify(msg.summary.stats),
            createdAt: new Date(),
          });

          // Advance queue if this game belongs to one
          await this.processQueueNext(gameRequestId);
        }
        break;

      case "error":
        await db
          .update(gameRequests)
          .set({
            status: "failed",
            errorMessage: msg.error?.slice(0, 500),
            completedAt: new Date(),
          })
          .where(eq(gameRequests.id, gameRequestId));
        break;
    }
  }

  private async handleWorkerExit(gameRequestId: number, code: number | null): Promise<void> {
    this.workers.delete(gameRequestId);

    if (code === 0) {
      // Clean exit — game completed normally, queue next
      this.retries.delete(gameRequestId);
      this.processQueue();
      return;
    }

    // Unexpected exit — check if we should auto-resume
    const [request] = await db
      .select()
      .from(gameRequests)
      .where(eq(gameRequests.id, gameRequestId))
      .limit(1);

    if (!request || request.status !== "running") {
      // Already marked as completed/failed by a message handler
      this.retries.delete(gameRequestId);
      this.processQueue();
      return;
    }

    const retryCount = (this.retries.get(gameRequestId) || 0) + 1;
    this.retries.set(gameRequestId, retryCount);

    if (request.gameId && retryCount <= MAX_RETRIES) {
      // Game has an on-chain ID — attempt auto-resume
      console.log(
        `[WorkerManager] Worker for game ${gameRequestId} crashed (code ${code}), ` +
        `auto-resuming (attempt ${retryCount}/${MAX_RETRIES})...`
      );

      // Brief delay before retry to avoid tight crash loops
      await new Promise((r) => setTimeout(r, 3000));

      await this.spawnWorker(gameRequestId, "resume");
    } else {
      // No gameId or retries exhausted — mark as failed
      const reason = !request.gameId
        ? `Worker crashed before game was purchased (code ${code})`
        : `Worker crashed ${retryCount} times (code ${code}), giving up`;

      console.error(`[WorkerManager] ${reason} for game request #${gameRequestId}`);

      await db
        .update(gameRequests)
        .set({
          status: "failed",
          errorMessage: reason,
          completedAt: new Date(),
        })
        .where(eq(gameRequests.id, gameRequestId));

      this.retries.delete(gameRequestId);

      // Advance game queue if this game belongs to one
      await this.processQueueNext(gameRequestId);

      this.processQueue();
    }
  }

  private async processQueueNext(completedGameRequestId: number): Promise<void> {
    // Look up the completed game's queue
    const [request] = await db
      .select()
      .from(gameRequests)
      .where(eq(gameRequests.id, completedGameRequestId))
      .limit(1);

    if (!request?.queueId) return;

    const [queue] = await db
      .select()
      .from(gameQueues)
      .where(eq(gameQueues.id, request.queueId))
      .limit(1);

    if (!queue || queue.status !== "active") return;

    const newCompleted = (queue.completedGames || 0) + 1;

    // Look up userId for broadcasting
    const userId = queue.userId;

    if (newCompleted >= queue.totalGames) {
      // Queue is done
      await db
        .update(gameQueues)
        .set({ completedGames: newCompleted, status: "completed", completedAt: new Date() })
        .where(eq(gameQueues.id, queue.id));

      if (this.userEventCallback) {
        this.userEventCallback(userId, {
          type: "queue_complete",
          queueId: queue.id,
          totalGames: queue.totalGames,
          completedGames: newCompleted,
        });
      }
    } else {
      // Start next game in queue
      const result = await db.insert(gameRequests).values({
        userId,
        queueId: queue.id,
        status: "queued",
        botName: request.botName || "BOT",
        createdAt: new Date(),
      });

      const nextId = Number(result.lastInsertRowid);

      await db
        .update(gameQueues)
        .set({ completedGames: newCompleted, currentGameRequestId: nextId })
        .where(eq(gameQueues.id, queue.id));

      if (this.userEventCallback) {
        this.userEventCallback(userId, {
          type: "queue_progress",
          queueId: queue.id,
          totalGames: queue.totalGames,
          completedGames: newCompleted,
          currentGameRequestId: nextId,
          gameNumber: newCompleted + 1,
        });
      }

      // Brief delay before starting next game
      await new Promise((r) => setTimeout(r, 3000));
      await this.spawnWorker(nextId, "start");
    }
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length > 0 && this.workers.size < this.maxConcurrent) {
      const next = this.queue.shift()!;
      await this.spawnWorker(next, "start");
    }
  }
}

// Singleton via globalThis to survive Next.js separate module graphs
const GLOBAL_KEY = "__workerManager";
export const workerManager: WorkerManager =
  (globalThis as any)[GLOBAL_KEY] ??
  ((globalThis as any)[GLOBAL_KEY] = new WorkerManager());
