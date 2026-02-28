// Setup Cartridge session for the bot
// Two modes:
// 1. Automatic: callback server on localhost (may not work in WSL2)
// 2. Manual: user pastes the redirect URL after approval

import { stark, ec, encode, hash, addAddressPadding } from "starknet";
import { constants } from "starknet";
import * as fs from "fs";
import * as http from "http";
import * as readline from "readline";

const GAME = "0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c";
const VRF = "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f";
const DUNGEON = "0x00a67ef20b61a9846e1c82b411175e6ab167ea9f8632bd6c2091823c3629ec42";
const TICKET = "0x0452810188C4Cb3AEbD63711a3b445755BC0D6C4f27B923fDd99B1A118858136";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const KEYCHAIN_URL = "https://x.cartridge.gg";
const RPC_URL = "https://api.cartridge.gg/x/starknet/mainnet";
const CHAIN_ID = constants.StarknetChainId.SN_MAIN;
const SESSION_DIR = "./cartridge-session";

// Policies in the format expected by SessionProvider
const policies = {
  verified: false,
  contracts: {
    [VRF]: {
      methods: [
        { name: "request_random", entrypoint: "request_random", authorized: true },
      ],
    },
    [GAME]: {
      methods: [
        { name: "attack", entrypoint: "attack", authorized: true },
        { name: "explore", entrypoint: "explore", authorized: true },
        { name: "flee", entrypoint: "flee", authorized: true },
        { name: "start_game", entrypoint: "start_game", authorized: true },
        { name: "select_stat_upgrades", entrypoint: "select_stat_upgrades", authorized: true },
        { name: "buy_items", entrypoint: "buy_items", authorized: true },
        { name: "equip", entrypoint: "equip", authorized: true },
        { name: "drop", entrypoint: "drop", authorized: true },
      ],
    },
    [DUNGEON]: {
      methods: [
        { name: "buy_game", entrypoint: "buy_game", authorized: true },
      ],
    },
    [TICKET]: {
      methods: [
        { name: "approve", entrypoint: "approve", authorized: true },
      ],
    },
    [STRK]: {
      methods: [
        { name: "approve", entrypoint: "approve", authorized: true },
        { name: "transfer", entrypoint: "transfer", authorized: true },
      ],
    },
  },
};

function processSessionData(sessionData: string, publicKey: string) {
  const { signerToGuid } = require("@cartridge/controller-wasm");

  const sessionRegistration = JSON.parse(atob(sessionData));
  const formattedPk = encode.addHexPrefix(publicKey);

  sessionRegistration.address = sessionRegistration.address.toLowerCase();
  sessionRegistration.ownerGuid = sessionRegistration.ownerGuid.toLowerCase();
  sessionRegistration.guardianKeyGuid = "0x0";
  sessionRegistration.metadataHash = "0x0";
  sessionRegistration.sessionKeyGuid = signerToGuid({
    starknet: { privateKey: formattedPk },
  });

  return sessionRegistration;
}

async function main() {
  const { signerToGuid } = await import("@cartridge/controller-wasm");

  // Step 1: Generate session key pair
  const privKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privKey);
  const formattedPk = encode.addHexPrefix(publicKey);

  console.log("Generated session key pair:");
  console.log("  Private key:", privKey);
  console.log("  Public key:", formattedPk);

  const sessionKeyGuid = signerToGuid({ starknet: { privateKey: formattedPk } });
  console.log("  Session key GUID:", sessionKeyGuid);

  // Step 2: Start callback server
  let callbackPort = 0;
  let callbackResolve: ((data: string) => void) | null = null;

  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith("/callback")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const params = new URLSearchParams(req.url.split("?")[1]);
    const session = params.get("startapp");
    if (session && callbackResolve) {
      callbackResolve(session);
      callbackResolve = null;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body>Session registered! You can close this window.</body></html>");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "localhost", () => {
      const addr = server.address() as any;
      callbackPort = addr.port;
      resolve();
    });
  });

  const redirectUri = `http://localhost:${callbackPort}/callback`;

  // Step 3: Build the approval URL
  const url = `${KEYCHAIN_URL}/session?public_key=${encodeURIComponent(formattedPk)}&redirect_uri=${encodeURIComponent(redirectUri)}&redirect_query_name=startapp&policies=${encodeURIComponent(JSON.stringify(policies))}&rpc_url=${encodeURIComponent(RPC_URL)}`;

  console.log("\n============================================================");
  console.log("OPEN THIS URL IN YOUR BROWSER:");
  console.log("============================================================");
  console.log(url);
  console.log("============================================================\n");

  console.log("After approving, one of two things will happen:");
  console.log("1. The callback server detects the approval automatically");
  console.log("2. OR the browser redirects to a localhost URL - copy the FULL URL from the browser bar");
  console.log("   and paste it here if nothing happens after 30 seconds.\n");

  // Step 4: Wait for either callback or manual input
  const sessionDataPromise = new Promise<string>((resolve) => {
    callbackResolve = resolve;

    // Also accept manual input
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Check if it's a URL with startapp parameter
      if (trimmed.includes("startapp=")) {
        const match = trimmed.match(/startapp=([^&\s]+)/);
        if (match) {
          console.log("Got session data from pasted URL!");
          resolve(match[1]);
          rl.close();
          return;
        }
      }

      // Check if it's raw base64 data
      try {
        const decoded = atob(trimmed);
        if (decoded.includes("address") && decoded.includes("ownerGuid")) {
          console.log("Got raw session data!");
          resolve(trimmed);
          rl.close();
          return;
        }
      } catch {}

      console.log("Didn't recognize input. Paste the full redirect URL or base64 session data.");
    });
  });

  console.log("Waiting for session approval...\n");

  const sessionData = await Promise.race([
    sessionDataPromise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Timeout after 10 minutes")), 10 * 60 * 1000)),
  ]);

  server.close();

  // Step 5: Process and save session data
  console.log("\nProcessing session data...");
  const sessionRegistration = JSON.parse(atob(sessionData));

  sessionRegistration.address = sessionRegistration.address.toLowerCase();
  sessionRegistration.ownerGuid = sessionRegistration.ownerGuid.toLowerCase();
  sessionRegistration.guardianKeyGuid = "0x0";
  sessionRegistration.metadataHash = "0x0";
  sessionRegistration.sessionKeyGuid = signerToGuid({
    starknet: { privateKey: formattedPk },
  });

  console.log("Session details:");
  console.log("  Controller address:", sessionRegistration.address);
  console.log("  Owner GUID:", sessionRegistration.ownerGuid);
  console.log("  Session key GUID:", sessionRegistration.sessionKeyGuid);
  console.log("  Expires at:", sessionRegistration.expiresAt);
  console.log("  Username:", sessionRegistration.username);

  // Save in SessionProvider format
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  const fileData = {
    session: sessionRegistration,
    signer: { privKey, pubKey: publicKey },
  };

  fs.writeFileSync(`${SESSION_DIR}/session.json`, JSON.stringify(fileData, null, 2));
  console.log(`\nSession saved to ${SESSION_DIR}/session.json`);
  console.log("\nYou can now run the bot!");
}

main().catch((e) => {
  console.error("Error:", e.message || e);
  process.exit(1);
});
