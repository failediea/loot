import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { verifyToken, type JWTPayload } from "./auth";
import { db } from "./db";
import { gameRequests } from "./schema";
import { eq, and } from "drizzle-orm";

interface WSClient {
  ws: WebSocket;
  userId: number;
  gameRequestId?: number;
}

class WSServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WSClient>();

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", async (ws, req) => {
      // Authenticate via query param token
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const token = url.searchParams.get("token");

      if (!token) {
        ws.close(4001, "Missing auth token");
        return;
      }

      const user = await verifyToken(token);
      if (!user) {
        ws.close(4001, "Invalid auth token");
        return;
      }

      const client: WSClient = {
        ws,
        userId: parseInt(user.sub),
      };

      // Find user's active game to auto-join room
      const [activeGame] = await db
        .select()
        .from(gameRequests)
        .where(
          and(
            eq(gameRequests.userId, parseInt(user.sub)),
            eq(gameRequests.status, "running")
          )
        )
        .limit(1);

      if (activeGame) {
        client.gameRequestId = activeGame.id;
      }

      this.clients.add(client);

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "join_game" && msg.gameRequestId) {
            client.gameRequestId = msg.gameRequestId;
          }
        } catch {}
      });

      ws.on("close", () => {
        this.clients.delete(client);
      });

      // Send welcome with current game status
      ws.send(JSON.stringify({
        type: "connected",
        activeGameRequestId: activeGame?.id || null,
        activeGameId: activeGame?.gameId || null,
      }));
    });
  }

  broadcastToGame(gameRequestId: number, event: any): void {
    const msg = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.gameRequestId === gameRequestId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }

  broadcastToUser(userId: number, event: any): void {
    const msg = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }
}

// Singleton via globalThis to survive Next.js separate module graphs
const WS_GLOBAL_KEY = "__wsServer";
export const wsServer: WSServer =
  (globalThis as any)[WS_GLOBAL_KEY] ??
  ((globalThis as any)[WS_GLOBAL_KEY] = new WSServer());
