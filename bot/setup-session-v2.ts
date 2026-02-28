// Generate session key and approval URL, save key pair
// After user approves, run process-callback.ts with the callback data

import { stark, ec, encode } from "starknet";
import * as fs from "fs";

const GAME = "0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c";
const VRF = "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f";
const DUNGEON = "0x00a67ef20b61a9846e1c82b411175e6ab167ea9f8632bd6c2091823c3629ec42";
const TICKET = "0x0452810188C4Cb3AEbD63711a3b445755BC0D6C4f27B923fDd99B1A118858136";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const KEYCHAIN_URL = "https://x.cartridge.gg";
const RPC_URL = "https://api.cartridge.gg/x/starknet/mainnet";
const SESSION_DIR = "./cartridge-session";

async function main() {
  const { signerToGuid } = await import("@cartridge/controller-wasm");

  // Generate new key pair
  const privKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privKey);
  const formattedPk = encode.addHexPrefix(publicKey);

  const sessionKeyGuid = signerToGuid({ starknet: { privateKey: formattedPk } });

  console.log("Session key generated:");
  console.log("  Private key:", privKey);
  console.log("  Public key:", formattedPk);
  console.log("  GUID:", sessionKeyGuid);

  // Save key pair
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(`${SESSION_DIR}/pending-key.json`, JSON.stringify({ privKey, pubKey: publicKey, guid: sessionKeyGuid }));

  // Policies
  const policies = {
    verified: false,
    contracts: {
      [VRF]: { methods: [{ name: "request_random", entrypoint: "request_random", authorized: true }] },
      [GAME]: { methods: [
        { name: "attack", entrypoint: "attack", authorized: true },
        { name: "explore", entrypoint: "explore", authorized: true },
        { name: "flee", entrypoint: "flee", authorized: true },
        { name: "start_game", entrypoint: "start_game", authorized: true },
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
    },
  };

  // Use a simple redirect that shows the data in the URL
  // The user can copy the URL from their browser
  const redirectUri = "https://x.cartridge.gg/callback";
  const url = `${KEYCHAIN_URL}/session?public_key=${encodeURIComponent(formattedPk)}&redirect_uri=${encodeURIComponent(redirectUri)}&redirect_query_name=startapp&policies=${encodeURIComponent(JSON.stringify(policies))}&rpc_url=${encodeURIComponent(RPC_URL)}`;

  console.log("\n========================================");
  console.log("OPEN THIS URL IN YOUR BROWSER:");
  console.log("========================================");
  console.log(url);
  console.log("========================================\n");
  console.log("After approving, the browser will redirect to a URL like:");
  console.log("  https://x.cartridge.gg/callback?startapp=BASE64DATA");
  console.log("\nCopy the ENTIRE URL from your browser's address bar and");
  console.log("paste it when running: node --import tsx/esm --experimental-wasm-modules process-callback.ts");
}

main().catch(console.error);
