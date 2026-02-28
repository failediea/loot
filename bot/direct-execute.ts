// Direct StarkNet transaction submission bypassing Cartridge WASM execute path
// Submits an explore transaction for game 187071 on Loot Survivor
//
// Strategy:
//  1. Get nonce via starknet.js RpcProvider
//  2. Build calldata for [VRF.request_random, GAME.explore]
//  3. Estimate fee via direct JSON-RPC (SKIP_VALIDATE), fallback to block-price bounds
//  4. Compute V3 tx hash manually
//  5. Build session signature:
//     a. Call WASM CartridgeSessionAccount.sign(txHash, calls) to get the correct
//        signature structure (including guardian sig, merkle proofs)
//     b. Replace sig[2] (policies_root) with WILDCARD_ROOT
//     c. Recompute sig[12]/sig[13] (r,s) using the registered wildcard SESSION_HASH
//  6. Submit via starknet_addInvokeTransaction

import { RpcProvider, CallData, hash, addAddressPadding, getChecksumAddress, num } from "starknet";
import { poseidonHashMany, poseidonSmall, sign as starkSign } from "@scure/starknet";

// ============================================================
// Constants
// ============================================================
const CONTROLLER       = "0x02eb8e6459a39d3ac8a2f52ab17084b259beed1f705c0cae9caae4cffe391d8e";
const SESSION_PRIV     = "0x6fb20ea6869285bdd60d58024081659cfefd6167c5a3941240fd4d72d67dbd4";
const SESSION_KEY_GUID = "0x6932f6d78dccf32a90ba255a0fd3e59d3a87caf2410f0bac9885638da08b67d";
// Registered wildcard session hash (confirmed on-chain via is_session_registered)
const SESSION_HASH     = "0x2740f7281f92da75ad1c838fd7794d8cacb1fc7cbb66efd19c0fe9f526a74f5";
const CHAIN_ID         = "0x534e5f4d41494e";
const RPC_URL          = "https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9";
const GAME             = "0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c";
const VRF              = "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f";
const WILDCARD_ROOT    = "0x77696c64636172642d706f6c696379";
const GAME_ID          = 187071;
const XP               = 17;

// Resource name encoding (ASCII bytes as big-endian felt)
const L1_GAS_NAME      = BigInt("0x" + Buffer.from("L1_GAS").toString("hex"));
const L2_GAS_NAME      = BigInt("0x" + Buffer.from("L2_GAS").toString("hex"));
const L1_DATA_GAS_NAME = BigInt("0x" + Buffer.from("L1_DATA").toString("hex"));
const RESOURCE_VALUE_OFFSET = 192n;  // 64 + 128

const INVOKE_PREFIX = BigInt("0x696e766f6b65");

// ============================================================
// Helper: decode hex string to ASCII if printable
// ============================================================
function tryDecode(hex: string): string {
  try {
    const b = Buffer.from(String(hex).replace("0x", ""), "hex").toString("ascii");
    return b.match(/^[\x20-\x7e]+$/) ? b : "";
  } catch { return ""; }
}

// ============================================================
// Encode a resource bound element for the tx hash:
//   (resource_name << 192) | (max_amount << 128) | max_price_per_unit
// ============================================================
function encodeResourceBound(name: bigint, amount: bigint, pricePerUnit: bigint): bigint {
  return (name << RESOURCE_VALUE_OFFSET) | (amount << 128n) | pricePerUnit;
}

// ============================================================
// Compute V3 invoke transaction hash
// ============================================================
interface ResourceBounds { max_amount: string; max_price_per_unit: string; }
interface TxData {
  version: string;
  sender_address: string;
  nonce: string;
  tip?: string;
  resource_bounds: { l1_gas: ResourceBounds; l2_gas: ResourceBounds; l1_data_gas?: ResourceBounds };
  paymaster_data?: string[];
  nonce_data_availability_mode?: string;
  fee_data_availability_mode?: string;
  account_deployment_data?: string[];
  calldata: string[];
}

