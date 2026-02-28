import { num } from "starknet";
import { ItemUtils } from "./utils/item-utils.js";
import { calculateLevel } from "./utils/math.js";

const TORII_URL = "https://api.cartridge.gg/x/pg-mainnet-10/torii";

function addAddressPadding(hex: string): string {
  return "0x" + hex.replace("0x", "").padStart(64, "0");
}

async function fetchGameEvents(gameId: number) {
  const paddedId = addAddressPadding(num.toHex(gameId));
  const query = encodeURIComponent(
    `SELECT data FROM "event_messages_historical" WHERE keys = '${paddedId}/' LIMIT 10000`
  );
  const resp = await fetch(TORII_URL + "/sql?query=" + query);
  if (!resp.ok) return [];
  return await resp.json();
}

const gameIds = [13218, 196424, 36005, 144200, 9986, 147686];

async function main() {
  for (const gameId of gameIds) {
    console.log("\n" + "=".repeat(80));
    console.log("Game " + gameId);
    console.log("=".repeat(80));
    
    const rows = await fetchGameEvents(gameId);
    if (!rows || rows.length === 0) { console.log("  No events"); continue; }
    
    let lastLevel = 0;
    const snapshots: Map<number, any> = new Map();
    
    for (const row of rows) {
      try {
        const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
        const adv = data?.details?.adventurer;
        if (!adv) continue;
        
        const xp = adv.xp || 0;
        const level = calculateLevel(xp);
        const stats = adv.stats || {};
        const eq = adv.equipment || {};
        
        let weaponStr = "<none>";
        const wid = eq.weapon?.id || 0;
        if (wid > 0) {
          weaponStr = ItemUtils.getItemName(wid) + " T" + ItemUtils.getItemTier(wid);
        }
        
        // Count equipped armor slots
        const armorSlots = ["chest", "head", "waist", "foot", "hand", "neck", "ring"];
        let filledSlots = 0;
        for (const s of armorSlots) {
          if (eq[s]?.id > 0) filledSlots++;
        }
        
        // Track highest state per level (latest snapshot wins)
        if (level > 0) {
          const existing = snapshots.get(level);
          const actionCount = data.action_count || adv.action_count || 0;
          if (!existing || actionCount >= (existing.actionCount || 0)) {
            snapshots.set(level, {
              level, xp,
              hp: adv.health || 0,
              gold: adv.gold || 0,
              str: stats.strength || 0,
              dex: stats.dexterity || 0,
              vit: stats.vitality || 0,
              int_: stats.intelligence || 0,
              wis: stats.wisdom || 0,
              cha: stats.charisma || 0,
              luck: stats.luck || 0,
              weapon: weaponStr,
              slots: filledSlots,
              actionCount,
            });
          }
          if (level > lastLevel) lastLevel = level;
        }
      } catch (e) {}
    }
    
    console.log("  Lvl | STR DEX VIT INT WIS CHA LCK | Weapon            | Slots | HP   Gold");
    console.log("  ----|------------------------------|-------------------|-------|----------");
    
    // Show every level up to 20, then every 5
    for (let lvl = 1; lvl <= lastLevel; lvl++) {
      if (lvl > 20 && lvl % 5 !== 0 && lvl !== lastLevel) continue;
      const s = snapshots.get(lvl);
      if (!s) continue;
      console.log(
        "  L" + String(s.level).padStart(2) + " | " +
        String(s.str).padStart(3) + " " +
        String(s.dex).padStart(3) + " " +
        String(s.vit).padStart(3) + " " +
        String(s.int_).padStart(3) + " " +
        String(s.wis).padStart(3) + " " +
        String(s.cha).padStart(3) + " " +
        String(s.luck).padStart(3) + " | " +
        s.weapon.padEnd(17) + " | " +
        String(s.slots).padStart(5) + " | " +
        String(s.hp).padStart(4) + " " +
        String(s.gold).padStart(5)
      );
    }
  }
}
main();
