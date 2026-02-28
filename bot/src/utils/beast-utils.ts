import {
  BEAST_NAMES,
  BEAST_NAME_PREFIXES,
  BEAST_NAME_SUFFIXES,
  BEAST_SPECIAL_NAME_LEVEL_UNLOCK,
} from "../constants/beasts.js";
import type { Beast } from "../types.js";

export function getBeastType(id: number): string {
  if (id >= 1 && id <= 25) return "Magic";
  if (id >= 26 && id <= 50) return "Hunter";
  if (id >= 51 && id <= 75) return "Brute";
  return "None";
}

export function getBeastAttackType(id: number): string {
  if (id >= 1 && id <= 25) return "Magic";
  if (id >= 26 && id <= 50) return "Blade";
  if (id >= 51 && id <= 75) return "Bludgeon";
  return "None";
}

export function getBeastArmorType(id: number): string {
  if (id >= 1 && id <= 25) return "Cloth";
  if (id >= 26 && id <= 50) return "Hide";
  if (id >= 51 && id <= 75) return "Metal";
  return "None";
}

export function getBeastTier(id: number): number {
  const offset = ((id - 1) % 25);
  if (offset < 5) return 1;
  if (offset < 10) return 2;
  if (offset < 15) return 3;
  if (offset < 20) return 4;
  return 5;
}

export function getBeastName(id: number, level: number, special2: number, special3: number): string {
  const baseName = BEAST_NAMES[id] || "Unknown";
  const specialPrefix = level >= BEAST_SPECIAL_NAME_LEVEL_UNLOCK ? BEAST_NAME_PREFIXES[special2] : undefined;
  const specialSuffix = level >= BEAST_SPECIAL_NAME_LEVEL_UNLOCK ? BEAST_NAME_SUFFIXES[special3] : undefined;

  if (specialPrefix && specialSuffix) {
    return `"${specialPrefix} ${specialSuffix}" ${baseName}`;
  }
  return baseName;
}

export function enrichBeast(beast: Beast): Beast {
  return {
    ...beast,
    name: getBeastName(beast.id, beast.level, beast.specials.special2, beast.specials.special3),
    type: getBeastType(beast.id),
    tier: getBeastTier(beast.id),
    specialPrefix:
      beast.level >= BEAST_SPECIAL_NAME_LEVEL_UNLOCK
        ? BEAST_NAME_PREFIXES[beast.specials.special2] || null
        : null,
    specialSuffix:
      beast.level >= BEAST_SPECIAL_NAME_LEVEL_UNLOCK
        ? BEAST_NAME_SUFFIXES[beast.specials.special3] || null
        : null,
  };
}
