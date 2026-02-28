import {
  BEAST_MIN_DAMAGE,
  MIN_DAMAGE,
  MINIMUM_DAMAGE_FROM_OBSTACLES,
  JEWELRY_BONUS_CRITICAL_HIT_PERCENT,
  NECKLACE_ARMOR_BONUS,
  BASE_DAMAGE_REDUCTION_PCT,
} from "../constants/game.js";
import type { Adventurer, Beast, DamageResult, Equipment, Item } from "../types.js";
import { getBeastArmorType, getBeastAttackType, getBeastTier } from "./beast-utils.js";
import { ItemType, ItemUtils, neckMatchesArmor } from "./item-utils.js";
import { calculateLevel } from "./math.js";

/**
 * Calculate elemental-adjusted damage based on weapon type vs armor type
 */
export function elementalAdjustedDamage(baseAttack: number, weaponType: string, armorType: string): number {
  const elemental = Math.floor(baseAttack / 2);

  // Strong matchups: +50%
  if (
    (weaponType === ItemType.Magic && armorType === "Metal") ||
    (weaponType === ItemType.Blade && armorType === "Cloth") ||
    (weaponType === ItemType.Bludgeon && armorType === "Hide")
  ) {
    return baseAttack + elemental;
  }

  // Weak matchups: -50%
  if (
    (weaponType === ItemType.Magic && armorType === "Hide") ||
    (weaponType === ItemType.Blade && armorType === "Metal") ||
    (weaponType === ItemType.Bludgeon && armorType === "Cloth")
  ) {
    return baseAttack - elemental;
  }

  return baseAttack;
}

/**
 * Calculate the damage an adventurer deals to a beast.
 * Crit chance uses luck stat (contract formula: (luck * 256) > (100 * rnd) where rnd is 0-255).
 */
export function calculateAttackDamage(weapon: Item, adventurer: Adventurer, beast: Beast | null, ring?: Item): DamageResult {
  if (!weapon || weapon.id === 0) return { baseDamage: MIN_DAMAGE, criticalDamage: MIN_DAMAGE };

  const weaponLevel = calculateLevel(weapon.xp);
  const weaponTier = ItemUtils.getItemTier(weapon.id);
  const baseAttack = weaponLevel * (6 - weaponTier);

  if (!beast) {
    const strBonus = Math.floor(baseAttack * (adventurer.stats.strength / 10));
    return {
      baseDamage: baseAttack + strBonus,
      criticalDamage: baseAttack * 2 + strBonus,
    };
  }

  const beastArmor = getBeastArmorType(beast.id);
  const baseArmor = beast.level * (6 - (beast.tier || 1));
  const weaponType = ItemUtils.getItemType(weapon.id);
  const elemDmg = elementalAdjustedDamage(baseAttack, weaponType, beastArmor);

  // Strength bonus
  let strengthBonus = 0;
  if (adventurer.stats.strength > 0) {
    strengthBonus = Math.floor((elemDmg * adventurer.stats.strength * 10) / 100);
  }

  const baseDamage = Math.max(MIN_DAMAGE, elemDmg + strengthBonus - baseArmor);
  let critBonus = elemDmg; // Critical hit doubles elemental damage

  // Titanium Ring (ID 7): +3% crit bonus per ring level
  if (ring && ring.id === 7) {
    const ringLevel = calculateLevel(ring.xp);
    critBonus += Math.floor((critBonus * JEWELRY_BONUS_CRITICAL_HIT_PERCENT * ringLevel) / 100);
  }

  const criticalDamage = Math.max(MIN_DAMAGE, elemDmg + strengthBonus + critBonus - baseArmor);

  return { baseDamage, criticalDamage };
}

/**
 * Calculate the damage a beast deals to an adventurer at a specific armor slot
 */
