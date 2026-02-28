import { RpcProvider, num } from "starknet";
import { ItemUtils } from "./utils/item-utils.js";
import { calculateLevel } from "./utils/math.js";

const GAME_ADDRESS = "0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c";
const RPC_URL = "https://rpc.starknet.lava.build/";

const provider = new RpcProvider({ nodeUrl: RPC_URL });

const gameIds = [13218, 196424, 36005, 144200, 9986, 147686];

async function main() {
for (const gameId of gameIds) {
  try {
    const r = await provider.callContract({
      contractAddress: GAME_ADDRESS,
      entrypoint: "get_game_state",
      calldata: [num.toHex(gameId)],
    });

    const hp = parseInt(r[0], 16);
    const xp = parseInt(r[1], 16);
    const gold = parseInt(r[2], 16);
    const beastHp = parseInt(r[3], 16);
    const upgrades = parseInt(r[4], 16);
    const str = parseInt(r[5], 16);
    const dex = parseInt(r[6], 16);
    const vit = parseInt(r[7], 16);
    const int_ = parseInt(r[8], 16);
    const wis = parseInt(r[9], 16);
    const cha = parseInt(r[10], 16);
    const luck = parseInt(r[11], 16);
    const level = calculateLevel(xp);

    // Equipment
    const slots = ["Weapon", "Chest", "Head", "Waist", "Foot", "Hand", "Neck", "Ring"];
    const equipment: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = parseInt(r[12 + i * 2], 16);
      const itemXp = parseInt(r[13 + i * 2], 16);
      if (id > 0) {
        const name = ItemUtils.getItemName(id);
        const tier = ItemUtils.getItemTier(id);
        const greatness = Math.floor(Math.sqrt(itemXp));
        equipment.push(`  ${slots[i]}: ${name} T${tier} G${greatness} (xp:${itemXp})`);
      } else {
        equipment.push(`  ${slots[i]}: <empty>`);
      }
    }

    // Bag items
    const bagItems: string[] = [];
    for (let i = 0; i < 15; i++) {
      const id = parseInt(r[30 + i * 2], 16);
      const itemXp = parseInt(r[31 + i * 2], 16);
      if (id > 0) {
        const name = ItemUtils.getItemName(id);
        const tier = ItemUtils.getItemTier(id);
        const greatness = Math.floor(Math.sqrt(itemXp));
        bagItems.push(`  ${name} T${tier} G${greatness} (xp:${itemXp})`);
      }
    }

    // Total stats
    const totalStats = str + dex + vit + int_ + wis + cha;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Game ${gameId} | Level ${level} | XP ${xp} | HP ${hp} | Gold ${gold}`);
    console.log(`Stats (total ${totalStats}): STR:${str} DEX:${dex} VIT:${vit} INT:${int_} WIS:${wis} CHA:${cha} LCK:${luck}`);
    console.log(`Max HP: ${100 + vit * 15} | Flee: ${dex >= level ? '100%' : `${Math.floor((255 * dex / level) / 256 * 100)}%`}`);
    console.log(`Potion cost: ${Math.max(1, level - cha * 2)}g`);
    console.log(`Equipment:`);
    equipment.forEach(e => console.log(e));
    if (bagItems.length > 0) {
      console.log(`Bag (${bagItems.length} items):`);
      bagItems.forEach(b => console.log(b));
    }
  } catch (err: any) {
    console.log(`\nGame ${gameId}: Error - ${err.message?.slice(0, 100)}`);
  }
}
}
main();
