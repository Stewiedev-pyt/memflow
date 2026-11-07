import { Bot, Context } from "grammy";
import {
  searchPairs,
  getTokenProfile,
  sortPairsByLiquidity,
  DexPair,
} from "../../sources/dexscreener.js";
import { toGeckoNetwork, getPoolTrades, PoolTrade } from "../../sources/geckoterminal.js";
import {
  getContractCreator,
  getTokenBalance,
  getRecentTokenTransfers,
} from "../../sources/etherscan.js";
import { getTokenCreator } from "../../sources/pumpfun.js";
import {
  getSolTokenBalance,
  getTokenSupply,
  getTokenLargestAccounts,
} from "../../sources/helius.js";
import { setPending } from "../pending.js";
import { esc, fmtUsd, fmtMcap } from "../format.js";

/** Entry: buys must meaningfully outpace sells. */
const ENTRY_BUY_RATIO = 0.6;
/** Dip: this much of recent flow selling = distribution / rug risk. */
const DIP_SELL_SHARE = 0.5;
/** Skip pools thinner than this. */
const MIN_LIQ_USD = 25_000;
/** Order size at or above this counts as whale-sized. */
const WHALE_USD = 4_000;
/** How many top traders to balance-check. */
const TOP_N = 10;
const DEAD = /^0x0{40}$/;

/** Raw contract address — pasting one auto-runs the check. */
export const CA_RE = /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

type Verdict = "pass" | "warn" | "fail";

interface Stage {
  title: string;
  lines: string[];
  verdict: Verdict;
}

const ICON: Record<Verdict, string> = { pass: "✅", warn: "⚠️", fail: "❌" };

