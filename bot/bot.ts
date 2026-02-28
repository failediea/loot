// Loot Survivor Automation Bot v2
// Uses Cartridge Controller session with wildcard policy fix
import { hash, CallData, addAddressPadding, RpcProvider, num } from "starknet";
import { poseidonHashMany, poseidonSmall, sign as starkSign } from "@scure/starknet";

// Handle WASM crashes gracefully - it throws "url parse" after successful tx submission
process.on('uncaughtException', (err) => {
  if (err.message === 'url parse') return; // Known WASM bug, tx was already sent
  console.error('Uncaught exception:', err);
  process.exit(1);
});

// ============================================================
// Configuration
// ============================================================
const CONTROLLER = "0x02eb8e6459a39d3ac8a2f52ab17084b259beed1f705c0cae9caae4cffe391d8e";
const SESSION_PRIV = "0x6fb20ea6869285bdd60d58024081659cfefd6167c5a3941240fd4d72d67dbd4";
const SESSION_HASH = "0x2740f7281f92da75ad1c838fd7794d8cacb1fc7cbb66efd19c0fe9f526a74f5";
const SESSION_KEY_GUID = "0x6932f6d78dccf32a90ba255a0fd3e59d3a87caf2410f0bac9885638da08b67d";
const WILDCARD_ROOT = "0x77696c64636172642d706f6c696379";
const RPC_URL = "https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9";
const CHAIN_ID = "0x534e5f4d41494e";
const GAME = "0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c";
const VRF = "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f";
const GAME_ID = 187071;

// OutsideExecution SNIP-12 constants
const DOMAIN_TYPE_HASH = 0x1ff2f602e42168014d405a94f75e8a93d640751d71d16311266e140d8b0a210n;
const CALL_TYPE_HASH = 0x3635c7f2a7ba93844c0d064e18e487f35ab90f7c39d00f186a781fc3f0c2ca9n;
const OE_TYPE_HASH = 0x13c8403ec4241d635a9bb6243dc259fe85c3483374f6c92b23510b4594a7d38n;
const OE_DOMAIN_NAME = BigInt("0x" + Buffer.from("Account.execute_from_outside").toString("hex"));
const STARKNET_MESSAGE = BigInt("0x" + Buffer.from("StarkNet Message").toString("hex"));
const OE_CHAIN_ID = 0x534e5f4d41494en;

// ============================================================
// Item/Equipment constants
// ============================================================
// Item ID → Tier (1=best T1, 5=worst T5)
function getItemTier(id: number): number {
  if (id <= 0) return 5;
  // Jewelry: all T1 except SilverRing(4)=T2, BronzeRing(5)=T3
  if (id <= 8) return [0, 1, 1, 1, 2, 3, 1, 1, 1][id];
  // Magic weapons (no T4): GhostWand(9)T1, GraveWand(10)T2, BoneWand(11)T3, Wand(12)T5
  if (id >= 9 && id <= 12) return [1, 2, 3, 5][id - 9];
  // Books (no T4): Grimoire(13)T1, Chronicle(14)T2, Tome(15)T3, Book(16)T5
  if (id >= 13 && id <= 16) return [1, 2, 3, 5][id - 13];
  // Cloth armor (17-41): groups of 5, T1-T5
  if (id >= 17 && id <= 41) return ((id - 17) % 5) + 1;
  // Hide: blades(42-46) + armor(47-71): groups of 5, T1-T5
  if (id >= 42 && id <= 71) return ((id - 42) % 5) + 1;
  // Metal: bludgeon(72-76) + armor(77-101): groups of 5, T1-T5
  if (id >= 72 && id <= 101) return ((id - 72) % 5) + 1;
  return 5;
}

// Item type: cloth(magic), hide(blade), metal(bludgeon)
type ItemType = 'cloth' | 'hide' | 'metal' | 'jewelry';
function getItemType(id: number): ItemType {
  if (id <= 8) return 'jewelry';
  if (id <= 41) return 'cloth';
  if (id <= 71) return 'hide';
  return 'metal';
}

