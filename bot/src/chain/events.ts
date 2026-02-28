import { BEAST_NAMES, BEAST_NAME_PREFIXES, BEAST_NAME_SUFFIXES, BEAST_SPECIAL_NAME_LEVEL_UNLOCK } from "../constants/beasts.js";
import { getBeastTier, getBeastType } from "../utils/beast-utils.js";
import { log } from "../utils/logger.js";

// Event type index matches the contract's GameEvent enum
const GAME_EVENT_TYPES = [
  "adventurer", "bag", "beast", "discovery", "obstacle",
  "defeated_beast", "fled_beast", "stat_upgrade", "buy_items",
  "equip", "drop", "level_up", "market_items", "ambush",
  "attack", "beast_attack", "flee",
];

export interface ParsedGameEvent {
  type: string;
  action_count: number;
  [key: string]: any;
}

/**
 * Parse game events from a transaction receipt.
 * This is a simplified parser that extracts the key events we need for bot decisions.
 */
export function parseGameEvents(receipt: any): ParsedGameEvent[] {
  const events: ParsedGameEvent[] = [];

  if (!receipt?.events) return events;

  for (const event of receipt.events) {
    try {
      const parsed = parseGameEvent(event);
      if (parsed) events.push(parsed);
    } catch {
      // Skip events we can't parse (non-game events)
    }
  }

  return events;
}

function parseGameEvent(event: any): ParsedGameEvent | null {
  const data = event.data;
  if (!data || data.length < 4) return null;

  const keysNumber = parseInt(data[0], 16);
  if (isNaN(keysNumber) || keysNumber < 1) return null;

  const adventurerId = parseInt(data[1], 16);
  if (isNaN(adventurerId)) return null;

  const actionCount = parseInt(data[keysNumber], 16);
  const typeIndex = parseInt(data[keysNumber + 2], 16);

  if (isNaN(typeIndex) || typeIndex >= GAME_EVENT_TYPES.length) return null;

  const type = GAME_EVENT_TYPES[typeIndex];
  let values = [...data.slice(1, 1 + keysNumber), ...data.slice(keysNumber + 2)].slice(2);

  // Remove the type index
  values = values.slice(1);

  const result: ParsedGameEvent = { type, action_count: actionCount };

  try {
    switch (type) {
      case "adventurer":
        result.adventurer = parseAdventurer(values);
        break;
      case "beast":
        result.beast = parseBeast(values);
        break;
      case "defeated_beast":
        result.beast_id = parseInt(values[0], 16);
        result.gold_reward = parseInt(values[1], 16);
        result.xp_reward = parseInt(values[2], 16);
        break;
      case "fled_beast":
        result.beast_id = parseInt(values[0], 16);
        result.xp_reward = parseInt(values[1], 16);
        break;
      case "discovery":
        result.discovery = parseDiscovery(values);
        break;
      case "level_up":
        result.level = parseInt(values[0], 16);
        break;
      case "market_items":
        result.items = parseNumberArray(values);
        break;
      case "attack":
      case "beast_attack":
      case "ambush":
        result.damage = parseInt(values[0], 16);
        result.critical_hit = parseInt(values[2], 16) === 1;
        break;
      case "flee":
        result.success = parseInt(values[0], 16) === 1;
        break;
      case "obstacle":
        result.obstacle_id = parseInt(values[0], 16);
        result.dodged = parseInt(values[1], 16) === 1;
        result.damage = parseInt(values[2], 16);
        break;
    }
  } catch {
    // Return what we have
  }

  return result;
}

