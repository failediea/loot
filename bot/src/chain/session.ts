/**
 * Cartridge Controller session auth with wildcard policy fix.
 *
 * The WASM CartridgeSessionAccount computes the wrong allowed_policies_root.
 * We intercept the cartridge_addExecuteOutsideTransaction fetch call and:
 * 1. Replace sig[2] with WILDCARD_ROOT
 * 2. Recompute OutsideExecution SNIP-12 hash (domain: version=2, revision=2)
 * 3. Re-sign sig[12]/sig[13] with poseidonSmall([oeHash, SESSION_HASH, 2n])[0]
 * 4. Replace proofs with empty [0x0]
 */
import { addAddressPadding, hash } from "starknet";
import { poseidonHashMany, poseidonSmall, sign as starkSign } from "@scure/starknet";
import { log } from "../utils/logger.js";

// Session credentials (exported for use by direct invoke)
export const CONTROLLER = "0x02eb8e6459a39d3ac8a2f52ab17084b259beed1f705c0cae9caae4cffe391d8e";
export const SESSION_PRIV = "0x6fb20ea6869285bdd60d58024081659cfefd6167c5a3941240fd4d72d67dbd4";
const SESSION_HASH = "0x2740f7281f92da75ad1c838fd7794d8cacb1fc7cbb66efd19c0fe9f526a74f5";
export const SESSION_KEY_GUID = "0x6932f6d78dccf32a90ba255a0fd3e59d3a87caf2410f0bac9885638da08b67d";
export const WILDCARD_ROOT = "0x77696c64636172642d706f6c696379";
export const OWNER_EIP191 = "0x5efc192b995c0bf39bf8ba332e230dfa7abd3283";
export const SESSION_EXPIRES = 0x69aaeeb6;

// SNIP-12 constants for OutsideExecution
const DOMAIN_TYPE_HASH = 0x1ff2f602e42168014d405a94f75e8a93d640751d71d16311266e140d8b0a210n;
const CALL_TYPE_HASH = 0x3635c7f2a7ba93844c0d064e18e487f35ab90f7c39d00f186a781fc3f0c2ca9n;
const OE_TYPE_HASH = 0x13c8403ec4241d635a9bb6243dc259fe85c3483374f6c92b23510b4594a7d38n;
const OE_DOMAIN_NAME = BigInt("0x" + Buffer.from("Account.execute_from_outside").toString("hex"));
const STARKNET_MESSAGE = BigInt("0x" + Buffer.from("StarkNet Message").toString("hex"));
const OE_CHAIN_ID = 0x534e5f4d41494en;

// State captured from intercepted fetch responses
let lastTxHash: string | null = null;
let lastTxError: string | null = null;
const origFetch = globalThis.fetch;

function computeOutsideExecHash(oe: any): string {
  const callHashes = oe.calls.map((c: any) => {
    const cdHash = poseidonHashMany(c.calldata.length > 0 ? c.calldata.map(BigInt) : []);
    return poseidonHashMany([CALL_TYPE_HASH, BigInt(c.to), BigInt(c.selector), cdHash]);
  });
  const callsHash = poseidonHashMany(callHashes.length > 0 ? callHashes : []);
  const [nonceChannel, nonceMask] = oe.nonce;
  const structHash = poseidonHashMany([
    OE_TYPE_HASH, BigInt(oe.caller), BigInt(nonceChannel), BigInt(nonceMask),
    BigInt(oe.execute_after), BigInt(oe.execute_before), callsHash,
  ]);
  const domainHash = poseidonHashMany([DOMAIN_TYPE_HASH, OE_DOMAIN_NAME, 2n, OE_CHAIN_ID, 2n]);
  return "0x" + poseidonHashMany([STARKNET_MESSAGE, domainHash, BigInt(CONTROLLER), structHash]).toString(16);
}

/**
 * Install the fetch interceptor and WASM crash handler.
 * Must be called once at startup before any session operations.
 */
