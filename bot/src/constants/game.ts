export const STARTING_HEALTH = 100;
export const MAX_HEALTH = 1023;
export const MAX_STAT_VALUE = 31;
export const MAX_BAG_SIZE = 15;
export const MIN_DAMAGE = 4;
export const BEAST_MIN_DAMAGE = 2;
export const TIER_PRICE = 4;
export const NUMBER_OF_ITEMS_PER_LEVEL = 21;
export const POTION_HEAL_AMOUNT = 10;
export const STARTER_BEAST_HEALTH = 3;
export const MINIMUM_XP_REWARD = 4;

// Missing constants from contracts
export const STARTING_GOLD = 40;
export const MAX_GOLD = 511;
export const XP_REWARD_DIVISOR = 2;
export const MAX_XP_DECAY = 95; // adventurer_level * 2, capped at 95%
export const ITEM_XP_MULTIPLIER_BEASTS = 2;
export const ITEM_XP_MULTIPLIER_OBSTACLES = 1;
export const MINIMUM_DAMAGE_FROM_OBSTACLES = 4;
export const FLEE_XP_REWARD = 1;
export const BEAST_MAX_HEALTH = 1023;
export const SILVER_RING_LUCK_BONUS_PER_GREATNESS = 1;
export const JEWELRY_BONUS_BEAST_GOLD_PERCENT = 3;
export const JEWELRY_BONUS_CRITICAL_HIT_PERCENT = 3;
export const JEWELRY_BONUS_NAME_MATCH_PERCENT = 3;
export const NECKLACE_ARMOR_BONUS = 3;
export const BASE_DAMAGE_REDUCTION_PCT = 75; // 25% reduction = multiply by 75/100

// Starter weapons: Wand(12), Book(16), ShortSword(46), Club(76)
export const STARTER_WEAPONS = [12, 16, 46, 76] as const;