function computeV3TxHash(tx: TxData): string {
  const rb = tx.resource_bounds;
  const l1e  = encodeResourceBound(L1_GAS_NAME,      BigInt(rb.l1_gas.max_amount),                          BigInt(rb.l1_gas.max_price_per_unit));
  const l2e  = encodeResourceBound(L2_GAS_NAME,      BigInt(rb.l2_gas.max_amount),                          BigInt(rb.l2_gas.max_price_per_unit));
  const l1de = rb.l1_data_gas
    ? encodeResourceBound(L1_DATA_GAS_NAME, BigInt(rb.l1_data_gas.max_amount), BigInt(rb.l1_data_gas.max_price_per_unit))
    : 0n;

  const feeFieldHash  = poseidonHashMany([BigInt(tx.tip ?? "0x0"), l1e, l2e, l1de]);
  const pmData        = (tx.paymaster_data ?? []).map(BigInt);
  const pmHash        = poseidonHashMany(pmData.length > 0 ? pmData : []);
  const nDA           = (tx.nonce_data_availability_mode ?? "L1") === "L1" ? 0n : 1n;
  const fDA           = (tx.fee_data_availability_mode  ?? "L1") === "L1" ? 0n : 1n;
  const adData        = (tx.account_deployment_data ?? []).map(BigInt);
  const adHash        = poseidonHashMany(adData.length > 0 ? adData : []);
  const cdData        = tx.calldata.map(BigInt);
  const cdHash        = poseidonHashMany(cdData.length > 0 ? cdData : []);

  return "0x" + poseidonHashMany([
    INVOKE_PREFIX, BigInt(tx.version), BigInt(tx.sender_address),
    feeFieldHash, pmHash, BigInt(CHAIN_ID), BigInt(tx.nonce),
    (nDA << 32n) | fDA, adHash, cdHash,
  ]).toString(16);
}

// ============================================================
// Direct JSON-RPC call helper
// ============================================================
async function rpcCall(method: string, params: unknown): Promise<unknown> {
  const resp = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await resp.json() as {
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
  };
  if (data.error) {
    const errData = data.error.data;
    const errStr = typeof errData === "string" ? errData : JSON.stringify(errData ?? "");
    const hexMatches = errStr.match(/0x[0-9a-f]+/gi) ?? [];
    const decoded = hexMatches.map((h: string) => { const d = tryDecode(h); return d ? `${h}="${d}"` : ""; }).filter(Boolean);
    throw new Error(
      `RPC error ${data.error.code}: ${data.error.message}` +
      (decoded.length ? " | " + decoded.join(", ") : "") +
      (errStr ? " | " + errStr.slice(0, 600) : "")
    );
  }
  return data.result;
}

// ============================================================
// Get current gas prices from the latest block
// ============================================================
interface GasPrices { l1GasPrice: bigint; l2GasPrice: bigint; l1DataGasPrice: bigint; }
async function getGasPrices(): Promise<GasPrices> {
  const block = await rpcCall("starknet_getBlockWithTxHashes", { block_id: "latest" }) as {
    l1_gas_price: { price_in_fri: string };
    l2_gas_price: { price_in_fri: string };
    l1_data_gas_price: { price_in_fri: string };
  };
  return {
    l1GasPrice:     BigInt(block.l1_gas_price?.price_in_fri      ?? "0x1"),
    l2GasPrice:     BigInt(block.l2_gas_price?.price_in_fri      ?? "0x1"),
    l1DataGasPrice: BigInt(block.l1_data_gas_price?.price_in_fri ?? "0x1"),
  };
}

