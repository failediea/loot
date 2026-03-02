import type { Adventurer, Beast, CombatAction } from "../types.js";
import { calculateLevel } from "../utils/math.js";
import { MINIMUM_XP_REWARD, XP_REWARD_DIVISOR, MAX_XP_DECAY, POTION_HEAL_AMOUNT } from "../constants/game.js";
import { getBeastTier } from "../utils/beast-utils.js";
import { log } from "../utils/logger.js";
import { simulateCombat, simulateFlee } from "./combat-sim.js";
import { dashboard } from "../dashboard/events.js";

interface CombatDecision {
  action: CombatAction;
  toTheDeath: boolean;
  reason: string;
}

/**
 * Check if fighting a beast is profitable (gold reward heals more HP than expected loss).
 *
 * Returns net HP cost: positive = unprofitable (lose more HP than you can heal back),
 * negative = profitable (gold reward exceeds HP cost).
 */
function combatNetHpCost(
  expectedHpLossOnWin: number,
  beastLevel: number,
  beastTier: number,
  charisma: number,
  adventurerLevel: number,
): number {
  const potionCost = Math.max(1, adventurerLevel - charisma * 2);
  const hpPerGold = POTION_HEAL_AMOUNT / potionCost;
  const killGold = Math.max(1, Math.floor(beastLevel * (6 - beastTier) / 2));
  const healableHp = killGold * hpPerGold;
  return expectedHpLossOnWin - healableHp;
}

/**
 * Flee success probability.
 * If dex >= level: 100% (guaranteed)
 * Otherwise: P = (255 * dex / level) / 256
 */
function fleeChance(dex: number, level: number): number {
  if (dex >= level) return 1.0;
  if (level === 0) return 1.0;
  return Math.min(1, (255 * dex / level) / 256);
}

/**
 * Estimate XP reward for killing a beast (contract formula).
 */
function estimateKillXpReward(beastTier: number, beastLevel: number, adventurerLevel: number): number {
  const tierMult = 6 - beastTier;
  const decayPct = Math.min(adventurerLevel * 2, MAX_XP_DECAY);
  const base = Math.floor((tierMult * beastLevel) / XP_REWARD_DIVISOR);
  const decayed = Math.floor((base * (100 - decayPct)) / 100);
  return Math.max(MINIMUM_XP_REWARD, decayed);
}

/**
 * Decide whether to attack or flee, and whether to go to_the_death.
 *
 * Uses Monte Carlo combat simulation for probability-based decisions
 * rather than heuristic "rounds to kill" / "survival margin" estimates.
 *
 * Key rules:
 * - NEVER flee(to_the_death=true) — same seed = infinite loop until death
 * - Starter beast (level 1, xp < 4): always attack(to_the_death=true)
 *
 * Decision priority:
 * 1. Starter beast -> attack TTD
 * 2. Run combat + flee simulation
 * 3. Log special name matching awareness
 * 4. 1-round kill (winRate > 0.99, ~1 round) -> attack TTD
 * 5. High win rate (>= 0.90) -> attack, TTD if HP loss is low
 * 6. Good win rate (>= 0.70) -> attack (not TTD)
 * 7. Marginal win rate (>= 0.50) -> flee if safe, else attack cautiously
 * 8. Low win rate (< 0.50) -> flee if possible, else last resort attack
 *
 * to_the_death logic:
 * - TTD = true only when winRate >= 0.90 AND expectedHpLossOnWin < HP * 0.4
 * - Otherwise TTD = false (let the bot re-evaluate each round)
 */