// Weapon IDs (for checking if an item is a weapon)
function isWeapon(id: number): boolean {
  return (id >= 9 && id <= 16) || (id >= 42 && id <= 46) || (id >= 72 && id <= 76);
}

// Armor slot from item ID (for checking if market item fills an empty slot)
function getArmorSlot(id: number): string | null {
  if (id >= 9 && id <= 16) return 'weapon';
  if (id >= 42 && id <= 46) return 'weapon';
  if (id >= 72 && id <= 76) return 'weapon';
  // Chest
  if ((id >= 17 && id <= 21) || (id >= 47 && id <= 51) || (id >= 77 && id <= 81)) return 'chest';
  // Head
  if ((id >= 22 && id <= 26) || (id >= 52 && id <= 56) || (id >= 82 && id <= 86)) return 'head';
  // Waist
  if ((id >= 27 && id <= 31) || (id >= 57 && id <= 61) || (id >= 87 && id <= 91)) return 'waist';
  // Foot
  if ((id >= 32 && id <= 36) || (id >= 62 && id <= 66) || (id >= 92 && id <= 96)) return 'foot';
  // Hand
  if ((id >= 37 && id <= 41) || (id >= 67 && id <= 71) || (id >= 97 && id <= 101)) return 'hand';
  // Neck/Ring
  if (id >= 1 && id <= 3) return 'neck';
  if (id >= 4 && id <= 8) return 'ring';
  return null;
}

// Tier multiplier for damage/armor: T1=5, T2=4, T3=3, T4=2, T5=1
function tierMultiplier(tier: number): number { return 6 - tier; }

// Item price by tier: TIER_PRICE(4) * multiplier, with charisma discount
function itemPrice(tier: number, charisma: number): number {
  const base = 4 * tierMultiplier(tier);
  return Math.max(1, base - charisma);
}

// Max HP: 100 + VIT * 15
function maxHp(vitality: number): number {
  return Math.min(1023, 100 + vitality * 15);
}

// Level from XP: sqrt(xp), min 1
function levelFromXp(xp: number): number {
  return xp === 0 ? 1 : Math.floor(Math.sqrt(xp));
}

// Potion cost: max(1, level - 2*CHA)
function potionCost(level: number, charisma: number): number {
  return Math.max(1, level - 2 * charisma);
}

// Elemental effectiveness: damage modifier
function elementalModifier(weaponType: ItemType, armorType: ItemType): number {
  // Strong = 1.5x, Fair = 1x, Weak = 0.5x
  if (weaponType === armorType) return 1.0; // fair
  if (weaponType === 'cloth' && armorType === 'metal') return 1.5; // strong
  if (weaponType === 'cloth' && armorType === 'hide') return 0.5; // weak
  if (weaponType === 'hide' && armorType === 'cloth') return 1.5;
  if (weaponType === 'hide' && armorType === 'metal') return 0.5;
  if (weaponType === 'metal' && armorType === 'hide') return 1.5;
  if (weaponType === 'metal' && armorType === 'cloth') return 0.5;
  return 1.0;
}

// ============================================================
// OutsideExecution hash computation
// ============================================================
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

