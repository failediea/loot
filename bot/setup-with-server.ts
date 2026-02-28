// Setup with local callback server - captures session data automatically
import { stark, ec, encode, getChecksumAddress, hash } from "starknet";
import * as fs from "fs";
import * as http from "http";

const GAME = "0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c";
const VRF = "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f";
const DUNGEON = "0x00a67ef20b61a9846e1c82b411175e6ab167ea9f8632bd6c2091823c3629ec42";
const TICKET = "0x0452810188C4Cb3AEbD63711a3b445755BC0D6C4f27B923fDd99B1A118858136";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const SESSION_DIR = "./cartridge-session";

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

function toWasmPolicies() {
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

  const privKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privKey);
  const formattedPk = encode.addHexPrefix(publicKey);
  const sessionKeyGuid = signerToGuid({ starknet: { privateKey: formattedPk } });

  // Start callback server on port 8765
  const PORT = 8765;

  const sessionPromise = new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Handle ALL requests - log everything
      console.log(`\n[SERVER] ${req.method} ${req.url}`);

      const url = new URL(req.url || "/", `http://localhost:${PORT}`);
      const startapp = url.searchParams.get("startapp");

      if (startapp) {
        console.log("[SERVER] Got session data!");
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Access-Control-Allow-Origin": "*",
        });
        res.end("<html><body><h1>Session approved! You can close this tab.</h1></body></html>");
        server.close();
        resolve(startapp);
        return;
      }

      // For any other request, return OK
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Access-Control-Allow-Origin": "*",
      });
      res.end("<html><body><h1>Waiting for session approval...</h1><p>Approve the session in the Cartridge tab.</p></body></html>");
    });

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Callback server listening on port ${PORT}`);
    });

    // 10 minute timeout
    setTimeout(() => { reject(new Error("Timeout")); server.close(); }, 600000);
  });

  const redirectUri = `http://localhost:${PORT}/callback`;
  const url = `https://x.cartridge.gg/session?public_key=${encodeURIComponent(formattedPk)}&redirect_uri=${encodeURIComponent(redirectUri)}&redirect_query_name=startapp&policies=${encodeURIComponent(JSON.stringify(policies))}&rpc_url=${encodeURIComponent("https://api.cartridge.gg/x/starknet/mainnet")}`;

  console.log("\n=== OPEN THIS URL IN YOUR BROWSER ===");
  console.log(url);
  console.log("=====================================\n");
  console.log("Waiting for approval (10 min timeout)...\n");

  const sessionData = await sessionPromise;

  // Process
  const sessionRegistration = JSON.parse(atob(sessionData));
  sessionRegistration.address = sessionRegistration.address.toLowerCase();
  sessionRegistration.ownerGuid = sessionRegistration.ownerGuid.toLowerCase();
  sessionRegistration.guardianKeyGuid = "0x0";
  sessionRegistration.metadataHash = "0x0";
  sessionRegistration.sessionKeyGuid = signerToGuid({ starknet: { privateKey: formattedPk } });

  console.log("\nSession approved!");
  console.log("  Address:", sessionRegistration.address);
  console.log("  Owner:", sessionRegistration.ownerGuid);
  console.log("  Username:", sessionRegistration.username);

  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  const wasmPolicies = toWasmPolicies();
  fs.writeFileSync(`${SESSION_DIR}/session.json`, JSON.stringify({
    signer: { privKey, pubKey: publicKey },
    session: sessionRegistration,
    policies: wasmPolicies,
  }, null, 2));

  console.log(`\nSaved to ${SESSION_DIR}/session.json`);
  console.log("Ready to run the bot!");
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
