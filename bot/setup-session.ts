// Setup Cartridge session WITHOUT relying on localhost callback
// Uses subscribeCreateSession to detect approval via Cartridge API

import { stark, ec, encode, hash, CallData, addAddressPadding } from "starknet";
import * as fs from "fs";

// Polyfill for session WASM
(globalThis as any).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
  length: 0, key: () => null,
};
(globalThis as any).window = globalThis;

const GAME = "0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c";
const DUNGEON = "0x00a67ef20b61a9846e1c82b411175e6ab167ea9f8632bd6c2091823c3629ec42";
const VRF = "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f";
const TICKET = "0x0452810188C4Cb3AEbD63711a3b445755BC0D6C4f27B923fDd99B1A118858136";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const EKUBO_ROUTER = "0x0199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4fb8737e";

const CARTRIDGE_API = "https://api.cartridge.gg";
const RPC = "https://api.cartridge.gg/x/starknet/mainnet";
const KEYCHAIN_URL = "https://x.cartridge.gg";
const CHAIN_ID = "0x534e5f4d41494e"; // SN_MAIN

async function main() {
  const { signerToGuid, subscribeCreateSession } = await import("@cartridge/controller-wasm");

  // Step 1: Generate session key
  const privKey = stark.randomAddress();
  const pubKey = ec.starkCurve.getStarkKey(privKey);
  const formattedPk = encode.addHexPrefix(pubKey);

  console.log("Session key generated:");
  console.log("  Private key:", privKey);
  console.log("  Public key:", formattedPk);

  // Compute session key GUID
  const sessionKeyGuid = signerToGuid({ starknet: { privateKey: formattedPk } });
  console.log("  Session key GUID:", sessionKeyGuid);

  // Step 2: Build policies
  const policies = {
    verified: false,
    contracts: {
      [VRF]: { methods: [{ name: "request_random", entrypoint: "request_random", authorized: true }] },
      [GAME]: { methods: [
        { name: "start_game", entrypoint: "start_game", authorized: true },
        { name: "attack", entrypoint: "attack", authorized: true },
        { name: "explore", entrypoint: "explore", authorized: true },
        { name: "flee", entrypoint: "flee", authorized: true },
        { name: "select_stat_upgrades", entrypoint: "select_stat_upgrades", authorized: true },
        { name: "buy_items", entrypoint: "buy_items", authorized: true },
        { name: "equip", entrypoint: "equip", authorized: true },
        { name: "drop", entrypoint: "drop", authorized: true },
      ]},
      [DUNGEON]: { methods: [{ name: "buy_game", entrypoint: "buy_game", authorized: true }] },
      [TICKET]: { methods: [{ name: "approve", entrypoint: "approve", authorized: true }] },
      [STRK]: { methods: [
        { name: "approve", entrypoint: "approve", authorized: true },
        { name: "transfer", entrypoint: "transfer", authorized: true },
      ]},
      [EKUBO_ROUTER]: { methods: [
        { name: "multihop_swap", entrypoint: "multihop_swap", authorized: true },
        { name: "clear_minimum", entrypoint: "clear_minimum", authorized: true },
        { name: "clear", entrypoint: "clear", authorized: true },
      ]},
    },
  };

  // Step 3: Build session URL - use a fake redirect that we won't need
  const redirectUri = "https://x.cartridge.gg/callback";
  const url = `${KEYCHAIN_URL}/session?public_key=${encodeURIComponent(formattedPk)}&redirect_uri=${encodeURIComponent(redirectUri)}&redirect_query_name=startapp&policies=${encodeURIComponent(JSON.stringify(policies))}&rpc_url=${encodeURIComponent(RPC)}`;

  console.log("\n============================================================");
  console.log("OPEN THIS URL IN YOUR BROWSER AND APPROVE THE SESSION:");
  console.log("============================================================");
  console.log(url);
  console.log("============================================================\n");

  // Step 4: Subscribe to session creation via Cartridge API
  console.log("Waiting for session approval via Cartridge API...");
  console.log("(This will detect when you approve in the browser)\n");

  try {
    const result = await subscribeCreateSession(sessionKeyGuid, CARTRIDGE_API);
    console.log("Session approved!");
    console.log("Result:", JSON.stringify(result, null, 2));

    // Save session data
    const sessionDir = "./cartridge-session";
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    // Save signer
    fs.writeFileSync(`${sessionDir}/session.json`, JSON.stringify({
      signer: { privKey, pubKey: formattedPk },
      session: result,
      chainId: CHAIN_ID,
      rpcUrl: RPC,
    }, null, 2));

    console.log("\nSession saved to ./cartridge-session/session.json");
    console.log("You can now run the bot!");
  } catch (e: any) {
    console.log("Subscription error:", e.message || e);
    console.log("\nAlternative: After approving in browser, copy the URL from the");
    console.log("browser address bar (it should contain ?startapp=...) and paste it here.");
  }
}

main().catch(console.error);
