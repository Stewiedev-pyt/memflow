import { HoneypotResult } from "../sources/honeypot.js";
import { RugcheckSummary } from "../sources/rugcheck.js";

export interface AuditLine {
  ok: boolean;
  text: string;
}

export interface AuditVerdict {
  score: number;
  band: string;
  lines: AuditLine[];
  headline: string;
}

export function auditEvm(r: HoneypotResult): AuditVerdict {
  const c = r.contractCode ?? {};
  const lines: AuditLine[] = [];
  let score = 100;

  if (r.honeypotResult?.isHoneypot === true || r.simulationSuccess === false) {
    score -= 70;
    lines.push({ ok: false, text: "SELL SIMULATION FAILED — likely honeypot, you cannot exit" });
  } else if (r.simulationSuccess === true) {
    lines.push({ ok: true, text: "buy & sell simulation passed — exit is possible" });
  } else {
    score -= 20;
    lines.push({ ok: false, text: "simulation unavailable — treat as unknown risk" });
  }

  if (c.openSource === true) lines.push({ ok: true, text: "contract source verified" });
  else if (c.openSource === false) { score -= 25; lines.push({ ok: false, text: "source NOT verified" }); }

  if (c.mintable) { score -= 20; lines.push({ ok: false, text: "owner can MINT new supply" }); }
  if (c.ownerChangeBalance) { score -= 25; lines.push({ ok: false, text: "owner can change balances" }); }
  if (c.selfDestruct) { score -= 15; lines.push({ ok: false, text: "selfdestruct enabled" }); }
  if (c.hiddenOwner) { score -= 10; lines.push({ ok: false, text: "hidden owner wallet" }); }
  if (c.blacklist) { score -= 10; lines.push({ ok: false, text: "blacklist function present" }); }
  if (c.whitelist) { score -= 5; lines.push({ ok: false, text: "whitelist restriction present" }); }
  if (c.canTakeBackOwnership) { score -= 10; lines.push({ ok: false, text: "ownership can be reclaimed" }); }
  if (c.transferPausable) { score -= 10; lines.push({ ok: false, text: "transfers can be paused" }); }
  if (c.cannotSellAll) { score -= 10; lines.push({ ok: false, text: "full-amount sells restricted" }); }
  if (c.slippageModifiable || c.personalSlippageModifiable) { score -= 8; lines.push({ ok: false, text: "slippage modifiable by owner" }); }
  if (c.isProxy || c.hasProxyCalls) { score -= 8; lines.push({ ok: false, text: "proxy contract — logic can be swapped" }); }
  if (c.tradingCooldown) { score -= 3; lines.push({ ok: false, text: "cooldown between sells" }); }

  const buyTax = Math.round((r.simulationResult?.buyTax ?? 0) * 100);
  const sellTax = Math.round((r.simulationResult?.sellTax ?? 0) * 100);
  const maxTax = Math.max(buyTax, sellTax);
  if (maxTax >= 50) { score -= 30; lines.push({ ok: false, text: `extreme tax: ${buyTax}% buy / ${sellTax}% sell` }); }
  else if (maxTax >= 10) { score -= 12; lines.push({ ok: false, text: `tax: ${buyTax}% buy / ${sellTax}% sell` }); }
  else if (r.simulationSuccess) lines.push({ ok: true, text: `tax: ${buyTax}% buy / ${sellTax}% sell` });

  const holders = r.token?.totalHolders ?? Number(r.holderAnalysis?.holders ?? 0);
  if (holders > 0 && holders < 100) { score -= 12; lines.push({ ok: false, text: `only ${holders} holders` }); }
  else if (holders >= 100) lines.push({ ok: true, text: `${holders.toLocaleString()} holders` });

  const liq = r.pair?.liquidity;
  if (liq !== undefined) {
    if (liq < 5_000) { score -= 15; lines.push({ ok: false, text: `thin liquidity $${Math.round(liq)}` }); }
    else if (liq < 30_000) { score -= 8; lines.push({ ok: false, text: `low liquidity $${Math.round(liq).toLocaleString()}` }); }
    else lines.push({ ok: true, text: `liquidity $${Math.round(liq).toLocaleString()}` });
  }

  if (r.pair?.createdAtTimestamp) {
    const ageDays = (Date.now() - Number(r.pair.createdAtTimestamp) * 1000) / 86_400_000;
    if (ageDays < 1) { score -= 10; lines.push({ ok: false, text: "pair younger than 1 day ⚠️" }); }
    else if (ageDays < 7) { score -= 5; lines.push({ ok: false, text: `pair only ${ageDays.toFixed(1)}d old` }); }
  }

  for (const f of r.summary?.flags ?? []) {
    score -= 5;
    lines.push({ ok: false, text: `flag: ${f}` });
  }

  return finalize(score, lines);
}

export function auditSolana(rc: RugcheckSummary): AuditVerdict {
  const lines: AuditLine[] = [];
  let score = rc.score_normalised !== undefined ? Math.round(rc.score_normalised) : 60;

  for (const risk of rc.risks ?? []) {
    const danger = risk.level === "danger";
    lines.push({
      ok: !danger,
      text: `${risk.name ?? "risk"}${risk.value ? ` (${risk.value})` : ""}${risk.description ? ` — ${risk.description}` : ""}`,
    });
  }
  if ((rc.risks ?? []).length === 0) lines.push({ ok: true, text: "RugCheck found no notable risks" });

  return finalize(score, lines);
}

function finalize(scoreInput: number, lines: AuditLine[]): AuditVerdict {
  const score = Math.max(0, Math.min(100, scoreInput));
  let band: string;
  if (score >= 85) band = "🟢 Relatively clean";
  else if (score >= 65) band = "🟡 Tradeable with care";
  else if (score >= 40) band = "🟠 High risk — tiny size or skip";
  else band = "🚨 Casino ticket — assume it rugs";
  return { score, band, lines, headline: band };
}
