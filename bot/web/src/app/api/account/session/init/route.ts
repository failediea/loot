import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { stark, ec, encode } from "starknet";
import { encrypt } from "@/lib/encryption";
import { db } from "@/lib/db";
import { sessionCredentials } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Game contract policies for session approval
const GAME_CONTRACT = "0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c";
const VRF_CONTRACT = "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f";
const DUNGEON_CONTRACT = "0x00a67ef20b61a9846e1c82b411175e6ab167ea9f8632bd6c2091823c3629ec42";
const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const SESSION_POLICIES = {
  contracts: {
    [GAME_CONTRACT]: {
      methods: [
        { entrypoint: "new_game" },
        { entrypoint: "explore" },
        { entrypoint: "attack" },
        { entrypoint: "flee" },
        { entrypoint: "equip" },
        { entrypoint: "drop" },
        { entrypoint: "buy_items" },
        { entrypoint: "upgrade" },
        { entrypoint: "buy_potions" },
        { entrypoint: "receive_random_words" },
        { entrypoint: "slay_idle_adventurers" },
      ],
    },
    [VRF_CONTRACT]: {
      methods: [
        { entrypoint: "request_random" },
        { entrypoint: "submit_random" },
      ],
    },
    [DUNGEON_CONTRACT]: {
      methods: [
        { entrypoint: "enter_dungeon" },
        { entrypoint: "claim_dungeon_reward" },
      ],
    },
    [STRK_TOKEN]: {
      methods: [
        { entrypoint: "approve" },
        { entrypoint: "transfer" },
      ],
    },
  },
};

const KEYCHAIN_URL = "https://x.cartridge.gg";
const RPC_URL = "https://api.cartridge.gg/x/starknet/mainnet";

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser();
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userId = parseInt(authUser.sub);

    // Generate a new session keypair
    const privateKey = stark.randomAddress();
    const publicKey = ec.starkCurve.getStarkKey(privateKey);

    // Store the private key encrypted in a pending session record
    // We'll finalize it when the keychain redirect comes back
    const privKeyHex = encode.addHexPrefix(privateKey);

    // Deactivate any existing sessions
    await db
      .update(sessionCredentials)
      .set({ isActive: false })
      .where(eq(sessionCredentials.userId, userId));

    // Store pending session with encrypted private key
    await db.insert(sessionCredentials).values({
      userId,
      sessionPrivEnc: encrypt(privKeyHex),
      sessionHash: "0x0", // Will be set on finalize
      sessionKeyGuid: "0x0", // Will be set on finalize
      ownerEip191: "0x0", // Will be set on finalize
      expiresAt: 0, // Will be set on finalize
      isActive: false, // Not active until finalized
      createdAt: new Date(),
    });

    // Build the keychain URL for session approval
    // Use the Host header to get the correct origin (not 0.0.0.0)
    const host = req.headers.get("host") || "localhost:3001";
    const protocol = req.headers.get("x-forwarded-proto") || "http";
    const redirectUrl = `${protocol}://${host}/`;
    let keychainUrl = `${KEYCHAIN_URL}/session?public_key=${publicKey}&redirect_uri=${encodeURIComponent(redirectUrl)}&redirect_query_name=startapp&rpc_url=${encodeURIComponent(RPC_URL)}`;
    keychainUrl += `&policies=${encodeURIComponent(JSON.stringify(SESSION_POLICIES))}`;

    return NextResponse.json({
      publicKey,
      keychainUrl,
    });
  } catch (error: any) {
    console.error("Session init error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
