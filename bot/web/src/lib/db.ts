import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "../../data/bot.db");

// Ensure data directory exists
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

// Auto-create tables on first load using better-sqlite3's exec (not child_process)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    controller_addr TEXT NOT NULL UNIQUE,
    display_name TEXT,
    is_owner INTEGER DEFAULT 0,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS session_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    session_priv_enc TEXT NOT NULL,
    session_hash TEXT NOT NULL,
    session_key_guid TEXT NOT NULL,
    owner_eip191 TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS game_queues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    total_games INTEGER NOT NULL,
    completed_games INTEGER DEFAULT 0,
    current_game_request_id INTEGER,
    status TEXT DEFAULT 'active',
    created_at INTEGER,
    completed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS game_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    queue_id INTEGER,
    status TEXT DEFAULT 'queued',
    game_id INTEGER,
    worker_pid INTEGER,
    bot_name TEXT DEFAULT 'BOT',
    cost_strk TEXT,
    tx_hash TEXT,
    error_message TEXT,
    created_at INTEGER,
    started_at INTEGER,
    completed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS game_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_request_id INTEGER NOT NULL REFERENCES game_requests(id),
    game_id INTEGER NOT NULL,
    level INTEGER,
    xp INTEGER,
    gold INTEGER,
    cause_of_death TEXT,
    stats_json TEXT,
    created_at INTEGER
  );
`);

// Migrations for existing databases (SQLite has no IF NOT EXISTS for ALTER TABLE)
try { sqlite.exec("ALTER TABLE game_requests ADD COLUMN queue_id INTEGER"); } catch {}

