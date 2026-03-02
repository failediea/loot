import { addAddressPadding, hash, transaction, cairo, type Call } from "starknet";
import { poseidonHashMany, poseidonSmall, sign as starkSign } from "@scure/starknet";
import {
  createSessionAccount,
  computeWildcardSessionHash,
  getLastTxHash,
  getLastTxError,
  resetTxState,
  getOrigFetch,
  type SessionCredentials,
  DEFAULT_CREDENTIALS,
  CONTROLLER,
  SESSION_PRIV,
  SESSION_KEY_GUID,
  SESSION_EXPIRES,
  WILDCARD_ROOT,
} from "./session.js";
import { log } from "../utils/logger.js";
import { dashboard } from "../dashboard/events.js";

const TX_TIMEOUT_MS = 10000;
const RECEIPT_WAIT_MS = 500;
const RECEIPT_POLL_INTERVAL_MS = 1000;
const MAX_RETRIES = 3;

/** Check if an error message indicates a contract simulation/revert failure (not retryable). */
function isContractRevert(msg: string): boolean {
  const revertPatterns = [
    "execution error", "Transaction execution error",
    "is not playable", "Game over", "reverted",
    "Failure reason", "Error in the called contract",
  ];
  return revertPatterns.some(p => msg.includes(p));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a transaction via the Cartridge session account's executeFromOutside.
 *
 * Flow:
 * 1. Create fresh session account (WASM crashes after each use)
 * 2. Call executeFromOutside(calls) with timeout
 * 3. Capture tx hash from interceptor response
 * 4. Wait for receipt via RPC
 * 5. Return receipt
 */
export async function executeTransaction(
  _account: any, // kept for API compatibility, ignored
  calls: any[],
  description: string,
  rpcUrl?: string,
  chainId?: string,
  creds?: SessionCredentials
): Promise<any> {
  const url = rpcUrl || "https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9";
  const chain = chainId || "0x534e5f4d41494e";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log.tx(`Executing: ${description} (attempt ${attempt}/${MAX_RETRIES})`);
      dashboard.emitTxStatus("submitting", description, undefined, undefined, attempt);
      resetTxState();

      // Create fresh session account (WASM instance dies after each use)
      const sa = await createSessionAccount(url, chain, creds);

      // Normalize calls: ensure contractAddress is padded
      const normalizedCalls = calls.map((c: any) => ({
        ...c,
        contractAddress: addAddressPadding(c.contractAddress),
      }));

      // Fire WASM call — triggers fetch interceptor, but promise will hang (WASM crashes)
      let wasmResolved = false;
      sa.executeFromOutside(normalizedCalls)
        .then((result: any) => {
          wasmResolved = true;
          // Future-proof: if Cartridge fixes WASM, capture hash from result too
          if (!getLastTxHash()) {
            const h = typeof result === 'string' ? result : result?.transaction_hash;
            if (h) log.tx(`TX hash from WASM resolve: ${h}`);
          }
        })
        .catch(() => {}); // Swallow — crash is uncaughtException, not rejection

      // Poll for TX result from interceptor — hash appears in ~1-3s
      let txHash: string | null = null;
      let txError: string | null = null;
      const deadline = Date.now() + TX_TIMEOUT_MS;
      while (Date.now() < deadline) {
        txHash = getLastTxHash();
        txError = getLastTxError();
        if (txHash || txError || wasmResolved) break;
        await delay(100);
      }
      if (!txHash) txHash = getLastTxHash();
      if (!txError) txError = getLastTxError();

      if (txError && !txHash) {
        log.error(`TX Error: ${txError}`);
        if (isContractRevert(txError)) {
          throw new Error(`Transaction reverted: ${txError}`);
        }
        if (attempt < MAX_RETRIES) {
          await delay(2000 * attempt);
          continue;
        }
        throw new Error(`Transaction failed: ${txError}`);
      }

      if (!txHash) {
        log.warn(`Timeout - no tx hash captured`);
        if (attempt < MAX_RETRIES) {
          await delay(2000 * attempt);
          continue;
        }
        throw new Error("Failed to get transaction hash");
      }

      log.tx(`TX submitted: ${txHash}`);
      dashboard.emitTxStatus("submitted", description, txHash);

      // Wait for receipt
      const receipt = await waitForReceipt(url, txHash);

      if (receipt?.execution_status === "REVERTED") {
        log.error(`TX REVERTED: ${description}`);
        if (receipt.revert_reason) {
          log.error(`Reason: ${receipt.revert_reason}`);
        }
        dashboard.emitTxStatus("reverted", description, txHash, receipt.revert_reason);
        throw new Error(`Transaction reverted: ${receipt.revert_reason || "unknown"}`);
      }

      log.success(`TX confirmed: ${description}`);
      dashboard.emitTxStatus("confirmed", description, txHash);
      return receipt || { transaction_hash: txHash };
    } catch (error: any) {
      const msg = error?.message || String(error);
      log.error(`TX failed (attempt ${attempt}): ${msg.slice(0, 200)}`);
      dashboard.emitTxStatus("error", description, undefined, msg.slice(0, 200), attempt);

      if (msg.includes("reverted")) {
        throw error; // Don't retry reverts
      }

      if (attempt < MAX_RETRIES) {
        log.info(`Retrying in ${2000 * attempt}ms...`);
        await delay(2000 * attempt);
      } else {
        throw error;
      }
    }
  }
  throw new Error("Unreachable");
}

