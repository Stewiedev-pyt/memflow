import { Bot } from "grammy";

export interface CopyTradeRule {
  id: string;
  chatId: number;
  walletAddress: string;
  label: string;
  chain: string;
  autoBuy: boolean;
  buyAmountSol: number;
  minLiq: number;
  maxMc: number;
  enabled: boolean;
  createdAt: number;
  tradesCount: number;
}

const copyRules = new Map<string, CopyTradeRule>();
const recentCopies = new Map<string, number>();

function copyId(): string {
  return "cp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
}

export function getCopyRules(): CopyTradeRule[] {
  return [...copyRules.values()];
}

export function getCopyRulesForChat(chatId: number): CopyTradeRule[] {
  return [...copyRules.values()].filter((r) => r.chatId === chatId);
}

export function removeCopyRule(id: string): boolean {
  return copyRules.delete(id);
}

export function wasRecentlyCopied(wallet: string, tokenAddress: string): boolean {
  const key = `${wallet}:${tokenAddress}`;
  const last = recentCopies.get(key);
  if (last && Date.now() - last < 300_000) return true;
  recentCopies.set(key, Date.now());
  return false;
}

export function incrementCopyCount(id: string): void {
  const r = copyRules.get(id);
  if (r) r.tradesCount++;
}

export function registerCopyCommand(bot: Bot) {
  bot.command("copy", async (ctx) => {
    if (!ctx.chat) return;
    const args = ctx.match?.trim();

    if (!args) {
      return ctx.reply(
        [
          "🤖 *Copy Trading Commands:*",
          "",
          "`/copy add <wallet> [label]` — start copying a wallet",
          "`/copy list` — view your copy trades",
          "`/copy remove <id>` — stop copying",
          "`/copy config <id> auto on/off` — toggle auto-buy",
          "`/copy config <id> amount <sol>` — set buy amount",
          "`/copy config <id> liq <min>` — minimum liquidity filter",
          "`/copy config <id> mc <max>` — max market cap filter",
          "",
          "*How it works:*",
          "When a copied wallet buys a token, stewie alerts you.",
          "With auto-buy ON, stewie will also buy the same token",
          "using Jupiter swap (Solana only for now).",
          "",
          "*Example:*",
          "`/copy add 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU whale1`",
          "`/copy config cp123 auto on`",
          "`/copy config cp123 amount 0.5`",
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    const parts = args.split(/\s+/);
    const sub = parts[0]?.toLowerCase();

    if (sub === "list") {
      const rules = getCopyRulesForChat(ctx.chat.id);
      if (rules.length === 0) {
        return ctx.reply("No copy trades active. Use `/copy add` to start.", { parse_mode: "Markdown" });
      }
      const lines = rules.map(
        (r) =>
          `• \`${r.id}\` ${r.label || r.walletAddress.slice(0, 8)} — ${r.autoBuy ? "🟢 auto" : "🔴 alert only"} · ${r.tradesCount} trades`
      );
      return ctx.reply(`🤖 *Copy Trades (${rules.length}):*\n${lines.join("\n")}`, {
        parse_mode: "Markdown",
      });
    }

    if (sub === "remove") {
      const id = parts[1];
      if (!id) return ctx.reply("Usage: `/copy remove <id>`", { parse_mode: "Markdown" });
      if (removeCopyRule(id)) {
        return ctx.reply(`✅ Stopped copying \`${id}\`.`, { parse_mode: "Markdown" });
      }
      return ctx.reply(`❌ Copy rule \`${id}\` not found.`, { parse_mode: "Markdown" });
    }

    if (sub === "config") {
      const id = parts[1];
      const key = parts[2];
      const val = parts[3];

      if (!id || !key) {
        return ctx.reply("Usage: `/copy config <id> <auto|amount|liq|mc> <value>`", { parse_mode: "Markdown" });
      }

      const rule = copyRules.get(id);
      if (!rule) return ctx.reply(`❌ Copy rule \`${id}\` not found.`);
      if (rule.chatId !== ctx.chat.id) return ctx.reply("Not your copy rule.");

      switch (key) {
        case "auto":
          rule.autoBuy = val?.toLowerCase() === "on";
          return ctx.reply(`✅ Auto-buy ${rule.autoBuy ? "ON" : "OFF"} for ${rule.label || rule.walletAddress.slice(0, 8)}.`);
        case "amount":
          rule.buyAmountSol = parseFloat(val) || 0.1;
          return ctx.reply(`✅ Buy amount set to ${rule.buyAmountSol} SOL.`);
        case "liq":
          rule.minLiq = parseFloat(val) || 0;
          return ctx.reply(`✅ Min liquidity set to $${rule.minLiq}.`);
        case "mc":
          rule.maxMc = parseFloat(val) || Infinity;
          return ctx.reply(`✅ Max MC set to $${rule.maxMc}.`);
        default:
          return ctx.reply("Unknown config key. Use: auto, amount, liq, mc");
      }
    }

    if (sub === "add") {
      const wallet = parts[1];
      const label = parts[2] || "";

      if (!wallet || wallet.length < 20) {
        return ctx.reply("Usage: `/copy add <wallet_address> [label]`");
      }

      const existing = getCopyRulesForChat(ctx.chat.id).find((r) => r.walletAddress === wallet);
      if (existing) {
        return ctx.reply(`Already copying this wallet as \`${existing.id}\`.`, { parse_mode: "Markdown" });
      }

      const id = copyId();
      const rule: CopyTradeRule = {
        id,
        chatId: ctx.chat.id,
        walletAddress: wallet,
        label,
        chain: "solana",
        autoBuy: false,
        buyAmountSol: 0.1,
        minLiq: 5000,
        maxMc: 500000,
        enabled: true,
        createdAt: Date.now(),
        tradesCount: 0,
      };

      copyRules.set(id, rule);

      return ctx.reply(
        [
          `✅ *Now copying wallet!*`,
          "",
          `Wallet: \`${wallet}\``,
          `Label: ${label || "none"}`,
          `Mode: 🔔 alert only (use \`/copy config ${id} auto on\` for auto-buy)`,
          `Filters: liq > $5K, MC < $500K`,
          `ID: \`${id}\``,
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    return ctx.reply("Unknown subcommand. Use `/copy` for help.", { parse_mode: "Markdown" });
  });
}
