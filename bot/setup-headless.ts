// Polyfill window/localStorage BEFORE any imports
import * as fs from "fs";
import * as path from "path";

const STORAGE_FILE = "./cartridge-session/storage.json";

function ensureDir() {
  const dir = path.dirname(STORAGE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStorage(): Record<string, string> {
  ensureDir();
  try { return JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")); }
  catch { return {}; }
}

function saveStorage(data: Record<string, string>) {
  ensureDir();
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
}

const _data = loadStorage();

const ls = {
  getItem: (key: string) => { return _data[key] ?? null; },
  setItem: (key: string, value: string) => { _data[key] = value; saveStorage(_data); },
  removeItem: (key: string) => { delete _data[key]; saveStorage(_data); },
  clear: () => { Object.keys(_data).forEach(k => delete _data[k]); saveStorage(_data); },
  get length() { return Object.keys(_data).length; },
  key: (i: number) => Object.keys(_data)[i] ?? null,
};

// Must set BEFORE wasm imports
(globalThis as any).localStorage = ls;
(globalThis as any).window = globalThis;

// Also add fetch if missing
if (!(globalThis as any).fetch) {
  console.log("NOTE: fetch already exists");
}

async function main() {
  console.log("window exists:", typeof (globalThis as any).window !== "undefined");
  console.log("localStorage exists:", typeof (globalThis as any).localStorage !== "undefined");
  console.log("localStorage.getItem:", typeof (globalThis as any).localStorage.getItem);

  const wasm = await import("@cartridge/controller-wasm");
  const { RpcProvider } = await import("starknet");

  const CARTRIDGE_API = "https://api.cartridge.gg";
  const RPC = "https://api.cartridge.gg/x/starknet/mainnet";
  const provider = new RpcProvider({ nodeUrl: RPC });

  const existingClassHash = await provider.getClassHashAt(
    "0x02EB8E6459A39d3ac8A2F52aB17084B259BeED1f705c0CAe9caAE4CFFE391d8E"
  );
  console.log("Controller class hash:", existingClassHash);

  const username = "lsbot" + Math.floor(Math.random() * 100000);
  console.log(`Creating headless Controller: ${username}`);

  try {
    const result = await wasm.CartridgeAccount.newHeadless(
      existingClassHash, RPC, username, CARTRIDGE_API
    );
    const meta = result.meta();
    console.log("\nController created!");
    console.log("Address:", meta.address());
    console.log("Username:", meta.username());
    console.log("Owner:", JSON.stringify(meta.owner()));

    const accountInfo = {
      address: meta.address(),
      username: meta.username(),
      classHash: meta.classHash(),
      owner: meta.owner(),
    };
    fs.writeFileSync("./cartridge-session/headless-account.json", JSON.stringify(accountInfo, null, 2));
    console.log("Saved to ./cartridge-session/headless-account.json");
  } catch (e: any) {
    console.log("Error:", e.message || e);

    // Check if the error is about a specific window property
    if (e.message?.includes("window")) {
      console.log("\nWindow properties check:");
      console.log("  window:", typeof (globalThis as any).window);
      console.log("  window.localStorage:", typeof (globalThis as any).window?.localStorage);
      console.log("  window.localStorage.getItem:", typeof (globalThis as any).window?.localStorage?.getItem);
    }
  }
}

main().catch(console.error);