/**
 * Wait for transaction receipt via direct RPC call.
 * Uses the original (non-intercepted) fetch to avoid interference.
 */
async function waitForReceipt(rpcUrl: string, txHash: string): Promise<any> {
  const origFetch = getOrigFetch();

  // Brief wait before first poll — TX needs a moment to propagate
  await delay(RECEIPT_WAIT_MS);

  for (let i = 0; i < 20; i++) {
    try {
      const resp = await origFetch.call(globalThis, rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'starknet_getTransactionReceipt',
          params: { transaction_hash: txHash },
        }),
      });
      const data = await resp.json() as any;

      if (data.result) {
        if (data.result.execution_status === 'SUCCEEDED' ||
            data.result.execution_status === 'REVERTED') {
          return data.result;
        }
        // Still pending
        log.info(`TX pending (attempt ${i + 1}/20)...`);
      } else if (data.error) {
        // TX not found yet, keep waiting
        log.info(`TX not found yet (attempt ${i + 1}/20)...`);
      }
    } catch (e: any) {
      log.warn(`Receipt fetch error: ${e.message?.slice(0, 100)}`);
    }

    await delay(RECEIPT_POLL_INTERVAL_MS);
  }

  log.warn(`Could not get receipt for ${txHash} after 20 attempts`);
  return null;
}

// ---------------------------------------------------------------------------
// Direct Invoke (pay gas from controller's STRK balance)
// ---------------------------------------------------------------------------

const SIGN_TIMEOUT_MS = 10000;
const DIRECT_INVOKE_MAX_RETRIES = 3;

/**
 * Execute a transaction as an Invoke V3 paying gas from the controller's STRK balance.
 *
 * Unlike executeTransaction (which uses executeFromOutside via the Cartridge paymaster),
 * this submits a standard invoke transaction directly to the network.
 *
 * Flow:
 * 1. Create fresh CartridgeSessionAccount WASM instance
 * 2. Get nonce from RPC
 * 3. Get gas prices from latest block
 * 4. Compute invoke V3 tx hash
 * 5. Call sa.sign(txHash, jsCalls) to get session signature
 * 6. Apply wildcard fix (replace sig[2], recompute signing hash, re-sign sig[12]/sig[13], fix proofs)
 * 7. Submit via starknet_addInvokeTransaction
 * 8. Wait for receipt
 */
