import { searchPairs, sortPairsByLiquidity } from "../src/sources/dexscreener.js";
import { auditEvmViaHoneypot } from "../src/sources/honeypot.js";
import { auditSolanaViaRugcheck } from "../src/sources/rugcheck.js";

const CASES: Array<{ label: string; query: string }> = [
  { label: "SOLANA meme", query: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" }, // BONK
  { label: "BNB meme", query: "0x965f527d9159dce6288a2219db51fc6eef120dd1" }, // BabyDoge
  { label: "ETH meme", query: "0x6982508145454ce325ddbe47a25d4ec3d2311933" }, // PEPE
];

async function main(): Promise<void> {
  for (const c of CASES) {
    try {
      const pairs = sortPairsByLiquidity(await searchPairs(c.query));
      const top = pairs[0];
      console.log(`${c.label}: ${pairs.length} pairs | top -> ${top?.baseToken.symbol} on ${top?.chainId} liq=$${Math.round(top?.liquidity?.usd ?? 0)}`);
    } catch (e) {
      console.log(`${c.label}: SEARCH ERROR ${(e as Error).message}`);
    }
  }

  const rc = await auditSolanaViaRugcheck("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
  console.log(`SOLANA audit (rugcheck): ${rc ? `score=${rc.score}` : "null"}`);

  const evm = await auditEvmViaHoneypot("0x965f527d9159dce6288a2219db51fc6eef120dd1");
  console.log(`BNB audit (honeypot): ${evm ? `${evm.chainName} ${evm.result.token?.symbol} honeypot=${evm.result.honeypotResult?.isHoneypot}` : "null"}`);
}

main();
