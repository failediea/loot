import type { CallBuilders } from "../chain/calls.js";
import type { Adventurer, Bag, Beast, BotDecision, GamePhase, GameState } from "../types.js";
import { decideCombat } from "./combat.js";
import { allocateStats } from "./stats.js";
import { decideMarketPurchases } from "./market.js";
import { suggestGearSwap } from "./gear.js";
import { calculateLevel, maxHealth } from "../utils/math.js";
import { simulateCombat } from "./combat-sim.js";
import { log } from "../utils/logger.js";

/**
 * Track whether we already swapped gear for the current beast encounter.
 * Reset when the beast changes (new encounter).
 */
let lastSwapBeastSeed: number | null = null;
let gearSwapDone = false;

/**
 * Top-level strategy dispatcher.
 * Given the current game state and phase, returns the next action to take.
 */
export function decideNextAction(
  gameId: number,
  state: GameState,
  phase: GamePhase,
  calls: CallBuilders
): BotDecision {
  const { adventurer, bag, beast, market } = state;

  switch (phase) {
    case "starter_beast":
    case "in_battle":
      return decideBattleAction(gameId, state, calls);

    case "stat_upgrade":
      return decideStatAction(gameId, adventurer, calls);

    case "shopping":
      return decideShoppingAction(gameId, adventurer, bag, market, calls);

    case "exploring":
      return decideExploreAction(gameId, adventurer, calls);

    default:
      log.warn(`Unexpected phase: ${phase}`);
      return { action: "wait", reason: `Unexpected phase: ${phase}`, calls: [] };
  }
}

/**
 * Decide the battle action, including potential pre-combat gear swaps.
 *
 * Gear swap logic:
 * - Only attempt once per beast encounter (tracked via beast seed).
 * - Only if suggestGearSwap reports a beneficial swap with weapon type advantage.
 * - Only if HP is high enough to absorb a beast counter-attack from equipping.
 * - Equipping during combat triggers a beast counter-attack, so we only do it
 *   when the weapon type advantage outweighs the cost of one hit.
 */
function decideBattleAction(
  gameId: number,
  state: GameState,
  calls: CallBuilders
): BotDecision {
  const { adventurer, bag, beast } = state;

  // Detect new beast encounter and reset swap tracking
  if (beast.seed !== lastSwapBeastSeed) {
    lastSwapBeastSeed = beast.seed;
    gearSwapDone = false;
  }

  // Attempt gear swap on first round of a new beast encounter.
  // Only swap if current win rate is low (< 70%) — if we're already winning,
  // don't waste HP on a counter-attack from equipping.
  if (!gearSwapDone && bag.items.length > 0) {
    gearSwapDone = true;

    // Check current win rate before considering a swap
    const preSwapSim = simulateCombat(adventurer, beast);

    if (preSwapSim.winRate < 0.70) {
      const gearResult = suggestGearSwap(adventurer, bag, beast);

      if (gearResult.hasSwaps) {
        // Estimate whether we can absorb the beast counter-attack from equipping.
        const roughBeastDmg = Math.max(5, beast.level * 2);
        const hpAfterCounterAttack = adventurer.health - roughBeastDmg;
        const mHealth = maxHealth(adventurer.stats.vitality);
        const hpThreshold = mHealth * 0.3;

        if (hpAfterCounterAttack > hpThreshold) {
          const itemIds = gearResult.swaps.equipItemIds;
          log.combat(
            `Swapping gear for beast matchup: equipping [${itemIds.join(", ")}] ` +
            `(win rate ${(preSwapSim.winRate * 100).toFixed(0)}% too low, swap may flip it) - ${gearResult.swaps.reason}`
          );
          // Equipping during battle triggers a beast counter-attack which needs VRF
          const vrfCall = calls.requestRandomForBattle(gameId, adventurer.xp, adventurer.action_count);
          return {
            action: `equip([${itemIds.join(", ")}])`,
            reason: `Gear swap for beast matchup: ${gearResult.swaps.reason} ` +
              `(win rate ${(preSwapSim.winRate * 100).toFixed(0)}%, HP ${adventurer.health}/${mHealth})`,
            calls: [vrfCall, calls.equip(gameId, itemIds)],
          };
        } else {
          log.combat(
            `Skipping gear swap - HP too low to absorb counter-attack ` +
            `(HP: ${adventurer.health}, est. beast dmg: ${roughBeastDmg}, threshold: ${hpThreshold.toFixed(0)})`
          );
        }
      }
    } else {
      log.combat(
        `Skipping gear swap - already winning (${(preSwapSim.winRate * 100).toFixed(0)}% win rate)`
      );
    }
  }

  // Normal combat decision
  const decision = decideCombat(adventurer, beast);
  const vrfCall = calls.requestRandomForBattle(gameId, adventurer.xp, adventurer.action_count);

  if (decision.action === "attack") {
    return {
      action: `attack(to_the_death=${decision.toTheDeath})`,
      reason: decision.reason,
      calls: [vrfCall, calls.attack(gameId, decision.toTheDeath)],
    };
  } else {
    return {
      action: `flee(to_the_death=${decision.toTheDeath})`,
      reason: decision.reason,
      calls: [vrfCall, calls.flee(gameId, decision.toTheDeath)],
    };
  }
}

