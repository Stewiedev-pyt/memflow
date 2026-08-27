import { getSignatures } from "../sources/wallet.js";
import { getPairsByAddresses } from "../sources/dexscreener.js";
import { getCopyRules, wasRecentlyCopied, markCopied, incrementCopyCount } from "../bot/commands/copy.js";
import { config } from "../config.js";

const lastSeenSig = new Map<string, string>();
const CHECK_INTERVAL_MS = 5 * 60_000;
const lastCheckAt = new Map<string, number>();

export interface CopyTradeAlert {
  ruleId: string;
  chatId: number;
  wallet: string;
  label: string;
  tokenAddress: string;
  pairAddress: string;
  symbol: string;
  chain: string;
  price: number;
  mcap: number;
  txSignature: string;
  autoBuy: boolean;
  buyAmountSol: number;
}

async function heliusPost<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${config.heliusKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`helius ${method} ${res.status}`);
  const data = (await res.json()) as { error?: { message?: string }; result?: T };
  if (data.error) throw new Error(`helius ${method}: ${data.error.message ?? "unknown"}`);
  return data.result as T;
}

interface Instruction {
  programId: string;
  accounts: string[];
  data: string;
}

interface TxMeta {
  err: unknown;
  preTokenBalances: Array<{ accountIndex: number; mint: string; uiTokenAmount: { uiAmount: number | null } }>;
  postTokenBalances: Array<{ accountIndex: number; mint: string; uiTokenAmount: { uiAmount: number | null } }>;
}

interface ParsedTx {
  slot: number;
  blockTime: number | null;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string }>;
      instructions: Instruction[];
    };
  };
  meta: TxMeta;
}

const SWAP_PROGRAMS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
]);

function extractMintsFromTx(tx: ParsedTx): Map<string, { delta: number; mint: string }> {
  const mints = new Map<string, { delta: number; mint: string }>();
  const pre = new Map<string, number>();
  const post = new Map<string, number>();

  for (const b of tx.meta.preTokenBalances ?? []) {
    const key = `${b.accountIndex}:${b.mint}`;
    pre.set(key, b.uiTokenAmount.uiAmount ?? 0);
  }
  for (const b of tx.meta.postTokenBalances ?? []) {
    const key = `${b.accountIndex}:${b.mint}`;
    post.set(key, b.uiTokenAmount.uiAmount ?? 0);
  }

  const allKeys = new Set([...pre.keys(), ...post.keys()]);
  for (const key of allKeys) {
    const [, mint] = key.split(":");
    if (mint === "So11111111111111111111111111111111111111112") continue;
    const before = pre.get(key) ?? 0;
    const after = post.get(key) ?? 0;
    const delta = after - before;
    if (delta > 0) {
      mints.set(mint, { delta, mint });
    }
  }
  return mints;
}

function isSwapTx(tx: ParsedTx): boolean {
  const programs = tx.transaction.message.instructions.map((ix) => ix.programId);
  return programs.some((p) => SWAP_PROGRAMS.has(p));
}

export async function checkCopyTrades(bot: { api: { sendMessage: (chatId: number, msg: string, opts?: any) => Promise<any> } }): Promise<void> {
  if (!config.heliusKey) return;

  const rules = getCopyRules();
  if (rules.length === 0) return;

  const now = Date.now();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const lastCheck = lastCheckAt.get(rule.id) ?? 0;
    if (now - lastCheck < CHECK_INTERVAL_MS) continue;
    lastCheckAt.set(rule.id, now);

    try {
      const sigs = await getSignatures(rule.walletAddress, 10);
      if (sigs.length === 0) continue;

      const lastSeen = lastSeenSig.get(rule.walletAddress);
      const newSigs = lastSeen
        ? sigs.filter((s) => s.signature !== lastSeen && !s.err)
        : [];

      lastSeenSig.set(rule.walletAddress, sigs[0].signature);

      if (newSigs.length === 0) continue;

      for (const sig of newSigs.slice(0, 5)) {
        try {
          const tx = await heliusPost<ParsedTx | null>("getTransaction", [
            sig.signature,
            { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
          ]);

          if (!tx || !isSwapTx(tx)) continue;

          const mints = extractMintsFromTx(tx);
          if (mints.size === 0) continue;

          for (const [tokenAddress] of mints) {
            if (wasRecentlyCopied(rule.walletAddress, tokenAddress)) continue;

            const pairs = await getPairsByAddresses([tokenAddress]).catch(() => []);
            if (pairs.length === 0) continue;

            const pair = pairs[0];
            const symbol = pair.baseToken?.symbol ?? "UNKNOWN";
            const chain = pair.chainId ?? "unknown";
            const price = parseFloat(pair.priceUsd ?? "0");
            const mcap = pair.marketCap ?? 0;

            markCopied(rule.walletAddress, tokenAddress);
            incrementCopyCount(rule.id);

            const alert: CopyTradeAlert = {
              ruleId: rule.id,
              chatId: rule.chatId,
              wallet: rule.walletAddress,
              label: rule.label || rule.walletAddress.slice(0, 8),
              tokenAddress,
              pairAddress: pair.pairAddress ?? tokenAddress,
              symbol,
              chain,
              price,
              mcap,
              txSignature: sig.signature,
              autoBuy: rule.autoBuy,
              buyAmountSol: rule.buyAmountSol,
            };

            await sendCopyAlert(bot, alert);
          }
        } catch {
          // individual tx parse failure — skip
        }
      }
    } catch {
      // wallet check failure — skip, will retry next interval
    }
  }
}

async function sendCopyAlert(
  bot: { api: { sendMessage: (chatId: number, msg: string, opts?: any) => Promise<any> } },
  alert: CopyTradeAlert
): Promise<void> {
  const filters = [];
  if (alert.mcap > 0) filters.push(`MC $${alert.mcap.toLocaleString()}`);
  if (alert.price > 0) filters.push(`$${alert.price}`);

  const autoNote = alert.autoBuy
    ? `\n🤖 Auto-buy: ${alert.buyAmountSol} SOL`
    : "\n🔔 Alert only — use /copy config to enable auto-buy";

  const msg = [
    `🎯 <b>COPY TRADE DETECTED</b>`,
    "",
    `Wallet: <code>${alert.label}</code>`,
    `Token: <b>${alert.symbol}</b> (${alert.chain})`,
    `Price: $${alert.price}`,
    ...filters.length ? [`MC: $${alert.mcap.toLocaleString()}`] : [],
    "",
    `<a href="https://solscan.io/tx/${alert.txSignature}">View TX</a>`,
    `<a href="https://dexscreener.com/solana/${alert.pairAddress}">Chart</a>`,
    autoNote,
  ].join("\n");

  try {
    await bot.api.sendMessage(alert.chatId, msg, { parse_mode: "HTML" });
  } catch (e) {
    console.error(`[copytrade] send to ${alert.chatId} failed:`, (e as Error).message);
  }
}
