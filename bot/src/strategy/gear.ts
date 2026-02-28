import type { Adventurer, Bag, Beast, Item } from "../types.js";
import { ItemUtils, ItemType, getArmorMaterialFamily } from "../utils/item-utils.js";
import { getBeastArmorType } from "../utils/beast-utils.js";
import { calculateLevel } from "../utils/math.js";
import { log } from "../utils/logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GearSwap {
  equipItemIds: number[]; // items to equip from bag (auto-unequips current)
  reason: string;
}

export interface GearSwapResult {
  swaps: GearSwap;
  hasSwaps: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Items at or above this greatness are close to suffix unlock -- avoid swapping */
const HIGH_GREATNESS_THRESHOLD = 12;

/** Weapon must be this many tiers better to justify swapping when both have advantage */
const TIER_UPGRADE_THRESHOLD = 2;

// ─── Elemental Matchup Helpers ───────────────────────────────────────────────

/**
 * Returns the weapon type that has elemental advantage against a given armor type.
 *
 *   Magic  beats Metal  (+50%)
 *   Blade  beats Cloth  (+50%)
 *   Bludgeon beats Hide (+50%)
 */
function getStrongWeaponType(armorType: string): ItemType {
  switch (armorType) {
    case "Metal": return ItemType.Magic;
    case "Cloth": return ItemType.Blade;
    case "Hide":  return ItemType.Bludgeon;
    default:      return ItemType.None;
  }
}

/**
 * Returns the weapon type that has elemental disadvantage against a given armor type.
 *
 *   Magic  weak vs Hide  (-50%)
 *   Blade  weak vs Metal (-50%)
 *   Bludgeon weak vs Cloth (-50%)
 */
function getWeakWeaponType(armorType: string): ItemType {
  switch (armorType) {
    case "Hide":  return ItemType.Magic;
    case "Metal": return ItemType.Blade;
    case "Cloth": return ItemType.Bludgeon;
    default:      return ItemType.None;
  }
}

// ─── Weapon Matchup Scoring ──────────────────────────────────────────────────

/**
 * Returns an elemental matchup score for a weapon against a beast's armor type.
 *   +1 = advantage, 0 = neutral, -1 = disadvantage
 */
function weaponMatchupScore(weaponId: number, beastArmorType: string): number {
  const weaponType = ItemUtils.getItemType(weaponId);
  const strong = getStrongWeaponType(beastArmorType);
  const weak = getWeakWeaponType(beastArmorType);
  if (weaponType === strong) return 1;
  if (weaponType === weak) return -1;
  return 0;
}

// ─── Effective Damage ────────────────────────────────────────────────────────

/**
 * Compute a relative effective damage score for a weapon against a beast.
 * Combines tier multiplier (6 - tier) with element multiplier.
 *
 * Examples:
 *   T1 weak:    (6-1) * 0.5 = 2.5
 *   T1 neutral: (6-1) * 1.0 = 5.0
 *   T1 strong:  (6-1) * 1.5 = 7.5
 *   T5 neutral: (6-5) * 1.0 = 1.0
 *   T5 strong:  (6-5) * 1.5 = 1.5
 *
 * This prevents swapping a T1 weak weapon for a T5 neutral — the T1 still
 * does 2.5x more effective damage.
 */
function effectiveDamageScore(tier: number, matchupScore: number): number {
  const tierMult = 6 - tier; // T1=5, T2=4, ..., T5=1
  const elemMult = matchupScore > 0 ? 1.5 : matchupScore < 0 ? 0.5 : 1.0;
  return tierMult * elemMult;
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Suggest optimal gear swaps from bag before engaging a beast.
 *
 * Checks weapon and each armor slot for elemental advantage improvements.
 * Only suggests swaps that meaningfully improve the matchup:
 *   - Flipping from disadvantage/neutral to advantage
 *   - Or upgrading tier significantly when both have advantage
 * Avoids swapping high-greatness items (close to suffix unlock at greatness 15).
 */
export function suggestGearSwap(
  adventurer: Adventurer,
  bag: Bag,
  beast: Beast
): GearSwapResult {
  const beastArmorType = getBeastArmorType(beast.id);
  const equipItemIds: number[] = [];
  const reasons: string[] = [];

  // ── Weapon Swap ──────────────────────────────────────────────────────────

  const currentWeapon = adventurer.equipment.weapon;
  if (currentWeapon.id > 0) {
    const currentScore = weaponMatchupScore(currentWeapon.id, beastArmorType);
    const currentTier = ItemUtils.getItemTier(currentWeapon.id);
    const currentGreatness = calculateLevel(currentWeapon.xp);

    // Only consider swapping if current weapon isn't close to suffix unlock
    if (currentGreatness < HIGH_GREATNESS_THRESHOLD) {
      let bestCandidate: Item | null = null;
      let bestEffective = effectiveDamageScore(currentTier, currentScore);

      for (const bagItem of bag.items) {
        if (!ItemUtils.isWeapon(bagItem.id)) continue;

        const bagScore = weaponMatchupScore(bagItem.id, beastArmorType);
        const bagTier = ItemUtils.getItemTier(bagItem.id);
        const bagGreatness = calculateLevel(bagItem.xp);

        // Skip high-greatness bag weapons too -- they're leveling toward suffix
        if (bagGreatness >= HIGH_GREATNESS_THRESHOLD) continue;

        // Compare effective damage: tier * element multiplier
        // A T1 with disadvantage (5*0.5=2.5) beats T5 neutral (1*1.0=1.0)
        const bagEffective = effectiveDamageScore(bagTier, bagScore);
        if (bagEffective > bestEffective) {
          bestCandidate = bagItem;
          bestEffective = bagEffective;
        }
      }

      if (bestCandidate) {
        equipItemIds.push(bestCandidate.id);
        const fromName = ItemUtils.getItemName(currentWeapon.id);
        const toName = ItemUtils.getItemName(bestCandidate.id);
        const fromType = ItemUtils.getItemType(currentWeapon.id);
        const toType = ItemUtils.getItemType(bestCandidate.id);
        const toTier = ItemUtils.getItemTier(bestCandidate.id);
        reasons.push(
          `Weapon: ${fromName}(${fromType},T${currentTier}) -> ${toName}(${toType},T${toTier}) vs ${beastArmorType} armor`
        );
      }
    }
  }

  // NOTE: Armor swaps removed — counter-attack HP cost outweighs marginal
  // defensive gain, and swapping destroys greatness progress. Armor matchup
  // should be handled in the market, not mid-combat.

  // ── Build Result ─────────────────────────────────────────────────────────

  const hasSwaps = equipItemIds.length > 0;

  if (hasSwaps) {
    log.combat(`Gear swap suggested: ${reasons.join(" | ")}`);
  }

  return {
    swaps: {
      equipItemIds,
      reason: reasons.join("; "),
    },
    hasSwaps,
  };
}

// ─── Bag Cleanup ─────────────────────────────────────────────────────────────

/**
 * Score a bag item for drop priority.
 * Higher score = more valuable = keep.
 * Lower score = less valuable = drop candidate.
 *
 * Scoring factors:
 *   - Tier value:  T1=50, T2=40, T3=30, T4=20, T5=10
 *   - Greatness:   greatness * 3
 *   - Elemental versatility:  items that cover underrepresented types score higher
 */
function scoreBagItem(item: Item, adventurer: Adventurer, bag: Bag): number {
  const tier = ItemUtils.getItemTier(item.id);
  const greatness = calculateLevel(item.xp);
  const slot = ItemUtils.getItemSlot(item.id);

  // Base tier score: lower tier = higher score
  const tierScore = (6 - tier) * 10;

  // Greatness contribution
  const greatnessScore = greatness * 3;

  // Elemental versatility: count how many items of each armor material we have
  // across equipped + bag. Items that provide a unique material type score higher.
  let versatilityScore = 0;
  if (slot !== "Weapon" && slot !== "Ring" && slot !== "Neck" && slot !== "None") {
    const material = getArmorMaterialFamily(item.id);
    if (material !== "None") {
      // Count how many other items share this material (equipped + bag)
      let sameMatCount = 0;
      const armorKeys = ["chest", "head", "waist", "foot", "hand"] as const;
      for (const k of armorKeys) {
        const eq = adventurer.equipment[k];
        if (eq.id > 0 && eq.id !== item.id && getArmorMaterialFamily(eq.id) === material) {
          sameMatCount++;
        }
      }
      for (const bagItem of bag.items) {
        if (bagItem.id !== item.id && getArmorMaterialFamily(bagItem.id) === material) {
          sameMatCount++;
        }
      }
      // Fewer items of same material = more valuable for versatility
      versatilityScore = Math.max(0, 15 - sameMatCount * 3);
    }
  } else if (slot === "Weapon") {
    // Weapons are always versatile -- we may need different types for different beasts
    const weaponType = ItemUtils.getItemType(item.id);
    let sameTypeCount = 0;
    const eqWeapon = adventurer.equipment.weapon;
    if (eqWeapon.id > 0 && eqWeapon.id !== item.id && ItemUtils.getItemType(eqWeapon.id) === weaponType) {
      sameTypeCount++;
    }
    for (const bagItem of bag.items) {
      if (bagItem.id !== item.id && ItemUtils.isWeapon(bagItem.id) && ItemUtils.getItemType(bagItem.id) === weaponType) {
        sameTypeCount++;
      }
    }
    versatilityScore = Math.max(0, 15 - sameTypeCount * 5);
  }

  return tierScore + greatnessScore + versatilityScore;
}

/**
 * Suggest items to drop when the bag is full (15 items).
 *
 * Returns IDs of the lowest-scored items (up to 3).
 * Never suggests dropping jewelry (rings/necklaces are rare and contribute to luck).
 */
export function suggestItemDrops(bag: Bag, adventurer: Adventurer): number[] {
  if (bag.items.length < 15) return [];

  const scored = bag.items
    .filter((item) => {
      // Never drop jewelry
      if (ItemUtils.isNecklace(item.id) || ItemUtils.isRing(item.id)) return false;
      // Never drop items with id 0 (empty slots)
      if (item.id === 0) return false;
      return true;
    })
    .map((item) => ({
      id: item.id,
      score: scoreBagItem(item, adventurer, bag),
      name: ItemUtils.getItemName(item.id),
      tier: ItemUtils.getItemTier(item.id),
    }))
    .sort((a, b) => a.score - b.score);

  const dropCount = Math.min(3, scored.length);
  const drops = scored.slice(0, dropCount);

  if (drops.length > 0) {
    log.info(
      `Bag cleanup: suggesting ${drops.length} drops: ${drops.map((d) => `${d.name}(T${d.tier},score=${d.score})`).join(", ")}`
    );
  }

  return drops.map((d) => d.id);
}