// ============================================================
// Estimate fee via SKIP_VALIDATE, with block-price fallback
// ============================================================
async function estimateFee(
  calldata: string[],
  nonce: string,
  gasPrices: GasPrices
): Promise<{ l1_gas: ResourceBounds; l2_gas: ResourceBounds; l1_data_gas: ResourceBounds }> {
  const MULT = 2n;
  const estimateBounds = {
    l1_gas:      { max_amount: "0x0",      max_price_per_unit: "0x" + (gasPrices.l1GasPrice     * MULT).toString(16) },
    l2_gas:      { max_amount: "0x1e8480", max_price_per_unit: "0x" + (gasPrices.l2GasPrice     * MULT).toString(16) },
    l1_data_gas: { max_amount: "0x800",    max_price_per_unit: "0x" + (gasPrices.l1DataGasPrice * MULT).toString(16) },
  };
  console.log("  estimate bounds:", JSON.stringify(estimateBounds));

  try {
    const feeResult = await rpcCall("starknet_estimateFee", {
      request: [{
        type: "INVOKE", version: "0x3", sender_address: CONTROLLER, nonce, calldata,
        resource_bounds: estimateBounds, tip: "0x0", paymaster_data: [],
        nonce_data_availability_mode: "L1", fee_data_availability_mode: "L1",
        account_deployment_data: [], signature: ["0x1"],
      }],
      simulation_flags: ["SKIP_VALIDATE"],
      block_id: "latest",
    }) as Array<{ l2_gas_consumed?: string; l2_gas_price?: string; l1_gas_consumed?: string; l1_gas_price?: string; l1_data_gas_consumed?: string; l1_data_gas_price?: string; gas_consumed?: string; gas_price?: string; data_gas_consumed?: string; data_gas_price?: string; }>;

    console.log("  fee estimate raw:", JSON.stringify(feeResult[0]));
    const e = feeResult[0];
    const SAFETY = 150n; const DIV = 100n;
    const l2Amt  = BigInt(e.l2_gas_consumed  ?? "0x0");
    const l1Amt  = BigInt(e.l1_gas_consumed  ?? e.gas_consumed ?? "0x0");
    const l1dAmt = BigInt(e.l1_data_gas_consumed ?? e.data_gas_consumed ?? "0x0");
    if (l2Amt === 0n && l1Amt === 0n && l1dAmt === 0n) throw new Error("All-zero fee estimate");
    const l2P  = BigInt(e.l2_gas_price  ?? "0x" + gasPrices.l2GasPrice.toString(16));
    const l1P  = BigInt(e.l1_gas_price  ?? e.gas_price ?? "0x" + gasPrices.l1GasPrice.toString(16));
    const l1dP = BigInt(e.l1_data_gas_price ?? e.data_gas_price ?? "0x" + gasPrices.l1DataGasPrice.toString(16));
    return {
      l1_gas:      { max_amount: "0x" + ((l1Amt  * SAFETY / DIV) + 1n).toString(16), max_price_per_unit: "0x" + (l1P  * SAFETY / DIV).toString(16) },
      l2_gas:      { max_amount: "0x" + ((l2Amt  * SAFETY / DIV) + 1n).toString(16), max_price_per_unit: "0x" + (l2P  * SAFETY / DIV).toString(16) },
      l1_data_gas: { max_amount: "0x" + ((l1dAmt * SAFETY / DIV) + 1n).toString(16), max_price_per_unit: "0x" + (l1dP * SAFETY / DIV).toString(16) },
    };
  } catch (e: any) {
    console.log("  fee estimation failed:", e.message.slice(0, 200));
    console.log("  using block-price-based fallback bounds");
    // Use typical values from recent on-chain game transactions
    const SAFETY = 3n;
    return {
      l1_gas:      { max_amount: "0x0",       max_price_per_unit: "0x" + (gasPrices.l1GasPrice     * SAFETY).toString(16) },
      l2_gas:      { max_amount: "0x1312d00", max_price_per_unit: "0x" + (gasPrices.l2GasPrice     * SAFETY).toString(16) },
      l1_data_gas: { max_amount: "0xc00",     max_price_per_unit: "0x" + (gasPrices.l1DataGasPrice * SAFETY).toString(16) },
    };
  }
}

