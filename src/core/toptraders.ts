export interface WalletTrade {
  wallet: string;
  side: "buy" | "sell";
  usd: number;
  ts: number;
}

interface WalletFlow {
  netUsd: number;
  trades: number;
  firstTs: number;
  lastTs: number;
}

const LEDGER_TTL_MS = 20 * 60_000;
const ledgers = new Map<string, Map<string, WalletFlow>>();

export function recordTrades(pairAddress: string, trades: WalletTrade[]): void {
  let ledger = ledgers.get(pairAddress);
  if (!ledger) {
    ledger = new Map();
    ledgers.set(pairAddress, ledger);
  }
  for (const t of trades) {
    const ts = t.ts || Date.now();
    let f = ledger.get(t.wallet);
    if (!f) {
      f = { netUsd: 0, trades: 0, firstTs: ts, lastTs: ts };
      ledger.set(t.wallet, f);
    }
    f.netUsd += t.side === "buy" ? t.usd : -t.usd;
    f.trades++;
    if (f.lastTs < ts) f.lastTs = ts;
  }
}

export interface TopTraderConsensus {
  trackedWallets: number;
  buyers: number;
  sellers: number;
  netUsd: number;
  verdict: "EXIT" | "ACCUMULATION" | null;
}

export function analyzeTopTraders(
  pairAddress: string,
  opts: {
    minNetUsd?: number;
    minWallets?: number;
    dominance?: number;
    netFlowThreshold?: number;
    windowMs?: number;
  } = {}
): TopTraderConsensus {
  const {
    minNetUsd = 1_000,
    minWallets = 3,
    dominance = 0.7,
    netFlowThreshold = 5_000,
    windowMs = LEDGER_TTL_MS,
  } = opts;

  const ledger = ledgers.get(pairAddress);
  if (!ledger) return { trackedWallets: 0, buyers: 0, sellers: 0, netUsd: 0, verdict: null };

  const cutoff = Date.now() - windowMs;
  let buyers = 0;
  let sellers = 0;
  let netUsd = 0;
  for (const [wallet, f] of ledger) {
    if (f.lastTs < cutoff) {
      ledger.delete(wallet);
      continue;
    }
    if (Math.abs(f.netUsd) < minNetUsd) continue;
    if (f.netUsd > 0) buyers++;
    else sellers++;
    netUsd += f.netUsd;
  }

  const tracked = buyers + sellers;
  let verdict: TopTraderConsensus["verdict"] = null;
  if (tracked >= minWallets && tracked > 0) {
    if (sellers / tracked >= dominance && netUsd <= -netFlowThreshold) verdict = "EXIT";
    else if (buyers / tracked >= dominance && netUsd >= netFlowThreshold) verdict = "ACCUMULATION";
  }

  return { trackedWallets: tracked, buyers, sellers, netUsd, verdict };
}