// ============================================================
// Fetch interceptor: fix wildcard signature for executeFromOutside
// ============================================================
const origFetch = globalThis.fetch;
globalThis.fetch = async function(input: any, init?: any) {
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
      sig[2] = WILDCARD_ROOT;
      const oeHash = computeOutsideExecHash(oe);
      const hadesResult = poseidonSmall([BigInt(oeHash), BigInt(SESSION_HASH), 2n]);
      const signingHash = "0x" + hadesResult[0].toString(16);
      const newSig = starkSign(signingHash, SESSION_PRIV);
      sig[12] = "0x" + newSig.r.toString(16);
      sig[13] = "0x" + newSig.s.toString(16);
      const authLen = parseInt(sig[7], 16);
      const proofsStart = 8 + authLen + 4 + 4;
      sig.length = proofsStart;
      sig.push("0x0");

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

  if (parsed?.method === 'cartridge_addExecuteOutsideTransaction') {
    const clone = resp.clone();
    try {
      const text = await clone.text();
      const rp = JSON.parse(text);
      if (rp.error) {
        const errStr = typeof rp.error.data === 'string' ? rp.error.data :
                       rp.error.data?.execution_error || JSON.stringify(rp.error.data || '');
        lastTxError = `${rp.error.code}: ${rp.error.message}`;
        console.log(`    [RESP] Error: ${rp.error.code} ${rp.error.message}`);
        (typeof errStr === 'string' ? errStr : '').match(/0x[0-9a-f]+/gi)?.forEach((h: string) => {
          try { const d = Buffer.from(h.replace('0x',''),'hex').toString('ascii');
            if (d.match(/^[\x20-\x7e]+$/)) console.log(`    ${h} = "${d}"`);
          } catch {}
        });
      } else if (rp.result) {
        console.log(`    [RESP] OK: ${JSON.stringify(rp.result).slice(0, 200)}`);
        if (rp.result?.transaction_hash) lastTxHash = rp.result.transaction_hash;
      }
    } catch {}
    return new Response(await resp.clone().text(), { status: resp.status, headers: resp.headers });
  }

  return resp;
} as typeof fetch;

// ============================================================
// Game state
// ============================================================
interface GameState {
  hp: number; xp: number; gold: number; beastHp: number;
  statUpgrades: number; actionCount: number; level: number;
  // Stats
  strength: number; dexterity: number; vitality: number;
  intelligence: number; wisdom: number; charisma: number; luck: number;
  // Equipment (id, xp pairs)
  weaponId: number; weaponXp: number;
  chestId: number; headId: number; waistId: number;
  footId: number; handId: number; neckId: number; ringId: number;
  // Beast
  beastId: number; beastLevel: number;
  // Market
  marketItems: number[];
  // Derived
  maxHp: number; weaponTier: number; weaponType: ItemType;
}

async function getGameState(provider: RpcProvider): Promise<GameState> {
  const r = await provider.callContract({
    contractAddress: GAME, entrypoint: "get_game_state", calldata: [num.toHex(GAME_ID)],
  });
  const p = (i: number) => parseInt(r[i], 16);
  const xp = p(1);
  const vit = p(7);
  const weaponId = p(12);

  // Market items: index 69 = array length, 70+ = item IDs
  const marketLen = p(69);
  const marketItems: number[] = [];
  for (let i = 0; i < marketLen && i < 30; i++) {
    marketItems.push(p(70 + i));
  }

  return {
    hp: p(0), xp, gold: p(2), beastHp: p(3), statUpgrades: p(4),
    strength: p(5), dexterity: p(6), vitality: vit,
    intelligence: p(8), wisdom: p(9), charisma: p(10), luck: p(11),
    weaponId, weaponXp: p(13),
    chestId: p(14), headId: p(16), waistId: p(18),
    footId: p(20), handId: p(22), neckId: p(24), ringId: p(26),
    actionCount: p(29),
    beastId: p(61), beastLevel: p(64),
    marketItems,
    level: levelFromXp(xp),
    maxHp: maxHp(vit),
    weaponTier: getItemTier(weaponId),
    weaponType: getItemType(weaponId),
  };
}

// ============================================================
// Combat estimation
// ============================================================
function estimateOurDamage(state: GameState): number {
  // base_attack = tier_multiplier * weapon_greatness
  const weaponGreatness = Math.max(1, Math.floor(Math.sqrt(state.weaponXp)));
  const base = tierMultiplier(state.weaponTier) * weaponGreatness;
  // STR bonus: 10% per point
  const strBonus = Math.floor(base * state.strength * 10 / 100);
  // Minimum damage is 4
  return Math.max(4, base + strBonus);
}

