import { RpcProvider } from "starknet";
import type { BotConfig } from "../config.js";

export function createProvider(config: BotConfig): RpcProvider {
  return new RpcProvider({ nodeUrl: config.rpcUrl });
}
