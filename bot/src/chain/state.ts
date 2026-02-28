import { num, RpcProvider } from "starknet";
import type { BotConfig } from "../config.js";
import type { Adventurer, Bag, Beast, GameState, Item } from "../types.js";
import { enrichBeast } from "../utils/beast-utils.js";
import { log } from "../utils/logger.js";

/**
 * Fetch full game state from on-chain via starknet_call to game_systems.get_game_state()
 * Mirrors the client's getGameState in starknet.ts
 */
export async function fetchGameState(
  provider: RpcProvider,
  config: BotConfig,
  gameId: number
): Promise<GameState | null> {
  try {
    const response = await provider.callContract({
      contractAddress: config.gameAddress,
      entrypoint: "get_game_state",
      calldata: [num.toHex(gameId)],
    });

    const r = response;
    if (!r || r.length < 10) return null;

    const adventurer: Adventurer = {
      health: parseInt(r[0], 16),
      xp: parseInt(r[1], 16),
      gold: parseInt(r[2], 16),
      beast_health: parseInt(r[3], 16),
      stat_upgrades_available: parseInt(r[4], 16),
      stats: {
        strength: parseInt(r[5], 16),
        dexterity: parseInt(r[6], 16),
        vitality: parseInt(r[7], 16),
        intelligence: parseInt(r[8], 16),
        wisdom: parseInt(r[9], 16),
        charisma: parseInt(r[10], 16),
        luck: parseInt(r[11], 16),
      },
      equipment: {
        weapon: { id: parseInt(r[12], 16), xp: parseInt(r[13], 16) },
        chest: { id: parseInt(r[14], 16), xp: parseInt(r[15], 16) },
        head: { id: parseInt(r[16], 16), xp: parseInt(r[17], 16) },
        waist: { id: parseInt(r[18], 16), xp: parseInt(r[19], 16) },
        foot: { id: parseInt(r[20], 16), xp: parseInt(r[21], 16) },
        hand: { id: parseInt(r[22], 16), xp: parseInt(r[23], 16) },
        neck: { id: parseInt(r[24], 16), xp: parseInt(r[25], 16) },
        ring: { id: parseInt(r[26], 16), xp: parseInt(r[27], 16) },
      },
      item_specials_seed: parseInt(r[28], 16),
      action_count: parseInt(r[29], 16),
    };

    const bagItems: Item[] = [];
    for (let i = 0; i < 15; i++) {
      const id = parseInt(r[30 + i * 2], 16);
      const xp = parseInt(r[31 + i * 2], 16);
      if (id > 0) bagItems.push({ id, xp });
    }
    const mutated = parseInt(r[60], 16) === 1;

    const bag: Bag = { items: bagItems, mutated };

    const rawBeast: Beast = {
      id: parseInt(r[61], 16),
      seed: parseInt(r[62], 16),
      health: parseInt(r[63], 16),
      level: parseInt(r[64], 16),
      specials: {
        special1: parseInt(r[65], 16),
        special2: parseInt(r[66], 16),
        special3: parseInt(r[67], 16),
      },
      is_collectable: parseInt(r[68], 16) === 1,
    };

    const beast = enrichBeast(rawBeast);

    // Market items start after beast data. Index 69 is array length, 70+ are item IDs
    const marketLen = r.length > 70 ? parseInt(r[69], 16) : 0;
    const market: number[] = [];
    for (let i = 0; i < marketLen && 70 + i < r.length; i++) {
      market.push(parseInt(r[70 + i], 16));
    }

    return { adventurer, bag, beast, market };
  } catch (error) {
    log.error(`Failed to fetch game state for game ${gameId}: ${error}`);
    return null;
  }
}
