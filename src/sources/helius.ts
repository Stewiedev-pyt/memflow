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

/** Current token balance held by a wallet (owner) for a given mint. */
export async function getSolTokenBalance(wallet: string, mint: string): Promise<number> {
  try {
    const result = await rpc<{
      value?: Array<{
        account?: {
          data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } };
        };
      }>;
    }>("getTokenAccountsByOwner", [wallet, { mint }, { encoding: "jsonParsed" }]);
    return (result.value ?? []).reduce((sum, a) => {
      const ui = a.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
      return sum + (typeof ui === "number" && Number.isFinite(ui) ? ui : 0);
    }, 0);
  } catch {
    return 0;
  }
}

/** Total supply of a mint — used for holder-concentration math. */
export async function getTokenSupply(mint: string): Promise<number> {
  try {
    const result = await rpc<{
      value?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } } };
    }>("getTokenSupply", [mint]);
    const ui = result.value?.data?.parsed?.info?.tokenAmount?.uiAmount;
    return typeof ui === "number" && Number.isFinite(ui) ? ui : 0;
  } catch {
    return 0;
  }
}