export function decideCombat(adventurer: Adventurer, beast: Beast): CombatDecision {
  const level = calculateLevel(adventurer.xp);
  const dex = adventurer.stats.dexterity;

  // ── 1. Starter beast — 3 HP, guaranteed 1-hit kill ──
  if (level === 1 && adventurer.xp < 4) {
    log.combat("Starter beast - attacking to_the_death");
    return { action: "attack", toTheDeath: true, reason: "Starter beast (3 HP, easy kill)" };
  }

  // ── 2. Run simulations ──
  const combatSim = simulateCombat(adventurer, beast);
  const fleeSim = simulateFlee(adventurer, beast, level);

  const fleeProb = fleeChance(dex, level);
  const tier = beast.tier || getBeastTier(beast.id);
  const killXp = estimateKillXpReward(tier, beast.level, level);
  const killGold = Math.max(1, Math.floor(beast.level * (6 - tier) / 2));

  // ── 3. Check for special name matching awareness ──
  // Beast specials.special2 > 0 means it has a name prefix active (L19+).
  // If the weapon has a matching prefix, the combat sim already accounts for
  // the 8x damage multiplier through the damage calc. We log it for visibility.
  if (beast.specials.special2 > 0) {
    log.combat(
      `Beast has specials active (prefix=${beast.specials.special2}, suffix=${beast.specials.special3}) — ` +
      `name matching may apply (8x prefix / 2x suffix damage bonus)`
    );
  }

  // ── Profitability check ──
  const netHpCost = combatNetHpCost(
    combatSim.expectedHpLossOnWin, beast.level, tier,
    adventurer.stats.charisma, level,
  );
  const isProfitable = netHpCost <= 0;

  // Log simulation results
  log.combat(
    `Combat sim: WinRate=${(combatSim.winRate * 100).toFixed(0)}% ` +
    `AvgHpLoss=${combatSim.expectedHpLoss.toFixed(0)} ` +
    `AvgRounds=${combatSim.expectedRounds.toFixed(1)} ` +
    `HpLossOnWin=${combatSim.expectedHpLossOnWin.toFixed(0)} | ` +
    `Flee: ${(fleeProb * 100).toFixed(0)}% chance, ` +
    `avgHpLoss=${fleeSim.expectedHpLoss.toFixed(0)}, ` +
    `deathRate=${(fleeSim.fleeDeathRate * 100).toFixed(0)}% | ` +
    `Profit: ${isProfitable ? "YES" : "NO"} (netHpCost=${netHpCost.toFixed(0)}, gold=${killGold})`
  );

  dashboard.emitCombatSim({
    beast: {
      id: beast.id,
      name: beast.name || `Beast #${beast.id}`,
      type: beast.type || "Unknown",
      tier,
      level: beast.level,
      health: beast.health,
      specials: beast.specials,
    },
    winRate: combatSim.winRate,
    expectedHpLoss: combatSim.expectedHpLoss,
    expectedHpLossOnWin: combatSim.expectedHpLossOnWin,
    expectedRounds: combatSim.expectedRounds,
    deathRate: combatSim.deathRate,
    fleeChance: fleeProb,
    fleeDeathRate: fleeSim.fleeDeathRate,
    fleeExpectedHpLoss: fleeSim.expectedHpLoss,
    isProfitable,
    netHpCost,
    killGold,
    killXp,
  });

  // ── 4. Guaranteed kill (winRate > 0.99) — always TTD ──
  // At 99%+ win rate, re-evaluating each round adds nothing (same decision every time).
  // TTD saves TXs: a 12-round fight = 12 TXs (~5 min) vs 1 TX (~30s).
  if (combatSim.winRate > 0.99) {
    const reason = `Guaranteed kill ${(combatSim.winRate * 100).toFixed(0)}% (${combatSim.expectedRounds.toFixed(1)} rounds, +${killXp}xp +${killGold}g)`;
    log.combat(`Decision: ATTACK TTD (${reason})`);
    return { action: "attack", toTheDeath: true, reason };
  }

  // ── 5. High win rate (>= 0.90) ──
  if (combatSim.winRate >= 0.90) {
    if (isProfitable) {
      // Profitable + high win rate → attack, TTD if HP loss is modest
      const ttd = combatSim.expectedHpLossOnWin < adventurer.health * 0.4;
      const reason =
        `High win rate ${(combatSim.winRate * 100).toFixed(0)}%, profitable ` +
        `(hpLoss=${combatSim.expectedHpLossOnWin.toFixed(0)}, +${killGold}g heals ${(-netHpCost).toFixed(0)} net) ` +
        `(+${killXp}xp)${ttd ? " TTD" : ""}`;
      log.combat(`Decision: ATTACK${ttd ? " TTD" : ""} (${reason})`);
      return { action: "attack", toTheDeath: ttd, reason };
    }
    // Unprofitable but high win rate — attack without TTD if HP is healthy, flee if low
    if (adventurer.health > 60) {
      const reason =
        `High win ${(combatSim.winRate * 100).toFixed(0)}% but unprofitable ` +
        `(netHpCost=${netHpCost.toFixed(0)}), attacking cautiously (HP=${adventurer.health})`;
      log.combat(`Decision: ATTACK no TTD (${reason})`);
      return { action: "attack", toTheDeath: false, reason };
    }
    // Unprofitable + low HP → flee to preserve HP if safe
    if (fleeProb > 0 && fleeSim.fleeDeathRate < 0.30) {
      const reason =
        `High win ${(combatSim.winRate * 100).toFixed(0)}% but unprofitable ` +
        `(netHpCost=${netHpCost.toFixed(0)}), HP low (${adventurer.health}), fleeing to conserve`;
      log.combat(`Decision: FLEE unprofitable (${reason})`);
      return { action: "flee", toTheDeath: false, reason };
    }
    // Can't flee safely — fight anyway
    const reason =
      `High win ${(combatSim.winRate * 100).toFixed(0)}% but unprofitable, ` +
      `HP low (${adventurer.health}) but flee unsafe (${(fleeSim.fleeDeathRate * 100).toFixed(0)}% death), attacking`;
    log.combat(`Decision: ATTACK forced (${reason})`);
    return { action: "attack", toTheDeath: false, reason };
  }

  // ── 6. Good win rate (>= 0.70) ──
  if (combatSim.winRate >= 0.70) {
    if (isProfitable) {
      const reason =
        `Good win rate ${(combatSim.winRate * 100).toFixed(0)}%, profitable ` +
        `(+${killGold}g, netHp=${netHpCost.toFixed(0)}) (+${killXp}xp)`;
      log.combat(`Decision: ATTACK (${reason})`);
      return { action: "attack", toTheDeath: false, reason };
    }
    // Unprofitable at 70-89% win rate — flee if safe
    if (fleeProb > 0 && fleeSim.fleeDeathRate < 0.30) {
      const reason =
        `Good win ${(combatSim.winRate * 100).toFixed(0)}% but unprofitable ` +
        `(netHpCost=${netHpCost.toFixed(0)}), fleeing to conserve HP`;
      log.combat(`Decision: FLEE unprofitable (${reason})`);
      return { action: "flee", toTheDeath: false, reason };
    }
    // Can't flee safely — fight despite being unprofitable
    const reason =
      `Good win ${(combatSim.winRate * 100).toFixed(0)}% but unprofitable, ` +
      `flee unsafe (${(fleeSim.fleeDeathRate * 100).toFixed(0)}% death), attacking anyway`;
    log.combat(`Decision: ATTACK forced (${reason})`);
    return { action: "attack", toTheDeath: false, reason };
  }

  // ── 7. Marginal win rate (>= 0.50) ──
  if (combatSim.winRate >= 0.50) {
    // Compare flee death rate vs fight death rate — flee if safer
    if (fleeProb > 0 && fleeSim.fleeDeathRate < combatSim.deathRate) {
      const reason =
        `Marginal ${(combatSim.winRate * 100).toFixed(0)}% win, ` +
        `fleeing (flee death ${(fleeSim.fleeDeathRate * 100).toFixed(1)}% < fight death ${(combatSim.deathRate * 100).toFixed(1)}%)`;
      log.combat(`Decision: FLEE (${reason})`);
      return { action: "flee", toTheDeath: false, reason };
    }
    // Cannot flee safely or fleeing is more dangerous — attack cautiously
    const reason =
      `Marginal ${(combatSim.winRate * 100).toFixed(0)}% win, ` +
      `fight safer than flee (fight death ${(combatSim.deathRate * 100).toFixed(1)}% vs flee death ${(fleeSim.fleeDeathRate * 100).toFixed(1)}%)`;
    log.combat(`Decision: ATTACK cautious (${reason})`);
    return { action: "attack", toTheDeath: false, reason };
  }

  // ── 8. Low win rate (< 0.50) ──
  // CRITICAL: Compare flee death rate vs fight death rate.
  // If fleeing is more dangerous than fighting, fight instead.
  // Example: 20% win rate (80% death) vs 70% flee death rate → fight is safer.
  if (fleeProb > 0 && fleeSim.fleeDeathRate < combatSim.deathRate) {
    const reason =
      `Low win ${(combatSim.winRate * 100).toFixed(0)}%, ` +
      `fleeing (${(fleeProb * 100).toFixed(0)}% chance, ` +
      `flee death ${(fleeSim.fleeDeathRate * 100).toFixed(1)}% < fight death ${(combatSim.deathRate * 100).toFixed(1)}%)`;
    log.combat(`Decision: FLEE (${reason})`);
    return { action: "flee", toTheDeath: false, reason };
  }

  // Flee would be more dangerous than fighting, or no flee chance
  if (combatSim.winRate > 0) {
    const reason =
      `Low win ${(combatSim.winRate * 100).toFixed(0)}%, ` +
      `but fight is safer than flee ` +
      `(fight death ${(combatSim.deathRate * 100).toFixed(0)}% vs flee death ${(fleeSim.fleeDeathRate * 100).toFixed(0)}%)`;
    log.combat(`Decision: ATTACK (${reason})`);
    return { action: "attack", toTheDeath: false, reason };
  }

  // No win chance and no safe flee — attack as absolute last resort
  const reason =
    `No win chance (${(combatSim.winRate * 100).toFixed(0)}%), ` +
    `no safe flee, attacking as last resort`;
  log.combat(`Decision: ATTACK last resort (${reason})`);
  return { action: "attack", toTheDeath: false, reason };
}
