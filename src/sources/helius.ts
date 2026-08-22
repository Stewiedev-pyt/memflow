import { config } from "../config.js";

const RPC_URL = () => `https://mainnet.helius-rpc.com/?api-key=${config.heliusKey}`;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`helius rpc ${res.status}`);
  const data = (await res.json()) as { error?: { message?: string }; result?: T };
  if (data.error) throw new Error(`helius rpc error: ${data.error.message ?? "unknown"}`);
  return data.result as T;
}

export interface LargeTokenAccount {
  address: string;
  uiAmount: number;
}

export async function getTokenLargestAccounts(mint: string): Promise<LargeTokenAccount[]> {
  const result = await rpc<{ value?: Array<{ address: string; uiAmount: number | null }> }>(
    "getTokenLargestAccounts",
    [mint]
  );
  return (result.value ?? [])
    .filter((v) => v.uiAmount !== null && Number.isFinite(v.uiAmount))
    .map((v) => ({ address: v.address, uiAmount: v.uiAmount as number }));
}

export async function getSlot(): Promise<number> {
  return rpc<number>("getSlot", []);
}
