import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Cache STRK/USD price for 60 seconds to avoid hammering the API. */
let cachedPrice: { usd: number; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function fetchStrkPrice(): Promise<number | null> {
  // Return cached if fresh
  if (cachedPrice && Date.now() - cachedPrice.fetchedAt < CACHE_TTL_MS) {
    return cachedPrice.usd;
  }

  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=starknet&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`CoinGecko returned ${res.status}`);
    const data = await res.json();
    const usd = data?.starknet?.usd;
    if (typeof usd === "number" && usd > 0) {
      cachedPrice = { usd, fetchedAt: Date.now() };
      return usd;
    }
    throw new Error("Invalid price data");
  } catch (err) {
    console.warn("[price] CoinGecko fetch failed:", err);
    // Return stale cache if available
    if (cachedPrice) return cachedPrice.usd;
    return null;
  }
}

export async function GET() {
  const usd = await fetchStrkPrice();
  if (usd === null) {
    return NextResponse.json({ error: "Price unavailable" }, { status: 503 });
  }
  return NextResponse.json({ strkUsd: usd });
}
