import { Bot, Context } from "grammy";
import { searchPairs, sortPairsByLiquidity } from "../../sources/dexscreener.js";
import { setPending } from "../pending.js";
import { esc } from "../format.js";

interface VlAnalysis {
  symbol: string;
  chainId: string;
  priceUsd: number;
  mcap: number;
  liquidityUsd: number;
  volH24: number;
  volH1: number;
  volM5: number;
  buysH24: number;
  sellsH24: number;
  liqMcRatio: number;
  volLiqRatio: number;
  buyPressure: number;
  volPerLiq: number;
  ageHours: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  signals: string[];
}

function analyzeVl(p: any): VlAnalysis {
  const price = p.priceUsd ? Number(p.priceUsd) : 0;
  const mc = p.marketCap ?? 0;
  const liq = p.liquidity?.usd ?? 0;
  const vol24 = p.volume?.h24 ?? 0;
  const vol1 = p.volume?.h1 ?? 0;
  const vol5 = p.volume?.m5 ?? 0;
  const buys = p.txns?.h24?.buys ?? 0;
  const sells = p.txns?.h24?.sells ?? 0;
  const ageMs = p.pairCreatedAt ? Date.now() - p.pairCreatedAt : Infinity;
  const ageHours = ageMs / 3_600_000;

  const liqMcRatio = mc > 0 && liq > 0 ? liq / mc : 0;
  const volLiqRatio = liq > 0 ? vol24 / liq : 0;
  const buyPressure = buys + sells > 0 ? buys / (buys + sells) : 0.5;
  const volPerLiq = liq > 0 ? vol24 / liq : 0;

  const signals: string[] = [];
  let riskScore = 0;

  // Liquidity health
  if (liqMcRatio < 0.02) {
    signals.push("🔴 liq/mc < 2% — EXTREME rug risk");
    riskScore += 4;
  } else if (liqMcRatio < 0.05) {
    signals.push("🟡 liq/mc < 5% — low liquidity");
    riskScore += 2;
  } else if (liqMcRatio > 0.15) {
    signals.push("🟢 liq/mc > 15% — strong liquidity floor");
    riskScore -= 1;
  }

  // Volume health
  if (vol24 > 0 && liq > 0) {
    if (volLiqRatio > 5) {
      signals.push("⚠️ vol/liq > 5x — suspicious volume spike");
      riskScore += 2;
    } else if (volLiqRatio > 2) {
      signals.push("📈 vol/liq > 2x — high trading activity");
    } else if (volLiqRatio < 0.1) {
      signals.push("📉 vol/liq < 0.1x — dead trading");
      riskScore += 1;
    } else {
      signals.push("✅ vol/liq healthy — organic trading");
      riskScore -= 1;
    }
  }

  // Buy pressure
  if (buyPressure > 0.7) {
    signals.push(`🟢 ${Math.round(buyPressure * 100)}% buys — strong buying pressure`);
  } else if (buyPressure < 0.3) {
    signals.push(`🔴 ${Math.round((1 - buyPressure) * 100)}% sells — heavy selling`);
    riskScore += 2;
  } else {
    signals.push(`➡️ ${Math.round(buyPressure * 100)}% buys — balanced`);
  }

  // Volume trend (compare M5 to H1 average)
  if (vol5 > 0 && vol1 > 0) {
    const h1AvgPer5 = vol1 / 12;
    const volTrend = vol5 / h1AvgPer5;
    if (volTrend > 2) {
      signals.push("🚀 volume surging — 5min is 2x+ above hourly avg");
    } else if (volTrend > 1.3) {
      signals.push("📈 volume picking up");
    } else if (volTrend < 0.5) {
      signals.push("📉 volume dying down");
    }
  }

  // Liquidity vs MC prediction
  if (liq > 0 && mc > 0) {
    if (liqMcRatio > 0.1 && vol24 > liq * 0.5) {
      signals.push("💎 strong base — liq supports current MC");
    }
    const projectedMc = liq / 0.05;
    if (projectedMc > mc * 2) {
      signals.push(`🎯 MC could 2x+ if liq/mc normalizes to 5%`);
    }
  }

  // Age risk
  if (ageHours < 1) {
    signals.push("⏰ < 1 hour old — extreme volatility");
    riskScore += 2;
  } else if (ageHours < 6) {
    signals.push("⏰ < 6 hours old — early but risky");
    riskScore += 1;
  } else if (ageHours > 168) {
    signals.push("✅ > 7 days old — survived initial dump");
    riskScore -= 1;
  }

  let riskLevel: VlAnalysis["riskLevel"];
  if (riskScore <= 0) riskLevel = "LOW";
  else if (riskScore <= 2) riskLevel = "MEDIUM";
  else if (riskScore <= 4) riskLevel = "HIGH";
  else riskLevel = "EXTREME";

  return {
    symbol: p.baseToken.symbol,
    chainId: p.chainId,
    priceUsd: price,
    mcap: mc,
    liquidityUsd: liq,
    volH24: vol24,
    volH1: vol1,
    volM5: vol5,
    buysH24: buys,
    sellsH24: sells,
    liqMcRatio,
    volLiqRatio,
    buyPressure,
    volPerLiq,
    ageHours,
    riskLevel,
    signals,
  };
}