function estimateBeastDamage(state: GameState): number {
  // Beast attack = tier_multiplier * beast_level (beast tier is random, assume T3 average)
  const beastTier = 3; // average
  const base = tierMultiplier(beastTier) * state.beastLevel;
  // Our armor reduces: use chest armor as proxy (largest piece)
  const chestTier = getItemTier(state.chestId);
  const chestGreatness = 1; // conservative - we don't read chest XP easily
  const armor = state.chestId > 0 ? tierMultiplier(chestTier) * chestGreatness : 0;
  // Minimum damage from beasts is 2
  return Math.max(2, base - armor);
}

function estimateRoundsToKill(state: GameState): number {
  const dmg = estimateOurDamage(state);
  return Math.ceil(state.beastHp / dmg);
}

function estimateRoundsToSurvive(state: GameState): number {
  const beastDmg = estimateBeastDamage(state);
  return Math.floor(state.hp / beastDmg);
}

// ============================================================
// Shopping: potions + equipment
// ============================================================
function findBestMarketUpgrade(state: GameState): { itemId: number; slot: string; tier: number; price: number } | null {
  if (state.marketItems.length === 0) return null;

  // Current equipment tiers by slot
  const currentTiers: Record<string, number> = {
    weapon: state.weaponTier,
    chest: state.chestId > 0 ? getItemTier(state.chestId) : 6, // 6 = no item (worse than T5)
    head: state.headId > 0 ? getItemTier(state.headId) : 6,
    waist: state.waistId > 0 ? getItemTier(state.waistId) : 6,
    foot: state.footId > 0 ? getItemTier(state.footId) : 6,
    hand: state.handId > 0 ? getItemTier(state.handId) : 6,
    neck: state.neckId > 0 ? getItemTier(state.neckId) : 6,
    ring: state.ringId > 0 ? getItemTier(state.ringId) : 6,
  };

  let bestUpgrade: { itemId: number; slot: string; tier: number; price: number; improvement: number } | null = null;

  for (const itemId of state.marketItems) {
    const slot = getArmorSlot(itemId);
    if (!slot) continue;
    const tier = getItemTier(itemId);
    const currentTier = currentTiers[slot];
    const improvement = currentTier - tier; // higher = better (going from T5→T1 = 4 improvement)

    if (improvement <= 0) continue; // Not an upgrade

    const price = itemPrice(tier, state.charisma);

    // Prioritize: weapon upgrades (2x weight), then filling empty slots (1.5x), then armor upgrades
    let score = improvement;
    if (slot === 'weapon') score *= 2;
    else if (currentTier >= 6) score *= 1.5; // empty slot

    if (!bestUpgrade || score > bestUpgrade.improvement) {
      bestUpgrade = { itemId, slot, tier, price, improvement: score };
    }
  }

  return bestUpgrade;
}

