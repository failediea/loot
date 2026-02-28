import { TIER_PRICE, SILVER_RING_LUCK_BONUS_PER_GREATNESS } from "../constants/game.js";
import { ItemName } from "../constants/items.js";
import type { Adventurer, Bag, Stats } from "../types.js";
import { calculateLevel } from "./math.js";

// ─── Suffix / Specials Constants ─────────────────────────────────────────────

export const SUFFIX_UNLOCK_GREATNESS = 15;
const NUM_ITEMS = 101;

export const ITEM_SUFFIXES: Record<number, string> = {
  1: "of Power", 2: "of Giant", 3: "of Titans", 4: "of Skill", 5: "of Perfection",
  6: "of Brilliance", 7: "of Enlightenment", 8: "of Protection", 9: "of Anger",
  10: "of Rage", 11: "of Fury", 12: "of Vitriol", 13: "of the Fox",
  14: "of Detection", 15: "of Reflection", 16: "of the Twins",
};

const SLOT_LENGTH: Record<string, number> = {
  Weapon: 18, Chest: 15, Head: 15, Waist: 15, Foot: 15, Hand: 15, Neck: 3, Ring: 5,
};

/** Maps item ID → 0-based index within its slot (mirrors client ItemIndex) */
const ITEM_INDEX: Record<number, number> = {
  // Necklaces
  1: 2, 2: 0, 3: 1,
  // Rings
  4: 1, 5: 2, 6: 3, 7: 4, 8: 0,
  // Weapons — Bludgeon
  72: 0, 73: 1, 74: 2, 75: 3, 76: 4,
  // Weapons — Blade
  42: 5, 43: 6, 44: 7, 45: 8, 46: 9,
  // Weapons — Magic
  9: 10, 10: 11, 11: 12, 12: 13, 13: 14, 14: 15, 15: 16, 16: 17,
  // Chest — Cloth
  17: 0, 18: 1, 19: 2, 20: 3, 21: 4,
  // Chest — Hide
  47: 5, 48: 6, 49: 7, 50: 8, 51: 9,
  // Chest — Metal
  77: 10, 78: 11, 79: 12, 80: 13, 81: 14,
  // Head — Metal
  82: 0, 83: 1, 84: 2, 85: 3, 86: 4,
  // Head — Hide
  52: 5, 53: 6, 54: 7, 55: 8, 56: 9,
  // Head — Cloth
  22: 10, 23: 11, 24: 12, 25: 13, 26: 14,
  // Waist — Metal
  87: 0, 88: 1, 89: 2, 90: 3, 91: 4,
  // Waist — Hide
  57: 5, 58: 6, 59: 7, 60: 8, 61: 9,
  // Waist — Cloth
  27: 10, 28: 11, 29: 12, 30: 13, 31: 14,
  // Foot — Metal
  92: 0, 93: 1, 94: 2, 95: 3, 96: 4,
  // Foot — Hide
  62: 5, 63: 6, 64: 7, 65: 8, 66: 9,
  // Foot — Cloth
  32: 10, 33: 11, 34: 12, 35: 13, 36: 14,
  // Hand — Metal
  97: 0, 98: 1, 99: 2, 100: 3, 101: 4,
  // Hand — Hide
  67: 5, 68: 6, 69: 7, 70: 8, 71: 9,
  // Hand — Cloth
  37: 10, 38: 11, 39: 12, 40: 13, 41: 14,
};

export enum ItemType {
  Magic = "Magic",
  Bludgeon = "Bludgeon",
  Blade = "Blade",
  Cloth = "Cloth",
  Hide = "Hide",
  Metal = "Metal",
  Ring = "Ring",
  Necklace = "Necklace",
  None = "None",
}

