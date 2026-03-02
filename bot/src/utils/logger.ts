type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
  bold: "\x1b[1m",
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.gray,
  info: COLORS.blue,
  warn: COLORS.yellow,
  error: COLORS.red,
};

const CATEGORY_COLORS: Record<string, string> = {
  combat: COLORS.red,
  explore: COLORS.cyan,
  shop: COLORS.magenta,
  stats: COLORS.green,
  death: `${COLORS.red}${COLORS.bold}`,
  tx: COLORS.yellow,
  state: COLORS.white,
};

let _gameRequestId: string | null = null;
let _minLevel: LogLevel = "info";
let _structuredMode = false;

/** Set correlation ID for all log lines (call once per game) */
export function setLogContext(gameRequestId: string | null): void {
  _gameRequestId = gameRequestId;
}

/** Set minimum log level (default: info) */
export function setLogLevel(level: LogLevel): void {
  _minLevel = level;
}

/** Enable structured JSON output (for SaaS/production) */
export function setStructuredMode(enabled: boolean): void {
  _structuredMode = enabled;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[_minLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

function emitStructured(level: LogLevel, category: string | null, msg: string, args: any[]): void {
  const entry: Record<string, any> = {
    ts: timestamp(),
    level,
    msg: args.length > 0 ? `${msg} ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}` : msg,
  };
  if (category) entry.cat = category;
  if (_gameRequestId) entry.gid = _gameRequestId;
  console.log(JSON.stringify(entry));
}

function emitPretty(level: LogLevel, category: string | null, msg: string, args: any[]): void {
  const ts = timestamp().slice(11, 23); // HH:MM:SS.mmm
  const levelColor = LEVEL_COLORS[level];
  const levelTag = level.toUpperCase().padEnd(5);
  const gidTag = _gameRequestId ? `${COLORS.gray}[${_gameRequestId.slice(0, 8)}]${COLORS.reset} ` : "";
  const catTag = category
    ? `${CATEGORY_COLORS[category] || COLORS.white}${category.padEnd(7)}${COLORS.reset} `
    : "";

  console.log(
    `${COLORS.gray}[${ts}]${COLORS.reset} ${levelColor}${levelTag}${COLORS.reset} ${gidTag}${catTag}${msg}`,
    ...args,
  );
}

function emit(level: LogLevel, category: string | null, msg: string, args: any[]): void {
  if (!shouldLog(level)) return;
  if (_structuredMode) {
    emitStructured(level, category, msg, args);
  } else {
    emitPretty(level, category, msg, args);
  }
}

export const log = {
  // Level-based methods
  debug: (msg: string, ...args: any[]) => emit("debug", null, msg, args),
  info: (msg: string, ...args: any[]) => emit("info", null, msg, args),
  warn: (msg: string, ...args: any[]) => emit("warn", null, msg, args),
  error: (msg: string, ...args: any[]) => emit("error", null, msg, args),

  // Domain categories (all at info level, except death=warn)
  success: (msg: string, ...args: any[]) => emit("info", null, msg, args),
  combat: (msg: string, ...args: any[]) => emit("info", "combat", msg, args),
  explore: (msg: string, ...args: any[]) => emit("info", "explore", msg, args),
  shop: (msg: string, ...args: any[]) => emit("info", "shop", msg, args),
  stats: (msg: string, ...args: any[]) => emit("info", "stats", msg, args),
  death: (msg: string, ...args: any[]) => emit("warn", "death", msg, args),
  tx: (msg: string, ...args: any[]) => emit("info", "tx", msg, args),
  state: (msg: string, ...args: any[]) => emit("debug", "state", msg, args),
};
