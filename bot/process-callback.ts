// Process the callback URL from session approval
// Usage: node --import tsx/esm --experimental-wasm-modules process-callback.ts "CALLBACK_URL_OR_BASE64"

import { encode, getChecksumAddress, hash } from "starknet";
import * as fs from "fs";

const SESSION_DIR = "./cartridge-session";

const GAME = "0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c";
const VRF = "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f";
const DUNGEON = "0x00a67ef20b61a9846e1c82b411175e6ab167ea9f8632bd6c2091823c3629ec42";
const TICKET = "0x0452810188C4Cb3AEbD63711a3b445755BC0D6C4f27B923fDd99B1A118858136";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

// Same policies as setup (must match!)
function toWasmPolicies() {
  const policies: any = {
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

  return [
    ...Object.entries(policies.contracts)
      .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .flatMap(([target, contract]: [string, any]) =>
        contract.methods.slice().sort((a: any, b: any) => a.entrypoint.localeCompare(b.entrypoint))
          .map((m: any) => ({
            target: getChecksumAddress(target),
            method: hash.getSelectorFromName(m.entrypoint),
            authorized: !!m.authorized,
          }))
      ),
  ];
}

async function main() {
  const { signerToGuid } = await import("@cartridge/controller-wasm");

  // Get the callback data from command line or stdin
  let input = process.argv[2];
  if (!input) {
    console.log("Paste the callback URL or base64 data:");
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    input = await new Promise<string>((resolve) => {
      rl.on("line", (line: string) => { resolve(line.trim()); rl.close(); });
    });
  }

  // Extract base64 data
  let sessionData: string;
  if (input.includes("startapp=")) {
    const match = input.match(/startapp=([^&\s]+)/);
    if (!match) throw new Error("Could not find startapp parameter in URL");
    sessionData = match[1];
  } else {
    sessionData = input;
  }

  // Decode session
  const sessionRegistration = JSON.parse(atob(sessionData));
  console.log("Session data decoded:");
  console.log("  Address:", sessionRegistration.address);
  console.log("  Owner GUID:", sessionRegistration.ownerGuid);
  console.log("  Expires at:", sessionRegistration.expiresAt);
  console.log("  Username:", sessionRegistration.username);

  // Load key pair
  const keyFile = `${SESSION_DIR}/pending-key.json`;
  if (!fs.existsSync(keyFile)) {
    throw new Error(`Key file not found at ${keyFile}. Run setup-session-v2.ts first.`);
  }
  const keyData = JSON.parse(fs.readFileSync(keyFile, "utf-8"));
  console.log("  Session key GUID:", keyData.guid);

  // Complete session registration
  const formattedPk = encode.addHexPrefix(keyData.pubKey);
  sessionRegistration.address = sessionRegistration.address.toLowerCase();
  sessionRegistration.ownerGuid = sessionRegistration.ownerGuid.toLowerCase();
  sessionRegistration.guardianKeyGuid = "0x0";
  sessionRegistration.metadataHash = "0x0";
  sessionRegistration.sessionKeyGuid = signerToGuid({ starknet: { privateKey: formattedPk } });

  // Save in SessionProvider format
  const fileData = {
    signer: { privKey: keyData.privKey, pubKey: keyData.pubKey },
    session: sessionRegistration,
  };
  fs.writeFileSync(`${SESSION_DIR}/session.json`, JSON.stringify(fileData, null, 2));

  // Also save the WASM policies for the bot
  const wasmPolicies = toWasmPolicies();
  fs.writeFileSync(`${SESSION_DIR}/policies.json`, JSON.stringify(wasmPolicies, null, 2));

  console.log(`\nSession saved to ${SESSION_DIR}/session.json`);
  console.log(`Policies saved to ${SESSION_DIR}/policies.json`);
  console.log("\nThe bot can now use this session. Run: pnpm start");

  // Quick test
  console.log("\nTesting session...");
  const { CartridgeSessionAccount } = await import("@cartridge/controller-wasm/session");
  const { addAddressPadding, RpcProvider, num } = await import("starknet");

  const RPC_URL = "https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9";
  const CHAIN_ID = "0x534e5f4d41494e";

  const sessionAccount = CartridgeSessionAccount.newAsRegistered(
    RPC_URL,
    keyData.privKey,
    addAddressPadding(sessionRegistration.address),
    sessionRegistration.ownerGuid,
    CHAIN_ID,
    {
      expiresAt: parseInt(sessionRegistration.expiresAt),
      policies: wasmPolicies,
      guardianKeyGuid: sessionRegistration.guardianKeyGuid,
      metadataHash: sessionRegistration.metadataHash,
      sessionKeyGuid: sessionRegistration.sessionKeyGuid,
    }
  );
  console.log("Session account created successfully!");

  // Test a simple read to verify the provider works
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const gameId = 187071;
  const response = await provider.callContract({
    contractAddress: GAME, entrypoint: "get_game_state", calldata: [num.toHex(gameId)],
  });
  const hp = parseInt(response[0], 16);
  console.log(`Game ${gameId} HP: ${hp} (account: ${sessionRegistration.address})`);
  console.log("\nSession is ready!");
}

main().catch((e) => {
  console.error("Error:", e.message || e);
  process.exit(1);
});
