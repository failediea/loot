import type { Adventurer, Beast, Bag, Equipment } from "../types.js";
import { calculateAttackDamage, calculateBeastDamage } from "../utils/combat-calc.js";
import { getBeastTier } from "../utils/beast-utils.js";
import { calculateLevel } from "../utils/math.js";
import {
  MINIMUM_XP_REWARD,
  XP_REWARD_DIVISOR,
  MAX_XP_DECAY,
  FLEE_XP_REWARD,
  POTION_HEAL_AMOUNT,
} from "../constants/game.js";

// ─── Result Interfaces ──────────────────────────────────────────────────────

export interface CombatSimResult {
  winRate: number;              // 0.0-1.0 probability of killing beast
  expectedHpLoss: number;       // average HP lost if fighting to the death
  expectedRounds: number;       // average rounds to resolve
  expectedHpLossOnWin: number;  // avg HP lost in winning scenarios
  deathRate: number;            // 1 - winRate
}

export interface FleeSimResult {
  expectedAttempts: number;     // average flee attempts before success
  expectedHpLoss: number;       // average HP lost while fleeing
  fleeDeathRate: number;        // chance of dying while trying to flee
}

export interface CombatEV {
  attackEV: number;             // expected value of attacking
  fleeEV: number;              // expected value of fleeing
  recommendation: "attack" | "flee";
  confidence: number;           // how much better the recommendation is
}

// ─── Precomputed Damage Tables ──────────────────────────────────────────────

/**
 * Precompute player damage values (base and critical) once before the
 * simulation loop to avoid recalculating elemental/strength/armor math
 * on every sample iteration.
 */
interface PlayerDamageTable {
  baseDamage: number;
  criticalDamage: number;
  critChance: number;   // luck / 100, capped at 1.0
}

function buildPlayerDamageTable(adventurer: Adventurer, beast: Beast): PlayerDamageTable {
  const ring = adventurer.equipment.ring;
  const { baseDamage, criticalDamage } = calculateAttackDamage(
    adventurer.equipment.weapon,
    adventurer,
    beast,
    ring,
  );
  const critChance = Math.min(adventurer.stats.luck / 100, 1.0);
  return { baseDamage, criticalDamage, critChance };
}

/**
 * Precompute beast damage for each of the 5 armor slots. Each slot has an
 * equal 20% chance of being hit. Storing both base and crit values avoids
 * recomputing elemental adjustments inside the hot loop.
 */
interface BeastSlotDamage {
  baseDamage: number;
  criticalDamage: number;
}

interface BeastDamageTable {
  slots: BeastSlotDamage[];     // length 5: chest, head, waist, foot, hand
  beastCritChance: number;      // adventurerLevel / 100, capped at 1.0
}

function buildBeastDamageTable(adventurer: Adventurer, beast: Beast, adventurerLevel: number): BeastDamageTable {
  const armorSlots: (keyof Equipment)[] = ["chest", "head", "waist", "foot", "hand"];
  const neck = adventurer.equipment.neck;
  const beastCritChance = Math.min(adventurerLevel / 100, 1.0);

  const slots: BeastSlotDamage[] = armorSlots.map((slot) => {
    const armor = adventurer.equipment[slot];
    const { baseDamage, criticalDamage } = calculateBeastDamage(beast, adventurer, armor, neck);
    return { baseDamage, criticalDamage };
  });

  return { slots, beastCritChance };
}

// ─── Single-Round Sampling Helpers ──────────────────────────────────────────

/**
 * Roll a single player attack and return the damage dealt.
 * Uses Math.random() for speed -- no seeded RNG needed for Monte Carlo.
 */
function rollPlayerDamage(table: PlayerDamageTable): number {
  if (Math.random() < table.critChance) {
    return table.criticalDamage;
  }
  return table.baseDamage;
}

/**
 * Roll a single beast attack: pick a random armor slot, then roll for crit.
 */
function rollBeastDamage(table: BeastDamageTable): number {
  const slotIndex = (Math.random() * 5) | 0; // fast int in [0,4]
  const slot = table.slots[slotIndex];
  if (Math.random() < table.beastCritChance) {
    return slot.criticalDamage;
  }
  return slot.baseDamage;
}

// ─── Monte Carlo: Combat ────────────────────────────────────────────────────

/**
 * Run a Monte Carlo simulation of the adventurer fighting the beast to the
 * death (one side reaches 0 HP).
 *
 * Each sample plays out full rounds: player attacks first, then beast attacks
 * if still alive. We track wins, total HP lost, HP lost on wins, and rounds.
 *
 * Performance target: 5000 samples < 50 ms. The inner loop is a tight
 * arithmetic loop with no allocations and precomputed damage tables.
 */
export function simulateCombat(
  adventurer: Adventurer,
  beast: Beast,
  samples: number = 5000,
): CombatSimResult {
  const level = calculateLevel(adventurer.xp);
  const playerTable = buildPlayerDamageTable(adventurer, beast);
  const beastTable = buildBeastDamageTable(adventurer, beast, level);

  const startHp = adventurer.health;
  const beastStartHp = beast.health;

  let wins = 0;
  let totalHpLost = 0;
  let totalHpLostOnWin = 0;
  let totalRounds = 0;

  for (let i = 0; i < samples; i++) {
    let hp = startHp;
    let beastHp = beastStartHp;
    let rounds = 0;

    while (hp > 0 && beastHp > 0) {
      rounds++;

      // Player attacks beast
      const playerDmg = rollPlayerDamage(playerTable);
      beastHp -= playerDmg;

      if (beastHp <= 0) {
        // Beast is dead, player wins -- no counter-attack this round
        break;
      }

      // Beast attacks player
      const beastDmg = rollBeastDamage(beastTable);
      hp -= beastDmg;
    }

    totalRounds += rounds;
    const hpLost = startHp - Math.max(hp, 0);
    totalHpLost += hpLost;

    if (beastHp <= 0) {
      wins++;
      totalHpLostOnWin += hpLost;
    }
  }

  const winRate = wins / samples;
  return {
    winRate,
    expectedHpLoss: totalHpLost / samples,
    expectedRounds: totalRounds / samples,
    expectedHpLossOnWin: wins > 0 ? totalHpLostOnWin / wins : 0,
    deathRate: 1 - winRate,
  };
}

