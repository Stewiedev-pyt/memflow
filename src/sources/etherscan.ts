import { config } from "../config.js";

export interface TokenTransfer {
  from: string;
  to: string;
  value: string;
  timeStamp: string;
}

const V2 = "https://api.etherscan.io/v2/api";

async function callEtherscan(params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams({ chainid: "1", apikey: config.etherscanKey ?? "", ...params });
  const res = await fetch(`${V2}?${qs}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`etherscan ${res.status}`);
  const data = (await res.json()) as { status: string; result: unknown; message?: string };
  if (data.status !== "1") throw new Error(`etherscan: ${String(data.result).slice(0, 80)}`);
  return data.result;
}

export async function getRecentTokenTransfers(
  contract: string,
  page = 1
): Promise<TokenTransfer[]> {
  const result = (await callEtherscan({
    module: "account",
    action: "tokentx",
    contractaddress: contract,
    page: String(page),
    offset: "200",
    sort: "desc",
  })) as TokenTransfer[];
  return result;
}

const DEAD = /^0x0{40}$/;

export function rankWhales(
  transfers: TokenTransfer[],
  excludeAddresses: Set<string>
): Array<{ wallet: string; received: bigint; txCount: number }> {
  const totals = new Map<string, { received: bigint; txCount: number }>();
  for (const t of transfers) {
    const to = t.to.toLowerCase();
    if (DEAD.test(to) || excludeAddresses.has(to)) continue;
    let v = BigInt(0);
    try {
      v = BigInt(t.value || "0");
    } catch {
      continue;
    }
    const cur = totals.get(to) ?? { received: BigInt(0), txCount: 0 };
    cur.received += v;
    cur.txCount += 1;
    totals.set(to, cur);
  }
  const max = Math.max(...[...totals.values()].map((v) => Number(v.received)), 1);
  const pairLike = [...totals.entries()].filter(([, v]) => Number(v.received) / max > 0.9 && v.txCount > transfers.length * 0.5);
  for (const [addr] of pairLike) totals.delete(addr);

  return [...totals.entries()]
    .map(([wallet, v]) => ({ wallet, ...v }))
    .sort((a, b) => (a.received > b.received ? -1 : 1))
    .slice(0, 6);
}

export async function getTokenBalance(wallet: string, contract: string): Promise<number> {
  const raw = (await callEtherscan({
    module: "account",
    action: "tokenbalance",
    contractaddress: contract,
    address: wallet,
    tag: "latest",
  })) as string;
  try {
    return Number(BigInt(raw));
  } catch {
    return 0;
  }
}

export interface TokenHolder {
  address: string;
  balance: string;
  pct: number;
}

export async function getTokenHolders(contract: string, top = 20): Promise<TokenHolder[]> {
  try {
    const result = (await callEtherscan({
      module: "token",
      action: "tokenholderlist",
      contractaddress: contract,
      page: "1",
      offset: String(top),
    })) as Array<{ TokenHolderAddress: string; TokenHolderQuantity: string }> | string;
    if (!Array.isArray(result) || result.length === 0) return [];
    const totalSupply = result.reduce((s, h) => s + Number(h.TokenHolderQuantity), 0);
    return result.map((h) => ({
      address: h.TokenHolderAddress,
      balance: h.TokenHolderQuantity,
      pct: totalSupply > 0 ? (Number(h.TokenHolderQuantity) / totalSupply) * 100 : 0,
    }));
  } catch {
    return [];
  }
}

export async function getContractCreator(address: string): Promise<string | null> {
  try {
    const result = (await callEtherscan({
      module: "contract",
      action: "getcontractcreation",
      contractaddresses: address,
    })) as Array<{ contractCreator: string }> | string;
    if (Array.isArray(result) && result.length > 0) return result[0].contractCreator;
    return null;
  } catch {
    return null;
  }
}