export function installSessionInterceptor(): void {
  // Handle WASM crashes: after successful tx submission, WASM throws "url parse"
  process.on('uncaughtException', (err) => {
    if (err.message === 'url parse') return;
    console.error('Uncaught exception:', err);
    process.exit(1);
  });

  globalThis.fetch = async function (input: any, init?: any) {
    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
    let bodyStr = '';
    if (init?.body) bodyStr = typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as any);
    else if (input instanceof Request) { try { bodyStr = await input.clone().text(); } catch {} }

    let parsed: any = null;
    if (bodyStr) try { parsed = JSON.parse(bodyStr); } catch {}

    if (parsed?.method === 'cartridge_addExecuteOutsideTransaction') {
      const sig = parsed.params.signature;
      const oe = parsed.params.outside_execution;

      if (sig && sig[0] === "0x73657373696f6e2d746f6b656e" && sig[2] !== WILDCARD_ROOT) {
        // 1. Replace policies root with wildcard
        sig[2] = WILDCARD_ROOT;

        // 2. Compute OE message hash
        const oeHash = computeOutsideExecHash(oe);

        // 3. Compute signing hash and re-sign
        const hadesResult = poseidonSmall([BigInt(oeHash), BigInt(SESSION_HASH), 2n]);
        const signingHash = "0x" + hadesResult[0].toString(16);
        const newSig = starkSign(signingHash, SESSION_PRIV);
        sig[12] = "0x" + newSig.r.toString(16);
        sig[13] = "0x" + newSig.s.toString(16);

        // 4. Fix proofs: replace with empty (wildcard)
        const authLen = parseInt(sig[7], 16);
        const proofsStart = 8 + authLen + 4 + 4;
        sig.length = proofsStart;
        sig.push("0x0");

        // Update request body
        const newBody = JSON.stringify(parsed);
        if (init) {
          init.body = newBody;
        } else {
          input = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: newBody });
          init = undefined;
        }
      }
    }

    const resp = await origFetch.call(globalThis, input, init || {});

    // Capture response from executeFromOutside
    if (parsed?.method === 'cartridge_addExecuteOutsideTransaction') {
      const clone = resp.clone();
      try {
        const text = await clone.text();
        const rp = JSON.parse(text);
        if (rp.error) {
          const errStr = typeof rp.error.data === 'string' ? rp.error.data :
                         rp.error.data?.execution_error || JSON.stringify(rp.error.data || '');
          lastTxError = `${rp.error.code}: ${rp.error.message} ${errStr}`.slice(0, 500);
          log.error(`TX Error: ${lastTxError}`);
        } else if (rp.result) {
          if (rp.result?.transaction_hash) {
            lastTxHash = rp.result.transaction_hash;
            log.tx(`TX hash captured: ${lastTxHash}`);
          }
        }
      } catch {}
      return new Response(await resp.clone().text(), { status: resp.status, headers: resp.headers });
    }

    return resp;
  } as typeof fetch;

  log.success("Session interceptor installed");
}

// WASM module - loaded once
let wasmModule: any = null;

async function loadWasm(): Promise<any> {
  if (!wasmModule) {
    wasmModule = await import("@cartridge/controller-wasm/session");
  }
  return wasmModule;
}

// Cartridge RPC endpoint - must be used for session tx submission
// (cartridge_addExecuteOutsideTransaction is a Cartridge-specific method)
const CARTRIDGE_RPC = "https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9";

/**
 * Create a fresh CartridgeSessionAccount.
 * Must create a new one for each executeFromOutside call because
 * the WASM instance crashes after successful tx submission.
 *
 * Always uses the Cartridge RPC for tx submission regardless of the
 * configured state-read RPC (Lava, etc).
 */
export async function createSessionAccount(_rpcUrl: string, chainId: string): Promise<any> {
  const { CartridgeSessionAccount, signerToGuid } = await loadWasm();
  const ownerGuid = signerToGuid({ eip191: { address: OWNER_EIP191 } });

  // Policies: all game methods + VRF. The specific policies don't matter
  // because the interceptor replaces with wildcard root, but the WASM
  // needs them to compute the initial signature.
  const GAME = "0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c";
  const VRF = "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f";
  const DUNGEON = "0x00a67ef20b61a9846e1c82b411175e6ab167ea9f8632bd6c2091823c3629ec42";
  const TICKET = "0x0452810188C4Cb3AEbD63711a3b445755BC0D6C4f27B923fDd99B1A118858136";
  const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
  const EKUBO = "0x0199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4fb8737e";

  const gameMethods = [
    "attack", "explore", "flee", "start_game",
    "select_stat_upgrades", "buy_items", "equip", "drop",
  ];
  const ekuboMethods = [
    "multihop_swap", "multi_multihop_swap", "clear_minimum", "clear",
  ];
  const policies = [
    { target: addAddressPadding(VRF), method: hash.getSelectorFromName("request_random"), authorized: true },
    ...gameMethods.map(m => ({
      target: addAddressPadding(GAME), method: hash.getSelectorFromName(m), authorized: true,
    })),
    // Ticket approval + dungeon buyGame + token transfers (for swaps)
    { target: addAddressPadding(TICKET), method: hash.getSelectorFromName("approve"), authorized: true },
    { target: addAddressPadding(DUNGEON), method: hash.getSelectorFromName("buy_game"), authorized: true },
    { target: addAddressPadding(STRK), method: hash.getSelectorFromName("transfer"), authorized: true },
    // Ekubo DEX router for STRK → ticket swaps
    ...ekuboMethods.map(m => ({
      target: addAddressPadding(EKUBO), method: hash.getSelectorFromName(m), authorized: true,
    })),
  ];

  return CartridgeSessionAccount.newAsRegistered(
    CARTRIDGE_RPC, SESSION_PRIV, addAddressPadding(CONTROLLER), ownerGuid, chainId,
    {
      expiresAt: SESSION_EXPIRES,
      policies,
      guardianKeyGuid: "0x0",
      metadataHash: "0x0",
      sessionKeyGuid: SESSION_KEY_GUID,
    }
  );
}

export function getLastTxHash(): string | null { return lastTxHash; }
export function getLastTxError(): string | null { return lastTxError; }
export function resetTxState(): void { lastTxHash = null; lastTxError = null; }
export function getOrigFetch(): typeof fetch { return origFetch; }
export function getControllerAddress(): string { return CONTROLLER; }