// ============================================================
// Build session signature using WASM for structure, then patch
// ============================================================
async function buildWasmSignature(
  txHash: string,
  wasmCalls: Array<{ contractAddress: string; entrypoint: string; calldata: string[] }>,
  ownerGuid: string
): Promise<string[]> {
  const { CartridgeSessionAccount } = await import("@cartridge/controller-wasm/session");

  // Build policies (must match the registered session's policy set for WASM to sign)
  const policies = [
    ...Object.entries({
      [VRF]: ["request_random"],
      [GAME]: ["attack", "explore", "flee", "start_game", "select_stat_upgrades", "buy_items", "equip", "drop"],
    })
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .flatMap(([t, ms]) => (ms as string[]).sort().map(m => ({
      target:     getChecksumAddress(t),
      method:     hash.getSelectorFromName(m),
      authorized: true,
    }))),
  ];

  const sa = (CartridgeSessionAccount as any).newAsRegistered(
    RPC_URL, SESSION_PRIV, addAddressPadding(CONTROLLER), ownerGuid, CHAIN_ID,
    { expiresAt: parseInt("0x69aaeeb6", 16), policies, guardianKeyGuid: "0x0", metadataHash: "0x0", sessionKeyGuid: SESSION_KEY_GUID }
  );

  console.log("  calling WASM sign()...");
  const wasmSig = await sa.sign(txHash, wasmCalls) as string[];
  console.log("  WASM sig length:", wasmSig.length);

  // Replace [2] (policies_root) with WILDCARD_ROOT
  const modSig = [...wasmSig.map(String)];
  modSig[2] = WILDCARD_ROOT;

  // Recompute [12]/[13] (r,s) using the registered wildcard SESSION_HASH
  // Sign: poseidonSmall([txHash, SESSION_HASH, 2])[0]
  const hadesResult = poseidonSmall([BigInt(txHash), BigInt(SESSION_HASH), 2n]);
  const sigHash = "0x" + hadesResult[0].toString(16);
  const sig = starkSign(sigHash, SESSION_PRIV);
  modSig[12] = "0x" + sig.r.toString(16);
  modSig[13] = "0x" + sig.s.toString(16);

  console.log("  sigHash (wildcard SESSION_HASH):", sigHash);
  console.log("  new r:", modSig[12]);
  console.log("  new s:", modSig[13]);

  return modSig;
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log("=== Direct StarkNet Execute: Explore Game", GAME_ID, "(bypassing Cartridge WASM execute) ===\n");

  // ---- Step 0: Get owner GUID ----
  const { signerToGuid } = await import("@cartridge/controller-wasm/session");
  const ownerGuid = signerToGuid({ eip191: { address: "0x5efc192b995c0bf39bf8ba332e230dfa7abd3283" } });
  console.log("Owner GUID:", ownerGuid);

  // ---- Step 1: Get nonce ----
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const nonce = await provider.getNonceForAddress(CONTROLLER);
  console.log("Nonce:", nonce, "=", parseInt(nonce, 16));

  // ---- Step 2: Build calldata ----
  // Salt for explore: poseidonHashOnElements([xp, gameId])
  const exploreSalt = hash.computePoseidonHashOnElements([BigInt(XP), BigInt(GAME_ID)]);
  console.log("\nExplore salt:", exploreSalt);

  const vrfCalldata     = CallData.compile({ caller: GAME, source: { type: 1, salt: exploreSalt } });
  const exploreCalldata = CallData.compile([GAME_ID.toString(), "0"]);
  console.log("VRF calldata:    ", vrfCalldata);
  console.log("Explore calldata:", exploreCalldata);

  // Multicall format: [num_calls, to, selector, calldata_len, ...data, ...]
  const vrfTo           = addAddressPadding(VRF);
  const gameAddr        = addAddressPadding(GAME);
  const vrfSelector     = hash.getSelectorFromName("request_random");
  const exploreSelector = hash.getSelectorFromName("explore");
  const numCalls        = 2;

  const fullCalldata = [
    num.toHex(numCalls),
    vrfTo,
    vrfSelector,
    num.toHex(vrfCalldata.length),
    ...vrfCalldata.map((x: string) => num.toHex(BigInt(x))),
    gameAddr,
    exploreSelector,
    num.toHex(exploreCalldata.length),
    ...exploreCalldata.map((x: string) => num.toHex(BigInt(x))),
  ];

  console.log("\nFull calldata (" + fullCalldata.length + " elements):");
  fullCalldata.forEach((v, i) => {
    const d = tryDecode(v);
    console.log(`  [${i}] ${v}${d ? ` ("${d}")` : ""}`);
  });

  // ---- Step 3: Get gas prices ----
  console.log("\n---- Gas Prices ----");
  const gasPrices = await getGasPrices();
  console.log("l1_gas_price:",      "0x" + gasPrices.l1GasPrice.toString(16));
  console.log("l2_gas_price:",      "0x" + gasPrices.l2GasPrice.toString(16));
  console.log("l1_data_gas_price:", "0x" + gasPrices.l1DataGasPrice.toString(16));

  // ---- Step 4: Estimate fee ----
  console.log("\n---- Estimating Fee ----");
  const resourceBounds = await estimateFee(fullCalldata, nonce, gasPrices);
  console.log("Resource bounds:", JSON.stringify(resourceBounds, null, 2));

  // ---- Step 5: Compute transaction hash ----
  console.log("\n---- Computing TX Hash ----");
  const txData: TxData = {
    version: "0x3",
    sender_address: CONTROLLER,
    nonce,
    calldata: fullCalldata,
    resource_bounds: resourceBounds,
    tip: "0x0",
    paymaster_data: [],
    nonce_data_availability_mode: "L1",
    fee_data_availability_mode:   "L1",
    account_deployment_data: [],
  };
  const txHash = computeV3TxHash(txData);
  console.log("TX hash:", txHash);

  // ---- Step 6: Build session signature ----
  console.log("\n---- Building Session Signature ----");
  // WASM call format (uses contract name rather than full calldata)
  const wasmCalls = [
    { contractAddress: addAddressPadding(VRF),  entrypoint: "request_random", calldata: CallData.toHex(vrfCalldata) },
    { contractAddress: addAddressPadding(GAME), entrypoint: "explore",        calldata: CallData.toHex(exploreCalldata) },
  ];

  const signature = await buildWasmSignature(txHash, wasmCalls, ownerGuid);

  console.log("\nFinal signature (" + signature.length + " elements):");
  signature.forEach((v, i) => {
    const d = tryDecode(v);
    console.log(`  [${i}] ${v}${d ? ` ("${d}")` : ""}`);
  });

  // ---- Step 7: Submit transaction ----
  console.log("\n---- Submitting Transaction ----");
  const invokeTx = {
    type: "INVOKE",
    version: "0x3",
    sender_address: CONTROLLER,
    nonce,
    calldata: fullCalldata,
    resource_bounds: resourceBounds,
    tip: "0x0",
    paymaster_data: [],
    nonce_data_availability_mode: "L1",
    fee_data_availability_mode:   "L1",
    account_deployment_data: [],
    signature,
  };

  console.log("\nTransaction JSON:");
  console.log(JSON.stringify(invokeTx, null, 2));

  try {
    const result = await rpcCall("starknet_addInvokeTransaction", {
      invoke_transaction: invokeTx,
    }) as { transaction_hash: string };
    console.log("\nSUCCESS! Transaction hash:", result.transaction_hash);
    console.log("Explorer: https://voyager.online/tx/" + result.transaction_hash);
  } catch (e: any) {
    console.error("\nTransaction submission failed:", e.message);
    process.exit(1);
  }
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
