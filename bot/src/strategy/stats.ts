import type { Adventurer, Stats } from "../types.js";
import { calculateLevel, maxHealth } from "../utils/math.js";
import { ItemUtils } from "../utils/item-utils.js";
import { log } from "../utils/logger.js";

/**
 * Stat allocation based on top-game analysis (games 13218, 196424, 36005,
 * 144200, 9986, 147686 — all reached L48-49).
 *
 * Key findings from level-by-level progression of top games:
 * - L2-L14: Pure DEX + CHA alternation. ZERO WIS/INT investment.
 * - VIT minimal early (0-4 at L10), heavy dump starting at L15+.
 * - CHA maintained at ~ceil(level/2) for 1g potions throughout.
 * - DEX prioritized for flee safety through early/mid game.
 * - WIS/INT only grow at L20+ (not needed with safe single-explores).
 *
 * Phase 1 (L2-L14): DEX + CHA alternation
 *   CHA → ceil(level/2) keeps potions at 1g (most efficient stat).
 *   DEX → all remaining points for flee safety.
 *   No WIS, INT, or VIT — flee + cheap potions handles survival.
 *   Safe single-explores (engine.ts) prevent chained ambush damage.
 *
 * Phase 2 (L15+): VIT scaling with DEX maintenance
 *   Multi-level-ups provide bulk points for VIT dump.
 *   DEX floor at ~55% of level for reasonable flee (~55%/round).
 *   VIT gets all excess points (MaxHP = 100 + VIT*15).
 *   CHA maintenance continues.
 */

const MAX_STAT_VALUE = 31;

type StatName = "strength" | "dexterity" | "vitality" | "intelligence" | "wisdom" | "charisma";

export function allocateStats(adventurer: Adventurer): Stats {
  const points = adventurer.stat_upgrades_available;
  if (points <= 0) {
    return { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, wisdom: 0, charisma: 0, luck: 0 };
  }

  const level = calculateLevel(adventurer.xp);
  const allocation: Stats = { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, wisdom: 0, charisma: 0, luck: 0 };

  let str = adventurer.stats.strength;
  let dex = adventurer.stats.dexterity;
  let vit = adventurer.stats.vitality;
  let int_ = adventurer.stats.intelligence;
  let wis = adventurer.stats.wisdom;
  let cha = adventurer.stats.charisma;
  let hp = adventurer.health;
  let mhp = maxHealth(vit);

  log.stats(`Allocating ${points} points at L${level}`);

  for (let i = 0; i < points; i++) {
    const capped = (stat: number): boolean => stat >= MAX_STAT_VALUE;
    const stat = pickNextStat(level, hp, mhp, str, dex, vit, int_, wis, cha, capped);

    switch (stat) {
      case "strength":
        allocation.strength++; str++;
        log.stats(`  +1 STR -> ${str} (+10% weapon dmg)`);
        break;
      case "dexterity":
        allocation.dexterity++; dex++;
        log.stats(`  +1 DEX -> ${dex} (~${fleePct(dex, level)}% flee)`);
        break;
      case "vitality":
        allocation.vitality++; vit++; hp += 15; mhp = maxHealth(vit);
        log.stats(`  +1 VIT -> ${vit} (maxHP ${mhp})`);
        break;
      case "intelligence":
        allocation.intelligence++; int_++;
        log.stats(`  +1 INT -> ${int_} (obstacle dodge)`);
        break;
      case "wisdom":
        allocation.wisdom++; wis++;
        log.stats(`  +1 WIS -> ${wis} (ambush avoid)`);
        break;
      case "charisma":
        allocation.charisma++; cha++;
        const potionCost = Math.max(1, level - cha * 2);
        log.stats(`  +1 CHA -> ${cha} (potion: ${potionCost}g)`);
        break;
    }
  }

  const potionCost = Math.max(1, level - cha * 2);
  log.stats(
    `Totals: STR:${str} DEX:${dex} VIT:${vit} WIS:${wis} INT:${int_} CHA:${cha}` +
    ` | Flee:~${fleePct(dex, level)}% Potion:${potionCost}g HP:${hp}/${mhp}`
  );
  return allocation;
}

// ---------------------------------------------------------------------------
// Two-phase stat picker based on top-game analysis
//
// Phase 1 (L2-L14): Pure DEX + CHA. No WIS/INT/VIT.
//   Top games had DEX:5-7 CHA:4-6 at L10 with WIS=0 INT=0 VIT=0-2.
//   Safe single-explores (engine.ts) handle ambush/obstacle damage.
//
// Phase 2 (L15+): VIT dump with DEX floor at 55% of level.
//   Top games had VIT:5-15 at L15, VIT:20-30 at L20.
//   DEX maintained at ~55% of level for reasonable flee chance.
// ---------------------------------------------------------------------------

function pickNextStat(
  level: number,
  hp: number,
  mhp: number,
  str: number,
  dex: number,
  vit: number,
  int_: number,
  wis: number,
  cha: number,
  capped: (v: number) => boolean
): StatName {
  // 1. Emergency VIT: HP below 25% of max (survival override)
  if (hp < mhp * 0.25 && !capped(vit)) return "vitality";

  // 2. First DEX: unlock fleeing (DEX=0 = 0% flee = forced fights)
  if (dex === 0 && !capped(dex)) return "dexterity";

  // 3. First CHA: cheap potions (massive early gold savings)
  if (cha === 0 && !capped(cha)) return "charisma";

  // 4. CHA for 1g potions: CHA >= ceil(level/2)
  //    Most efficient stat — saves gold on every potion forever.
  //    Top games maintain this threshold throughout all levels.
  const chaTarget = Math.ceil(level / 2);
  if (cha < chaTarget && !capped(cha)) return "charisma";

  // ── Phase 1 (L2-L14): Pure DEX after CHA ──
  // Top games invest only in DEX + CHA through L14.
  // No WIS, INT, or VIT — flee + cheap potions handles survival.
  // Engine.ts forces safe single-explores when WIS/INT are low.
  if (level < 15) {
    if (!capped(dex)) return "dexterity";
    if (!capped(vit)) return "vitality"; // overflow (unlikely)
  }

  // ── Phase 2 (L15+): VIT scaling with DEX maintenance ──
  // Multi-level-ups provide bulk points. Top games dump VIT heavily
  // while keeping DEX at ~50-60% of level for decent flee chance.
  // At 55%, flee per round is ~55% → flee-to-the-death over 5 rounds
  // succeeds ~98% of the time. HP buffer absorbs the hits.
  const dexFloor = Math.ceil(level * 0.55);
  if (dex < dexFloor && !capped(dex)) return "dexterity";

  // VIT gets all remaining points — HP pool is critical at higher levels.
  // Each VIT = +15 max HP. VIT=20 → 400 maxHP, VIT=30 → 550 maxHP.
  if (!capped(vit)) return "vitality";

  // ── Overflow (VIT capped at 31) ──
  if (!capped(dex)) return "dexterity";
  if (!capped(cha)) return "charisma";
  if (!capped(wis)) return "wisdom";
  if (!capped(int_)) return "intelligence";
  if (!capped(str)) return "strength";

  return "vitality"; // all capped, shouldn't happen
}

// ---------------------------------------------------------------------------
// Flee probability estimator (unchanged)
// ---------------------------------------------------------------------------

function fleePct(dex: number, level: number): number {
  if (dex >= level) return 100;
  if (level === 0) return 100;
  return Math.floor((255 * dex / level) / 256 * 100);
}
