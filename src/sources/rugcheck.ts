export interface RugcheckSummary {
  risks: Array<{ name?: string; value?: string; description?: string; level?: string }>;
  score_normalised?: number;
  score?: number;
  topHolders?: Array<{ percentage: number; address?: string }>;
}

const KNOWN_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
]);

export function isSolanaAddress(address: string): boolean {
  return !address.startsWith("0x") && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && !KNOWN_MINTS.has(address);
}

export async function auditSolanaViaRugcheck(mint: string): Promise<RugcheckSummary | null> {
  try {
    const res = await fetch(
      `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return null;
    return (await res.json()) as RugcheckSummary;
  } catch {
    return null;
  }
}
