import { STARTER_WEAPONS } from "../constants/game.js";
import { log } from "../utils/logger.js";
import { ItemUtils } from "../utils/item-utils.js";

/**
 * Select the best starting weapon.
 * Starter weapons: Wand(12/Magic), Book(16/Magic), ShortSword(46/Blade), Club(76/Bludgeon)
 *
 * We want a Blade weapon (ShortSword) as it's the most generally useful:
 * - Strong vs Cloth (Magic beasts) which are common early
 * - Decent overall
 */
export function selectStarterWeapon(): number {
  // ShortSword (46) - Blade type, good general choice
  const preferred = 46;
  log.info(`Selected starter weapon: ${ItemUtils.getItemName(preferred)} (ID: ${preferred})`);
  return preferred;
}