function parseAdventurer(values: string[]): any {
  return {
    health: parseInt(values[0], 16),
    xp: parseInt(values[1], 16),
    gold: parseInt(values[2], 16),
    beast_health: parseInt(values[3], 16),
    stat_upgrades_available: parseInt(values[4], 16),
    stats: {
      strength: parseInt(values[5], 16),
      dexterity: parseInt(values[6], 16),
      vitality: parseInt(values[7], 16),
      intelligence: parseInt(values[8], 16),
      wisdom: parseInt(values[9], 16),
      charisma: parseInt(values[10], 16),
      luck: parseInt(values[11], 16),
    },
    equipment: {
      weapon: { id: parseInt(values[12], 16), xp: parseInt(values[13], 16) },
      chest: { id: parseInt(values[14], 16), xp: parseInt(values[15], 16) },
      head: { id: parseInt(values[16], 16), xp: parseInt(values[17], 16) },
      waist: { id: parseInt(values[18], 16), xp: parseInt(values[19], 16) },
      foot: { id: parseInt(values[20], 16), xp: parseInt(values[21], 16) },
      hand: { id: parseInt(values[22], 16), xp: parseInt(values[23], 16) },
      neck: { id: parseInt(values[24], 16), xp: parseInt(values[25], 16) },
      ring: { id: parseInt(values[26], 16), xp: parseInt(values[27], 16) },
    },
    item_specials_seed: parseInt(values[28], 16),
    action_count: parseInt(values[29], 16),
  };
}

function parseBeast(values: string[]): any {
  const id = parseInt(values[0], 16);
  const level = parseInt(values[3], 16);
  const special2 = parseInt(values[5], 16);
  const special3 = parseInt(values[6], 16);

  return {
    id,
    seed: parseInt(values[1], 16),
    health: parseInt(values[2], 16),
    level,
    specials: {
      special1: parseInt(values[4], 16),
      special2,
      special3,
    },
    is_collectable: parseInt(values[7], 16) === 1,
    name: BEAST_NAMES[id] || "Unknown",
    type: getBeastType(id),
    tier: getBeastTier(id),
    specialPrefix: level >= BEAST_SPECIAL_NAME_LEVEL_UNLOCK ? BEAST_NAME_PREFIXES[special2] || null : null,
    specialSuffix: level >= BEAST_SPECIAL_NAME_LEVEL_UNLOCK ? BEAST_NAME_SUFFIXES[special3] || null : null,
  };
}

function parseDiscovery(values: string[]): any {
  const types = ["Gold", "Health", "Loot"];
  return {
    type: types[parseInt(values[0], 16)] || "Unknown",
    amount: parseInt(values[1], 16),
    xp_reward: parseInt(values[2], 16),
  };
}

function parseNumberArray(values: string[]): number[] {
  const length = parseInt(values[0], 16);
  const items: number[] = [];
  for (let i = 1; i <= length; i++) {
    items.push(parseInt(values[i], 16));
  }
  return items;
}

/**
 * Extract the latest adventurer state from events
 */
export function getLatestAdventurerFromEvents(events: ParsedGameEvent[]): any | null {
  const adventurerEvents = events.filter((e) => e.type === "adventurer");
  if (adventurerEvents.length === 0) return null;

  // Get the one with highest action_count
  return adventurerEvents.reduce((latest, e) =>
    e.action_count >= latest.action_count ? e : latest
  ).adventurer;
}

/**
 * Extract beast from events
 */
export function getBeastFromEvents(events: ParsedGameEvent[]): any | null {
  const beastEvents = events.filter((e) => e.type === "beast");
  if (beastEvents.length === 0) return null;
  return beastEvents[beastEvents.length - 1].beast;
}

/**
 * Extract market items from events
 */
export function getMarketFromEvents(events: ParsedGameEvent[]): number[] {
  const marketEvents = events.filter((e) => e.type === "market_items");
  if (marketEvents.length === 0) return [];
  return marketEvents[marketEvents.length - 1].items || [];
}

/**
 * Check if adventurer died
 */
export function isDeadFromEvents(events: ParsedGameEvent[]): boolean {
  const advEvents = events.filter((e) => e.type === "adventurer");
  if (advEvents.length === 0) return false;
  const latest = advEvents[advEvents.length - 1];
  return latest.adventurer?.health === 0;
}