/**
 * Decide explore action with dynamic strategy based on HP, level, and stats.
 *
 * CRITICAL: Stay above 100 HP at all times.
 *
 * till_beast=true chains multiple exploration steps in one TX. This is
 * efficient but dangerous: each step can trigger obstacles (INT-based)
 * and ambushes (WIS-based). Game 206426 died from full HP at L10 with
 * WIS=2 INT=2 — cumulative ambush/obstacle damage over ~5 steps = death.
 *
 * Strategy:
 * - Level <= 3: till_beast=true (low damage, need to progress fast)
 * - HP > 100 AND HP > 70% AND adequate WIS/INT: till_beast=true
 * - Otherwise: till_beast=false (single explore, re-evaluate each step)
 *
 * "Adequate WIS/INT" means both WIS >= level*0.4 AND INT >= level*0.4.
 * At L10 this requires WIS >= 4, INT >= 4 — enough to avoid ~40% of
 * ambushes/obstacles, making chained explores survivable.
 */
function decideExploreAction(
  gameId: number,
  adventurer: Adventurer,
  calls: CallBuilders
): BotDecision {
  const vrfCall = calls.requestRandomForExplore(gameId, adventurer.xp);
  const level = calculateLevel(adventurer.xp);
  const mHealth = maxHealth(adventurer.stats.vitality);
  const hpPercent = adventurer.health / mHealth;
  const MIN_HP_TARGET = 100;
  const wis = adventurer.stats.wisdom;
  const int_ = adventurer.stats.intelligence;

  // Exploration protection check: can we safely chain multiple explores?
  const wisThreshold = Math.ceil(level * 0.4);
  const intThreshold = Math.ceil(level * 0.4);
  const hasExplorationProtection = wis >= wisThreshold && int_ >= intThreshold;

  let tillBeast: boolean;
  let reason: string;

  if (level <= 3) {
    // Early game: rush to progress (obstacles/ambushes are weak)
    tillBeast = true;
    reason = `Early game (level ${level}), exploring till beast for fast progression`;
  } else if (adventurer.health > MIN_HP_TARGET && hpPercent > 0.7 && hasExplorationProtection) {
    // Healthy with adequate WIS/INT protection: safe to chain explores
    tillBeast = true;
    reason = `Healthy (HP: ${adventurer.health}/${mHealth}, ${(hpPercent * 100).toFixed(0)}%), WIS:${wis}≥${wisThreshold} INT:${int_}≥${intThreshold}, exploring till beast`;
  } else if (adventurer.health > MIN_HP_TARGET && hpPercent > 0.7 && !hasExplorationProtection) {
    // Healthy HP but low WIS/INT: single explore to avoid chained damage
    tillBeast = false;
    reason = `HP good (${adventurer.health}/${mHealth}) but WIS:${wis}<${wisThreshold} or INT:${int_}<${intThreshold} — single explore to avoid chained damage`;
  } else if (adventurer.health > MIN_HP_TARGET) {
    // Above 100 HP but below 70% max: cautious single explore
    tillBeast = false;
    reason = `Exploring cautiously (HP: ${adventurer.health}/${mHealth}, ${(hpPercent * 100).toFixed(0)}%, single explore for possible health discovery)`;
  } else {
    // Below 100 HP: very cautious single explore
    tillBeast = false;
    reason = `HP below 100 (HP: ${adventurer.health}/${mHealth}), single explore - health discoveries are critical`;
  }

  log.explore(reason);

  return {
    action: `explore(till_beast=${tillBeast})`,
    reason,
    calls: [vrfCall, calls.explore(gameId, tillBeast)],
  };
}

function decideStatAction(
  gameId: number,
  adventurer: Adventurer,
  calls: CallBuilders
): BotDecision {
  const allocation = allocateStats(adventurer);
  return {
    action: "select_stat_upgrades",
    reason: `Allocating ${adventurer.stat_upgrades_available} stat points`,
    calls: [calls.selectStatUpgrades(gameId, allocation)],
  };
}

function decideShoppingAction(
  gameId: number,
  adventurer: Adventurer,
  bag: Bag,
  marketItemIds: number[],
  calls: CallBuilders
): BotDecision {
  const { potions, items, totalCost } = decideMarketPurchases(adventurer, bag, marketItemIds);

  if (potions === 0 && items.length === 0) {
    log.shop("Nothing worth buying, skipping market");
    return {
      action: "skip_market",
      reason: "Nothing worth buying",
      calls: [],
    };
  }

  return {
    action: `buy_items(potions=${potions}, items=${items.length})`,
    reason: `Spending ${totalCost}g on ${items.length} items and ${potions} potions`,
    calls: [calls.buyItems(gameId, potions, items)],
  };
}
