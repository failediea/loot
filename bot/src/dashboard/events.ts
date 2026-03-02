import { EventEmitter } from "events";
import type { GameState, GamePhase, GameSummary, Stats, Beast } from "../types.js";
import { calculateLevel } from "../utils/math.js";
import { ItemUtils } from "../utils/item-utils.js";
import { getBeastType, getBeastTier } from "../utils/beast-utils.js";
import { BEAST_NAMES } from "../constants/beasts.js";

// ─── Event Types ────────────────────────────────────────────────────────────

export interface StateUpdateEvent {
  type: "state_update";
  ts: number;
  gameRequestId?: number;
  gameId: number;
  phase: string;
  adventurer: {
    health: number;
    maxHealth: number;
    xp: number;
    level: number;
    gold: number;
    stats: Stats;
    equipment: EnrichedEquipment;
    bag: EnrichedItem[];
    statUpgrades: number;
  };
  beast: EnrichedBeast | null;
  marketSize: number;
}

export interface DecisionEvent {
  type: "decision";
  ts: number;
  gameRequestId?: number;
  phase: string;
  action: string;
  reason: string;
}

export interface CombatSimEvent {
  type: "combat_sim";
  ts: number;
  gameRequestId?: number;
  beast: EnrichedBeast;
  winRate: number;
  expectedHpLoss: number;
  expectedHpLossOnWin: number;
  expectedRounds: number;
  deathRate: number;
  fleeChance: number;
  fleeDeathRate: number;
  fleeExpectedHpLoss: number;
  isProfitable: boolean;
  netHpCost: number;
  killGold: number;
  killXp: number;
}

export interface MarketActionEvent {
  type: "market_action";
  ts: number;
  gameRequestId?: number;
  potions: number;
  items: { id: number; name: string; tier: number; slot: string; equip: boolean }[];
  totalCost: number;
  goldRemaining: number;
  savingForWeapon: boolean;
}

export interface StatAllocationEvent {
  type: "stat_allocation";
  ts: number;
  gameRequestId?: number;
  points: number;
  allocation: Stats;
  resultingStats: Stats;
  level: number;
}

export interface TxStatusEvent {
  type: "tx_status";
  ts: number;
  gameRequestId?: number;
  status: "submitting" | "submitted" | "confirmed" | "reverted" | "error";
  description: string;
  txHash?: string;
  error?: string;
  attempt?: number;
}

export interface GameStartEvent {
  type: "game_start";
  ts: number;
  gameRequestId?: number;
  gameId: number;
  gameNumber: number;
}

export interface GameSummaryEvent {
  type: "game_summary";
  ts: number;
  gameRequestId?: number;
  summary: GameSummary;
  gameNumber: number;
}

export type DashboardEvent =
  | StateUpdateEvent
  | DecisionEvent
  | CombatSimEvent
  | MarketActionEvent
  | StatAllocationEvent
  | TxStatusEvent
  | GameStartEvent
  | GameSummaryEvent;

// ─── Enriched Types (names/tiers resolved for dashboard) ────────────────────

interface EnrichedItem {
  id: number;
  xp: number;
  name: string;
  tier: number;
  slot: string;
  greatness: number;
}

interface EnrichedBeast {
  id: number;
  name: string;
  type: string;
  tier: number;
  level: number;
  health: number;
  specials: { special1: number; special2: number; special3: number };
}

type EnrichedEquipment = Record<string, EnrichedItem>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function enrichItem(item: { id: number; xp: number }, slot: string): EnrichedItem {
  if (item.id === 0) {
    return { id: 0, xp: 0, name: "(empty)", tier: 0, slot, greatness: 0 };
  }
  return {
    id: item.id,
    xp: item.xp,
    name: ItemUtils.getItemName(item.id),
    tier: ItemUtils.getItemTier(item.id),
    slot,
    greatness: Math.floor(Math.sqrt(item.xp)),
  };
}

function enrichBeast(beast: Beast): EnrichedBeast | null {
  if (!beast || beast.id === 0) return null;
  return {
    id: beast.id,
    name: BEAST_NAMES[beast.id] || `Beast #${beast.id}`,
    type: getBeastType(beast.id),
    tier: beast.tier || getBeastTier(beast.id),
    level: beast.level,
    health: beast.health,
    specials: beast.specials,
  };
}

