import { num } from "starknet";
import { log } from "../utils/logger.js";

// Ekubo quoter API for mainnet
const EKUBO_QUOTER_URL = "https://prod-api-quoter.ekubo.org/23448594291968334";

interface RouteNode {
  pool_key: {
    token0: string;
    token1: string;
    fee: string;
    tick_spacing: string;
    extension: string;
  };
  sqrt_ratio_limit: string;
  skip_ahead: number;
}

interface SwapSplit {
  amount_specified: string;
  amount_calculated: string;
  route: RouteNode[];
}

interface SwapQuote {
  total_calculated: string;
  price_impact: number;
  splits: SwapSplit[];
}

/**
 * Get a swap quote from Ekubo.
 * amount < 0 means "I want exactly |amount| of `token` out" (exact output).
 */
export async function getSwapQuote(
  amount: number,
  token: string,
  otherToken: string
): Promise<SwapQuote | null> {
  const url = `${EKUBO_QUOTER_URL}/${amount}/${token}/${otherToken}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.splits || data.splits.length === 0) return null;
    return data as SwapQuote;
  } catch (e: any) {
    log.error(`Ekubo quote failed: ${e.message}`);
    return null;
  }
}

/**
 * Build multicall array to swap sourceToken → ticketToken via Ekubo router.
 * Returns the call objects ready for account.execute().
 */
export function buildSwapCalls(
  routerAddress: string,
  sourceTokenAddress: string,
  ticketTokenAddress: string,
  quote: SwapQuote
): any[] {
  // Calculate total source tokens needed (with 1% buffer for slippage)
  let totalQuoteSum = 0n;
  if (quote.splits.length > 0) {
    const total = BigInt(quote.total_calculated);
    totalQuoteSum = total < 0n ? -total : total;
  }
  const totalWithBuffer = (totalQuoteSum * 100n) / 99n;

  // Step 1: Transfer source tokens to the Ekubo router
  const transferCall = {
    contractAddress: sourceTokenAddress,
    entrypoint: "transfer",
    calldata: [routerAddress, num.toHex(totalWithBuffer), "0x0"],
  };

  // Step 2: Build the swap call(s)
  const { splits } = quote;
  let swapCalls: any[];

  if (splits.length === 1) {
    const split = splits[0];
    swapCalls = [
      {
        contractAddress: routerAddress,
        entrypoint: "multihop_swap",
        calldata: [
          num.toHex(split.route.length),
          ...split.route
            .reduce(
              (
                memo: { token: string; encoded: string[] },
                routeNode: RouteNode
              ) => {
                const isToken1 =
                  BigInt(memo.token) === BigInt(routeNode.pool_key.token1);
                return {
                  token: isToken1
                    ? routeNode.pool_key.token0
                    : routeNode.pool_key.token1,
                  encoded: memo.encoded.concat([
                    routeNode.pool_key.token0,
                    routeNode.pool_key.token1,
                    routeNode.pool_key.fee,
                    num.toHex(routeNode.pool_key.tick_spacing),
                    routeNode.pool_key.extension,
                    num.toHex(BigInt(routeNode.sqrt_ratio_limit) % 2n ** 128n),
                    num.toHex(BigInt(routeNode.sqrt_ratio_limit) >> 128n),
                    routeNode.skip_ahead.toString(),
                  ]),
                };
              },
              { token: ticketTokenAddress, encoded: [] }
            )
            .encoded,
          ticketTokenAddress,
          num.toHex(
            BigInt(split.amount_specified) < 0n
              ? -BigInt(split.amount_specified)
              : BigInt(split.amount_specified)
          ),
          "0x1",
        ],
      },
    ];
  } else {
    // Multi-split swap
    swapCalls = [
      {
        contractAddress: routerAddress,
        entrypoint: "multi_multihop_swap",
        calldata: [
          num.toHex(splits.length),
          ...splits.reduce((memo: string[], split: SwapSplit) => {
            return memo.concat([
              num.toHex(split.route.length),
              ...split.route
                .reduce(
                  (
                    memo: { token: string; encoded: string[] },
                    routeNode: RouteNode
                  ) => {
                    const isToken1 =
                      BigInt(memo.token) === BigInt(routeNode.pool_key.token1);
                    return {
                      token: isToken1
                        ? routeNode.pool_key.token0
                        : routeNode.pool_key.token1,
                      encoded: memo.encoded.concat([
                        routeNode.pool_key.token0,
                        routeNode.pool_key.token1,
                        routeNode.pool_key.fee,
                        num.toHex(routeNode.pool_key.tick_spacing),
                        routeNode.pool_key.extension,
                        num.toHex(
                          BigInt(routeNode.sqrt_ratio_limit) % 2n ** 128n
                        ),
                        num.toHex(
                          BigInt(routeNode.sqrt_ratio_limit) >> 128n
                        ),
                        routeNode.skip_ahead.toString(),
                      ]),
                    };
                  },
                  { token: ticketTokenAddress, encoded: [] }
                )
                .encoded,
              ticketTokenAddress,
              num.toHex(
                BigInt(split.amount_specified) < 0n
                  ? -BigInt(split.amount_specified)
                  : BigInt(split.amount_specified)
              ),
              "0x1",
            ]);
          }, []),
        ],
      },
    ];
  }

  // Step 3: Clear the ticket token profit from the router to our account
  // clear_minimum(token, minimum_amount)
  const clearProfitsCall = {
    contractAddress: routerAddress,
    entrypoint: "clear_minimum",
    calldata: [ticketTokenAddress, num.toHex(BigInt(1e18)), "0x0"],
  };

  // Step 4: Clear any leftover source tokens back to us
  const clearSourceCall = {
    contractAddress: routerAddress,
    entrypoint: "clear",
    calldata: [sourceTokenAddress],
  };

  return [transferCall, ...swapCalls, clearProfitsCall, clearSourceCall];
}
