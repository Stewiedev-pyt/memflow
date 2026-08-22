import { searchPairs } from "../src/sources/dexscreener.js";
import { auditEvmViaHoneypot, isEvmAddress } from "../src/sources/honeypot.js";

const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";

async function main(): Promise<void> {
  try {
    const pairs = await searchPairs(PEPE);
    const top = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    console.log("SEARCH PAIRS:", pairs.length);
    if (top) console.log("TOP:", top.baseToken.symbol, top.chainId, top.priceUsd, "liq", Math.round(top.liquidity?.usd ?? 0));
  } catch (e) {
    console.log("SEARCH ERROR:", (e as Error).message);
  }

  try {
    if (!isEvmAddress(PEPE)) {
      console.log("HONEYPOT: address failed isEvmAddress check?!");
    } else {
      const r = await auditEvmViaHoneypot(PEPE);
      console.log("HONEYPOT AUDIT:", r ? `${r.chainName} ${r.result.token?.symbol} honeypot=${r.result.honeypotResult?.isHoneypot}` : "null (no pool)");
    }
  } catch (e) {
    console.log("AUDIT ERROR:", (e as Error).message);
  }
}

main();
