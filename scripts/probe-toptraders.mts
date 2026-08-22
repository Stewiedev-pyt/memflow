import { searchPairs, sortPairsByLiquidity } from "../src/sources/dexscreener.js";
import { getPoolTrades, getPoolBaseToken, toGeckoNetwork } from "../src/sources/geckoterminal.js";

async function main(): Promise<void> {
  const pairs = sortPairsByLiquidity(await searchPairs("bonk")).filter((p) => p.chainId === "solana");
  const p = pairs[0];
  if (!p) {
    console.log("no solana bonk pair found");
    return;
  }
  console.log(`pool: ${p.pairAddress} base=${p.baseToken.symbol} (${p.baseToken.address})`);

  const network = toGeckoNetwork(p.chainId);
  const gtBase = await getPoolBaseToken(network!, p.pairAddress);
  console.log(`GT base token: ${gtBase} | matches ours: ${gtBase === p.baseToken.address.toLowerCase()}`);

  const trades = await getPoolTrades(network!, p.pairAddress, 800);
  console.log(`large trades fetched: ${trades.length}`);
  for (const t of trades.slice(0, 5)) {
    console.log(`  ${t.side.toUpperCase()} $${Math.round(t.usd)} wallet=${t.wallet.slice(0, 10)}…`);
  }
}

main();
