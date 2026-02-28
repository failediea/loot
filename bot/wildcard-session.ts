// Wildcard Session Fix: Intercept WASM transactions and re-sign with correct wildcard session hash
import { hash, CallData, addAddressPadding, RpcProvider, getChecksumAddress } from "starknet";
import { poseidonHashMany, poseidonSmall, sign as starkSign, getStarkKey } from "@scure/starknet";

// === Constants ===
const WILDCARD_ROOT = "0x77696c64636172642d706f6c696379"; // "wildcard-policy"
const SESSION_HASH = "0x2740f7281f92da75ad1c838fd7794d8cacb1fc7cbb66efd19c0fe9f526a74f5"; // registered on-chain
const SESSION_PRIVATE_KEY = "0x6fb20ea6869285bdd60d58024081659cfefd6167c5a3941240fd4d72d67dbd4";
const CHAIN_ID = "0x534e5f4d41494e";

const INVOKE_PREFIX = BigInt("0x696e766f6b65");
const L1_GAS_NAME = BigInt("0x" + Buffer.from("L1_GAS").toString("hex"));
const L2_GAS_NAME = BigInt("0x" + Buffer.from("L2_GAS").toString("hex"));
const L1_DATA_GAS_NAME = BigInt("0x" + Buffer.from("L1_DATA").toString("hex"));
const RESOURCE_VALUE_OFFSET = 64n + 128n; // MAX_AMOUNT_BITS + MAX_PRICE_PER_UNIT_BITS

// === Transaction Hash Computation (V3) ===
function encodeResourceBound(resourceName: bigint, maxAmount: bigint, maxPricePerUnit: bigint): bigint {
  return (resourceName << RESOURCE_VALUE_OFFSET) + (maxAmount << 128n) + maxPricePerUnit;
}

function computeInvokeV3TxHash(tx: any): string {
  const senderAddress = BigInt(tx.sender_address);
  const version = BigInt(tx.version);
  const nonce = BigInt(tx.nonce);
  const tip = BigInt(tx.tip || "0x0");
  const chainId = BigInt(CHAIN_ID);

  const rb = tx.resource_bounds;
  const l1Gas = encodeResourceBound(L1_GAS_NAME, BigInt(rb.l1_gas.max_amount), BigInt(rb.l1_gas.max_price_per_unit));
  const l2Gas = encodeResourceBound(L2_GAS_NAME, BigInt(rb.l2_gas.max_amount), BigInt(rb.l2_gas.max_price_per_unit));

  // l1_data_gas might not be present in older formats
  let l1DataGas = 0n;
  if (rb.l1_data_gas) {
    l1DataGas = encodeResourceBound(L1_DATA_GAS_NAME, BigInt(rb.l1_data_gas.max_amount), BigInt(rb.l1_data_gas.max_price_per_unit));
  }

  const feeFieldHash = poseidonHashMany([tip, l1Gas, l2Gas, l1DataGas]);

  const paymasterData = (tx.paymaster_data || []).map((x: string) => BigInt(x));
  const paymasterHash = poseidonHashMany(paymasterData.length > 0 ? paymasterData : []);

  const nonceDAMode = tx.nonce_data_availability_mode === "L1" ? 0n : 1n;
  const feeDAMode = tx.fee_data_availability_mode === "L1" ? 0n : 1n;
  const dAModeHash = (nonceDAMode << 32n) + feeDAMode;

  const accountDeploymentData = (tx.account_deployment_data || []).map((x: string) => BigInt(x));
  const accountDeploymentHash = poseidonHashMany(accountDeploymentData.length > 0 ? accountDeploymentData : []);

  const calldata = tx.calldata.map((x: string) => BigInt(x));
  const calldataHash = poseidonHashMany(calldata.length > 0 ? calldata : []);

  const txHash = poseidonHashMany([
    INVOKE_PREFIX,
    version,
    senderAddress,
    feeFieldHash,
    paymasterHash,
    chainId,
    nonce,
    dAModeHash,
    accountDeploymentHash,
    calldataHash,
  ]);

  return "0x" + txHash.toString(16);
}

// === Signature Re-signing ===
function resignSessionSignature(signature: string[], txHash: string): string[] {
  const newSig = [...signature];

  // Replace policies_root at index 2 with wildcard
  newSig[2] = WILDCARD_ROOT;

  // Find session signature position
  // [7] = session_authorization length
  const authLen = parseInt(newSig[7], 16);
  const sigStart = 8 + authLen;

  // sigStart = signer_type (0=Starknet)
  // sigStart+1 = pubkey
  // sigStart+2 = r
  // sigStart+3 = s

  // Compute signing hash: Hades([tx_hash, session_hash, 2])[0]
  const txHashBig = BigInt(txHash);
  const sessionHashBig = BigInt(SESSION_HASH);
  const hadesResult = poseidonSmall([txHashBig, sessionHashBig, 2n]);
  const signingHash = hadesResult[0];

  // Sign with session private key
  const sig = starkSign(signingHash, SESSION_PRIVATE_KEY);

  // Replace r and s
  newSig[sigStart + 2] = "0x" + sig.r.toString(16);
  newSig[sigStart + 3] = "0x" + sig.s.toString(16);

  return newSig;
}

// === Fetch Interceptor ===
const originalFetch = globalThis.fetch;

globalThis.fetch = async function(input: any, init?: any) {
  let bodyStr = '';
  if (init?.body) {
    bodyStr = typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as any);
  }

  if (bodyStr) {
    try {
      const parsed = JSON.parse(bodyStr);

      if (parsed.method === 'starknet_addInvokeTransaction') {
        console.log(`\n[WILDCARD-FIX] Intercepting starknet_addInvokeTransaction`);

        const tx = parsed.params.invoke_transaction;

        // Compute tx_hash from transaction data
        const txHash = computeInvokeV3TxHash(tx);
        console.log(`  tx_hash: ${txHash}`);

        // Re-sign signature with wildcard root
        const newSignature = resignSessionSignature(tx.signature, txHash);
        console.log(`  Replaced policies_root: ${tx.signature[2]} -> ${newSignature[2]}`);
        console.log(`  Re-signed: r=${newSignature[10 + parseInt(newSignature[7], 16)]?.slice(0, 20)}...`);

        tx.signature = newSignature;
        const newBody = JSON.stringify(parsed);
        if (init) {
          init.body = newBody;
        }
      }
    } catch {}
  }

  const resp = await originalFetch.call(globalThis, input, init || {});

  // Log errors for invoke transactions
  if (bodyStr.includes('starknet_addInvokeTransaction')) {
    const clone = resp.clone();
    try {
      const respText = await clone.text();
      const respParsed = JSON.parse(respText);
      if (respParsed.error) {
        console.log(`[WILDCARD-FIX] Error: ${JSON.stringify(respParsed.error).slice(0, 500)}`);
        // Decode error data if present
        if (respParsed.error.data) {
          try {
            const hex = respParsed.error.data.replace('0x', '');
            const ascii = Buffer.from(hex, 'hex').toString('ascii');
            if (ascii.match(/^[\x20-\x7e]+$/)) console.log(`  Decoded: "${ascii}"`);
          } catch {}
        }
      } else {
        console.log(`[WILDCARD-FIX] SUCCESS: ${JSON.stringify(respParsed.result).slice(0, 200)}`);
      }
    } catch {}
  }

  return resp;
} as typeof fetch;

export { computeInvokeV3TxHash, resignSessionSignature };
