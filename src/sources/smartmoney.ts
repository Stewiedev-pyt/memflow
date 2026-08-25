export interface SmartMoneySignal {
  signalId: number;
  ticker: string;
  chainId: string;
  contractAddress: string;
  direction: string;
  smartMoneyCount: number;
  alertPrice: string;
  currentPrice: string;
  maxGain: string;
  exitRate: number;
  status: string;
  totalTokenValue: string;
  signalTriggerTime: number;
  launchPlatform: string;
  highestPrice: string;
}

export async function getSmartMoneySignals(chain: string = "solana", limit: number = 20): Promise<SmartMoneySignal[]> {
  try {
    const chainId = chain === "solana" ? "CT_501" : chain === "bsc" ? "56" : chain === "ethereum" ? "1" : "CT_501";
    const res = await fetch("https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/web/signal/smart-money/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
        "User-Agent": "binance-web3/1.1",
      },
      body: JSON.stringify({
        smartSignalType: "",
        page: 1,
        pageSize: limit,
        chainId,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return [];
    const data = await res.json() as { data?: SmartMoneySignal[]; success?: boolean };
    if (!data.success || !data.data) return [];
    return data.data;
  } catch {
    return [];
  }
}

export async function getSmartMoneyAllChains(limit: number = 10): Promise<SmartMoneySignal[]> {
  const chains = ["solana", "bsc", "ethereum"];
  const results = await Promise.allSettled(
    chains.map((c) => getSmartMoneySignals(c, limit))
  );
  const all = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => (r as PromiseFulfilledResult<SmartMoneySignal[]>).value);
  return all;
}
