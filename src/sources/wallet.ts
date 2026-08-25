import { config } from "../config.js";

const HELIUS_KEY = () => config.heliusKey;

async function heliusPost<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`helius ${res.status}`);
  const data = (await res.json()) as { error?: { message?: string }; result?: T };
  if (data.error) throw new Error(`helius error: ${data.error.message ?? "unknown"}`);
  return data.result as T;
}

export interface TokenBalance {
  mint: string;
  amount: number;
  decimals: number;
  uiAmount: number;
}

export async function getWalletTokenAccounts(wallet: string): Promise<TokenBalance[]> {
  const result = await heliusPost<any>("getTokenAccountsByOwner", [
    wallet,
    { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { encoding: "jsonParsed" },
  ]);

  return (result.value ?? [])
    .map((v: any) => {
      const info = v.account.data.parsed.info;
      const ta = info.tokenAmount;
      return {
        mint: info.mint,
        amount: Number(ta.amount),
        decimals: ta.decimals,
        uiAmount: ta.uiAmount ?? 0,
      };
    })
    .filter((t: any) => t.uiAmount > 0);
}

export async function getSolBalance(wallet: string): Promise<number> {
  const result = await heliusPost<any>("getBalance", [wallet]);
  return (result.value ?? 0) / 1e9;
}

export interface Signature {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
}

export async function getSignatures(wallet: string, limit = 50): Promise<Signature[]> {
  const result = await heliusPost<any>("getSignaturesForAddress", [wallet, { limit }]);
  return result.value ?? [];
}