function pct(x: number): string {
  return `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;
}

function short(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function ageStr(createdMs?: number): string {
  if (!createdMs) return "unknown";
  const diff = Date.now() - createdMs;
  const h = diff / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.floor(diff / 60_000))}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

async function resolvePair(query: string): Promise<DexPair | null> {
  const q = query.trim().replace(/^\$/, "");
  if (CA_RE.test(q)) {
    try {
      const byAddr = await getTokenProfile(q);
      if (byAddr) return byAddr;
    } catch {
      /* fall through to search */
    }
  }
  const pairs = sortPairsByLiquidity(await searchPairs(q));
  if (pairs.length === 0) return null;
  const exact = pairs.find((p) => p.baseToken.symbol.toLowerCase() === q.toLowerCase());
  return exact ?? pairs[0];
}

/** Balance for a wallet on the token — null means "could not read". */
async function balanceOf(wallet: string, p: DexPair, isEvm: boolean): Promise<number | null> {
  try {
    if (isEvm) {
      // Raw units; > 0 means the wallet still holds something.
      const raw = await getTokenBalance(wallet, p.baseToken.address);
      return raw > 0 ? 1 : 0;
    }
    return await getSolTokenBalance(wallet, p.baseToken.address);
  } catch {
    return null;
  }
}

/* -- Stage 1: volume ------------------------------------------------ */

function stageVolume(p: DexPair, trades: PoolTrade[]): Stage {
  const win = (k: string) => p.txns?.[k] ?? { buys: 0, sells: 0 };
  const m5 = win("m5");
  const h1 = win("h1");
  const h24 = win("h24");
  const ratio = (b: number, s: number) => (b + s > 0 ? b / (b + s) : 0.5);

  const r5 = ratio(m5.buys, m5.sells);
  const r1 = ratio(h1.buys, h1.sells);
  const r24 = ratio(h24.buys, h24.sells);

  // USD-weighted flow from GeckoTerminal when available.
  const buysT = trades.filter((t) => t.side === "buy");
  const sellsT = trades.filter((t) => t.side === "sell");
  const buyUsd = buysT.reduce((a, t) => a + t.usd, 0);
  const sellUsd = sellsT.reduce((a, t) => a + t.usd, 0);
  const totalUsd = buyUsd + sellUsd;
  const sellShare = totalUsd > 0 ? sellUsd / totalUsd : 1 - ratio(h1.buys, h1.sells);
  const whaleUsd = buysT.filter((t) => t.usd >= WHALE_USD).reduce((a, t) => a + t.usd, 0);
  const whaleShare = buyUsd > 0 ? whaleUsd / buyUsd : 0;

  const accel =
    r5 > r1 + 0.05 ? "accelerating" : r5 < r1 - 0.05 ? "fading" : "steady";

  const lines = [
    `5m     ${m5.buys}b / ${m5.sells}s  -> ${pct(r5)}  ${accel}`,
    `1h     ${h1.buys}b / ${h1.sells}s  -> ${pct(r1)}`,
    `24h    ${h24.buys}b / ${h24.sells}s  -> ${pct(r24)}`,
    `size   whale ${pct(whaleShare)} of buy $ (>= $4K orders)`,
    `sell   ${pct(sellShare)} of recent $ flow`,
  ];

  if (sellShare >= DIP_SELL_SHARE) {
    lines.push(`DIP - ${pct(sellShare)} selling >= ${pct(DIP_SELL_SHARE)} threshold`);
    lines.push(`heavy distribution, possible rug in progress`);
    return { title: "VOLUME", lines, verdict: "fail" };
  }
  if (r1 >= ENTRY_BUY_RATIO) {
    lines.push(`ENTRY - buys ${pct(r1)} >= ${pct(ENTRY_BUY_RATIO)}, volume pushing up`);
    return { title: "VOLUME", lines, verdict: "pass" };
  }
  lines.push(`WAIT - buys ${pct(r1)} below ${pct(ENTRY_BUY_RATIO)} entry threshold`);
  return { title: "VOLUME", lines, verdict: "warn" };
}

/* -- Stage 2: liquidity -------------------------------------------- */

function stageLiquidity(p: DexPair): Stage {
  const liq = p.liquidity?.usd ?? 0;
  const mc = p.marketCap ?? p.fdv ?? 0;
  const vol24 = p.volume?.h24 ?? 0;
  const liqMc = mc > 0 && liq > 0 ? liq / mc : 0;
  const turnover = liq > 0 ? vol24 / liq : 0;

  const lines = [
    `liq    ${fmtUsd(liq)}  ·  mcap ${fmtMcap(mc)}`,
    `liq/mc ${pct(liqMc)}  ·  vol24/liq ${turnover.toFixed(1)}x turnover`,
  ];

  let verdict: Verdict;
  if (liq < MIN_LIQ_USD) {
    lines.push(`liq ${fmtUsd(liq)} below ${fmtUsd(MIN_LIQ_USD)} floor - dust pool`);
    verdict = "fail";
  } else if (liqMc >= 0.15) {
    lines.push(`strong floor - liquidity ahead of mcap`);
    verdict = "pass";
  } else if (liqMc >= 0.05) {
    lines.push(`healthy - volume can deepen LP (${turnover.toFixed(1)}x turnover)`);
    verdict = "pass";
  } else {
    lines.push(`thin floor - volume must catch up to mcap first`);
    verdict = "warn";
  }
  return { title: "LIQUIDITY", lines, verdict };
}

/* -- Stage 3: top traders - holding vs sold ------------------------ */

async function stageTopTraders(p: DexPair, trades: PoolTrade[], isEvm: boolean): Promise<Stage> {
  const byWallet = new Map<string, { usd: number; buys: number; sells: number; net: number }>();
  for (const t of trades) {
    const key = t.wallet.toLowerCase();
    const e = byWallet.get(key) ?? { usd: 0, buys: 0, sells: 0, net: 0 };
    e.usd += t.usd;
    if (t.side === "buy") {
      e.buys++;
      e.net += t.usd;
    } else {
      e.sells++;
      e.net -= t.usd;
    }
    byWallet.set(key, e);
  }

  const top = [...byWallet.entries()]
    .map(([wallet, v]) => ({ wallet, ...v }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, TOP_N);

  if (top.length === 0) {
    return {
      title: "TOP TRADERS",
      lines: ["no trades in window - GeckoTerminal returned nothing"],
      verdict: "warn",
    };
  }

  let holding = 0;
  let exited = 0;
  let unknown = 0;
  const bigExits: string[] = [];

  for (const t of top) {
    const bal = await balanceOf(t.wallet, p, isEvm);
    if (bal === null) unknown++;
    else if (bal > 0) holding++;
    else {
      exited++;
      if (t.net >= 5_000) bigExits.push(`${fmtUsd(t.net)} bought then fully exited`);
    }
  }

  const known = holding + exited;
  const lines = [
    `still holding  ${pct(known > 0 ? holding / known : 0)}  (${holding})`,
    `already sold    ${pct(known > 0 ? exited / known : 0)}  (${exited})`,
  ];
  if (unknown > 0) lines.push(`unreadable ${unknown} (rpc)`);
  if (bigExits.length > 0) lines.push(`WARN ${bigExits[0]} - distribution`);

  let verdict: Verdict = "pass";
  if (known === 0) verdict = "warn";
  else if (exited / known >= 0.6) verdict = "warn";
  else if (bigExits.length > 0) verdict = "warn";

  return { title: `TOP TRADERS (of ${top.length})`, lines, verdict };
}

/* -- Stage 4: dev + whale side wallets ----------------------------- */

async function stageDev(p: DexPair, isEvm: boolean): Promise<Stage> {
  const addr = p.baseToken.address;
  const lines: string[] = [];
  let verdict: Verdict = "warn";

  let dev: string | null = null;
  try {
    dev = isEvm ? await getContractCreator(addr) : await getTokenCreator(addr);
  } catch {
    dev = null;
  }

  if (!dev) {
    lines.push("dev wallet not resolvable on this chain");
    return { title: "DEV / WHALE", lines, verdict };
  }

  const devBal = await balanceOf(dev, p, isEvm);
  lines.push(
    `dev ${short(dev)} - ${
      devBal === null ? "unreadable" : devBal > 0 ? "still holding" : "exited / none left"
    }`
  );

  if (isEvm) {
    try {
      const transfers = await getRecentTokenTransfers(addr);
      const recipients = [
        ...new Set(
          transfers
            .filter((t) => t.from.toLowerCase() === dev.toLowerCase())
            .map((t) => t.to.toLowerCase())
        ),
      ].filter((a) => a !== dev.toLowerCase() && !DEAD.test(a));

      if (recipients.length > 0) {
        lines.push(
          `${recipients.length} wallet(s) received tokens from dev -> possible side wallets`
        );
        lines.push(recipients.slice(0, 3).map((a) => short(a)).join("  "));
        verdict = "warn";
      } else {
        lines.push(`no direct dev -> wallet transfers`);
        verdict = devBal !== null && devBal > 0 ? "pass" : "warn";
      }
    } catch {
      lines.push(`side-wallet trace unavailable (etherscan)`);
    }
  } else {
    // Solana: whale concentration from top token accounts vs supply.
    try {
      const [largest, supply] = await Promise.all([
        getTokenLargestAccounts(addr),
        getTokenSupply(addr),
      ]);
      const top5 = largest.slice(0, 5).reduce((a, h) => a + h.uiAmount, 0);
      if (supply > 0) {
        const conc = top5 / supply;
        lines.push(`top-5 holders control ${pct(conc)} of supply`);
        if (devBal !== null && devBal > 0 && conc < 0.5) verdict = "pass";
      }
      lines.push(`side-wallet trace: Solana needs per-signer parse (not yet wired)`);
    } catch {
      lines.push(`whale concentration unavailable (helius)`);
    }
  }

  return { title: "DEV / WHALE", lines, verdict };
}

/* -- Card assembly -------------------------------------------------- */

function refreshKeyboard(address: string) {
  return {
    inline_keyboard: [[{ text: "refresh", callback_data: `check_${address}` }]],
  };
}

async function buildCard(p: DexPair): Promise<{ card: string; verdict: Verdict }> {
  const isEvm = p.baseToken.address.startsWith("0x");
  const network = toGeckoNetwork(p.chainId);

  let trades: PoolTrade[] = [];
  if (network) {
    try {
      trades = await getPoolTrades(network, p.pairAddress, 50);
    } catch {
      trades = [];
    }
  }

  const stages: Stage[] = [];
  stages.push(stageVolume(p, trades));
  stages.push(stageLiquidity(p));

  try {
    stages.push(await stageTopTraders(p, trades, isEvm));
  } catch {
    stages.push({ title: "TOP TRADERS", lines: ["analysis failed"], verdict: "warn" });
  }

  try {
    stages.push(await stageDev(p, isEvm));
  } catch {
    stages.push({ title: "DEV / WHALE", lines: ["analysis failed"], verdict: "warn" });
  }

  const change24 = p.priceChange?.h24;
  const changeStr =
    change24 !== undefined ? `  ${change24 > 0 ? "+" : ""}${change24.toFixed(1)}%` : "";

  const lines: string[] = [
    `CHECK - ${esc(p.baseToken.symbol)} (${p.chainId})`,
    `${fmtUsd(p.liquidity?.usd)} liq | ${fmtMcap(p.marketCap ?? p.fdv ?? null)} mcap | age ${ageStr(p.pairCreatedAt)}${changeStr}`,
    "",
  ];

  const counts: Record<Verdict, number> = { pass: 0, warn: 0, fail: 0 };
  for (const s of stages) {
    counts[s.verdict]++;
    lines.push(`${ICON[s.verdict]} ${s.title}`);
    for (const l of s.lines) lines.push(`   ${l}`);
    lines.push("");
  }

  let headline: string;
  if (counts.fail > 0) headline = `SKIP - ${counts.fail} failed check(s)`;
  else if (counts.warn > 0) headline = `WAIT - ${counts.pass} pass, ${counts.warn} warn`;
  else headline = `ENTER - all ${counts.pass} checks passed`;

  lines.push(`--------------`);
  lines.push(headline);
  lines.push(`signals only, not financial advice.`);

  const worst: Verdict = counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass";
  return { card: lines.join("\n").slice(0, 3900), verdict: worst };
}

/* -- Entry points --------------------------------------------------- */

export async function handleCheck(
  ctx: Context,
  query: string,
  targetMsgId?: number
): Promise<void> {
  if (!ctx.chat) return;
  const chatId = ctx.chat.id;

  let msgId = targetMsgId;
  if (!msgId) {
    const thinking = await ctx.reply(`checking ${esc(query)}...`, { parse_mode: "Markdown" });
    msgId = thinking.message_id;
  } else {
    try {
      await ctx.api.editMessageText(chatId, msgId, `refreshing...`);
    } catch {
      /* ignore */
    }
  }

  try {
    const pair = await resolvePair(query);
    if (!pair) {
      await ctx.api.editMessageText(chatId, msgId, `No token found for "${esc(query)}".`);
      return;
    }
    const { card } = await buildCard(pair);
    await ctx.api.editMessageText(chatId, msgId, card, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
      reply_markup: refreshKeyboard(pair.baseToken.address),
    });
  } catch (err) {
    const msg = (err as Error).message;
    try {
      await ctx.api.editMessageText(chatId, msgId, `check failed: ${esc(msg)}`);
    } catch {
      await ctx.reply(`check failed: ${esc(msg)}`);
    }
  }
}

export function registerCheckCommand(bot: Bot): void {
  bot.command("check", async (ctx) => {
    if (!ctx.chat) return;
    const query = ctx.match?.trim();
    if (!query) {
      setPending(ctx.chat.id, "check");
      await ctx.reply(
        "Send a token name or contract address for the full entry check.\n\n" +
          "Checks: volume -> liquidity -> top traders -> dev/whale\n\n" +
          "Example: /check pepe - or just paste a CA.",
        { parse_mode: "Markdown" }
      );
      return;
    }
    await handleCheck(ctx, query);
  });

  // refresh button - re-runs all four stages on the same address.
  bot.callbackQuery(/^check_(.+)$/, async (ctx) => {
    const address = ctx.match[1];
    await ctx.answerCallbackQuery({ text: "refreshing..." }).catch(() => undefined);
    if (!ctx.chat) return;
    const msgId = ctx.callbackQuery.message?.message_id;
    await handleCheck(ctx, address, msgId);
  });
}