export function calculateBeastDamage(beast: Beast, adventurer: Adventurer, armor: Item, neck?: Item): DamageResult {
  const beastTier = beast.tier || 1;
  const baseAttack = beast.level * (6 - beastTier);

  if (!armor || armor.id === 0) {
    // No armor = 1.5x damage
    const dmg = Math.floor(baseAttack * 1.5);
    return {
      baseDamage: Math.max(BEAST_MIN_DAMAGE, dmg),
      criticalDamage: Math.max(BEAST_MIN_DAMAGE, dmg * 2),
    };
  }

  const armorLevel = calculateLevel(armor.xp);
  const armorTier = ItemUtils.getItemTier(armor.id);
  const armorValue = armorLevel * (6 - armorTier);
  const beastAttackType = getBeastAttackType(beast.id);
  const armorType = ItemUtils.getItemType(armor.id);
  const elemDmg = elementalAdjustedDamage(baseAttack, beastAttackType, armorType);

  let baseDamage = elemDmg - armorValue;
  let critDamage = elemDmg + elemDmg - armorValue;

  // Necklace damage reduction: if neck matches armor material
  if (neck && neck.id > 0 && neckMatchesArmor(neck.id, armorType)) {
    const neckLevel = calculateLevel(neck.xp);
    const reduction = Math.floor((armorValue * neckLevel * NECKLACE_ARMOR_BONUS) / 100);
    baseDamage -= reduction;
    critDamage -= reduction;
  }

  return {
    baseDamage: Math.max(BEAST_MIN_DAMAGE, baseDamage),
    criticalDamage: Math.max(BEAST_MIN_DAMAGE, critDamage),
  };
}

/**
 * Calculate average expected beast damage across all 5 armor slots (20% chance each).
 * Uses luck-based crit probability for weighted expected damage.
 */
export function calculateAverageBeastDamage(
  beast: Beast,
  adventurer: Adventurer,
  adventurerLevel?: number
): { expected: number; max: number } {
  const slots: (keyof Equipment)[] = ["chest", "head", "waist", "foot", "hand"];
  const neck = adventurer.equipment.neck;
  let totalExpected = 0;
  let maxDmg = 0;

  // Beast crit chance = adventurer_level% (capped at 100%)
  const level = adventurerLevel ?? 1;
  const beastCritChance = Math.min(level / 100, 1.0);

  for (const slot of slots) {
    const armor = adventurer.equipment[slot];
    const { baseDamage, criticalDamage } = calculateBeastDamage(beast, adventurer, armor, neck);
    // Weighted expected damage accounting for crit probability
    const slotExpected = baseDamage * (1 - beastCritChance) + criticalDamage * beastCritChance;
    totalExpected += slotExpected;
    maxDmg = Math.max(maxDmg, criticalDamage);
  }

  return {
    expected: totalExpected / 5,
    max: maxDmg,
  };
}

/**
 * Calculate obstacle damage against adventurer's armor.
 * Obstacles use the same combat system as beasts with elemental damage.
 */
export function calculateObstacleDamage(
  obstacleId: number,
  obstacleLevel: number,
  armor: Item,
  neck?: Item
): number {
  const obstacleTier = getBeastTier(obstacleId); // Same tier lookup as beasts
  const baseAttack = obstacleLevel * (6 - obstacleTier);

  if (!armor || armor.id === 0) {
    const dmg = Math.floor(baseAttack * 1.5);
    return Math.max(MINIMUM_DAMAGE_FROM_OBSTACLES, Math.floor(dmg * BASE_DAMAGE_REDUCTION_PCT / 100));
  }

  const armorLevel = calculateLevel(armor.xp);
  const armorTier = ItemUtils.getItemTier(armor.id);
  const armorValue = armorLevel * (6 - armorTier);
  const obstacleAttackType = getBeastAttackType(obstacleId);
  const armorType = ItemUtils.getItemType(armor.id);
  const elemDmg = elementalAdjustedDamage(baseAttack, obstacleAttackType, armorType);

  let damage = elemDmg - armorValue;

  // Necklace reduction
  if (neck && neck.id > 0 && neckMatchesArmor(neck.id, armorType)) {
    const neckLevel = calculateLevel(neck.xp);
    const reduction = Math.floor((armorValue * neckLevel * NECKLACE_ARMOR_BONUS) / 100);
    damage -= reduction;
  }

  // Apply base damage reduction (25%)
  damage = Math.floor(damage * BASE_DAMAGE_REDUCTION_PCT / 100);
  return Math.max(MINIMUM_DAMAGE_FROM_OBSTACLES, damage);
}
