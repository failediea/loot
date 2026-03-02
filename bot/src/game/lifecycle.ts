import type { RpcProvider } from "starknet";
import type { BotConfig } from "../config.js";
import type { CallBuilders } from "../chain/calls.js";
import { executeTransaction, executeDirectInvoke } from "../chain/executor.js";
import { getSwapQuote, buildSwapCalls } from "../chain/swap.js";
import { selectStarterWeapon } from "../strategy/weapon.js";
import { log } from "../utils/logger.js";

/**
 * Check ERC-20 token balance for an account.
 */
async function getTokenBalance(
  provider: RpcProvider,
  tokenAddress: string,
  accountAddress: string
): Promise<bigint> {
  try {
    const result = await provider.callContract({
      contractAddress: tokenAddress,
      entrypoint: "balanceOf",
      calldata: [accountAddress],
    });
    return BigInt(result[0]);
  } catch {
    return 0n;
  }
}

/**
 * Ensure the account has at least 1 ticket token.
 * If not, swap STRK -> ticket via Ekubo using direct invoke
 * (the Cartridge paymaster cannot sponsor DEX swaps).
 */
export async function ensureTicketToken(
  provider: RpcProvider,
  config: BotConfig
): Promise<void> {
  const ticketBal = await getTokenBalance(
    provider,
    config.ticketTokenAddress,
    config.accountAddress
  );

  if (ticketBal >= BigInt(1e18)) {
    log.success(
      `Ticket balance: ${Number(ticketBal) / 1e18} (sufficient)`
    );
    return;
  }

  log.warn(`Ticket balance: ${Number(ticketBal) / 1e18} — need to swap STRK for tickets`);

  // Check STRK balance
  const strkBal = await getTokenBalance(
    provider,
    config.strkTokenAddress,
    config.accountAddress
  );
  const strkAmount = Number(strkBal) / 1e18;
  log.info(`STRK balance: ${strkAmount}`);

  if (strkBal === 0n) {
    throw new Error(
      "No STRK balance to swap for ticket tokens. Fund the account with STRK first."
    );
  }

  // Get swap quote: want exactly 1 ticket token out
  log.info("Fetching Ekubo swap quote (STRK -> ticket)...");
  const quote = await getSwapQuote(
    -1e18, // negative = exact output (1 ticket)
    config.ticketTokenAddress,
    config.strkTokenAddress
  );

  if (!quote) {
    throw new Error(
      "Could not get swap quote from Ekubo. The STRK->ticket pool may lack liquidity."
    );
  }

  const strkNeeded = Math.abs(Number(BigInt(quote.total_calculated))) / 1e18;
  log.info(
    `Swap quote: 1 ticket = ${strkNeeded.toFixed(2)} STRK (impact: ${(quote.price_impact * 100).toFixed(2)}%)`
  );

  // Check we have enough STRK (with buffer)
  const strkNeededWithBuffer = (BigInt(quote.total_calculated) < 0n
    ? -BigInt(quote.total_calculated)
    : BigInt(quote.total_calculated)) * 100n / 99n;

  if (strkBal < strkNeededWithBuffer) {
    throw new Error(
      `Insufficient STRK. Need ~${strkNeeded.toFixed(2)} STRK but have ${strkAmount.toFixed(2)}`
    );
  }

  // Build and execute swap
  const swapCalls = buildSwapCalls(
    config.ekuboRouterAddress,
    config.strkTokenAddress,
    config.ticketTokenAddress,
    quote
  );

  // Use direct invoke (not paymaster) because Cartridge paymaster rejects DEX swaps
  log.info(`Executing STRK -> ticket swap (${swapCalls.length} calls) via direct invoke...`);
  await executeDirectInvoke(swapCalls, "swap_strk_to_ticket", config.rpcUrl, config.chainId);
  log.success("Swap complete! Ticket token acquired.");

  // Verify — poll for up to 10 seconds since RPC may return stale data
  let newBal = 0n;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      log.info(`Balance still stale, retrying (${attempt + 1}/5)...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    newBal = await getTokenBalance(
      provider,
      config.ticketTokenAddress,
      config.accountAddress
    );
    if (newBal >= BigInt(1e18)) break;
  }
  log.info(`New ticket balance: ${Number(newBal) / 1e18}`);

  if (newBal < BigInt(1e18)) {
    throw new Error("Swap succeeded but ticket balance still insufficient after polling");
  }
}

/**
 * Query the dungeon contract to find the latest game ID owned by an account.
 * Used as a fallback when receipt events are unavailable (e.g., WASM crash).
 */
async function queryLatestGameId(
  provider: RpcProvider,
  dungeonAddress: string,
  accountAddress: string
): Promise<number | null> {
  try {
    // Query the ERC-721 balance to find how many games the account owns
    const balResult = await provider.callContract({
      contractAddress: dungeonAddress,
      entrypoint: "balance_of",
      calldata: [accountAddress],
    });
    const balance = Number(BigInt(balResult[0]));
    if (balance === 0) return null;

    // Get the most recently minted token (last index)
    const tokenResult = await provider.callContract({
      contractAddress: dungeonAddress,
      entrypoint: "token_of_owner_by_index",
      calldata: [accountAddress, (balance - 1).toString(), "0"],
    });
    const gameId = Number(BigInt(tokenResult[0]));
    if (gameId > 0 && gameId < 10000000) {
      return gameId;
    }
    return null;
  } catch (e: any) {
    log.warn(`Chain query for game ID failed: ${e.message?.slice(0, 150)}`);
    return null;
  }
}

/**
 * Buy a new game token from the dungeon.
 * Uses executeTransaction (paymaster path) since approve+buy_game works fine there.
 * Has a chain query fallback if the receipt is missing events (WASM crash).
 * Returns the game ID.
 */
export async function buyGame(
  config: BotConfig,
  calls: CallBuilders,
  provider?: RpcProvider,
  name: string = "BOT"
): Promise<number> {
  log.info(`Buying new game as "${name}"...`);

  // Snapshot the current token count before buying so we can detect the new one
  let preBalance: number | null = null;
  if (provider) {
    // Ensure we have at least 1 ticket token — swap STRK if needed
    await ensureTicketToken(provider, config);

    // Record game token balance before purchase for fallback detection
    try {
      const balResult = await provider.callContract({
        contractAddress: config.dungeonAddress,
        entrypoint: "balance_of",
        calldata: [config.accountAddress],
      });
      preBalance = Number(BigInt(balResult[0]));
    } catch {
      // Non-critical, fallback will still work without pre-balance
    }
  }

  const txCalls = [
    calls.approveTicket(1),
    calls.buyGame(name, config.accountAddress),
  ];

  // approve+buy_game works through the paymaster, so keep using executeTransaction
  const receipt = await executeTransaction(null, txCalls, "buy_game", config.rpcUrl, config.chainId);

  // Parse game ID from receipt events
  if (receipt?.events) {
    const tokenEvent = receipt.events.find((e: any) => e.data?.length === 14);
    if (tokenEvent) {
      const gameId = parseInt(tokenEvent.data[1], 16);
      log.success(`Game purchased! ID: ${gameId}`);
      return gameId;
    }

    // Fallback: search for any event with a reasonable game ID
    for (const event of receipt.events) {
      if (event.data?.length >= 2) {
        const possibleId = parseInt(event.data[1], 16);
        if (possibleId > 0 && possibleId < 10000000) {
          log.success(`Game purchased! ID: ${possibleId} (fallback parse)`);
          return possibleId;
        }
      }
    }
  }

  // Fallback: receipt missing or has no events (WASM crash before receipt).
  // Query the chain directly to find the newly minted game token.
  if (provider) {
    log.warn("No events in receipt — querying chain for new game ID...");

    // Wait a moment for state to propagate
    await new Promise((r) => setTimeout(r, 5000));

    const gameId = await queryLatestGameId(
      provider,
      config.dungeonAddress,
      config.accountAddress
    );

    if (gameId !== null) {
      // Verify this is actually a new game (not one we already had)
      if (preBalance !== null) {
        try {
          const postResult = await provider.callContract({
            contractAddress: config.dungeonAddress,
            entrypoint: "balance_of",
            calldata: [config.accountAddress],
          });
          const postBalance = Number(BigInt(postResult[0]));
          if (postBalance > preBalance) {
            log.success(`Game purchased! ID: ${gameId} (chain query fallback)`);
            return gameId;
          }
          log.warn(`Balance unchanged (${preBalance} -> ${postBalance}), game may not have been purchased`);
        } catch {
          // If we can't verify balance change, trust the game ID if it looks new
          log.success(`Game purchased! ID: ${gameId} (chain query, unverified)`);
          return gameId;
        }
      } else {
        log.success(`Game purchased! ID: ${gameId} (chain query fallback)`);
        return gameId;
      }
    }
  }

  throw new Error("Failed to parse game ID from buy_game receipt and chain query fallback also failed");
}

/**
 * Start the game with a weapon selection and kill the starter beast.
 * Mirrors the client flow: startGame + requestRandom(battleSalt) + attack in one TX.
 * For new games (xp=0), no VRF is needed for start_game itself.
 */
export async function startGame(
  config: BotConfig,
  gameId: number,
  calls: CallBuilders
): Promise<void> {
  const weaponId = selectStarterWeapon();
  log.info(`Starting game ${gameId} with weapon ID ${weaponId}...`);

  // For new games: start + attack starter beast in one multicall
  // Battle salt uses xp=0, actionCount=0 (first action after start)
  const txCalls = [
    calls.startGame(gameId, weaponId),
    calls.requestRandomForBattle(gameId, 0, 1),
    calls.attack(gameId, false),
  ];

  await executeTransaction(null, txCalls, "start_game+attack_starter", config.rpcUrl, config.chainId);
  log.success(`Game ${gameId} started and starter beast attacked!`);
}