async function handleShopping(sa: any, state: GameState): Promise<boolean> {
  if (state.beastHp > 0 || state.statUpgrades > 0 || state.hp <= 0) return false;

  const potCost = potionCost(state.level, state.charisma);
  const hpTarget = Math.min(state.maxHp, Math.max(state.maxHp * 0.8, 50));
  const hpNeeded = Math.max(0, hpTarget - state.hp);
  const potionsNeeded = Math.ceil(hpNeeded / 10);
  const potionsAffordable = Math.floor(state.gold / potCost);
  let numPotions = Math.min(potionsNeeded, potionsAffordable);

  // Check for equipment upgrade
  const upgrade = findBestMarketUpgrade(state);
  let buyItemId = 0;
  let reserveGold = 0;

  if (upgrade && upgrade.price <= state.gold) {
    // Reserve gold for equipment, adjust potion count
    reserveGold = upgrade.price;
    const goldForPotions = state.gold - reserveGold;
    const adjustedPotions = Math.min(potionsNeeded, Math.floor(goldForPotions / potCost));

    // Buy equipment if we can still afford some potions (or HP is ok)
    if (adjustedPotions >= Math.min(3, potionsNeeded) || state.hp >= hpTarget * 0.6) {
      numPotions = adjustedPotions;
      buyItemId = upgrade.itemId;
      console.log(`  [Shop] Buying T${upgrade.tier} ${upgrade.slot} (item ${upgrade.itemId}) for ${upgrade.price}g`);
    } else {
      // Potions are more important - skip equipment
      buyItemId = 0;
    }
  }

  if (numPotions <= 0 && buyItemId === 0) {
    if (hpNeeded > 0 && state.gold > 0) {
      console.log(`  [Shop] Need ${potionsNeeded} potions but can't afford (cost=${potCost}g, gold=${state.gold})`);
    }
    return false;
  }

  // Build buy_items call: (adventurer_id, potions, items_array)
  // Items array: [length, item1_id, item1_equip, ...]
  let calldata: string[];
  if (buyItemId > 0) {
    calldata = CallData.toHex(CallData.compile([
      GAME_ID.toString(), numPotions.toString(),
      "1", buyItemId.toString(), "1", // 1 item, equip=true
    ]));
  } else {
    calldata = CallData.toHex(CallData.compile([
      GAME_ID.toString(), numPotions.toString(), "0", // 0 items
    ]));
  }

  const calls = [{ contractAddress: addAddressPadding(GAME), entrypoint: "buy_items", calldata }];

  const parts: string[] = [];
  if (numPotions > 0) parts.push(`${numPotions} potions (+${numPotions * 10} HP)`);
  if (buyItemId > 0) parts.push(`T${getItemTier(buyItemId)} item #${buyItemId}`);
  const label = `buy ${parts.join(' + ')}`;
  console.log(`  [Shop] ${label} for ${numPotions * potCost + (buyItemId > 0 ? reserveGold : 0)}g`);

  const result = await executeAction(sa, calls, label);
  return result !== null;
}

// ============================================================
// Build calls for VRF actions
// ============================================================
function buildExploreCalls(xp: number): any[] {
  const salt = hash.computePoseidonHashOnElements([BigInt(xp), BigInt(GAME_ID)]);
  return [
    { contractAddress: addAddressPadding(VRF), entrypoint: "request_random",
      calldata: CallData.toHex(CallData.compile({ caller: GAME, source: { type: 1, salt } })) },
    { contractAddress: addAddressPadding(GAME), entrypoint: "explore",
      calldata: CallData.toHex(CallData.compile([GAME_ID.toString(), "0"])) },
  ];
}

function buildAttackCalls(xp: number, actionCount: number): any[] {
  const salt = hash.computePoseidonHashOnElements([BigInt(xp), BigInt(GAME_ID), BigInt(actionCount + 1)]);
  return [
    { contractAddress: addAddressPadding(VRF), entrypoint: "request_random",
      calldata: CallData.toHex(CallData.compile({ caller: GAME, source: { type: 1, salt } })) },
    { contractAddress: addAddressPadding(GAME), entrypoint: "attack",
      calldata: CallData.toHex(CallData.compile([GAME_ID.toString(), "0"])) },
  ];
}

function buildFleeCalls(xp: number, actionCount: number): any[] {
  const salt = hash.computePoseidonHashOnElements([BigInt(xp), BigInt(GAME_ID), BigInt(actionCount + 1)]);
  return [
    { contractAddress: addAddressPadding(VRF), entrypoint: "request_random",
      calldata: CallData.toHex(CallData.compile({ caller: GAME, source: { type: 1, salt } })) },
    { contractAddress: addAddressPadding(GAME), entrypoint: "flee",
      calldata: CallData.toHex(CallData.compile([GAME_ID.toString(), "0"])) },
  ];
}

// ============================================================
// Execute action via session account
// ============================================================
let lastTxHash: string | null = null;
let lastTxError: string | null = null;

