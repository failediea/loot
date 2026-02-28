/**
 * Local game simulator - models Loot Survivor mechanics and runs the bot's strategy.
 * No chain connection needed.
 *
 * Fixed to match Cairo contract mechanics:
 * - Beast level/HP generation using contract formulas
 * - XP reward with divisor and level decay
 * - Item XP multiplier (2x for beast kills)
 * - 33/33/33 exploration splits
 * - Flee XP always 1
 * - Starting gold 40
 * - Luck-based crit chance
 * - Beast crit = adventurerLevel%
 * - Ambush mechanic
 * - Full obstacle combat system
 * - Contract-accurate discovery mechanics
 * - Gold cap at 511
 */

import {
  BEAST_MIN_DAMAGE,
  BEAST_MAX_HEALTH,
  MIN_DAMAGE,
  POTION_HEAL_AMOUNT,
  STARTING_HEALTH,
  STARTER_BEAST_HEALTH,
  STARTING_GOLD,
  MAX_GOLD,
  XP_REWARD_DIVISOR,
  MAX_XP_DECAY,
  ITEM_XP_MULTIPLIER_BEASTS,
  MINIMUM_XP_REWARD,
  MINIMUM_DAMAGE_FROM_OBSTACLES,
  FLEE_XP_REWARD,
  BASE_DAMAGE_REDUCTION_PCT,
} from "../constants/game.js";
import { BEAST_NAMES } from "../constants/beasts.js";
import type { Adventurer, Beast, Bag, Equipment, GameState, Item, Stats } from "../types.js";
import { calculateLevel, maxHealth } from "../utils/math.js";
import {
  ItemUtils,
  SUFFIX_UNLOCK_GREATNESS,
  getItemSuffix,
  getSuffixStatBonus,
  neckMatchesArmor,
  calculateLuck,
} from "../utils/item-utils.js";
import { getBeastType, getBeastTier, getBeastArmorType, getBeastAttackType, enrichBeast } from "../utils/beast-utils.js";
import { elementalAdjustedDamage, calculateObstacleDamage } from "../utils/combat-calc.js";
import { decideCombat } from "../strategy/combat.js";
import { allocateStats } from "../strategy/stats.js";
import { decideMarketPurchases } from "../strategy/market.js";
import { selectStarterWeapon } from "../strategy/weapon.js";
import { detectPhase } from "../game/state-machine.js";
import { log } from "../utils/logger.js";

// ─── RNG ────────────────────────────────────────────────────────────────────