export const ItemUtils = {
  isNecklace: (id: number): boolean => id >= 1 && id <= 3,
  isRing: (id: number): boolean => id >= 4 && id <= 8,
  isWeapon: (id: number): boolean =>
    (id >= 9 && id <= 16) || (id >= 42 && id <= 46) || (id >= 72 && id <= 76),
  isChest: (id: number): boolean =>
    (id >= 17 && id <= 21) || (id >= 47 && id <= 51) || (id >= 77 && id <= 81),
  isHead: (id: number): boolean =>
    (id >= 22 && id <= 26) || (id >= 52 && id <= 56) || (id >= 82 && id <= 86),
  isWaist: (id: number): boolean =>
    (id >= 27 && id <= 31) || (id >= 57 && id <= 61) || (id >= 87 && id <= 91),
  isFoot: (id: number): boolean =>
    (id >= 32 && id <= 36) || (id >= 62 && id <= 66) || (id >= 92 && id <= 96),
  isHand: (id: number): boolean =>
    (id >= 37 && id <= 41) || (id >= 67 && id <= 71) || (id >= 97 && id <= 101),

  isMagicOrCloth: (id: number): boolean => id >= 9 && id <= 41,
  isBladeOrHide: (id: number): boolean => id >= 42 && id <= 71,
  isBludgeonOrMetal: (id: number): boolean => id >= 72,

  getItemType: (id: number): ItemType => {
    if (ItemUtils.isNecklace(id)) return ItemType.Necklace;
    if (ItemUtils.isRing(id)) return ItemType.Ring;
    if (ItemUtils.isMagicOrCloth(id)) return ItemUtils.isWeapon(id) ? ItemType.Magic : ItemType.Cloth;
    if (ItemUtils.isBladeOrHide(id)) return ItemUtils.isWeapon(id) ? ItemType.Blade : ItemType.Hide;
    if (ItemUtils.isBludgeonOrMetal(id)) return ItemUtils.isWeapon(id) ? ItemType.Bludgeon : ItemType.Metal;
    return ItemType.None;
  },

  getItemSlot: (id: number): string => {
    if (ItemUtils.isNecklace(id)) return "Neck";
    if (ItemUtils.isRing(id)) return "Ring";
    if (ItemUtils.isWeapon(id)) return "Weapon";
    if (ItemUtils.isChest(id)) return "Chest";
    if (ItemUtils.isHead(id)) return "Head";
    if (ItemUtils.isWaist(id)) return "Waist";
    if (ItemUtils.isFoot(id)) return "Foot";
    if (ItemUtils.isHand(id)) return "Hand";
    return "None";
  },

  getItemTier: (id: number): number => {
    if (id <= 0) return 0;
    if (id <= 3) return 1; // Necklaces are T1
    if (id === 4) return 2; // Silver Ring T2
    if (id === 5) return 3; // Bronze Ring T3
    if (id <= 8) return 1; // Other rings T1

    // Magic/Cloth items (9-41)
    if (id <= 41) {
      if ([9, 13, 17, 22, 27, 32, 37].includes(id)) return 1;
      if ([10, 14, 18, 23, 28, 33, 38].includes(id)) return 2;
      if ([11, 15, 19, 24, 29, 34, 39].includes(id)) return 3;
      if ([20, 25, 30, 35, 40].includes(id)) return 4;
      return 5;
    }

    // Blade/Hide items (42-71)
    if (id <= 71) {
      if ([42, 47, 52, 57, 62, 67].includes(id)) return 1;
      if ([43, 48, 53, 58, 63, 68].includes(id)) return 2;
      if ([44, 49, 54, 59, 64, 69].includes(id)) return 3;
      if ([45, 50, 55, 60, 65, 70].includes(id)) return 4;
      return 5;
    }

    // Bludgeon/Metal items (72-101)
    if ([72, 77, 82, 87, 92, 97].includes(id)) return 1;
    if ([73, 78, 83, 88, 93, 98].includes(id)) return 2;
    if ([74, 79, 84, 89, 94, 99].includes(id)) return 3;
    if ([75, 80, 85, 90, 95, 100].includes(id)) return 4;
    return 5;
  },

  getItemBasePrice: (tier: number): number => {
    return (6 - tier) * TIER_PRICE;
  },

  getItemPrice: (tier: number, charisma: number): number => {
    const basePrice = ItemUtils.getItemBasePrice(tier);
    const discount = charisma; // 1 gold per charisma point
    return Math.max(1, basePrice - discount);
  },

  getItemName: (id: number): string => {
    return ItemName[id] || "Unknown Item";
  },

  getItemLevel: (xp: number): number => {
    return calculateLevel(xp);
  },
};

// ─── Suffix / Specials Helpers ───────────────────────────────────────────────

