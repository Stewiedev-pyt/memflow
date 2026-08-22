import { PairSnapshot } from "./types.js";

export interface DistributionSignal {
  kind: "DISTRIBUTION" | "HEAVY_SELLING" | "ACCUMULATION";
  sellShare: number;
  priceChangePct: number;
  windowMinutes: number;
}

const MIN_SNAPSHOTS = 6;
const WINDOW = 10;

export function analyzeDistribution(history: PairSnapshot[]): DistributionSignal | null {
  if (history.length < MIN_SNAPSHOTS) return null;
  const w = history.slice(-WINDOW);

  const totalBuys = w.reduce((a, s) => a + (s.buysM5 ?? 0), 0);
  const totalSells = w.reduce((a, s) => a + (s.sellsM5 ?? 0), 0);
  const totalTx = totalBuys + totalSells;
  if (totalTx < 20) return null;

  const sellShare = totalSells / totalTx;

  const prices = w.map((s) => s.priceUsd).filter((p): p is number => Number.isFinite(p));
  if (prices.length < 2 || !prices[0]) return null;
  const priceChangePct = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;

  const spanMs = w[w.length - 1].ts - w[0].ts;
  const windowMinutes = Math.max(1, Math.round(spanMs / 60_000));

  let kind: DistributionSignal["kind"] | null = null;
  if (sellShare >= 0.62 && priceChangePct >= 2) kind = "DISTRIBUTION";
  else if (sellShare >= 0.62 && priceChangePct <= -3) kind = "HEAVY_SELLING";
  else if (sellShare <= 0.38 && priceChangePct <= -2) kind = "ACCUMULATION";

  if (!kind) return null;
  return { kind, sellShare, priceChangePct, windowMinutes };
}

export function describeDistribution(sig: DistributionSignal): string[] {
  const share = `${Math.round(sig.sellShare * 100)}% of txns were SELLS`;
  switch (sig.kind) {
    case "DISTRIBUTION":
      return [
        `🐋 ${share} over ~${sig.windowMinutes} min`,
        `while price still climbing (+${sig.priceChangePct.toFixed(1)}%)`,
        "→ someone is selling INTO strength — classic distribution",
      ];
    case "HEAVY_SELLING":
      return [
        `🔴 ${share} over ~${sig.windowMinutes} min`,
        `price bleeding (${sig.priceChangePct.toFixed(1)}%)`,
        "→ momentum broken, sellers in control",
      ];
    case "ACCUMULATION":
      return [
        `👀 buyers absorbing ${Math.round((1 - sig.sellShare) * 100)}% of pressure`,
        `during dip (${sig.priceChangePct.toFixed(1)}%)`,
        "→ quiet accumulation pattern forming",
      ];
  }
}
