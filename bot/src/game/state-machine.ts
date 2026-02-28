import type { Adventurer, GamePhase, GameState } from "../types.js";
import { calculateLevel } from "../utils/math.js";
import { log } from "../utils/logger.js";

/**
 * Determine the current game phase from adventurer state.
 *
 * State machine (strict ordering):
 * 1. Dead → health = 0
 * 2. In battle → beast_health > 0
 *    - Starter beast: level 1 and xp < 4
 * 3. Stat upgrade → stat_upgrades_available > 0 (must do before shopping/exploring)
 * 4. Shopping → after stats allocated, market available
 * 5. Exploring → no beast, no upgrades pending
 */
export function detectPhase(state: GameState): GamePhase {
  const { adventurer, beast, market } = state;

  // Dead
  if (adventurer.health === 0) {
    return "dead";
  }

  // In battle
  if (adventurer.beast_health > 0) {
    const level = calculateLevel(adventurer.xp);
    if (level === 1 && adventurer.xp < 4) {
      return "starter_beast";
    }
    return "in_battle";
  }

  // Stat upgrades pending (must be done before shopping or exploring)
  if (adventurer.stat_upgrades_available > 0) {
    return "stat_upgrade";
  }

  // Shopping phase: market items available and we haven't explored yet
  // We enter shopping after stat upgrades, before exploring
  if (market.length > 0) {
    return "shopping";
  }

  // Default: explore
  return "exploring";
}

/**
 * Log a summary of the current adventurer state
 */
export function logAdventurerState(adventurer: Adventurer) {
  const level = calculateLevel(adventurer.xp);
  log.state(
    `Adventurer: L${level} HP:${adventurer.health} XP:${adventurer.xp} Gold:${adventurer.gold} ` +
    `Beast HP:${adventurer.beast_health} Upgrades:${adventurer.stat_upgrades_available}`
  );
  log.state(
    `Stats: STR:${adventurer.stats.strength} DEX:${adventurer.stats.dexterity} VIT:${adventurer.stats.vitality} ` +
    `INT:${adventurer.stats.intelligence} WIS:${adventurer.stats.wisdom} CHA:${adventurer.stats.charisma} LCK:${adventurer.stats.luck}`
  );
}
