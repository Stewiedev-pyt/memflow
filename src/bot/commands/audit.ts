import { Bot, Context } from "grammy";
import { auditEvmViaHoneypot, isEvmAddress } from "../../sources/honeypot.js";
import { auditSolanaViaRugcheck } from "../../sources/rugcheck.js";
import { auditEvm, auditSolana, AuditVerdict } from "../../core/audit.js";
import { setPending } from "../pending.js";

function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 20) + "\n\n_(truncated)_";
}

export async function handleAudit(ctx: Context, address: string): Promise<void> {
  if (!ctx.chat) return;

  const thinking = await ctx.reply(`🛡️ auditing \`${address.slice(0, 12)}…\`…`, { parse_mode: "Markdown" });

  try {
    let verdict: AuditVerdict;
    let chainLabel = "";
    let symbol = "";

    if (isEvmAddress(address)) {
      const evm = await auditEvmViaHoneypot(address);
      if (!evm) {
        await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No live pool found on ETH/BSC/Base.\nDouble-check the contract — or it may be too new.`);
        return;
      }
      verdict = auditEvm(evm.result);
      chainLabel = evm.chainName.toUpperCase();
      symbol = evm.result.token?.symbol ?? "?";
    } else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      const rc = await auditSolanaViaRugcheck(address);
      if (!rc) {
        await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "RugCheck has no report for that mint (too new or invalid).");
        return;
      }
      verdict = auditSolana(rc);
      chainLabel = "SOLANA";
      symbol = "?";
    } else {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "That doesn't look like a valid contract address.");
      return;
    }

    const flags = verdict.lines.map((l) => `${l.ok ? "✅" : "⚠️"} ${l.text}`).join("\n");
    const card = truncate([
      `🛡️ *AUDIT: ${symbol}* on ${chainLabel}`,
      "",
      `*Score: ${verdict.score}/100 — ${verdict.headline}*`,
      "",
      flags,
      "",
      `_not financial advice. an audit is a snapshot, not a guarantee._`,
    ].join("\n"));

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ audit failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ audit failed: ${(err as Error).message}`);
    }
  }
}

export function registerAuditCommand(bot: Bot): void {
  bot.command("audit", async (ctx) => {
    const address = ctx.match?.trim();
    if (!address) {
      setPending(ctx.chat.id, "audit");
      await ctx.reply(
        "🛡️ Send me a *contract address* to audit.\n\nWorks on ETH · BSC · Base · Solana\n_Tip: `/audit <address>` also works in one message._",
        { parse_mode: "Markdown" }
      );
      return;
    }
    await handleAudit(ctx, address);
  });
}
