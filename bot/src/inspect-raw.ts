import { num } from "starknet";

const TORII_URL = "https://api.cartridge.gg/x/pg-mainnet-10/torii";

function addAddressPadding(hex: string): string {
  const stripped = hex.replace("0x", "");
  return "0x" + stripped.padStart(64, "0");
}

async function main() {
  const gameId = 13218;
  const paddedId = addAddressPadding(num.toHex(gameId));
  const query = encodeURIComponent(
    `SELECT data FROM "event_messages_historical" WHERE keys = '${paddedId}/' LIMIT 5`
  );
  const url = TORII_URL + "/sql?query=" + query;
  const resp = await fetch(url);
  const rows = await resp.json();
  
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    console.log("--- Event " + i + " ---");
    const data = typeof rows[i].data === "string" ? JSON.parse(rows[i].data) : rows[i].data;
    console.log(JSON.stringify(data, null, 2).slice(0, 2000));
    console.log("");
  }
}
main();
