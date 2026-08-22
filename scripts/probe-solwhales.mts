import { getTokenLargestAccounts, getSlot } from "../src/sources/helius.js";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

async function main(): Promise<void> {
  const slot = await getSlot();
  console.log("rpc alive, slot:", slot);

  const top = await getTokenLargestAccounts(BONK);
  console.log(`largest accounts: ${top.length}`);
  for (const a of top.slice(0, 5)) {
    console.log(`  ${a.address.slice(0, 10)}… uiAmount=${(a.uiAmount / 1e9).toFixed(2)}B`);
  }
}

main();