export async function handleVl(ctx: Context, query: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(`📊 analyzing volume + liquidity for *$${esc(query)}*…`, { parse_mode: "Markdown" });
  try {
    const allPairs = sortPairsByLiquidity(await searchPairs(query));
    const best = allPairs.find(
      (p) => p.baseToken.symbol.toLowerCase() === query.toLowerCase()
    ) ?? allPairs[0];
    if (!best) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No token found for "$${query}".`);
      return;
    }

    const a = analyzeVl(best);

    const riskEmoji = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🟠", EXTREME: "🔴" };
    const fmt = (n: number) => {
      if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
      if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
      return `$${n.toFixed(2)}`;
    };

    const lines: string[] = [
      `📊 *VOLUME + LIQUIDITY — ${esc(a.symbol)}* (${a.chainId})`,
      "",
      `*Price:* $${a.priceUsd.toFixed(a.priceUsd < 0.001 ? 10 : a.priceUsd < 1 ? 6 : 4)}`,
      `*MC:* ${fmt(a.mcap)} · *Liq:* ${fmt(a.liquidityUsd)}`,
      `*Vol 24h:* ${fmt(a.volH24)} · *Vol 1h:* ${fmt(a.volH1)} · *Vol 5m:* ${fmt(a.volM5)}`,
      "",
      `*Ratios:*`,
      `• Liq/MC: ${(a.liqMcRatio * 100).toFixed(1)}%`,
      `• Vol/Liq: ${a.volLiqRatio.toFixed(2)}x`,
      `• Buy pressure: ${(a.buyPressure * 100).toFixed(0)}%`,
      "",
      `*Risk:* ${riskEmoji[a.riskLevel]} *${a.riskLevel}*`,
      "",
      ...a.signals.map((s) => `• ${s}`),
    ];

    const card = lines.join("\n").slice(0, 4000);
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, { parse_mode: "Markdown" });
  } catch (err) {
    const msg = (err as Error).message;
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ VL scan failed: ${msg}`);
    } catch {
      await ctx.reply(`⚠️ VL scan failed: ${msg}`);
    }
  }
}

export function registerVlCommand(bot: Bot): void {
  bot.command("vl", async (ctx) => {
    if (!ctx.chat) return;
    const query = ctx.match?.trim().replace(/^\$/, "");
    if (!query) {
      setPending(ctx.chat.id, "vl");
      await ctx.reply("📊 Send a token name to analyze volume + liquidity.\nExample: /vl pepe");
      return;
    }
    await handleVl(ctx, query);
  });
}
