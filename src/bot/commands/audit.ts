import { Bot } from "grammy";
import { auditEvmViaHoneypot, isEvmAddress } from "../../sources/honeypot.js";
import { auditSolanaViaRugcheck } from "../../sources/rugcheck.js";
import { auditEvm, auditSolana, AuditVerdict } from "../../core/audit.js";

export function registerAuditCommand(bot: Bot): void {
  const edit = (msg: { message_id: number }, chatId: number, text: string) =>
    bot.api.editMessageText(chatId, msg.message_id, text, { link_preview_options: { is_disabled: true } });

  bot.command("audit", async (ctx) => {
    const address = ctx.match?.trim();
    if (!address) {
      await ctx.reply("Usage: `/audit <contract address>`\nWorks on ETH · BSC · Base · Solana", {
        parse_mode: "Markdown",
      });
      return;
    }

    const thinking = await ctx.reply(`🛡️ auditing \`${address.slice(0, 12)}…\`…`, { parse_mode: "Markdown" });

    try {
      let verdict: AuditVerdict;
      let chainLabel = "";
      let symbol = "";

      if (isEvmAddress(address)) {
        const evm = await auditEvmViaHoneypot(address);
        if (!evm) {
          await edit(thinking, ctx.chat.id, `No live pool found on ETH/BSC/Base.\nDouble-check the contract — or it may be too new.`);
          return;
        }
        verdict = auditEvm(evm.result);
        chainLabel = evm.chainName.toUpperCase();
        symbol = evm.result.token?.symbol ?? "?";
      } else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
        const rc = await auditSolanaViaRugcheck(address);
        if (!rc) {
          await edit(thinking, ctx.chat.id, "RugCheck has no report for that mint (too new or invalid).");
          return;
        }
        verdict = auditSolana(rc);
        chainLabel = "SOLANA";
        symbol = "?";
      } else {
        await edit(thinking, ctx.chat.id, "That doesn't look like a valid contract address.");
        return;
      }

      const flags = verdict.lines.map((l) => `${l.ok ? "✅" : "⚠️"} ${l.text}`).join("\n");
      const card = [
        `🛡️ *AUDIT: ${symbol}* on ${chainLabel}`,
        "",
        `*Score: ${verdict.score}/100 — ${verdict.headline}*`,
        "",
        flags,
        "",
        `_not financial advice. an audit is a snapshot, not a guarantee._`,
      ].join("\n");

      await edit(thinking, ctx.chat.id, card);
    } catch (err) {
      await edit(thinking, ctx.chat.id, `⚠️ audit failed: ${(err as Error).message}`);
    }
  });
}