async function waitForTx(txHash: string): Promise<boolean> {
  await new Promise(r => setTimeout(r, 8000));
  try {
    const resp = await origFetch.call(globalThis, RPC_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'starknet_getTransactionReceipt',
        params: { transaction_hash: txHash } }),
    });
    const data = await resp.json() as any;
    return data.result?.execution_status === 'SUCCEEDED';
  } catch { return false; }
}

async function executeAction(sa: any, calls: any[], label: string): Promise<string | null> {
  lastTxHash = null;
  lastTxError = null;

  const wasmPromise = sa.executeFromOutside(calls).catch((e: any) => ({ error: e.message?.slice(0, 200) }));
  const timeoutPromise = new Promise<{ timeout: true }>(r => setTimeout(() => r({ timeout: true }), 15000));
  const result = await Promise.race([wasmPromise, timeoutPromise]);

  let txHash = lastTxHash;
  if (result && !('timeout' in result) && !('error' in result)) {
    txHash = typeof result === 'string' ? result : result?.transaction_hash || txHash;
  }

  if (lastTxError && !txHash) {
    console.log(`  Error: ${lastTxError}`);
    return null;
  }
  if (!txHash) {
    if (result && 'error' in result) console.log(`  FAILED: ${(result as any).error}`);
    else console.log(`  Timeout - no tx hash`);
    return null;
  }

  console.log(`  TX: ${txHash}`);
  const success = await waitForTx(txHash);
  if (success) { console.log(`  OK (${label})`); return txHash; }
  else { console.log(`  REVERTED or pending`); return null; }
}

// ============================================================
// Stat upgrade logic
// ============================================================
async function handleStatUpgrades(sa: any, state: GameState): Promise<boolean> {
  if (state.statUpgrades <= 0) return false;

  console.log(`  [Stats] ${state.statUpgrades} upgrades available`);
  console.log(`  [Stats] Current: STR=${state.strength} DEX=${state.dexterity} VIT=${state.vitality} INT=${state.intelligence} WIS=${state.wisdom} CHA=${state.charisma} LCK=${state.luck}`);

  const stats = { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, wisdom: 0, charisma: 0, luck: 0 };
  let remaining = state.statUpgrades;
  let simCha = state.charisma, simDex = state.dexterity, simVit = state.vitality;
  let simWis = state.wisdom, simInt = state.intelligence;

  while (remaining > 0) {
    // CHA needed for 1g potions: ceil(level/2)
    // But level will increase as we gain XP, so aim slightly ahead
    const futureLevel = state.level + 2;
    const chaNeeded = Math.ceil(futureLevel / 2);

    if (state.hp < 30 && simVit < 20) {
      // Critical HP: VIT for immediate max-HP boost (+15 HP cap per point)
      stats.vitality++; simVit++;
    } else if (simCha < chaNeeded) {
      // CHA: makes potions cost 1g (highest ROI stat for sustain)
      stats.charisma++; simCha++;
    } else if (simDex < state.level + 2) {
      // DEX: guaranteed flee (DEX >= level). Aim slightly ahead of current level.
      stats.dexterity++; simDex++;
    } else if (simVit < 15) {
      // VIT: HP buffer (100 + VIT*15). 15 VIT = 325 max HP.
      stats.vitality++; simVit++;
    } else if (simInt < state.level) {
      // INT: dodge obstacles during explore (INT >= level = guaranteed)
      stats.intelligence++; simInt++;
    } else if (simWis < state.level) {
      // WIS: avoid ambushes (WIS >= level = guaranteed)
      stats.wisdom++; simWis++;
    } else {
      // All key thresholds met - more VIT for tank
      stats.vitality++; simVit++;
    }
    remaining--;
  }

  const statStr = Object.entries(stats).filter(([,v]) => v > 0).map(([k,v]) => `${k}=${v}`).join(', ');
  console.log(`  [Stats] Allocating: ${statStr}`);

  const calls = [{
    contractAddress: addAddressPadding(GAME), entrypoint: "select_stat_upgrades",
    calldata: CallData.toHex(CallData.compile([
      GAME_ID.toString(),
      stats.strength.toString(), stats.dexterity.toString(), stats.vitality.toString(),
      stats.intelligence.toString(), stats.wisdom.toString(), stats.charisma.toString(),
      stats.luck.toString(),
    ])),
  }];

  const result = await executeAction(sa, calls, `upgrade ${statStr}`);
  return result !== null;
}

