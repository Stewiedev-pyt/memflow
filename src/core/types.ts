export interface PairSnapshot {
  pairAddress: string;
  chainId: string;
  symbol: string;
  baseAddress?: string;
  priceUsd?: number;
  liquidityUsd?: number;
  volM5?: number;
  volH1?: number;
  volH24?: number;
  buysM5?: number;
  sellsM5?: number;
  mcap?: number;
  ts: number;
}

export type FlowState = "HOP" | "TRAP" | "WATCH" | "EXIT_NOW" | "RUG_ALERT" | "IDLE";

export interface FlowSignal {
  state: FlowState;
  reasons: string[];
  zVol: number;
  liqSlopePct: number;
  buyRatio: number;
  entryScore: number;
}

export interface WatchedPair {
  pairAddress: string;
  chainId: string;
  symbol: string;
  addedAt: number;
}
