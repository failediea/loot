import dotenv from "dotenv";
dotenv.config();

export interface BotConfig {
  accountAddress: string;
  rpcUrl: string;
  chainId: string;
  mode: "single" | "continuous";
  gameAddress: string;
  dungeonAddress: string;
  vrfProviderAddress: string;
  ticketTokenAddress: string;
  strkTokenAddress: string;
  ekuboRouterAddress: string;
}

export function loadConfig(): BotConfig {
  return {
    accountAddress: "0x02eb8e6459a39d3ac8a2f52ab17084b259beed1f705c0cae9caae4cffe391d8e",
    rpcUrl: process.env.STARKNET_RPC_URL || "https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9",
    chainId: "0x534e5f4d41494e",
    mode: (process.env.BOT_MODE as "single" | "continuous") || "single",
    gameAddress: "0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c",
    dungeonAddress: "0x00a67ef20b61a9846e1c82b411175e6ab167ea9f8632bd6c2091823c3629ec42",
    vrfProviderAddress: "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f",
    ticketTokenAddress: "0x0452810188C4Cb3AEbD63711a3b445755BC0D6C4f27B923fDd99B1A118858136",
    strkTokenAddress: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    ekuboRouterAddress: "0x0199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4fb8737e",
  };
}
