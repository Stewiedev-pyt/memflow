import { MemflowAgent } from "./index.js";
import readline from "readline";

const agent = new MemflowAgent({
  onCall: (calls) => {
    console.log("\n🎯 ═══════════════════════════════════════");
    console.log("   NEW CALLS DETECTED");
    console.log("═══════════════════════════════════════════\n");
    for (const c of calls) {
      const risk = c.riskLevel === "LOW" ? "🟢" : c.riskLevel === "MEDIUM" ? "🟡" : "🟠";
      console.log(`${risk} ${c.symbol} (${c.chainId}) — score ${c.score}`);
      console.log(`   Entry: $${c.entryPrice} → TP1: $${c.target1} → TP2: $${c.target2} | SL: $${c.stopLoss}`);
      console.log(`   MC $${c.mcap} | Liq $${c.liquidityUsd} | Vol $${c.volH24} | Buys ${(c.buyPressure * 100).toFixed(0)}%`);
      console.log(`   CA: ${c.tokenAddress}`);
      console.log("");
    }
  },
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("╔══════════════════════════════════════════╗");
console.log("║         MEMFLOW AGENT v1.0               ║");
console.log("║  Type 'help' for commands                ║");
console.log("║  Type 'auto' to start auto mode          ║");
console.log("║  Type 'quit' to exit                     ║");
console.log("╚══════════════════════════════════════════╝\n");

function prompt() {
  rl.question("memflow> ", async (input) => {
    const text = input.trim();
    if (!text) { prompt(); return; }
    if (text === "quit" || text === "exit") { rl.close(); process.exit(0); }
    if (text === "auto") {
      agent.startAuto();
      console.log("✅ Auto mode started. Calls will appear periodically.\n");
      prompt();
      return;
    }
    if (text === "stop") {
      agent.stopAuto();
      console.log("⏹️ Auto mode stopped.\n");
      prompt();
      return;
    }

    console.log("⏳ processing...");
    const response = await agent.process(text);

    if (!response.success) {
      console.log(`❌ ${response.error}\n`);
    } else if (response.action === "scan" && response.data) {
      const d = response.data;
      console.log(`\n🔍 ${d.symbol} (${d.chain}) — ${d.name}`);
      console.log(`   Price: $${d.price} | MC: $${d.mcap} | Liq: $${d.liquidity}`);
      console.log(`   Vol 24h: $${d.volume24h} | 24h: ${d.priceChange24h}% | 1h: ${d.priceChange1h}%`);
      console.log(`   Buys/Sells: ${d.buys24h}/${d.sells24h} | Age: ${d.ageHours?.toFixed(1)}h`);
      if (d.tech) {
        console.log(`   Trend: ${d.tech.trend} | RSI: ${d.tech.rsiValue?.toFixed(0)}`);
      }
      console.log(`   CA: ${d.tokenAddress}\n`);
    } else if (response.action === "calls" && response.data) {
      for (const c of response.data) {
        const risk = c.riskLevel === "LOW" ? "🟢" : c.riskLevel === "MEDIUM" ? "🟡" : "🟠";
        console.log(`\n${risk} ${c.symbol} (${c.chainId}) — score ${c.score}`);
        console.log(`   Entry: $${c.entryPrice} → TP1: $${c.target1} → TP2: $${c.target2} | SL: $${c.stopLoss}`);
        console.log(`   MC $${c.mcap} | Liq $${c.liquidityUsd} | Vol $${c.volH24} | Buys ${(c.buyPressure * 100).toFixed(0)}%`);
        console.log(`   Why: ${c.reasons.join(" · ")}`);
        console.log(`   CA: ${c.tokenAddress}`);
      }
      console.log("");
    } else if (response.action === "audit" && response.data) {
      const d = response.data;
      console.log(`\n🔒 AUDIT — ${d.symbol} (${d.chain})`);
      console.log(`   Risk: ${d.riskScore}`);
      if (d.honeypot) console.log(`   Honeypot: ${d.honeypot.isHoneypot ? "YES" : "No"} | Buy tax: ${d.honeypot.buyTax}% | Sell tax: ${d.honeypot.sellTax}%`);
      if (d.rugcheck) console.log(`   RugCheck: ${d.rugcheck.score}`);
      console.log("");
    } else if (response.action === "holders" && response.data) {
      const d = response.data;
      console.log(`\n🐋 HOLDERS — ${d.symbol} (${d.chain})`);
      console.log(`   Whales: ${d.categories.whales.count} (${d.categories.whales.pct.toFixed(1)}%)`);
      console.log(`   Sharks: ${d.categories.sharks.count} (${d.categories.sharks.pct.toFixed(1)}%)`);
      console.log(`   Fish: ${d.categories.fish.count} (${d.categories.fish.pct.toFixed(1)}%)`);
      console.log(`   Small: ${d.categories.small.count} (${d.categories.small.pct.toFixed(1)}%)\n`);
    } else if (response.action === "gems" && response.data) {
      console.log(`\n💎 GEMS — ${response.data.length} found:`);
      for (const g of response.data.slice(0, 10)) {
        console.log(`   ${g.symbol} (${g.chain}) — MC $${g.mcap} | Liq $${g.liquidity} | Vol $${g.volume}`);
      }
      console.log("");
    } else if (response.action === "market" && response.data) {
      const m = response.data.market;
      const f = response.data.fearGreed;
      if (m) {
        console.log(`\n📊 MARKET`);
        console.log(`   MC: $${(m.totalMarketCapUsd / 1e12).toFixed(2)}T | Vol: $${(m.totalVolumeUsd / 1e9).toFixed(2)}B`);
        console.log(`   BTC Dom: ${m.btcDominance.toFixed(1)}% | ETH Dom: ${m.ethDominance.toFixed(1)}%`);
        for (const c of m.topCoins.slice(0, 5)) {
          console.log(`   ${c.symbol}: $${c.priceUsd.toLocaleString()} (${c.priceChange24h > 0 ? "+" : ""}${c.priceChange24h.toFixed(1)}%)`);
        }
      }
      if (f) console.log(`\n   Fear & Greed: ${f.value}/100 — ${f.classification}`);
      console.log("");
    } else if (response.action === "help") {
      console.log("\nAvailable commands:");
      for (const cmd of response.data.commands) {
        console.log(`   ${cmd}`);
      }
      console.log("");
    } else {
      console.log(JSON.stringify(response.data, null, 2) + "\n");
    }

    prompt();
  });
}

prompt();
