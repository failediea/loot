import { POTION_HEAL_AMOUNT } from "../constants/game.js";
import type { Adventurer, Bag, ItemPurchase, MarketItem } from "../types.js";
import { ItemUtils, ItemType, getItemSuffix, getSuffixStatBonus, getArmorMaterialFamily } from "../utils/item-utils.js";
import { calculateLevel, maxHealth } from "../utils/math.js";
import { log } from "../utils/logger.js";

interface ShoppingDecision {
  potions: number;
  items: ItemPurchase[];
  totalCost: number;
}

// ─── Ring Constants ─────────────────────────────────────────────────────────
const RING_IDS = {
  SILVER: 4,    // T2, +1 Luck per greatness (crit chance scaling)
  BRONZE: 5,    // T3
  PLATINUM: 6,  // T1, +3% per greatness on special name match damage
  TITANIUM: 7,  // T1, +3% per greatness on critical damage
  GOLD: 8,      // T1, +3% per greatness on gold rewards
} as const;

// ─── Greatness Helpers ──────────────────────────────────────────────────────

/** Item greatness = floor(sqrt(xp)). Determines suffix unlocks and scaling. */
function itemGreatness(xp: number): number {
  return Math.floor(Math.sqrt(xp));
}

/** XP needed to reach a given greatness level: greatness^2 */
function xpForGreatness(greatness: number): number {
  return greatness * greatness;
}

/**
 * Decide what to buy from the market.
 *
 * Priority order (greatness-first, potion-heavy):
 * 0. Priority potions (reach 100 HP first)
 * 1. Weapon upgrade (T1=5x damage vs T5=1x — get T1 ASAP, then never replace)
 * 2. Fill empty armor slots (cheapest available — then level them toward G20)
 * 3. Emergency potions (if HP still below 100)
 * 4. Ring (tier-aware selection based on build and greatness)
 * 5. Regular potions (heal up)
 * 6. Backup weapon (only once primary weapon reaches G20 for elemental coverage)
 * 7. Final potions
 *
 * KEY INSIGHT: Items gain XP toward G15 (suffix +3 stats) and G20 (prefix
 * for 8x name-match damage). Replacing an item resets it to G1, destroying
 * all progress. Therefore:
 * - NO armor upgrades ever — keep starter armor and level it to G20
 * - NO necklace purchases — negligible damage reduction vs potion value
 * - Buy T1 weapon ONCE early, then never replace it
 * - Buy backup weapons only after primary weapon is fully maxed (G20)
 * - Spend all remaining gold on potions (10 HP each at 1g with CHA)
 */
