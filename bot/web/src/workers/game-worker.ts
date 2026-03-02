/**
 * Game worker - runs in a child process.
 * Receives session credentials via IPC and plays a full game of Loot Survivor.
 * Supports both "start" (buy new game) and "resume" (continue existing game) modes.
 * Reports dashboard events back to parent via IPC.
 */

interface Creds {
  controller: string;
  sessionPriv: string;
  sessionKeyGuid: string;
  wildcardRoot: string;
  ownerGuid: string;
  sessionExpires: number;
}

interface StartMessage {
  type: "start";
  gameRequestId: number;
  creds: Creds;
  botName: string;
}

interface ResumeMessage {
  type: "resume";
  gameRequestId: number;
  gameId: number;
  creds: Creds;
}

type WorkerMessage = StartMessage | ResumeMessage;

process.on("message", async (msg: WorkerMessage) => {
  if (msg.type !== "start" && msg.type !== "resume") return;

  const { creds, gameRequestId } = msg;

  try {
    // Import bot modules (these are relative to bot/src/)
    const { installSessionInterceptor } = await import("../../../src/chain/session.js");
    const { loadConfig } = await import("../../../src/config.js");
    const { createProvider } = await import("../../../src/chain/provider.js");
    const { createCallBuilders } = await import("../../../src/chain/calls.js");
    const { buyGame, startGame } = await import("../../../src/game/lifecycle.js");
    const { resumeGame } = await import("../../../src/game/loop.js");
    const { fetchGameState } = await import("../../../src/chain/state.js");
    const { dashboard } = await import("../../../src/dashboard/events.js");

    // Set log context for correlation — all log lines will include this game request ID
    const { setLogContext } = await import("../../../src/utils/logger.js");
    setLogContext(String(gameRequestId));

    // Set game request ID on dashboard so events are tagged
    dashboard.setGameRequestId(gameRequestId);

    // Forward all dashboard events to parent process via IPC
    dashboard.on("event", (event: any) => {
      process.send!({
        type: "dashboard_event",
        event: { ...event, gameRequestId },
      });
    });

    // Install session interceptor with user's credentials
    installSessionInterceptor(creds);

    // Load config with user's controller address
    const config = loadConfig(creds.controller);
    const provider = createProvider(config);
    const calls = createCallBuilders(config);

    let gameId: number;

    if (msg.type === "start") {
      // Buy and start a new game
      gameId = await buyGame(config, calls, provider, msg.botName);
      process.send!({ type: "game_started", gameId });
      await startGame(config, gameId, calls);
    } else {
      // Resume an existing game — verify it's still alive
      gameId = msg.gameId;
      const state = await fetchGameState(provider, config, gameId);
      if (!state || state.adventurer.health === 0) {
        // Game is already dead on-chain
        process.send!({
          type: "game_complete",
          summary: state ? {
            gameId,
            level: state.adventurer.level,
            xp: state.adventurer.xp,
            gold: state.adventurer.gold,
            causeOfDeath: "Died (recovered after crash)",
            lastPhase: "dead",
            lastAction: "none",
            stats: state.adventurer.stats,
          } : { gameId, level: 0, xp: 0, gold: 0, causeOfDeath: "Game not found on-chain" },
        });
        process.exit(0);
        return;
      }
      process.send!({ type: "game_resumed", gameId });
    }

    dashboard.emitGameStart(gameId, 1);

    // Play the game to completion
    const summary = await resumeGame(provider, config, calls, gameId);

    process.send!({ type: "game_complete", summary });
    process.exit(0);
  } catch (error: any) {
    process.send!({
      type: "error",
      error: error?.message || String(error),
    });
    process.exit(1);
  }
});