class SimpleRNG {
  private state: number;
  constructor(seed: number) {
    this.state = seed || 1;
  }
  next(): number {
    this.state ^= this.state << 13;
    this.state ^= this.state >> 17;
    this.state ^= this.state << 5;
    return (this.state >>> 0) / 0xFFFFFFFF;
  }
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

// ─── Contract-Accurate Beast Generation ─────────────────────────────────────

/**
 * Generate beast level using contract formula:
 * baseLevel = 1 + (seed % (adventurerLevel * 3))
 * Plus difficulty jumps at level thresholds.
 */
function generateBeastLevel(adventurerLevel: number, seed: number): number {
  const range = Math.max(1, adventurerLevel * 3);
  const baseLevel = 1 + (Math.abs(seed) % range);
  if (adventurerLevel >= 50) return baseLevel + 80;
  if (adventurerLevel >= 40) return baseLevel + 40;
  if (adventurerLevel >= 30) return baseLevel + 20;
  if (adventurerLevel >= 20) return baseLevel + 10;
  return baseLevel;
}

/**
 * Generate beast health using contract formula:
 * health = 1 + (seed % (adventurerLevel * 20))
 * Plus HP jumps at level thresholds. Capped at BEAST_MAX_HEALTH (1023).
 */
function generateBeastHealth(adventurerLevel: number, seed: number): number {
  const range = Math.max(1, adventurerLevel * 20);
  let health = 1 + (Math.abs(seed) % range);
  if (adventurerLevel >= 50) health += 500;
  else if (adventurerLevel >= 40) health += 400;
  else if (adventurerLevel >= 30) health += 200;
  else if (adventurerLevel >= 20) health += 100;
  else health += 10;
  return Math.min(health, BEAST_MAX_HEALTH);
}

/**
 * Calculate XP reward with divisor and level decay.
 * Contract: max(4, floor((tierMult * beastLevel) / 2) * (100 - min(advLevel*2, 95)) / 100)
 */
function getXpReward(beastTier: number, beastLevel: number, adventurerLevel: number): number {
  const tierMult = 6 - beastTier; // T1=5, T2=4, T3=3, T4=2, T5=1
  const decayPct = Math.min(adventurerLevel * 2, MAX_XP_DECAY);
  const base = Math.floor((tierMult * beastLevel) / XP_REWARD_DIVISOR);
  const decayed = Math.floor((base * (100 - decayPct)) / 100);
  return Math.max(MINIMUM_XP_REWARD, decayed);
}

/**
 * Ability-based avoid threat (used for flee + ambush + obstacle dodge).
 * Contract: if stat >= level → always avoid. Otherwise probability-based.
 */
function abilityBasedAvoidThreat(level: number, stat: number, rnd: number): boolean {
  if (stat >= level) return true;
  if (level === 0) return true;
  return stat > Math.floor((level * rnd) / 255);
}

// ─── Game Simulation ────────────────────────────────────────────────────────

interface SimResult {
  level: number;
  xp: number;
  gold: number;
  kills: number;
  flees: number;
  turns: number;
  causeOfDeath: string;
  maxHealthReached: number;
  peakStr: number;
  peakDex: number;
}

/**
 * Generate a beast using contract-accurate formulas.
 */
function generateBeast(adventurerLevel: number, rng: SimpleRNG): Beast {
  const id = rng.nextInt(1, 75);
  const levelSeed = rng.nextInt(0, 65535);
  const healthSeed = rng.nextInt(0, 65535);

  const beastLevel = generateBeastLevel(adventurerLevel, levelSeed);
  const hp = generateBeastHealth(adventurerLevel, healthSeed);

  const beast: Beast = {
    id,
    seed: rng.nextInt(1, 1000000),
    health: Math.max(1, hp),
    level: beastLevel,
    specials: { special1: 0, special2: 0, special3: 0 },
    is_collectable: false,
  };

  return enrichBeast(beast);
}

function generateMarketItems(rng: SimpleRNG, count: number = 21): number[] {
  const items: number[] = [];
  const used = new Set<number>();
  while (items.length < count) {
    const id = rng.nextInt(1, 101);
    if (!used.has(id)) {
      used.add(id);
      items.push(id);
    }
  }
  return items;
}

/**
 * Simulate one round of combat between adventurer and beast.
 * Uses luck-based crit for adventurer, level-based crit for beast.
 */
function simulateCombatRound(
  adventurer: Adventurer,
  beast: Beast,
  bag: Bag,
  rng: SimpleRNG
): { advDamage: number; beastDamage: number } {
  const level = calculateLevel(adventurer.xp);
  const luck = calculateLuck(adventurer, bag);

  // ─── Adventurer → Beast ───
  const weapon = adventurer.equipment.weapon;
  const weaponLevel = calculateLevel(weapon.xp);
  const weaponTier = ItemUtils.getItemTier(weapon.id);
  const baseAttack = weaponLevel * (6 - weaponTier);
  const beastArmor = getBeastArmorType(beast.id);
  const weaponType = ItemUtils.getItemType(weapon.id);
  const elemDmg = elementalAdjustedDamage(baseAttack, weaponType, beastArmor);

  const strBonus = adventurer.stats.strength > 0
    ? Math.floor((elemDmg * adventurer.stats.strength * 10) / 100)
    : 0;

  const beastArmorValue = beast.level * (6 - (beast.tier || 1));

  // Crit chance using luck (contract: (luck * 256) > (100 * rnd) where rnd 0-255)
  const critRnd = rng.nextInt(0, 255);
  const isCrit = (luck * 256) > (100 * critRnd);
  let critBonus = isCrit ? elemDmg : 0;

  // Titanium Ring (ID 7): +3% crit bonus per ring level
  if (isCrit && adventurer.equipment.ring.id === 7) {
    const ringLevel = calculateLevel(adventurer.equipment.ring.xp);
    critBonus += Math.floor((critBonus * 3 * ringLevel) / 100);
  }

  const advDamage = Math.max(MIN_DAMAGE, elemDmg + strBonus + critBonus - beastArmorValue);

  // ─── Beast → Adventurer ───
  const beastTier = beast.tier || 1;
  const beastBaseAttack = beast.level * (6 - beastTier);
  const slots: (keyof Equipment)[] = ["chest", "head", "waist", "foot", "hand"];
  const hitSlot = slots[rng.nextInt(0, 4)];
  const armor = adventurer.equipment[hitSlot];

  let beastDamage: number;
  if (!armor || armor.id === 0) {
    beastDamage = Math.floor(beastBaseAttack * 1.5);
  } else {
    const armorLevel = calculateLevel(armor.xp);
    const armorTier = ItemUtils.getItemTier(armor.id);
    const armorValue = armorLevel * (6 - armorTier);
    const beastAttackType = getBeastAttackType(beast.id);
    const armorType = ItemUtils.getItemType(armor.id);
    const beastElemDmg = elementalAdjustedDamage(beastBaseAttack, beastAttackType, armorType);
    beastDamage = beastElemDmg - armorValue;

    // Necklace damage reduction: if neck matches armor material
    const neck = adventurer.equipment.neck;
    if (neck.id > 0 && neckMatchesArmor(neck.id, armorType)) {
      const neckLevel = calculateLevel(neck.xp);
      const neckReduction = Math.floor((armorValue * neckLevel * 3) / 100);
      beastDamage -= neckReduction;
    }
  }

  // Beast crit chance = adventurerLevel% (capped at 100%)
  const beastCritRnd = rng.next();
  if (beastCritRnd < Math.min(level / 100, 1.0)) {
    beastDamage = Math.floor(beastDamage * 2);
  }

  beastDamage = Math.max(BEAST_MIN_DAMAGE, beastDamage);

  return { advDamage, beastDamage };
}

/**
 * Simulate a beast's ambush attack (pre-combat damage).
 * Uses same combat system but with base damage reduction (25%).
 */
function simulateAmbushDamage(
  adventurer: Adventurer,
  beast: Beast,
  bag: Bag,
  rng: SimpleRNG
): number {
  const level = calculateLevel(adventurer.xp);
  const beastTier = beast.tier || 1;
  const beastBaseAttack = beast.level * (6 - beastTier);
  const slots: (keyof Equipment)[] = ["chest", "head", "waist", "foot", "hand"];
  const hitSlot = slots[rng.nextInt(0, 4)];
  const armor = adventurer.equipment[hitSlot];

  let damage: number;
  if (!armor || armor.id === 0) {
    damage = Math.floor(beastBaseAttack * 1.5);
  } else {
    const armorLevel = calculateLevel(armor.xp);
    const armorTier = ItemUtils.getItemTier(armor.id);
    const armorValue = armorLevel * (6 - armorTier);
    const beastAttackType = getBeastAttackType(beast.id);
    const armorType = ItemUtils.getItemType(armor.id);
    damage = elementalAdjustedDamage(beastBaseAttack, beastAttackType, armorType) - armorValue;

    const neck = adventurer.equipment.neck;
    if (neck.id > 0 && neckMatchesArmor(neck.id, armorType)) {
      const neckLevel = calculateLevel(neck.xp);
      damage -= Math.floor((armorValue * neckLevel * 3) / 100);
    }
  }

  // Apply base damage reduction (25%)
  damage = Math.floor(damage * BASE_DAMAGE_REDUCTION_PCT / 100);
  return Math.max(BEAST_MIN_DAMAGE, damage);
}

/**
 * Simulate a flee attempt. Returns true if successful.
 */
function simulateFlee(dex: number, level: number, rng: SimpleRNG): boolean {
  const rnd = rng.nextInt(0, 255);
  return abilityBasedAvoidThreat(level, dex, rnd);
}

export function simulateGame(seed: number, verbose: boolean = false): SimResult {
  const rng = new SimpleRNG(seed);

  const weaponId = selectStarterWeapon();
  const adventurer: Adventurer = {
    health: STARTING_HEALTH,
    xp: 0,
    gold: STARTING_GOLD, // Fixed: was 0, contract gives 40 starting gold
    beast_health: STARTER_BEAST_HEALTH,
    stat_upgrades_available: 0,
    action_count: 0,
    item_specials_seed: rng.nextInt(1, 65535),
    stats: { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, wisdom: 0, charisma: 0, luck: 0 },
    equipment: {
      weapon: { id: weaponId, xp: 0 },
      chest: { id: 0, xp: 0 }, head: { id: 0, xp: 0 }, waist: { id: 0, xp: 0 },
      foot: { id: 0, xp: 0 }, hand: { id: 0, xp: 0 }, neck: { id: 0, xp: 0 }, ring: { id: 0, xp: 0 },
    },
  };

  // Starter beast - very weak
  let beast: Beast = enrichBeast({
    id: rng.nextInt(1, 75), seed: 0, health: STARTER_BEAST_HEALTH, level: 1,
    specials: { special1: 0, special2: 0, special3: 0 }, is_collectable: false,
  });

  const bag: Bag = { items: [], mutated: false };
  let market: number[] = [];
  let kills = 0, flees = 0, turns = 0;
  let causeOfDeath = "unknown";
  let mhpReached = STARTING_HEALTH;
  let prevLevel = 1;
  let shoppedThisLevel = false;
  const suffixApplied = new Set<string>(); // Track which slots have had suffix bonuses applied

  const MAX_TURNS = 10000;

  while (adventurer.health > 0 && turns < MAX_TURNS) {
    turns++;
    const state: GameState = { adventurer, bag, beast, market };
    const phase = detectPhase(state);

    switch (phase) {
      case "dead":
        causeOfDeath = "health reached 0";
        break;

      case "starter_beast":
      case "in_battle": {
        const decision = decideCombat(adventurer, beast);

        if (decision.action === "flee") {
          const level = calculateLevel(adventurer.xp);
          const success = simulateFlee(adventurer.stats.dexterity, level, rng);
          if (success) {
            flees++;
            adventurer.xp += FLEE_XP_REWARD; // Fixed: always exactly 1 XP
            adventurer.beast_health = 0;
            checkLevelUp(adventurer, rng, market, prevLevel, (ml, pl) => { market = ml; prevLevel = pl; });
            if (verbose) log.combat(`Fled from ${beast.name} L${beast.level} successfully`);
          } else {
            // Failed flee = beast counter-attacks
            const { beastDamage } = simulateCombatRound(adventurer, beast, bag, rng);
            adventurer.health -= beastDamage;
            if (adventurer.health <= 0) {
              adventurer.health = 0;
              causeOfDeath = `killed by ${beast.name} L${beast.level} T${beast.tier} (flee failed)`;
            }
            if (verbose) log.combat(`Flee failed vs ${beast.name}! Took ${beastDamage} dmg (HP:${adventurer.health})`);
          }
        } else {
          // Attack
          if (decision.toTheDeath) {
            while (beast.health > 0 && adventurer.health > 0) {
              const { advDamage, beastDamage } = simulateCombatRound(adventurer, beast, bag, rng);
              beast.health = Math.max(0, beast.health - advDamage);
              if (beast.health <= 0) break;
              adventurer.health -= beastDamage;
              if (adventurer.health <= 0) {
                adventurer.health = 0;
                causeOfDeath = `killed by ${beast.name} L${beast.level} T${beast.tier} (to_the_death)`;
              }
            }
          } else {
            const { advDamage, beastDamage } = simulateCombatRound(adventurer, beast, bag, rng);
            beast.health = Math.max(0, beast.health - advDamage);
            if (beast.health > 0) {
              adventurer.health -= beastDamage;
              if (adventurer.health <= 0) {
                adventurer.health = 0;
                causeOfDeath = `killed by ${beast.name} L${beast.level} T${beast.tier}`;
              }
            }
          }

          // Beast killed?
          if (beast.health <= 0 && adventurer.health > 0) {
            kills++;
            adventurer.beast_health = 0;
            const tier = beast.tier || 1;
            const level = calculateLevel(adventurer.xp);

            // Fixed: XP reward with divisor and level decay
            const xpReward = getXpReward(tier, beast.level, level);
            let goldReward = Math.max(1, Math.floor(beast.level * (6 - tier) / 2));

            // Gold Ring (ID 8): +3% gold per ring level
            const ring = adventurer.equipment.ring;
            if (ring.id === 8) {
              const ringLevel = calculateLevel(ring.xp);
              goldReward += Math.floor((goldReward * 3 * ringLevel) / 100);
            }

            adventurer.xp += xpReward;
            adventurer.gold = Math.min(adventurer.gold + goldReward, MAX_GOLD); // Fixed: gold cap

            // All equipped items gain XP (Fixed: 2x multiplier for beast kills)
            for (const item of Object.values(adventurer.equipment)) {
              if (item.id > 0) item.xp += xpReward * ITEM_XP_MULTIPLIER_BEASTS;
            }

            // Item specials: apply suffix stat bonuses when items reach greatness 15+
            for (const [slotName, item] of Object.entries(adventurer.equipment)) {
              if (item.id > 0 && !suffixApplied.has(slotName) && calculateLevel(item.xp) >= SUFFIX_UNLOCK_GREATNESS) {
                const suffix = getItemSuffix(item.id, adventurer.item_specials_seed);
                if (suffix) {
                  const bonus = getSuffixStatBonus(suffix);
                  for (const [stat, value] of Object.entries(bonus)) {
                    (adventurer.stats as any)[stat] += value;
                  }
                  if (bonus.vitality) {
                    adventurer.health += bonus.vitality * 15;
                    adventurer.health = Math.min(adventurer.health, maxHealth(adventurer.stats.vitality));
                  }
                  suffixApplied.add(slotName);
                  if (verbose) log.info(`Item special: ${ItemUtils.getItemName(item.id)} ${suffix} → +${JSON.stringify(bonus)}`);
                }
              }
            }

            if (verbose) {
              log.combat(`Killed ${beast.name} L${beast.level} T${beast.tier} (+${xpReward}xp +${goldReward}g) HP:${adventurer.health}`);
            }

            const oldLevel = prevLevel;
            checkLevelUp(adventurer, rng, market, prevLevel, (ml, pl) => { market = ml; prevLevel = pl; shoppedThisLevel = false; });
            if (prevLevel > oldLevel && verbose) {
              log.info(`Level up! ${oldLevel} → ${prevLevel} (upgrades: ${adventurer.stat_upgrades_available})`);
            }
          }
        }
        break;
      }

      case "stat_upgrade": {
        const allocation = allocateStats(adventurer);
        adventurer.stats.strength += allocation.strength;
        adventurer.stats.dexterity += allocation.dexterity;
        adventurer.stats.vitality += allocation.vitality;
        adventurer.stats.intelligence += allocation.intelligence;
        adventurer.stats.wisdom += allocation.wisdom;
        adventurer.stats.charisma += allocation.charisma;
        adventurer.stats.luck += allocation.luck;

        if (allocation.vitality > 0) {
          adventurer.health += allocation.vitality * 15;
          adventurer.health = Math.min(adventurer.health, maxHealth(adventurer.stats.vitality));
        }

        adventurer.stat_upgrades_available = 0;
        mhpReached = Math.max(mhpReached, maxHealth(adventurer.stats.vitality));
        break;
      }

      case "shopping": {
        if (shoppedThisLevel) {
          market = [];
          break;
        }
        const shopDecision = decideMarketPurchases(adventurer, bag, market);

        // Apply potions
        if (shopDecision.potions > 0) {
          const level = calculateLevel(adventurer.xp);
          const potionCost = Math.max(1, level - adventurer.stats.charisma * 2);
          const totalCost = shopDecision.potions * potionCost;
          if (totalCost <= adventurer.gold) {
            adventurer.health = Math.min(
              adventurer.health + shopDecision.potions * POTION_HEAL_AMOUNT,
              maxHealth(adventurer.stats.vitality)
            );
            adventurer.gold -= totalCost;
            if (verbose) log.shop(`Bought ${shopDecision.potions} potions (HP: ${adventurer.health})`);
          }
        }

        // Apply item purchases
        for (const purchase of shopDecision.items) {
          const tier = ItemUtils.getItemTier(purchase.item_id);
          const price = ItemUtils.getItemPrice(tier, adventurer.stats.charisma);
          if (price <= adventurer.gold) {
            adventurer.gold -= price;
            if (purchase.equip) {
              const slotName = ItemUtils.getItemSlot(purchase.item_id).toLowerCase();
              const slot = slotName as keyof Equipment;
              if (slot in adventurer.equipment) {
                const oldItem = adventurer.equipment[slot];
                if (oldItem.id > 0 && bag.items.length < 15) {
                  bag.items.push({ ...oldItem });
                }
                adventurer.equipment[slot] = { id: purchase.item_id, xp: 0 };
              }
            } else if (bag.items.length < 15) {
              bag.items.push({ id: purchase.item_id, xp: 0 });
            }
            if (verbose) log.shop(`Bought ${ItemUtils.getItemName(purchase.item_id)} T${tier} for ${price}g`);
          }
        }

        shoppedThisLevel = true;
        market = [];
        break;
      }

      case "exploring": {
        adventurer.action_count++;
        const level = calculateLevel(adventurer.xp);

        // Fixed: Exploration outcomes 33/33/33 (contract uses seed % 3)
        const roll = rng.nextInt(0, 2);
        if (roll === 0) {
          // Beast encounter
          beast = generateBeast(level, rng);
          adventurer.beast_health = beast.health;

          // Fixed: Ambush mechanic (COMPLETELY MISSING before)
          // Wisdom-based avoidance check
          const ambushRnd = rng.nextInt(0, 255);
          const avoided = abilityBasedAvoidThreat(level, adventurer.stats.wisdom, ambushRnd);
          if (!avoided) {
            // Beast attacks FIRST before adventurer can act
            const ambushDmg = simulateAmbushDamage(adventurer, beast, bag, rng);
            adventurer.health -= ambushDmg;
            if (verbose) log.combat(`AMBUSHED by ${beast.name} L${beast.level}! Took ${ambushDmg} dmg (HP:${adventurer.health})`);
            if (adventurer.health <= 0) {
              adventurer.health = 0;
              causeOfDeath = `killed by ambush from ${beast.name} L${beast.level} T${beast.tier}`;
            }
          }

          if (verbose && adventurer.health > 0) {
            log.explore(`Found ${beast.name} L${beast.level} T${beast.tier} HP:${beast.health}${avoided ? "" : " (ambushed!)"}`);
          }
        } else if (roll === 1) {
          // Discovery — Fixed: 45% gold, 45% health, 10% loot
          const discoveryRoll = rng.next();
          if (discoveryRoll < 0.45) {
            // Gold: (rnd % adventurerLevel) + 1
            const goldFound = (rng.nextInt(0, 65535) % Math.max(1, level)) + 1;
            adventurer.gold = Math.min(adventurer.gold + goldFound, MAX_GOLD);
            if (verbose) log.explore(`Found ${goldFound} gold`);
          } else if (discoveryRoll < 0.90) {
            // Health: ((rnd % adventurerLevel) + 1) * 2
            const healthFound = ((rng.nextInt(0, 65535) % Math.max(1, level)) + 1) * 2;
            adventurer.health = Math.min(adventurer.health + healthFound, maxHealth(adventurer.stats.vitality));
            if (verbose) log.explore(`Found ${healthFound} health`);
          } else {
            // Loot discovery — item drop with tier distribution
            // 50% T5, 30% T4, 12% T3, 6% T2, 2% T1
            const tierRoll = rng.next();
            let lootTier: number;
            if (tierRoll < 0.02) lootTier = 1;
            else if (tierRoll < 0.08) lootTier = 2;
            else if (tierRoll < 0.20) lootTier = 3;
            else if (tierRoll < 0.50) lootTier = 4;
            else lootTier = 5;

            // Minor XP for loot discovery
            adventurer.xp += rng.nextInt(1, 3);
            if (verbose) log.explore(`Found T${lootTier} loot`);
          }
          checkLevelUp(adventurer, rng, market, prevLevel, (ml, pl) => { market = ml; prevLevel = pl; shoppedThisLevel = false; });
        } else {
          // Obstacle — Fixed: Full combat system
          const obstacleId = rng.nextInt(1, 75);
          const obstacleLevelSeed = rng.nextInt(0, 65535);
          const obstacleLevel = generateBeastLevel(level, obstacleLevelSeed);

          // Dodge check: INT only (not INT+WIS)
          const dodgeRnd = rng.nextInt(0, 255);
          const dodged = abilityBasedAvoidThreat(level, adventurer.stats.intelligence, dodgeRnd);

          if (dodged) {
            adventurer.xp += rng.nextInt(2, 5);
            if (verbose) log.explore(`Dodged obstacle!`);
          } else {
            // Full combat damage: obstacle attacks a random armor slot
            const slots: (keyof Equipment)[] = ["chest", "head", "waist", "foot", "hand"];
            const hitSlot = slots[rng.nextInt(0, 4)];
            const armor = adventurer.equipment[hitSlot];
            const neck = adventurer.equipment.neck;
            const obstacleDamage = calculateObstacleDamage(obstacleId, obstacleLevel, armor, neck);

            adventurer.health -= obstacleDamage;
            adventurer.xp += rng.nextInt(1, 3);
            if (verbose) log.explore(`Hit by obstacle L${obstacleLevel}: ${obstacleDamage} dmg (HP: ${adventurer.health})`);
            if (adventurer.health <= 0) {
              adventurer.health = 0;
              causeOfDeath = `killed by obstacle L${obstacleLevel} (${obstacleDamage} damage)`;
            }
          }
          checkLevelUp(adventurer, rng, market, prevLevel, (ml, pl) => { market = ml; prevLevel = pl; shoppedThisLevel = false; });
        }
        break;
      }
    }

    if (adventurer.health <= 0) break;
  }

  if (turns >= MAX_TURNS) causeOfDeath = "max turns reached";

  return {
    level: calculateLevel(adventurer.xp),
    xp: adventurer.xp,
    gold: adventurer.gold,
    kills,
    flees,
    turns,
    causeOfDeath,
    maxHealthReached: mhpReached,
    peakStr: adventurer.stats.strength,
    peakDex: adventurer.stats.dexterity,
  };
}

function checkLevelUp(
  adventurer: Adventurer,
  rng: SimpleRNG,
  market: number[],
  prevLevel: number,
  update: (market: number[], prevLevel: number) => void
) {
  const newLevel = calculateLevel(adventurer.xp);
  if (newLevel > prevLevel) {
    adventurer.stat_upgrades_available += (newLevel - prevLevel);
    const newMarket = generateMarketItems(rng);
    update(newMarket, newLevel);
  }
}

// ─── Run Simulations ────────────────────────────────────────────────────────

export function runSimulations(count: number, verbose: boolean = false): void {
  const results: SimResult[] = [];

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  LOOT SURVIVOR BOT SIMULATION - ${count} games`);
  console.log(`${"═".repeat(70)}\n`);

  for (let i = 0; i < count; i++) {
    const seed = 42069 + i * 7919;
    const isVerbose = verbose && i < 3;

    if (isVerbose) {
      console.log(`\n${"─".repeat(50)}`);
      console.log(`  Game #${i + 1} (seed: ${seed})`);
      console.log(`${"─".repeat(50)}`);
    }

