import { createServer } from "http";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { dashboard } from "./events.js";
import type { DashboardEvent } from "./events.js";
import { log } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, "../../dashboard/public/index.html");

let wss: WebSocketServer | null = null;

export async function startDashboard(port = 8080): Promise<void> {
  let html: string;
  try {
    html = readFileSync(HTML_PATH, "utf-8");
  } catch {
    log.warn(`Dashboard HTML not found at ${HTML_PATH}, dashboard disabled`);
    return;
  }

  const server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    // Send init payload with current state, recent events, and game history
    const init = {
      type: "init",
      currentState: dashboard.getCurrentState(),
      recentEvents: dashboard.getRecentEvents(),
      gameHistory: dashboard.getGameHistory(),
    };
    ws.send(JSON.stringify(init));
  });

  // Broadcast all events to connected clients
  dashboard.on("event", (event: DashboardEvent) => {
    if (!wss) return;
    const msg = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        log.warn(`Dashboard port ${port} is busy, dashboard disabled`);
        resolve();
      } else {
        log.warn(`Dashboard server error: ${err.message}`);
        resolve();
      }
    });

    server.listen(port, () => {
      log.success(`Dashboard running at http://localhost:${port}`);
      resolve();
    });
  });
}
