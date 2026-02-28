// Elemental triangle
// Magic beats Metal/Cloth, weak vs Hide
// Blade beats Cloth, weak vs Metal
// Bludgeon beats Hide, weak vs Cloth

export type WeaponType = "Magic" | "Blade" | "Bludgeon";
export type ArmorType = "Cloth" | "Hide" | "Metal";
export type BeastType = "Magic" | "Hunter" | "Brute";

// Weapon type → strong against armor type
export const WEAPON_STRENGTH: Record<WeaponType, ArmorType> = {
  Magic: "Metal",
  Blade: "Cloth",
  Bludgeon: "Hide",
};

// Weapon type → weak against armor type
export const WEAPON_WEAKNESS: Record<WeaponType, ArmorType> = {
  Magic: "Hide",
  Blade: "Metal",
  Bludgeon: "Cloth",
};

// Beast type → attack type mapping
export const BEAST_ATTACK_TYPE: Record<BeastType, WeaponType> = {
  Magic: "Magic",
  Hunter: "Blade",
  Brute: "Bludgeon",
};

// Beast type → armor type mapping
export const BEAST_ARMOR_TYPE: Record<BeastType, ArmorType> = {
  Magic: "Cloth",
  Hunter: "Hide",
  Brute: "Metal",
};

// Tier multipliers for damage/armor calculation
export const TIER_MULTIPLIER: Record<number, number> = {
  1: 5, // 6-1
  2: 4, // 6-2
  3: 3, // 6-3
  4: 2, // 6-4
  5: 1, // 6-5
};

// Gold reward multipliers by tier
export const GOLD_MULTIPLIER: Record<number, number> = {
  1: 5,
  2: 4,
  3: 3,
  4: 2,
  5: 1,
};

export const ARMOR_SLOTS = ["chest", "head", "waist", "foot", "hand"] as const;
export type ArmorSlot = (typeof ARMOR_SLOTS)[number];