export async function executeDirectInvoke(
  calls: any[],
  description: string,
  rpcUrl?: string,
  chainId?: string,
  creds?: SessionCredentials
): Promise<any> {
  const url = rpcUrl || "https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9";
  const chain = chainId || "0x534e5f4d41494e";
  const origFetch = getOrigFetch();

  for (let attempt = 1; attempt <= DIRECT_INVOKE_MAX_RETRIES; attempt++) {
    try {
      log.tx(`Direct invoke: ${description} (attempt ${attempt}/${DIRECT_INVOKE_MAX_RETRIES})`);
      dashboard.emitTxStatus("submitting", description, undefined, undefined, attempt);

      const cr = creds || DEFAULT_CREDENTIALS;

      // 1. Create fresh session account
      const sa = await createSessionAccount(url, chain, creds);

      // Normalize calls
      const normalizedCalls: Call[] = calls.map((c: any) => ({
        contractAddress: addAddressPadding(c.contractAddress),
        entrypoint: c.entrypoint,
        calldata: c.calldata || [],
      }));

      // 2. Get nonce from RPC
      const nonceResp = await origFetch.call(globalThis, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'starknet_getNonce',
          params: { block_id: 'latest', contract_address: cr.controller },
        }),
      });
      const nonceData = await nonceResp.json() as any;
      if (nonceData.error) {
        throw new Error(`Failed to get nonce: ${JSON.stringify(nonceData.error)}`);
      }
      const nonce = nonceData.result;
      log.info(`Nonce: ${nonce}`);

      // 3. Get gas prices from latest block
      const blockResp = await origFetch.call(globalThis, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'starknet_getBlockWithTxHashes',
          params: { block_id: 'latest' },
        }),
      });
      const blockData = await blockResp.json() as any;
      if (blockData.error) {
        throw new Error(`Failed to get block: ${JSON.stringify(blockData.error)}`);
      }
      const block = blockData.result;

      const l1Price = BigInt(block.l1_gas_price?.price_in_fri || '0x2d79883d2000') * 2n;
      const l1DataPrice = BigInt(block.l1_data_gas_price?.price_in_fri || '0x2d79883d2000') * 2n;
      const l2Price = BigInt(block.l2_gas_price?.price_in_fri || '0x174876e800') * 2n;

      const resourceBounds = {
        l1_gas: { max_amount: 0x4e20n, max_price_per_unit: l1Price },
        l2_gas: { max_amount: 0x1312d00n, max_price_per_unit: l2Price },
        l1_data_gas: { max_amount: 0x800n, max_price_per_unit: l1DataPrice },
      };

      // 4. Compute invoke V3 tx hash
      const compiledCalldata = transaction.getExecuteCalldata(normalizedCalls, cairo.felt('1') as any);

      const txHashForSign = hash.calculateInvokeTransactionHash({
        senderAddress: cr.controller,
        version: '0x3',
        compiledCalldata,
        chainId: chain as any,
        nonce,
        accountDeploymentData: [],
        nonceDataAvailabilityMode: 0,
        feeDataAvailabilityMode: 0,
        resourceBounds,
        tip: 0n,
        paymasterData: [],
      });
      log.info(`TX hash for signing: ${txHashForSign}`);

      // 5. Sign with WASM session account
      const jsCalls = normalizedCalls.map(c => ({
        contractAddress: c.contractAddress,
        entrypoint: c.entrypoint,
        calldata: (c.calldata as string[]) || [],
      }));

      const sigResult = await Promise.race([
        sa.sign(txHashForSign, jsCalls),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('sign timeout')), SIGN_TIMEOUT_MS)),
      ]) as string[];
      const signature = sigResult.map(String);
      log.info(`WASM signature obtained, length: ${signature.length}`);

      // Clean up WASM instance
      try { sa.free(); } catch {}

      // 6. Apply wildcard fix
      const wildcardSessionHash = computeWildcardSessionHash(chain, cr.controller, creds);

      // Replace policies root with wildcard
      signature[2] = cr.wildcardRoot;

      // Recompute signing hash using the wildcard session hash
      const signingInput = poseidonSmall([BigInt(txHashForSign), wildcardSessionHash, 2n]);
      const signingHash = "0x" + signingInput[0].toString(16);
      const newSig = starkSign(signingHash, cr.sessionPriv);
      signature[12] = "0x" + newSig.r.toString(16);
      signature[13] = "0x" + newSig.s.toString(16);

      // Fix proofs: replace with empty (wildcard)
      const authLen = parseInt(signature[7], 16);
      const proofsStart = 8 + authLen + 4 + 4;
      signature.length = proofsStart;
      signature.push("0x0");

      // 7. Submit via starknet_addInvokeTransaction
      log.tx(`Submitting invoke V3 transaction...`);
      const invokeBody = {
        jsonrpc: '2.0', id: 1,
        method: 'starknet_addInvokeTransaction',
        params: {
          invoke_transaction: {
            type: 'INVOKE',
            sender_address: cr.controller,
            calldata: compiledCalldata,
            version: '0x3',
            signature,
            nonce,
            resource_bounds: {
              l1_gas: {
                max_amount: '0x' + resourceBounds.l1_gas.max_amount.toString(16),
                max_price_per_unit: '0x' + resourceBounds.l1_gas.max_price_per_unit.toString(16),
              },
              l2_gas: {
                max_amount: '0x' + resourceBounds.l2_gas.max_amount.toString(16),
                max_price_per_unit: '0x' + resourceBounds.l2_gas.max_price_per_unit.toString(16),
              },
              l1_data_gas: {
                max_amount: '0x' + resourceBounds.l1_data_gas.max_amount.toString(16),
                max_price_per_unit: '0x' + resourceBounds.l1_data_gas.max_price_per_unit.toString(16),
              },
            },
            tip: '0x0',
            paymaster_data: [],
            account_deployment_data: [],
            nonce_data_availability_mode: 'L1',
            fee_data_availability_mode: 'L1',
          },
        },
      };

      const submitResp = await origFetch.call(globalThis, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invokeBody),
      });
      const submitResult = await submitResp.json() as any;

      if (submitResult.error) {
        const errMsg = typeof submitResult.error.data === 'string'
          ? submitResult.error.data
          : submitResult.error.data?.execution_error || JSON.stringify(submitResult.error.data || '');
        const fullErr = `${submitResult.error.code}: ${submitResult.error.message} ${errMsg}`;
        log.error(`Submit error: ${fullErr.slice(0, 500)}`);

        if (isContractRevert(fullErr)) {
          throw new Error(`Transaction reverted: ${fullErr}`);
        }
        if (attempt < DIRECT_INVOKE_MAX_RETRIES) {
          await delay(2000 * attempt);
          continue;
        }
        throw new Error(`Transaction submission failed: ${fullErr}`);
      }

      const txHash = submitResult.result?.transaction_hash;
      if (!txHash) {
        throw new Error(`No transaction hash in response: ${JSON.stringify(submitResult).slice(0, 500)}`);
      }

      log.tx(`TX submitted: ${txHash}`);
      dashboard.emitTxStatus("submitted", description, txHash);

      // 8. Wait for receipt
      const receipt = await waitForReceipt(url, txHash);

      if (receipt?.execution_status === "REVERTED") {
        log.error(`TX REVERTED: ${description}`);
        if (receipt.revert_reason) {
          log.error(`Reason: ${receipt.revert_reason}`);
        }
        dashboard.emitTxStatus("reverted", description, txHash, receipt.revert_reason);
        throw new Error(`Transaction reverted: ${receipt.revert_reason || "unknown"}`);
      }

      log.success(`Direct invoke confirmed: ${description}`);
      dashboard.emitTxStatus("confirmed", description, txHash);
      return receipt || { transaction_hash: txHash };
    } catch (error: any) {
      const msg = error?.message || String(error);
      log.error(`Direct invoke failed (attempt ${attempt}): ${msg.slice(0, 200)}`);
      dashboard.emitTxStatus("error", description, undefined, msg.slice(0, 200), attempt);

      if (msg.includes("reverted")) {
        throw error; // Don't retry reverts
      }

      if (attempt < DIRECT_INVOKE_MAX_RETRIES) {
        log.info(`Retrying in ${2000 * attempt}ms...`);
        await delay(2000 * attempt);
      } else {
        throw error;
      }
    }
  }
  throw new Error("Unreachable");
}