function getSpecialsSeed(itemId: number, entropy: number): number {
  let itemEntropy = entropy + itemId;
  if (itemEntropy > 65535) {
    itemEntropy = entropy - itemId;
  }
  const rnd = itemEntropy % NUM_ITEMS;
  const itemIndex = ITEM_INDEX[itemId] ?? 0;
  const slot = ItemUtils.getItemSlot(itemId);
  const slotLength = SLOT_LENGTH[slot] ?? 1;
  return rnd * slotLength + itemIndex;
}

/** Deterministic suffix lookup for an item given the adventurer's item_specials_seed */
export function getItemSuffix(itemId: number, itemSpecialsSeed: number): string | null {
  if (itemId <= 0) return null;
  const seed = getSpecialsSeed(itemId, itemSpecialsSeed);
  const suffixIndex = (seed % 16) + 1;
  return ITEM_SUFFIXES[suffixIndex] ?? null;
}

/** Stat bonuses granted by a suffix (+3 total points) */
export function getSuffixStatBonus(suffix: string): Partial<Stats> {
  switch (suffix) {
    case "of Power": return { strength: 3 };
    case "of Giant": return { vitality: 3 };
    case "of Titans": return { strength: 2, charisma: 1 };
    case "of Skill": return { dexterity: 3 };
    case "of Perfection": return { strength: 1, dexterity: 1, vitality: 1 };
    case "of Brilliance": return { intelligence: 3 };
    case "of Enlightenment": return { wisdom: 3 };
    case "of Protection": return { vitality: 2, dexterity: 1 };
    case "of Anger": return { strength: 2, dexterity: 1 };
    case "of Rage": return { strength: 1, charisma: 1, wisdom: 1 };
    case "of Fury": return { vitality: 1, charisma: 1, intelligence: 1 };
    case "of Vitriol": return { intelligence: 2, wisdom: 1 };
    case "of the Fox": return { dexterity: 2, charisma: 1 };
    case "of Detection": return { wisdom: 2, dexterity: 1 };
    case "of Reflection": return { intelligence: 1, wisdom: 2 };
    case "of the Twins": return { charisma: 3 };
    default: return {};
  }
}

/** Returns true if necklace type matches armor material (Amulet+Cloth, Pendant+Hide, Necklace+Metal) */
export function neckMatchesArmor(neckId: number, armorType: string): boolean {
  return (
    (neckId === 3 && armorType === ItemType.Cloth) ||
    (neckId === 1 && armorType === ItemType.Hide) ||
    (neckId === 2 && armorType === ItemType.Metal)
  );
}

/**
 * Calculate adventurer's luck stat from jewelry.
 * Luck = neck.greatness + ring.greatness + silverRingBonus + bagJewelryGreatness
 * Silver Ring (ID 4) grants bonus luck = greatness * SILVER_RING_LUCK_BONUS_PER_GREATNESS
 */
export function calculateLuck(adventurer: Adventurer, bag: Bag): number {
  const neckGreatness = adventurer.equipment.neck.id > 0
    ? calculateLevel(adventurer.equipment.neck.xp)
    : 0;
  const ringGreatness = adventurer.equipment.ring.id > 0
    ? calculateLevel(adventurer.equipment.ring.xp)
    : 0;
  // Silver Ring (ID 4) bonus
  const silverBonus = adventurer.equipment.ring.id === 4
    ? ringGreatness * SILVER_RING_LUCK_BONUS_PER_GREATNESS
    : 0;

  let bagJewelry = 0;
  for (const item of bag.items) {
    if (ItemUtils.isNecklace(item.id) || ItemUtils.isRing(item.id)) {
      bagJewelry += calculateLevel(item.xp);
    }
  }

  return neckGreatness + ringGreatness + silverBonus + bagJewelry;
}

/** Returns the armor material family for an item: "Cloth", "Hide", "Metal", or "None" */
export function getArmorMaterialFamily(id: number): string {
  if (ItemUtils.isMagicOrCloth(id) && !ItemUtils.isWeapon(id)) return "Cloth";
  if (ItemUtils.isBladeOrHide(id) && !ItemUtils.isWeapon(id)) return "Hide";
  if (ItemUtils.isBludgeonOrMetal(id) && !ItemUtils.isWeapon(id)) return "Metal";
  return "None";
}
