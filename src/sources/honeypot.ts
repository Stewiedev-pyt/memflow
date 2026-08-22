export function isEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export interface ContractCode {
  openSource?: boolean;
  rootOpenSource?: boolean;
  isProxy?: boolean;
  hasProxyCalls?: boolean;
  mintable?: boolean;
  ownerChangeBalance?: boolean;
  selfDestruct?: boolean;
  hiddenOwner?: boolean;
  canTakeBackOwnership?: boolean;
  transferPausable?: boolean;
  blacklist?: boolean;
  whitelist?: boolean;
  cannotSellAll?: boolean;
  slippageModifiable?: boolean;
  personalSlippageModifiable?: boolean;
  antiBot?: boolean;
  tradingCooldown?: boolean;
}

export interface HoneypotResult {
  token?: { name?: string; symbol?: string; totalHolders?: number };
  summary?: { risk?: string; riskLevel?: number; flags?: string[] };
  simulationSuccess?: boolean;
  honeypotResult?: { isHoneypot?: boolean };
  simulationResult?: { buyTax?: number; sellTax?: number; transferTax?: number };
  holderAnalysis?: {
    holders?: string;
    siphoned?: string;
    averageTax?: number;
    highestTax?: number;
    highTaxWallets?: string;
  };
  flags?: string[];
  contractCode?: ContractCode;
  pair?: { liquidity?: number; createdAtTimestamp?: string };
}

const EVM_CHAINS: Array<{ id: number; name: string }> = [
  { id: 1, name: "eth" },
  { id: 56, name: "bsc" },
  { id: 8453, name: "base" },
];

export interface EvmAudit {
  chainName: string;
  result: HoneypotResult;
}

export async function auditEvmViaHoneypot(address: string): Promise<EvmAudit | null> {
  for (const chain of EVM_CHAINS) {
    try {
      const res = await fetch(
        `https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chain.id}`,
        { signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as HoneypotResult;
      if (data.token?.symbol || data.contractCode || data.pair) {
        return { chainName: chain.name, result: data };
      }
    } catch {
      continue;
    }
  }
  return null;
}
