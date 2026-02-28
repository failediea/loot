import { CallData, hash, CairoOption, CairoOptionVariant, shortString } from "starknet";
import type { BotConfig } from "../config.js";
import type { ItemPurchase, Stats } from "../types.js";

/**
 * Generate VRF salt for explore actions.
 * Mirrors client's generateSalt(gameId, xp)
 */
function generateExploreSalt(gameId: number, xp: number): bigint {
  return BigInt(hash.computePoseidonHashOnElements([BigInt(xp), BigInt(gameId)]));
}

/**
 * Generate VRF salt for battle actions (attack/flee).
 * Mirrors client's generateBattleSalt(gameId, xp, actionCount)
 */
function generateBattleSalt(gameId: number, xp: number, actionCount: number): bigint {
  return BigInt(hash.computePoseidonHashOnElements([BigInt(xp), BigInt(gameId), BigInt(actionCount + 1)]));
}

export function createCallBuilders(config: BotConfig) {
  const GAME = config.gameAddress;
  const VRF = config.vrfProviderAddress;
  const DUNGEON = config.dungeonAddress;
  const TICKET = config.ticketTokenAddress;

  return {
    /**
     * Request VRF randomness for explore (needs xp, gameId)
     */
    requestRandomForExplore(gameId: number, xp: number) {
      const salt = generateExploreSalt(gameId, xp);
      return {
        contractAddress: VRF,
        entrypoint: "request_random",
        calldata: CallData.compile({
          caller: GAME,
          source: { type: 1, salt },
        }),
      };
    },

    /**
     * Request VRF randomness for battle (attack/flee) (needs xp, gameId, actionCount)
     */
    requestRandomForBattle(gameId: number, xp: number, actionCount: number) {
      const salt = generateBattleSalt(gameId, xp, actionCount);
      return {
        contractAddress: VRF,
        entrypoint: "request_random",
        calldata: CallData.compile({
          caller: GAME,
          source: { type: 1, salt },
        }),
      };
    },

    /**
     * Approve ticket token for buying game
     */
    approveTicket(amount: number) {
      return {
        contractAddress: TICKET,
        entrypoint: "approve",
        calldata: CallData.compile([DUNGEON, BigInt(amount) * BigInt(1e18), "0"]),
      };
    },

    /**
     * Buy a game from the dungeon
     */
    buyGame(name: string, recipientAddress: string) {
      const nameFelt = name.length > 0 && name.length <= 31
        ? shortString.encodeShortString(name)
        : shortString.encodeShortString("BOT");
      return {
        contractAddress: DUNGEON,
        entrypoint: "buy_game",
        calldata: CallData.compile([
          0,       // payment type: Ticket
          new CairoOption(CairoOptionVariant.Some, nameFelt),
          recipientAddress,
          false,   // soulbound
        ]),
      };
    },

    /**
     * Start a game with a chosen weapon (needs VRF)
     */
    startGame(gameId: number, weaponId: number) {
      return {
        contractAddress: GAME,
        entrypoint: "start_game",
        calldata: [gameId.toString(), weaponId.toString()],
      };
    },

    /**
     * Explore the world (needs VRF)
     */
    explore(gameId: number, tillBeast: boolean) {
      return {
        contractAddress: GAME,
        entrypoint: "explore",
        calldata: [gameId.toString(), tillBeast ? "1" : "0"],
      };
    },

    /**
     * Attack a beast (needs VRF)
     */
    attack(gameId: number, toTheDeath: boolean) {
      return {
        contractAddress: GAME,
        entrypoint: "attack",
        calldata: [gameId.toString(), toTheDeath ? "1" : "0"],
      };
    },

    /**
     * Flee from a beast (needs VRF)
     */
    flee(gameId: number, toTheDeath: boolean) {
      return {
        contractAddress: GAME,
        entrypoint: "flee",
        calldata: [gameId.toString(), toTheDeath ? "1" : "0"],
      };
    },

    /**
     * Select stat upgrades (no VRF needed)
     */
    selectStatUpgrades(gameId: number, stats: Stats) {
      return {
        contractAddress: GAME,
        entrypoint: "select_stat_upgrades",
        calldata: [
          gameId.toString(),
          stats.strength.toString(),
          stats.dexterity.toString(),
          stats.vitality.toString(),
          stats.intelligence.toString(),
          stats.wisdom.toString(),
          stats.charisma.toString(),
          stats.luck.toString(),
        ],
      };
    },

    /**
     * Buy items and potions (no VRF needed)
     */
    buyItems(gameId: number, potions: number, items: ItemPurchase[]) {
      return {
        contractAddress: GAME,
        entrypoint: "buy_items",
        calldata: [
          gameId.toString(),
          potions.toString(),
          items.length.toString(),
          ...items.flatMap((item) => [item.item_id.toString(), item.equip ? "1" : "0"]),
        ],
      };
    },

    /**
     * Equip items from bag (no VRF needed)
     */
    equip(gameId: number, itemIds: number[]) {
      return {
        contractAddress: GAME,
        entrypoint: "equip",
        calldata: [gameId.toString(), itemIds.length.toString(), ...itemIds.map(String)],
      };
    },

    /**
     * Drop items (no VRF needed)
     */
    drop(gameId: number, itemIds: number[]) {
      return {
        contractAddress: GAME,
        entrypoint: "drop",
        calldata: [gameId.toString(), itemIds.length.toString(), ...itemIds.map(String)],
      };
    },
  };
}

export type CallBuilders = ReturnType<typeof createCallBuilders>;
