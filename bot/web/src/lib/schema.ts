import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  controllerAddr: text("controller_addr").notNull().unique(),
  displayName: text("display_name"),
  isOwner: integer("is_owner", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const sessionCredentials = sqliteTable("session_credentials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  sessionPrivEnc: text("session_priv_enc").notNull(), // AES-256-GCM encrypted
  sessionHash: text("session_hash").notNull(),
  sessionKeyGuid: text("session_key_guid").notNull(),
  ownerEip191: text("owner_eip191").notNull(),
  expiresAt: integer("expires_at").notNull(), // unix timestamp
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const gameQueues = sqliteTable("game_queues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  totalGames: integer("total_games").notNull(),
  completedGames: integer("completed_games").default(0),
  currentGameRequestId: integer("current_game_request_id"),
  status: text("status", { enum: ["active", "completed", "cancelled"] }).default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const gameRequests = sqliteTable("game_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  queueId: integer("queue_id"),
  status: text("status", { enum: ["queued", "running", "completed", "failed"] }).default("queued"),
  gameId: integer("game_id"),
  workerPid: integer("worker_pid"),
  botName: text("bot_name").default("BOT"),
  costStrk: text("cost_strk"),
  txHash: text("tx_hash"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const gameResults = sqliteTable("game_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gameRequestId: integer("game_request_id").notNull().references(() => gameRequests.id),
  gameId: integer("game_id").notNull(),
  level: integer("level"),
  xp: integer("xp"),
  gold: integer("gold"),
  causeOfDeath: text("cause_of_death"),
  statsJson: text("stats_json"), // JSON blob
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
