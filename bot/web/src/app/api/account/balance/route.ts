import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { RpcProvider } from "starknet";

export const dynamic = "force-dynamic";

const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const provider = new RpcProvider({
      nodeUrl: process.env.STARKNET_RPC_URL || "https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9",
    });

    const result = await provider.callContract({
      contractAddress: STRK_TOKEN,
      entrypoint: "balanceOf",
      calldata: [user.addr],
    });

    const balance = BigInt(result[0]);
    const balanceFormatted = (Number(balance) / 1e18).toFixed(4);

    return NextResponse.json({
      address: user.addr,
      balance: balance.toString(),
      balanceFormatted,
    });
  } catch (error: any) {
    console.error("Balance fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch balance" }, { status: 500 });
  }
}
