import { RpcProvider, num } from "starknet";
async function main() {
  const provider = new RpcProvider({ nodeUrl: "https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9" });
  const GAME = "0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c";
  const response = await provider.callContract({
    contractAddress: GAME, entrypoint: "get_game_state", calldata: [num.toHex(187071)],
  });
  const hp = parseInt(response[0], 16);
  const xp = parseInt(response[1], 16);
  const gold = parseInt(response[2], 16);
  const beastHp = parseInt(response[3], 16);
  const statUpgrades = parseInt(response[4], 16);
  const actionCount = parseInt(response[29], 16);
  console.log(`HP=${hp} XP=${xp} Gold=${gold} BeastHP=${beastHp} Upgrades=${statUpgrades} Actions=${actionCount} Level=${Math.floor(xp/4)+1}`);
  if (hp <= 0) console.log("DEAD - Game Over");
  else console.log("ALIVE");
}
main().catch(console.error);