// ─── Monte Carlo: Flee ──────────────────────────────────────────────────────

/**
 * Simulate repeated flee attempts. On each failed attempt the beast gets a
 * free attack. If the adventurer dies before escaping, the sample is a death.
 *
 * Flee probability:
 *   - If dex >= level: 100% (instant success)
 *   - Otherwise: P = (255 * dex / level) / 256
 */
export function simulateFlee(
  adventurer: Adventurer,
  beast: Beast,
  level: number,
  samples: number = 5000,
): FleeSimResult {
  const dex = adventurer.stats.dexterity;

  // Guaranteed flee -- no simulation needed
  if (dex >= level) {
    return {
      expectedAttempts: 1,
      expectedHpLoss: 0,
      fleeDeathRate: 0,
    };
  }

  const fleeChance = level > 0 ? (255 * dex / level) / 256 : 1;
  const beastTable = buildBeastDamageTable(adventurer, beast, level);
  const startHp = adventurer.health;

  let totalAttempts = 0;
  let totalHpLost = 0;
  let deaths = 0;

  for (let i = 0; i < samples; i++) {
    let hp = startHp;
    let attempts = 0;
    let escaped = false;

    while (hp > 0) {
      attempts++;

      // Roll flee
      if (Math.random() < fleeChance) {
        escaped = true;
        break;
      }

      // Flee failed -- beast attacks
      const beastDmg = rollBeastDamage(beastTable);
      hp -= beastDmg;
    }

    totalAttempts += attempts;
    totalHpLost += startHp - Math.max(hp, 0);

    if (!escaped) {
      deaths++;
    }
  }

  return {
    expectedAttempts: totalAttempts / samples,
    expectedHpLoss: totalHpLost / samples,
    fleeDeathRate: deaths / samples,
  };
}

// ─── Expected Value Computation ─────────────────────────────────────────────

/** Very high penalty to discourage actions that risk death. */
const DEATH_PENALTY = 1000;

/** Approximate value of 1 gold relative to 1 XP. */
const GOLD_VALUE = 0.5;

/**
 * Estimate XP reward for killing a beast, using the contract formula:
 *   max(4, floor((tierMult * beastLevel / 2) * (100 - min(advLevel*2, 95)) / 100))
 */
function estimateKillXp(beastTier: number, beastLevel: number, adventurerLevel: number): number {
  const tierMult = 6 - beastTier;
  const decayPct = Math.min(adventurerLevel * 2, MAX_XP_DECAY);
  const base = Math.floor((tierMult * beastLevel) / XP_REWARD_DIVISOR);
  const decayed = Math.floor((base * (100 - decayPct)) / 100);
  return Math.max(MINIMUM_XP_REWARD, decayed);
}

/**
 * Estimate gold reward for killing a beast.
 *   gold = max(1, floor(beastLevel * (6 - tier) / 2))
 */
function estimateKillGold(beastTier: number, beastLevel: number): number {
  return Math.max(1, Math.floor(beastLevel * (6 - beastTier) / 2));
}

/**
 * Combine combat and flee simulations into an expected-value comparison.
 *
 * attackEV = winRate * (killXP + killGold * goldValue)
 *          - deathRate * deathPenalty
 *          - expectedHpLoss * potionCost
 *
 * fleeEV   = (1 - fleeDeathRate) * FLEE_XP_REWARD
 *          - fleeDeathRate * deathPenalty
 *          - fleeHpLoss * potionCost
 *
 * potionCost = max(1, level - charisma * 2) / POTION_HEAL_AMOUNT
 *   (the gold cost to restore 1 HP)
 */
export function computeCombatEV(
  adventurer: Adventurer,
  beast: Beast,
  bag: Bag,
  level: number,
): CombatEV {
  const tier = beast.tier ?? getBeastTier(beast.id);

  // Run simulations
  const combatResult = simulateCombat(adventurer, beast);
  const fleeResult = simulateFlee(adventurer, beast, level);

  // Potion cost per HP point
  const potionGoldCost = Math.max(1, level - adventurer.stats.charisma * 2);
  const costPerHp = potionGoldCost / POTION_HEAL_AMOUNT;

  // Attack EV
  const killXp = estimateKillXp(tier, beast.level, level);
  const killGold = estimateKillGold(tier, beast.level);
  const attackReward = killXp + killGold * GOLD_VALUE;
  const attackEV =
    combatResult.winRate * attackReward
    - combatResult.deathRate * DEATH_PENALTY
    - combatResult.expectedHpLoss * costPerHp;

  // Flee EV
  const fleeEV =
    (1 - fleeResult.fleeDeathRate) * FLEE_XP_REWARD
    - fleeResult.fleeDeathRate * DEATH_PENALTY
    - fleeResult.expectedHpLoss * costPerHp;

  const recommendation: "attack" | "flee" = attackEV >= fleeEV ? "attack" : "flee";
  const confidence = Math.abs(attackEV - fleeEV);

  return {
    attackEV,
    fleeEV,
    recommendation,
    confidence,
  };
}