export function decideMarketPurchases(
  adventurer: Adventurer,
  bag: Bag,
  marketItemIds: number[]
): ShoppingDecision {
  const charisma = adventurer.stats.charisma;
  const level = calculateLevel(adventurer.xp);
  let gold = adventurer.gold;
  const items: ItemPurchase[] = [];
  const mhp = maxHealth(adventurer.stats.vitality);
  const potionCost = Math.max(1, level - charisma * 2);
  let potions = 0;

  // Log potion efficiency
  const hpPerGold = POTION_HEAL_AMOUNT / potionCost;
  log.shop(`Potion efficiency: ${POTION_HEAL_AMOUNT}hp for ${potionCost}g (${hpPerGold.toFixed(1)} hp/gold)${charisma >= 3 ? " — CHA investment paying off" : ""}`);

  // Collect all item IDs the adventurer already owns (equipped + bag)
  // Must be before pre-scan so we can filter out already-owned market items
  const ownedItemIds = new Set<number>();
  for (const slotKey of Object.keys(adventurer.equipment) as (keyof typeof adventurer.equipment)[]) {
    const item = adventurer.equipment[slotKey];
    if (item.id > 0) ownedItemIds.add(item.id);
  }
  for (const bagItem of bag.items) {
    if (bagItem.id > 0) ownedItemIds.add(bagItem.id);
  }

  // ── PRE-SCAN: Check if we need to save for a critical weapon upgrade ──
  // When a T1/T2 weapon is available but unaffordable, and we have T3+,
  // reduce potion spending to accumulate gold. Game 206566 had T3 Scimitar
  // and couldn't save 17g for T1 Katana because potions consumed all gold.
  const currentWeaponTierPre = adventurer.equipment.weapon.id > 0
    ? ItemUtils.getItemTier(adventurer.equipment.weapon.id) : 6;
  const bestWeaponUpgrade = marketItemIds
    .filter(id => !ownedItemIds.has(id))
    .map(id => ({ id, tier: ItemUtils.getItemTier(id), slot: ItemUtils.getItemSlot(id), price: ItemUtils.getItemPrice(ItemUtils.getItemTier(id), charisma) }))
    .filter(w => w.slot === "Weapon" && w.tier < currentWeaponTierPre)
    .sort((a, b) => a.tier - b.tier)[0];

  // Save for weapon if it's 2+ tiers better and we can't afford it yet
  const savingForWeapon = bestWeaponUpgrade
    && (currentWeaponTierPre - bestWeaponUpgrade.tier) >= 2
    && gold < bestWeaponUpgrade.price;

  // ── STEP 0: Priority potions — reach safe HP before buying anything ──
  // Normally reach 100 HP, but if saving for a critical weapon, only reach 50 HP.
  // A T1 weapon (5x damage) is worth more long-term than 50 extra HP right now.
  const MIN_HP_TARGET = 100;
  const WEAPON_SAVINGS_HP_TARGET = 50;
  {
    const currentHp = adventurer.health;
    const hpTarget = savingForWeapon
      ? Math.min(WEAPON_SAVINGS_HP_TARGET, mhp)
      : Math.min(MIN_HP_TARGET, mhp);
    if (currentHp < hpTarget && gold >= potionCost) {
      const healthNeeded = hpTarget - currentHp;
      const potionsNeeded = Math.ceil(healthNeeded / POTION_HEAL_AMOUNT);
      const affordablePotions = Math.floor(gold / potionCost);
      const buyPotions = Math.min(potionsNeeded, affordablePotions);
      if (buyPotions > 0) {
        potions += buyPotions;
        gold -= buyPotions * potionCost;
        const newHp = Math.min(currentHp + buyPotions * POTION_HEAL_AMOUNT, mhp);
        log.shop(`PRIORITY potions to reach ${hpTarget} HP: ${buyPotions} for ${buyPotions * potionCost}g (HP: ${currentHp}→${newHp}/${mhp})${savingForWeapon ? " [saving for T" + bestWeaponUpgrade!.tier + " weapon]" : ""}`);
      }
    }
    if (savingForWeapon) {
      log.shop(`SAVING for weapon: ${ItemUtils.getItemName(bestWeaponUpgrade!.id)} T${bestWeaponUpgrade!.tier} costs ${bestWeaponUpgrade!.price}g (have ${gold}g, need ${bestWeaponUpgrade!.price - gold}g more)`);
    }
  }

  // Gold reserve: after Step 0 potions, if we've already reached 100 HP,
  // use a small reserve so we can invest in equipment (weapon/armor upgrades
  // reduce HP loss per fight, which is more valuable than holding gold).
  // If still below 100 HP (couldn't afford enough potions), keep bigger reserve.
  const effectiveHp = adventurer.health + potions * POTION_HEAL_AMOUNT;
  const minGoldReserve = effectiveHp >= MIN_HP_TARGET
    ? Math.min(3 * potionCost, Math.floor(gold * 0.10))  // Already at 100 HP: small reserve
    : Math.max(5 * potionCost, Math.floor(gold * 0.30));  // Below 100 HP: save for more potions

  // Build market items with prices, excluding already-owned items
  const marketItems: MarketItem[] = marketItemIds
    .filter((id) => !ownedItemIds.has(id))
    .map((id) => ({
      id,
      name: ItemUtils.getItemName(id),
      tier: ItemUtils.getItemTier(id),
      type: ItemUtils.getItemType(id),
      slot: ItemUtils.getItemSlot(id),
      price: ItemUtils.getItemPrice(ItemUtils.getItemTier(id), charisma),
    }));

  // Determine committed armor material family from equipped armor
  const armorSlots = ["Chest", "Head", "Waist", "Foot", "Hand"] as const;
  const slotToEquipKey: Record<string, keyof typeof adventurer.equipment> = {
    Chest: "chest", Head: "head", Waist: "waist", Foot: "foot", Hand: "hand",
  };

  // Count equipped armor by material
  const materialCounts: Record<string, number> = {};
  for (const slot of armorSlots) {
    const eKey = slotToEquipKey[slot];
    const item = adventurer.equipment[eKey];
    if (item.id > 0) {
      const mat = getArmorMaterialFamily(item.id);
      if (mat !== "None") materialCounts[mat] = (materialCounts[mat] || 0) + 1;
    }
  }
  // Committed material: the one we have most of, or weapon-matching if none
  const committedMaterial = Object.entries(materialCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  /**
   * Score an item for suffix-aware purchasing.
   * Prefer items whose suffix grants STR/DEX/VIT.
   * Penalizes purchases that would replace items near G15 suffix unlock.
   */
  function suffixScore(itemId: number, replacedItemXp?: number): number {
    if (adventurer.item_specials_seed === 0) return 0;
    const suffix = getItemSuffix(itemId, adventurer.item_specials_seed);
    if (!suffix) return 0;
    const bonus = getSuffixStatBonus(suffix);
    let score = 0;
    if (bonus.dexterity) score += bonus.dexterity * 3;
    if (bonus.strength) score += bonus.strength * 2;
    if (bonus.vitality) score += bonus.vitality * 2;
    if (bonus.wisdom) score += bonus.wisdom * 1;
    if (bonus.charisma) score += bonus.charisma * 1;

    // Penalize if the item being purchased would replace an item approaching G15
    if (replacedItemXp !== undefined) {
      const replacedGreatness = itemGreatness(replacedItemXp);
      if (replacedGreatness >= 12) {
        score -= 10;
      }
    }

    return score;
  }

  /**
   * Check if replacing a current item is blocked by greatness considerations.
   * Returns true if the replacement should be blocked.
   *
   * Rules:
   * - If currentGreatness >= 15 (suffix active), only replace with same-tier-or-better
   *   (but we never have high-greatness market items, so effectively block)
   * - If currentGreatness >= 12 (close to unlock), don't replace unless new item
   *   is 2+ tiers better
   */
  function shouldBlockReplacement(
    currentItemId: number,
    currentItemXp: number,
    newItemTier: number,
    slotName: string
  ): boolean {
    const currentGreatness = itemGreatness(currentItemXp);
    const currentTier = ItemUtils.getItemTier(currentItemId);
    const currentName = ItemUtils.getItemName(currentItemId);
    const tierImprovement = currentTier - newItemTier; // positive = new item is better tier

    if (currentGreatness >= 15) {
      // Suffix is active -- only replace with same-tier-or-better that we already own
      // with high greatness (market items are always G1, so block)
      log.shop(`Keeping G${currentGreatness} T${currentTier} ${currentName} — suffix active, market items are G1`);
      return true;
    }

    if (currentGreatness >= 12) {
      const xpNeeded = xpForGreatness(15) - currentItemXp;
      if (tierImprovement < 2) {
        log.shop(`Keeping G${currentGreatness} T${currentTier} ${currentName} — almost at suffix unlock (needs ${currentItemXp}→${xpForGreatness(15)} XP, ${xpNeeded} more)`);
        return true;
      }
      // 2+ tier improvement is worth it even near suffix unlock
      log.shop(`Replacing G${currentGreatness} T${currentTier} ${currentName} — ${tierImprovement} tier improvement outweighs suffix proximity`);
    }

    return false;
  }

  // ── STEP 1: Weapon upgrade (HIGHEST PRIORITY after potions) ──
  // Weapon is the single biggest damage multiplier: T1=5x, T2=4x, T5=1x.
  // Game 206407 spent all 40g on armor at L2, kept T5 weapon the entire game,
  // resulting in 0% win rate on 7/12 beast encounters → no gold income → death spiral.
  // A T1 weapon at L2 costs ~19g, leaving ~20g for armor — much better tradeoff.
  const currentWeapon = adventurer.equipment.weapon;
  const currentWeaponTier = currentWeapon.id > 0
    ? ItemUtils.getItemTier(currentWeapon.id)
    : 6; // No weapon = worst possible

  const weaponUpgrades = marketItems
    .filter((item) => item.slot === "Weapon" && item.tier < currentWeaponTier)
    .sort((a, b) => {
      // Best tier first, then suffix score
      if (a.tier !== b.tier) return a.tier - b.tier;
      return suffixScore(b.id, currentWeapon.xp) - suffixScore(a.id, currentWeapon.xp);
    });

  if (weaponUpgrades.length > 0) {
    const bestWeapon = weaponUpgrades[0];

    // Greatness guard: don't replace weapon near G15 unless 2+ tier improvement
    const weaponBlocked = currentWeapon.id > 0 &&
      shouldBlockReplacement(currentWeapon.id, currentWeapon.xp, bestWeapon.tier, "Weapon");

    if (!weaponBlocked) {
      // Weapons are the #1 purchase: the damage increase pays for itself
      // by killing beasts (gold income) and finishing fights faster (less HP lost).
      // Use minimal gold reserve — weapon ROI is immediate.
      const weaponReserve = Math.min(minGoldReserve, potionCost * 2);
      const affordable = weaponUpgrades.filter((w) => w.price <= gold && (gold - w.price) >= weaponReserve);
      if (affordable.length > 0) {
        const weapon = affordable[0];
        items.push({ item_id: weapon.id, equip: true });
        gold -= weapon.price;
        const currentGreatness = currentWeapon.id > 0 ? itemGreatness(currentWeapon.xp) : 0;
        log.shop(`WEAPON UPGRADE: ${weapon.name} T${weapon.tier} for ${weapon.price}g (was T${currentWeaponTier} G${currentGreatness})`);
      } else {
        log.shop(`Saving for weapon: ${bestWeapon.name} T${bestWeapon.tier} costs ${bestWeapon.price}g (have ${gold}g, reserve ${weaponReserve}g)`);
      }
    }
  }

  // ── STEP 2: Fill empty armor slots ──
  // Empty armor slots = 1.5x beast damage to that slot. Fill with cheapest available.
  // Price cap: only fill cheaply (max 5 potions worth). A T2 belt for 14g is terrible
  // when that gold buys 140 HP of potions. Skip the slot if only expensive options exist.
  // Runs AFTER weapon — a T5 weapon with full armor is far worse than T1 weapon with partial armor.
  const fillSlotMaxPrice = Math.max(5, potionCost * 5);
  for (const slot of armorSlots) {
    const equipKey = slotToEquipKey[slot];
    const currentItem = adventurer.equipment[equipKey];

    if (currentItem.id === 0) {
      const candidates = marketItems
        .filter((item) =>
          item.slot === slot &&
          item.price <= fillSlotMaxPrice &&
          !items.some((p) => p.item_id === item.id)
        )
        .sort((a, b) => {
          // Cheapest first — save gold for potions and other upgrades
          if (a.price !== b.price) return a.price - b.price;
          // Tiebreak: prefer committed material
          const aMat = getArmorMaterialFamily(a.id);
          const bMat = getArmorMaterialFamily(b.id);
          if (committedMaterial) {
            if (aMat === committedMaterial && bMat !== committedMaterial) return -1;
            if (bMat === committedMaterial && aMat !== committedMaterial) return 1;
          }
          return 0;
        });

      if (candidates.length > 0 && candidates[0].price <= gold && (gold - candidates[0].price) >= minGoldReserve) {
        const item = candidates[0];
        items.push({ item_id: item.id, equip: true });
        gold -= item.price;
        log.shop(`Fill ${slot}: ${item.name} T${item.tier} for ${item.price}g`);
      }
    }
  }

  // ── STEP 3: Emergency potions (if HP still below 100 after Step 0 + equipment) ──
  {
    const currentHp = adventurer.health + potions * POTION_HEAL_AMOUNT;
    const targetHp = Math.min(MIN_HP_TARGET, mhp);
    if (currentHp < targetHp && gold >= potionCost) {
      const healthNeeded = targetHp - currentHp;
      const potionsNeeded = Math.ceil(healthNeeded / POTION_HEAL_AMOUNT);
      const goldForPotions = Math.floor(gold * 0.9); // Spend up to 90% to reach 100 HP
      const affordablePotions = Math.floor(goldForPotions / potionCost);
      const buyPotions = Math.min(potionsNeeded, affordablePotions);
      if (buyPotions > 0) {
        potions += buyPotions;
        gold -= buyPotions * potionCost;
        const newHp = Math.min(adventurer.health + potions * POTION_HEAL_AMOUNT, mhp);
        log.shop(`EMERGENCY potions to reach ${targetHp} HP: ${buyPotions} for ${buyPotions * potionCost}g (HP: ${adventurer.health}→${newHp}/${mhp})`);
      }
    }
  }

  // ── STEP 4: Ring (tier-aware selection based on build and greatness) ──
  {
    const currentRing = adventurer.equipment.ring;
    const ringSlotEmpty = currentRing.id === 0;

    // Determine ideal ring priority based on build
    const ringPriority = getRingPriority(adventurer, level);

    if (ringSlotEmpty) {
      // No ring equipped — buy the best available ring from priority list
      const availableRings = marketItems
        .filter((item) => item.slot === "Ring" && !items.some((p) => p.item_id === item.id));

      const bestRing = pickBestRingFromPriority(availableRings, ringPriority);

      if (bestRing && bestRing.price <= gold && (gold - bestRing.price) >= minGoldReserve) {
        items.push({ item_id: bestRing.id, equip: true });
        gold -= bestRing.price;
        log.shop(`Fill Ring: ${bestRing.name} T${bestRing.tier} for ${bestRing.price}g (priority: ${ringPriority.map(id => ringName(id)).join(" > ")})`);
      }
    } else {
      // Ring equipped — consider upgrade, but respect greatness
      const currentRingGreatness = itemGreatness(currentRing.xp);
      const currentRingTier = ItemUtils.getItemTier(currentRing.id);
      const currentRingName = ItemUtils.getItemName(currentRing.id);

      // Find the ideal ring if it differs from current
      const idealRingId = ringPriority[0];
      if (idealRingId && idealRingId !== currentRing.id) {
        const idealInMarket = marketItems.find(
          (item) => item.id === idealRingId && !items.some((p) => p.item_id === item.id)
        );

        if (idealInMarket) {
          // Don't replace a ring with good greatness for a G1 ring
          // The new market ring will always be G1
          if (currentRingGreatness >= 8) {
            log.shop(`Keeping ${currentRingName} G${currentRingGreatness} — too much greatness invested to replace with G1 ${idealInMarket.name}`);
          } else if (currentRingGreatness >= 5 && currentRingTier <= idealInMarket.tier) {
            log.shop(`Keeping ${currentRingName} G${currentRingGreatness} — similar tier, greatness value too high to replace`);
          } else if (idealInMarket.price <= gold && (gold - idealInMarket.price) >= minGoldReserve) {
            items.push({ item_id: idealInMarket.id, equip: true });
            gold -= idealInMarket.price;
            log.shop(`RING UPGRADE: ${idealInMarket.name} T${idealInMarket.tier} for ${idealInMarket.price}g (was ${currentRingName} T${currentRingTier} G${currentRingGreatness})`);
          }
        }
      }
    }
  }

  // ── STEP 5: Regular potions — target 100 HP minimum, then heal toward max ──
  {
    const currentHp = adventurer.health + potions * POTION_HEAL_AMOUNT;
    if (currentHp < mhp && gold >= potionCost) {
      const targetHp = Math.min(Math.max(MIN_HP_TARGET, Math.floor(mhp * 0.7)), mhp);
      const healthNeeded = targetHp - currentHp;

      if (healthNeeded > 0) {
        const potionsNeeded = Math.ceil(healthNeeded / POTION_HEAL_AMOUNT);

        // Budget: be generous — potions keep us alive
        let goldForPotions: number;
        if (currentHp < MIN_HP_TARGET) {
          goldForPotions = Math.floor(gold * 0.9); // Below 100 HP: spend almost everything
        } else if (potionCost <= 1) {
          goldForPotions = Math.max(0, gold - 4); // 1g potions: spend almost everything
        } else if (currentHp < mhp * 0.7) {
          goldForPotions = Math.floor(gold * 0.7);
        } else {
          goldForPotions = Math.floor(gold * 0.5);
        }

        const affordablePotions = Math.floor(goldForPotions / potionCost);
        const buyPotions = Math.min(potionsNeeded, affordablePotions);
        if (buyPotions > 0) {
          potions += buyPotions;
          gold -= buyPotions * potionCost;
          const newHp = Math.min(adventurer.health + potions * POTION_HEAL_AMOUNT, mhp);
          log.shop(`Potions: ${buyPotions} for ${buyPotions * potionCost}g (HP: ${adventurer.health}→${newHp}/${mhp}, ${potionCost}g each, target ${targetHp})`);
        }
      }
    }
  }

  // NOTE: Necklace buying REMOVED. At L10 necklaces reduce ~1.5 damage/hit —
  // negligible vs spending that gold on 10+ potions (100 HP). Necklaces become
  // valuable at high levels but we need to survive to get there first.

  // NOTE: Armor upgrades REMOVED. Replacing armor resets greatness to G1,
  // destroying progress toward G15 suffix unlock (+3 stat points per item).
  // At 1g potions, 20g buys 200 HP of healing — far better than a T1 armor
  // upgrade that saves ~35 HP/hit against only 1/3 of beast types.
  // Keep starter armor and level it toward G20 instead.

  // ── STEP 6: Backup weapon for elemental coverage ──
  // Top games carry 3 T1 weapon types (Ghost Wand/Katana/Warhammer) for full
  // beast coverage. Only buy backup weapons once the primary weapon reaches
  // G20 (fully maxed — suffix + prefix unlocked, can't gain more XP).
  {
    const weaponGreatness = currentWeapon.id > 0 ? itemGreatness(currentWeapon.xp) : 0;
    if (weaponGreatness >= 20) {
      // Collect weapon types we already own (equipped + bag)
      const ownedWeaponTypes = new Set<ItemType>();
      if (currentWeapon.id > 0) {
        ownedWeaponTypes.add(ItemUtils.getItemType(currentWeapon.id));
      }
      for (const bagItem of bag.items) {
        if (ItemUtils.isWeapon(bagItem.id)) {
          ownedWeaponTypes.add(ItemUtils.getItemType(bagItem.id));
        }
      }
      // Also count weapons we're already buying this visit
      for (const purchase of items) {
        if (ItemUtils.isWeapon(purchase.item_id)) {
          ownedWeaponTypes.add(ItemUtils.getItemType(purchase.item_id));
        }
      }

      const allWeaponTypes = [ItemType.Magic, ItemType.Blade, ItemType.Bludgeon];
      const missingTypes = allWeaponTypes.filter((t) => !ownedWeaponTypes.has(t));

      if (missingTypes.length > 0) {
        // Find best available weapon of a missing type (prefer T1)
        const backupCandidates = marketItems
          .filter(
            (item) =>
              item.slot === "Weapon" &&
              missingTypes.includes(item.type as ItemType) &&
              !items.some((p) => p.item_id === item.id)
          )
          .sort((a, b) => a.tier - b.tier); // Best tier first

        if (backupCandidates.length > 0) {
          const backup = backupCandidates[0];
          const backupReserve = Math.min(minGoldReserve, potionCost * 3);
          if (backup.price <= gold && (gold - backup.price) >= backupReserve) {
            items.push({ item_id: backup.id, equip: false }); // to bag, not equipped
            gold -= backup.price;
            log.shop(
              `BACKUP WEAPON: ${backup.name} T${backup.tier} (${backup.type}) for ${backup.price}g ` +
              `— primary weapon G${weaponGreatness}, need ${backup.type} coverage`
            );
          } else {
            log.shop(
              `Want backup ${backup.name} T${backup.tier} (${backup.type}) but ${backup.price}g > budget ` +
              `(have ${gold}g, reserve ${backupReserve}g)`
            );
          }
        }
      }
    }
  }

  // ── STEP 7: Final potions — enforce 100 HP floor, then spend remaining gold ──
  {
    const currentHp = adventurer.health + potions * POTION_HEAL_AMOUNT;

    // First: if still below 100 HP, spend ALL remaining gold on potions
    if (currentHp < MIN_HP_TARGET && gold >= potionCost) {
      const healthNeeded = MIN_HP_TARGET - currentHp;
      const potionsNeeded = Math.ceil(healthNeeded / POTION_HEAL_AMOUNT);
      const affordablePotions = Math.floor(gold / potionCost);
      const buyPotions = Math.min(potionsNeeded, affordablePotions);
      if (buyPotions > 0) {
        potions += buyPotions;
        gold -= buyPotions * potionCost;
        const newHp = Math.min(adventurer.health + potions * POTION_HEAL_AMOUNT, mhp);
        log.shop(`FINAL potions to reach 100 HP: ${buyPotions} for ${buyPotions * potionCost}g (HP→${newHp})`);
      }
    }

    // Then: spend remaining gold on bonus potions up to max HP
    const updatedHp = adventurer.health + potions * POTION_HEAL_AMOUNT;
    if (updatedHp < mhp && gold >= potionCost) {
      const healthNeeded = mhp - updatedHp;
      const potionsNeeded = Math.ceil(healthNeeded / POTION_HEAL_AMOUNT);
      const affordablePotions = Math.floor(gold / potionCost);
      const buyPotions = Math.min(potionsNeeded, affordablePotions);
      if (buyPotions > 0) {
        potions += buyPotions;
        gold -= buyPotions * potionCost;
        log.shop(`Extra potions: ${buyPotions} for ${buyPotions * potionCost}g`);
      }
    }
  }

  const totalCost = adventurer.gold - gold;
  return { potions, items, totalCost };
}

// ─── Ring Strategy Helpers ──────────────────────────────────────────────────

/**
 * Determine ring priority order based on adventurer build and level.
 *
 * Ring effects:
 * - Silver Ring (4):   T2, +1 Luck per greatness -> crit chance scaling
 * - Bronze Ring (5):   T3, no special scaling
 * - Platinum Ring (6): T1, +3% per greatness on special name match damage
 * - Titanium Ring (7): T1, +3% per greatness on critical damage
 * - Gold Ring (8):     T1, +3% per greatness on gold rewards
 */
function getRingPriority(adventurer: Adventurer, level: number): number[] {
  // Damage-focused build: STR >= 5, crit scaling is king
  if (adventurer.stats.strength >= 5) {
    return [RING_IDS.TITANIUM, RING_IDS.SILVER, RING_IDS.PLATINUM, RING_IDS.GOLD, RING_IDS.BRONZE];
  }

  // Early game (level < 10): Silver Ring is cheapest (T2 = 8g base) and builds luck fast
  if (level < 10) {
    return [RING_IDS.SILVER, RING_IDS.TITANIUM, RING_IDS.PLATINUM, RING_IDS.GOLD, RING_IDS.BRONZE];
  }

  // Level 15+: endgame crit scaling with Titanium
  if (level >= 15) {
    return [RING_IDS.TITANIUM, RING_IDS.SILVER, RING_IDS.PLATINUM, RING_IDS.GOLD, RING_IDS.BRONZE];
  }

  // Default: Titanium > Silver > Platinum > Gold > Bronze
  return [RING_IDS.TITANIUM, RING_IDS.SILVER, RING_IDS.PLATINUM, RING_IDS.GOLD, RING_IDS.BRONZE];
}

/** Pick the best ring from the available market rings based on priority ordering. */
function pickBestRingFromPriority(
  availableRings: MarketItem[],
  priority: number[]
): MarketItem | undefined {
  for (const ringId of priority) {
    const ring = availableRings.find((r) => r.id === ringId);
    if (ring) return ring;
  }
  // Fallback: cheapest available ring if none from priority list found
  return availableRings.sort((a, b) => a.price - b.price)[0];
}

/** Human-readable ring name for logging. */
function ringName(id: number): string {
  switch (id) {
    case RING_IDS.SILVER: return "Silver";
    case RING_IDS.BRONZE: return "Bronze";
    case RING_IDS.PLATINUM: return "Platinum";
    case RING_IDS.TITANIUM: return "Titanium";
    case RING_IDS.GOLD: return "Gold";
    default: return "Unknown";
  }
}