// ============================================================
// Main bot loop
// ============================================================
async function main() {
  console.log(`=== Loot Survivor Bot v2 - Game ${GAME_ID} ===\n`);

  const { CartridgeSessionAccount, signerToGuid } = await import("@cartridge/controller-wasm/session");
  const ownerGuid = signerToGuid({ eip191: { address: "0x5efc192b995c0bf39bf8ba332e230dfa7abd3283" } });
  const provider = new RpcProvider({ nodeUrl: RPC_URL });

  const allMethods = ["request_random", "attack", "explore", "flee", "start_game",
                      "select_stat_upgrades", "buy_items", "equip", "drop"];
  const policies = [
    ...allMethods.filter(m => m === "request_random").map(m => ({
      target: addAddressPadding(VRF), method: hash.getSelectorFromName(m), authorized: true,
    })),
    ...allMethods.filter(m => m !== "request_random").map(m => ({
      target: addAddressPadding(GAME), method: hash.getSelectorFromName(m), authorized: true,
    })),
  ];

  function createSessionAccount() {
    return CartridgeSessionAccount.newAsRegistered(
      RPC_URL, SESSION_PRIV, addAddressPadding(CONTROLLER), ownerGuid, CHAIN_ID,
      { expiresAt: parseInt("0x69aaeeb6", 16), policies, guardianKeyGuid: "0x0", metadataHash: "0x0",
        sessionKeyGuid: SESSION_KEY_GUID });
  }

  let consecutiveFailures = 0;
  const MAX_FAILURES = 5;

  while (true) {
    try {
      const state = await getGameState(provider);
      const potCost = potionCost(state.level, state.charisma);
      const potionsCanBuy = Math.floor(state.gold / potCost);

      console.log(`\n[Turn] HP=${state.hp}/${state.maxHp} XP=${state.xp} Gold=${state.gold} BeastHP=${state.beastHp} ` +
                  `Upgrades=${state.statUpgrades} Actions=${state.actionCount} Level=${state.level}`);
      console.log(`  Stats: STR=${state.strength} DEX=${state.dexterity} VIT=${state.vitality} ` +
                  `INT=${state.intelligence} WIS=${state.wisdom} CHA=${state.charisma} LCK=${state.luck}`);
      console.log(`  Weapon: id=${state.weaponId} T${state.weaponTier} ${state.weaponType} | ` +
                  `Armor: chest=${state.chestId} head=${state.headId} waist=${state.waistId}`);

      if (state.beastHp === 0 && state.gold > 0) {
        console.log(`  Potions: ${potCost}g each, can buy ${potionsCanBuy} (+${potionsCanBuy * 10} HP)`);
        if (state.marketItems.length > 0) {
          const upgrade = findBestMarketUpgrade(state);
          if (upgrade) console.log(`  Market: best upgrade = T${upgrade.tier} ${upgrade.slot} for ${upgrade.price}g`);
        }
      }

      if (state.beastHp > 0) {
        const ourDmg = estimateOurDamage(state);
        const beastDmg = estimateBeastDamage(state);
        const roundsToKill = estimateRoundsToKill(state);
        const roundsToSurvive = estimateRoundsToSurvive(state);
        console.log(`  Combat: we deal ~${ourDmg}/hit, beast deals ~${beastDmg}/hit | ` +
                    `kill in ~${roundsToKill} rounds, survive ~${roundsToSurvive} rounds`);
      }

      const sa = createSessionAccount();

      if (state.hp <= 0) {
        console.log("\nAdventurer is dead. Game over.");
        break;
      }

      // === PRIORITY 1: Stat upgrades (required before shopping) ===
      if (state.statUpgrades > 0) {
        const upgraded = await handleStatUpgrades(sa, state);
        if (upgraded) { consecutiveFailures = 0; await new Promise(r => setTimeout(r, 3000)); continue; }
      }

      // === PRIORITY 2: Shop (potions + equipment) when safe ===
      if (state.beastHp === 0 && state.statUpgrades === 0) {
        const shopped = await handleShopping(sa, state);
        if (shopped) { consecutiveFailures = 0; await new Promise(r => setTimeout(r, 3000)); continue; }
      }

      // === PRIORITY 3: Combat or explore ===
      let calls: any[];
      let action: string;

      if (state.beastHp > 0) {
        const canGuaranteeFlee = state.dexterity >= state.level;
        const fleeChance = Math.min(1, (255 * state.dexterity / state.level) / 256);
        const roundsToKill = estimateRoundsToKill(state);
        const roundsToSurvive = estimateRoundsToSurvive(state);
        const canWinFight = roundsToKill < roundsToSurvive;

        if (state.beastHp <= estimateOurDamage(state)) {
          // One-shot kill - always attack
          calls = buildAttackCalls(state.xp, state.actionCount);
          action = `ATTACK (one-shot, beast has ${state.beastHp} HP)`;
        } else if (state.hp <= 15) {
          // Critical HP - flee if any chance, else yolo attack
          if (canGuaranteeFlee || fleeChance > 0.3) {
            calls = buildFleeCalls(state.xp, state.actionCount);
            action = `FLEE (HP=${state.hp} critical, chance=${(fleeChance*100).toFixed(0)}%)`;
          } else {
            calls = buildAttackCalls(state.xp, state.actionCount);
            action = `ATTACK (HP critical, can't flee dex=${state.dexterity}<lvl=${state.level})`;
          }
        } else if (canWinFight) {
          // We can likely win - attack
          calls = buildAttackCalls(state.xp, state.actionCount);
          action = `ATTACK (can win: ${roundsToKill}r to kill vs ${roundsToSurvive}r survive)`;
        } else if (canGuaranteeFlee) {
          // Can't win but can flee safely
          calls = buildFleeCalls(state.xp, state.actionCount);
          action = `FLEE (outmatched, guaranteed flee)`;
        } else if (fleeChance > 0.6) {
          // Risky fight, decent flee chance
          calls = buildFleeCalls(state.xp, state.actionCount);
          action = `FLEE (outmatched, ${(fleeChance*100).toFixed(0)}% chance)`;
        } else {
          // Can't flee reliably, fight and hope
          calls = buildAttackCalls(state.xp, state.actionCount);
          action = `ATTACK (no good options, flee=${(fleeChance*100).toFixed(0)}%)`;
        }
      } else {
        // Explore - but check if HP is safe
        const minHpToExplore = Math.max(30, state.level * 3);
        if (state.hp < minHpToExplore) {
          console.log(`  WARNING: HP=${state.hp} < threshold=${minHpToExplore}, exploring anyway (no potions/gold)`);
        }
        calls = buildExploreCalls(state.xp);
        action = "EXPLORE";
      }

      console.log(`  Action: ${action}`);
      const txHash = await executeAction(sa, calls, action);

      if (txHash) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_FAILURES) {
          console.log(`\n${MAX_FAILURES} consecutive failures. Stopping.`);
          break;
        }
        console.log(`  Retry (${consecutiveFailures}/${MAX_FAILURES})...`);
        await new Promise(r => setTimeout(r, 10000));
      }

      await new Promise(r => setTimeout(r, 3000));
    } catch (e: any) {
      console.error(`\nError: ${e.message?.slice(0, 300)}`);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_FAILURES) break;
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  console.log("\nBot stopped.");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
