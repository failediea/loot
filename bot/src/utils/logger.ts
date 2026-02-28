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

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export const log = {
  info: (msg: string, ...args: any[]) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.blue}INFO${COLORS.reset}  ${msg}`, ...args),

  success: (msg: string, ...args: any[]) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.green}OK${COLORS.reset}    ${msg}`, ...args),

  warn: (msg: string, ...args: any[]) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.yellow}WARN${COLORS.reset}  ${msg}`, ...args),

  error: (msg: string, ...args: any[]) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.red}ERROR${COLORS.reset} ${msg}`, ...args),

  combat: (msg: string, ...args: any[]) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.red}⚔️${COLORS.reset}    ${msg}`, ...args),

  explore: (msg: string, ...args: any[]) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.cyan}🗺️${COLORS.reset}    ${msg}`, ...args),

  shop: (msg: string, ...args: any[]) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.magenta}🛒${COLORS.reset}    ${msg}`, ...args),

  stats: (msg: string, ...args: any[]) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.green}📊${COLORS.reset}    ${msg}`, ...args),

  death: (msg: string, ...args: any[]) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.red}${COLORS.bold}💀${COLORS.reset}    ${msg}`, ...args),

  tx: (msg: string, ...args: any[]) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.yellow}📝${COLORS.reset}    ${msg}`, ...args),

  state: (msg: string, ...args: any[]) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.white}📋${COLORS.reset}    ${msg}`, ...args),
};