    const result = simulateGame(seed, isVerbose);
    results.push(result);

    if (isVerbose) {
      console.log(
        `  => L${result.level} | ${result.kills} kills | ${result.flees} flees | ` +
        `${result.turns} turns | STR:${result.peakStr} DEX:${result.peakDex} | ${result.causeOfDeath}`
      );
    }
  }

  // ─── Statistics ──────────────────────────────────────────────────────────
  const levels = results.map(r => r.level);
  const killCounts = results.map(r => r.kills);
  const fleeCounts = results.map(r => r.flees);
  const turnCounts = results.map(r => r.turns);

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const pct = (arr: number[], p: number) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * p / 100)];
  };

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  RESULTS SUMMARY (${count} games)`);
  console.log(`${"═".repeat(70)}`);

  console.log(`\n  LEVEL REACHED:`);
  console.log(`    Average:     ${avg(levels).toFixed(1)}`);
  console.log(`    Median:      ${median(levels)}`);
  console.log(`    Min:         ${Math.min(...levels)}`);
  console.log(`    Max:         ${Math.max(...levels)}`);
  console.log(`    P25:         ${pct(levels, 25)}`);
  console.log(`    P75:         ${pct(levels, 75)}`);
  console.log(`    P90:         ${pct(levels, 90)}`);
  console.log(`    P95:         ${pct(levels, 95)}`);

  console.log(`\n  KILLS:`);
  console.log(`    Average:     ${avg(killCounts).toFixed(1)}`);
  console.log(`    Median:      ${median(killCounts)}`);
  console.log(`    Max:         ${Math.max(...killCounts)}`);

  console.log(`\n  FLEES:`);
  console.log(`    Average:     ${avg(fleeCounts).toFixed(1)}`);
  const totalEncounters = avg(killCounts) + avg(fleeCounts);
  console.log(`    Flee rate:   ${totalEncounters > 0 ? ((avg(fleeCounts) / totalEncounters) * 100).toFixed(1) : 0}%`);

  console.log(`\n  TURNS:`);
  console.log(`    Average:     ${avg(turnCounts).toFixed(1)}`);
  console.log(`    Median:      ${median(turnCounts)}`);

  // Level distribution
  console.log(`\n  LEVEL DISTRIBUTION:`);
  const buckets = [
    { label: "1-4", min: 1, max: 4 },
    { label: "5-9", min: 5, max: 9 },
    { label: "10-14", min: 10, max: 14 },
    { label: "15-19", min: 15, max: 19 },
    { label: "20-24", min: 20, max: 24 },
    { label: "25-29", min: 25, max: 29 },
    { label: "30+", min: 30, max: 999 },
  ];
  for (const { label, min, max } of buckets) {
    const cnt = levels.filter(l => l >= min && l <= max).length;
    if (cnt === 0) continue;
    const pctStr = ((cnt / count) * 100).toFixed(1);
    const bar = "█".repeat(Math.max(1, Math.floor(cnt / count * 50)));
    console.log(`    L${label.padEnd(5)} ${String(cnt).padStart(5)} (${pctStr.padStart(5)}%) ${bar}`);
  }

  // Death causes
  console.log(`\n  DEATH CAUSES:`);
  const deathCauses: Record<string, number> = {};
  for (const r of results) {
    const cause = r.causeOfDeath.includes("ambush") ? "killed by ambush"
      : r.causeOfDeath.includes("flee failed") ? "flee failed"
      : r.causeOfDeath.includes("to_the_death") ? "killed (to_the_death)"
      : r.causeOfDeath.includes("obstacle") ? "killed by obstacle"
      : r.causeOfDeath.includes("killed by") ? "killed in combat"
      : r.causeOfDeath;
    deathCauses[cause] = (deathCauses[cause] || 0) + 1;
  }
  for (const [cause, cnt] of Object.entries(deathCauses).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cause.padEnd(30)} ${String(cnt).padStart(5)} (${((cnt / count) * 100).toFixed(1)}%)`);
  }

  // Top 10 best games
  const bestGames = [...results].sort((a, b) => b.level - a.level || b.xp - a.xp).slice(0, 10);
  console.log(`\n  TOP 10 GAMES:`);
  for (let i = 0; i < bestGames.length; i++) {
    const g = bestGames[i];
    console.log(
      `    #${String(i + 1).padStart(2)}: L${String(g.level).padStart(2)} | ` +
      `${String(g.kills).padStart(3)} kills ${String(g.flees).padStart(2)} flees | ` +
      `${String(g.turns).padStart(4)} turns | ` +
      `STR:${g.peakStr} DEX:${g.peakDex} | ${g.causeOfDeath}`
    );
  }

  // Average stats at death
  const avgStr = avg(results.map(r => r.peakStr));
  const avgDex = avg(results.map(r => r.peakDex));
  console.log(`\n  AVERAGE STATS AT DEATH:`);
  console.log(`    STR: ${avgStr.toFixed(1)}  DEX: ${avgDex.toFixed(1)}`);

  console.log(`\n${"═".repeat(70)}\n`);
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let count = 1000;
let verbose = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--count" || args[i] === "-n") count = parseInt(args[i + 1]) || 1000;
  if (args[i] === "--verbose" || args[i] === "-v") verbose = true;
}

runSimulations(count, verbose);
