import type { CallBuilders } from "../chain/calls.js";
import type { Adventurer, Bag, Beast, BotDecision, GamePhase, GameState } from "../types.js";
import { decideCombat } from "./combat.js";
import { allocateStats } from "./stats.js";
import { decideMarketPurchases } from "./market.js";
import { suggestGearSwap } from "./gear.js";
import { maxHealth } from "../utils/math.js";
import { getBeastTier } from "../utils/beast-utils.js";
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
  // Always check for the best weapon matchup — gear.ts effectiveDamageScore
  // ensures we only swap when meaningfully better (not for marginal gains).
  if (!gearSwapDone && bag.items.length > 0) {
    gearSwapDone = true;

    const gearResult = suggestGearSwap(adventurer, bag, beast);

    if (gearResult.hasSwaps) {
      // Estimate whether we can absorb the beast counter-attack from equipping.
      // Beast damage = level * (6 - tier). Crits double it, elemental advantage = 1.5x.
      // Use conservative estimate: base damage * 2 (assume crit) * 1.5 (assume advantage).
      // Game #207649 died at L7 from a gear swap because old estimate (level*2=14) was
      // absurdly low — actual hit was 100+ damage.
      const beastTier = beast.tier || getBeastTier(beast.id);
      const beastBaseAttack = beast.level * (6 - beastTier);
      const roughBeastDmg = Math.max(10, Math.ceil(beastBaseAttack * 2 * 1.5));
      const hpAfterCounterAttack = adventurer.health - roughBeastDmg;
      const mHealth = maxHealth(adventurer.stats.vitality);
      const hpThreshold = mHealth * 0.3;

      if (hpAfterCounterAttack > hpThreshold) {
        const itemIds = gearResult.swaps.equipItemIds;
        log.combat(
          `Swapping gear for beast matchup: equipping [${itemIds.join(", ")}] ` +
          `- ${gearResult.swaps.reason}`
        );
        // Equipping during battle triggers a beast counter-attack which needs VRF
        const vrfCall = calls.requestRandomForBattle(gameId, adventurer.xp, adventurer.action_count);
        return {
          action: `equip([${itemIds.join(", ")}])`,
          reason: `Gear swap for beast matchup: ${gearResult.swaps.reason} ` +
            `(HP ${adventurer.health}/${mHealth})`,
          calls: [vrfCall, calls.equip(gameId, itemIds)],
        };
      } else {
        log.combat(
          `Skipping gear swap - HP too low to absorb counter-attack ` +
          `(HP: ${adventurer.health}, est. beast dmg: ${roughBeastDmg}, threshold: ${hpThreshold.toFixed(0)})`
        );
      }
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
 * Decide explore action — always single-step (till_beast=false).
 *
 * till_beast=true chains multiple exploration steps in one TX with zero
 * chance to heal between hits. Game 206426 died 130→0 HP in one TX.
 * Single-step exploring lets the main loop buy potions between each step.
 * The ~2s extra per step is negligible compared to the safety benefit.
 * NEVER use till_beast=true — finding gold between steps lets us buy potions.
 */
function decideExploreAction(
  gameId: number,
  adventurer: Adventurer,
  calls: CallBuilders
): BotDecision {
  const vrfCall = calls.requestRandomForExplore(gameId, adventurer.xp);
  const mHealth = maxHealth(adventurer.stats.vitality);

  const tillBeast = false;
  const reason = `Exploring single step (HP: ${adventurer.health}/${mHealth}) — heal between encounters`;

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
