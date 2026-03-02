import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const EKUBO_QUOTER = "https://prod-api-quoter.ekubo.org";
const CHAIN_ID = "23448594291968334"; // Starknet mainnet

// Token addresses on Starknet mainnet
const TICKET_TOKEN = "0x0452810188C4Cb3AEbD63711a3b445755BC0D6C4f27B923fDd99B1A118858136";
const USDC_TOKEN = "0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb";
const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const ONE_TOKEN_18 = "1000000000000000000"; // 1e18
const USDC_DECIMALS = 6;

interface PriceCache {
  ticketUsd: number;
  strkUsd: number;
  fetchedAt: number;
}

let cache: PriceCache | null = null;
const CACHE_TTL_MS = 60_000;

/** Fetch Ekubo quote: sell `amount` of `sellToken`, receive `buyToken`. */
async function ekuboQuote(sellToken: string, buyToken: string, amount: string): Promise<number | null> {
  const url = `${EKUBO_QUOTER}/${CHAIN_ID}/-${amount}/${sellToken}/${buyToken}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const data = await res.json();
  const calculated = data?.total_calculated;
  if (!calculated) return null;
  // total_calculated is negative (tokens received), take absolute value
  return Math.abs(Number(calculated));
}

async function fetchPrices(): Promise<PriceCache | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;

  try {
    // Fetch both quotes in parallel — same API the official site uses
    const [ticketUsdc, strkUsdc] = await Promise.all([
      // Sell 1 ticket → USDC (routes through LORDS → ETH → USDC)
      ekuboQuote(TICKET_TOKEN, USDC_TOKEN, ONE_TOKEN_18),
      // Sell 1 STRK → USDC
      ekuboQuote(STRK_TOKEN, USDC_TOKEN, ONE_TOKEN_18),
    ]);

    if (ticketUsdc === null || strkUsdc === null) {
      throw new Error("Ekubo quotes returned null");
    }

    const ticketUsd = ticketUsdc / Math.pow(10, USDC_DECIMALS);
    const strkUsd = strkUsdc / Math.pow(10, USDC_DECIMALS);

    cache = { ticketUsd, strkUsd, fetchedAt: Date.now() };
    return cache;
  } catch (err) {
    console.warn("[price] Ekubo quote failed:", err);
    if (cache) return cache; // Return stale cache
    return null;
  }
}

export async function GET() {
  const prices = await fetchPrices();
  if (!prices) {
    return NextResponse.json({ error: "Price unavailable" }, { status: 503 });
  }
  return NextResponse.json({
    ticketUsd: prices.ticketUsd,
    strkUsd: prices.strkUsd,
  });
}
