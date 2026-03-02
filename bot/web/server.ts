import { createServer } from "http";
import next from "next";
import { parse } from "url";
import { wsServer } from "./src/lib/ws-server";
import { workerManager } from "./src/lib/worker-manager";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // Attach WebSocket server
  wsServer.attach(server);

  // Wire worker manager events to WebSocket
  workerManager.onEvent((gameRequestId, event) => {
    wsServer.broadcastToGame(gameRequestId, event);
  });

  // Wire queue-level events to user's WebSocket connections
  workerManager.onUserEvent((userId, event) => {
    wsServer.broadcastToUser(userId, event);
  });

  server.listen(port, hostname, () => {
    console.log(`> Loot Survivor SaaS running on http://${hostname}:${port}`);

    // Recover any games that were running when the server last stopped
    workerManager.recoverOrphanedGames().catch((err) => {
      console.error("[Server] Failed to recover orphaned games:", err);
    });
  });
});
