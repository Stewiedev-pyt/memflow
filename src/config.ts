import "dotenv/config";
import { createHash } from "node:crypto";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}. Check your .env file.`);
  }
  return value.trim();
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export const config = {
  telegramToken: required("TELEGRAM_BOT_TOKEN"),
  etherscanKey: optional("ETHERSCAN_API_KEY"),
  coingeckoKey: optional("COINGECKO_API_KEY"),
  solscanKey: optional("SOLSCAN_API_KEY"),
  heliusKey: optional("HELIUS_API_KEY"),
  geminiKey: optional("GEMINI_API_KEY"),
} as const;

export type Config = typeof config;

export function logSecretFingerprints(): void {
  const entries: Array<[string, string | undefined]> = [
    ["TELEGRAM_BOT_TOKEN", config.telegramToken],
    ["ETHERSCAN_API_KEY", config.etherscanKey],
    ["COINGECKO_API_KEY", config.coingeckoKey],
    ["SOLSCAN_API_KEY", config.solscanKey],
  ];
  for (const [name, value] of entries) {
    if (!value) {
      console.log(`🔑 ${name}: absent`);
      continue;
    }
    const fp = createHash("sha256").update(value).digest("hex").slice(0, 12);
    console.log(`🔑 ${name}: len=${value.length} fp=${fp}`);
  }
}

export function reportSources(): string[] {
  const lines: string[] = [];
  lines.push(`telegram      ✅ ready`);
  lines.push(`etherscan     ${config.etherscanKey ? "✅" : "⬜ (ETH deep data limited)"}`);
  lines.push(`coingecko     ${config.coingeckoKey ? "✅" : "⬜ (prices/mcap limited)"}`);
  lines.push(`solscan       ${config.solscanKey ? "✅" : "⬜ (SOL lookups limited)"}`);
  lines.push(`dexscreener   ✅ no key needed`);
  lines.push(`geckoterminal ✅ no key needed`);
  if (!config.heliusKey) lines.push(`helius        ⬜ (needed later for SOL smart money)`);
  if (!config.geminiKey) lines.push(`gemini        ⬜ (needed later for chart vision)`);
  return lines;
}