function maxHealth(vit: number): number {
  return Math.min(100 + vit * 15, 1023);
}

// ─── Dashboard Event Emitter ────────────────────────────────────────────────

const MAX_BUFFER_SIZE = 200;

class DashboardEvents extends EventEmitter {
  private buffer: DashboardEvent[] = [];
  private currentState: StateUpdateEvent | null = null;
  private gameHistory: GameSummaryEvent[] = [];
  private currentGameNumber = 0;
  private currentGameRequestId?: number;

  setGameRequestId(id: number): void {
    this.currentGameRequestId = id;
  }

  getRecentEvents(): DashboardEvent[] {
    return this.buffer;
  }

  getCurrentState(): StateUpdateEvent | null {
    return this.currentState;
  }

  getGameHistory(): GameSummaryEvent[] {
    return this.gameHistory;
  }

  private pushEvent(event: DashboardEvent): void {
    if (this.currentGameRequestId !== undefined) {
      (event as any).gameRequestId = this.currentGameRequestId;
    }
    this.buffer.push(event);
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer = this.buffer.slice(-MAX_BUFFER_SIZE);
    }
    this.emit("event", event);
  }

  // ── Typed emitters ──

  emitStateUpdate(gameId: number, state: GameState, phase: string): void {
    const { adventurer, bag, beast, market } = state;
    const level = calculateLevel(adventurer.xp);

    const equipment: EnrichedEquipment = {};
    const slots = ["weapon", "chest", "head", "waist", "foot", "hand", "neck", "ring"] as const;
    for (const slot of slots) {
      equipment[slot] = enrichItem(adventurer.equipment[slot], slot);
    }

    const enrichedBag = bag.items
      .filter((i) => i.id > 0)
      .map((i) => enrichItem(i, ItemUtils.getItemSlot(i.id)));

    const event: StateUpdateEvent = {
      type: "state_update",
      ts: Date.now(),
      gameId,
      phase,
      adventurer: {
        health: adventurer.health,
        maxHealth: maxHealth(adventurer.stats.vitality),
        xp: adventurer.xp,
        level,
        gold: adventurer.gold,
        stats: { ...adventurer.stats },
        equipment,
        bag: enrichedBag,
        statUpgrades: adventurer.stat_upgrades_available,
      },
      beast: enrichBeast(beast),
      marketSize: market.length,
    };

    this.currentState = event;
    this.pushEvent(event);
  }

  emitDecision(phase: string, action: string, reason: string): void {
    this.pushEvent({
      type: "decision",
      ts: Date.now(),
      phase,
      action,
      reason,
    });
  }

  emitCombatSim(data: Omit<CombatSimEvent, "type" | "ts">): void {
    this.pushEvent({
      type: "combat_sim",
      ts: Date.now(),
      ...data,
    });
  }

  emitMarketAction(
    potions: number,
    items: { id: number; name: string; tier: number; slot: string; equip: boolean }[],
    totalCost: number,
    goldRemaining: number,
    savingForWeapon: boolean
  ): void {
    this.pushEvent({
      type: "market_action",
      ts: Date.now(),
      potions,
      items,
      totalCost,
      goldRemaining,
      savingForWeapon,
    });
  }

  emitStatAllocation(points: number, allocation: Stats, resultingStats: Stats, level: number): void {
    this.pushEvent({
      type: "stat_allocation",
      ts: Date.now(),
      points,
      allocation,
      resultingStats,
      level,
    });
  }

  emitTxStatus(
    status: TxStatusEvent["status"],
    description: string,
    txHash?: string,
    error?: string,
    attempt?: number
  ): void {
    this.pushEvent({
      type: "tx_status",
      ts: Date.now(),
      status,
      description,
      txHash,
      error,
      attempt,
    });
  }

  emitGameStart(gameId: number, gameNumber: number): void {
    this.currentGameNumber = gameNumber;
    this.pushEvent({
      type: "game_start",
      ts: Date.now(),
      gameId,
      gameNumber,
    });
  }

  emitGameSummary(summary: GameSummary, gameNumber?: number): void {
    const event: GameSummaryEvent = {
      type: "game_summary",
      ts: Date.now(),
      summary,
      gameNumber: gameNumber ?? this.currentGameNumber,
    };
    this.gameHistory.push(event);
    this.pushEvent(event);
  }
}

export const dashboard = new DashboardEvents();
