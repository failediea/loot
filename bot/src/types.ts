export interface Stats {
  strength: number;
  dexterity: number;
  vitality: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  luck: number;
}

export interface Item {
  id: number;
  xp: number;
}

export interface Equipment {
  weapon: Item;
  chest: Item;
  head: Item;
  waist: Item;
  foot: Item;
  hand: Item;
  neck: Item;
  ring: Item;
}

export interface Adventurer {
  health: number;
  xp: number;
  gold: number;
  beast_health: number;
  stat_upgrades_available: number;
  stats: Stats;
  equipment: Equipment;
  item_specials_seed: number;
  action_count: number;
}

export interface BeastSpecials {
  special1: number;
  special2: number;
  special3: number;
}

export interface Beast {
  id: number;
  seed: number;
  health: number;
  level: number;
  specials: BeastSpecials;
  is_collectable: boolean;
  // Derived fields
  name?: string;
  type?: string;
  tier?: number;
  specialPrefix?: string | null;
  specialSuffix?: string | null;
}

export interface Bag {
  items: Item[];
  mutated: boolean;
}

export interface GameState {
  adventurer: Adventurer;
  bag: Bag;
  beast: Beast;
  market: number[];
}

export interface ItemPurchase {
  item_id: number;
  equip: boolean;
}

export type GamePhase =
  | "idle"
  | "starter_beast"
  | "in_battle"
  | "stat_upgrade"
  | "shopping"
  | "exploring"
  | "dead";

export type CombatAction = "attack" | "flee";

export interface BotDecision {
  action: string;
  reason: string;
  calls: any[];
}

export interface GameSummary {
  gameId: number;
  level: number;
  xp: number;
  gold: number;
  lastPhase: string;
  lastAction: string;
  causeOfDeath: string;
  stats: Stats;
}

export interface DamageResult {
  baseDamage: number;
  criticalDamage: number;
}

export interface MarketItem {
  id: number;
  name: string;
  tier: number;
  type: string;
  slot: string;
  price: number;
}
