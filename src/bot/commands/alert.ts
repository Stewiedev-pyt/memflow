import { Bot } from "grammy";

export interface AlertRule {
  id: string;
  chatId: number;
  token: string;
  symbol: string;
  chainId: string;
  pairAddress: string;
  type: "price_above" | "price_below" | "mc_above" | "mc_below";
  target: number;
  currentPrice: number;
  createdAt: number;
  triggered: boolean;
}

const alerts = new Map<string, AlertRule>();

function alertId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function getActiveAlerts(): AlertRule[] {
  return [...alerts.values()].filter((a) => !a.triggered);
}

export function markAlertTriggered(id: string): void {
  const a = alerts.get(id);
  if (a) a.triggered = true;
}

export function removeAlert(id: string): boolean {
  return alerts.delete(id);
}

export function cleanAlerts(): void {
  const cutoff = Date.now() - 3600_000;
  for (const [id, a] of alerts) {
    if (a.triggered && a.createdAt < cutoff) alerts.delete(id);
  }
}

export function getAlertsForChat(chatId: number): AlertRule[] {
  return [...alerts.values()].filter((a) => a.chatId === chatId && !a.triggered);
}

export function registerAlertCommand(bot: Bot) {
  bot.command("alert", async (ctx) => {
    if (!ctx.chat) return;
    const args = ctx.match?.trim();

    if (!args) {
      return ctx.reply(
        [
          "🔔 *Alert Commands:*",
          "",
          "`/alert add <token> <type> <value>` — set alert",
          "`/alert list` — view your alerts",
          "`/alert remove <id>` — cancel alert",
          "",
          "*Types:*",
          "`price_above` — token price goes above",
          "`price_below` — token price drops below",
          "`mc_above` — market cap goes above",
          "`mc_below` — market cap drops below",
          "",
          "*Example:*",
          "`/alert add PEPE price_above 0.00002`",
          "`/alert add WIF mc_above 1000000`",
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    const parts = args.split(/\s+/);
    const sub = parts[0]?.toLowerCase();

    if (sub === "list") {
      const userAlerts = getAlertsForChat(ctx.chat.id);
      if (userAlerts.length === 0) {
        return ctx.reply("No active alerts. Use `/alert add` to create one.", { parse_mode: "Markdown" });
      }
      const lines = userAlerts.map(
        (a) => `• \`${a.id}\` ${a.symbol} — ${a.type.replace("_", " ")} ${a.target}`
      );
      return ctx.reply(`🔔 *Your Alerts (${userAlerts.length}):*\n${lines.join("\n")}`, {
        parse_mode: "Markdown",
      });
    }

    if (sub === "remove") {
      const id = parts[1];
      if (!id) return ctx.reply("Usage: `/alert remove <id>`", { parse_mode: "Markdown" });
      if (removeAlert(id)) {
        return ctx.reply(`✅ Alert \`${id}\` removed.`, { parse_mode: "Markdown" });
      }
      return ctx.reply(`❌ Alert \`${id}\` not found.`, { parse_mode: "Markdown" });
    }

    if (sub === "add") {
      const token = parts[1];
      const type = parts[2];
      const value = parseFloat(parts[3]);

      if (!token || !type || isNaN(value) || value <= 0) {
        return ctx.reply("Usage: `/alert add <token> <type> <value>`\nValue must be a positive number.", { parse_mode: "Markdown" });
      }

      const validTypes = ["price_above", "price_below", "mc_above", "mc_below"];
      if (!validTypes.includes(type)) {
        return ctx.reply(`Invalid type. Use: ${validTypes.join(", ")}`);
      }

      const { searchPairs } = await import("../../sources/dexscreener.js");
      const pairs = await searchPairs(token);
      if (pairs.length === 0) {
        return ctx.reply(`❌ No results for "${token}".`);
      }

      const best = pairs[0];
      const id = alertId();
      const currentPrice = parseFloat(best.priceUsd ?? "0");
      const mc = best.marketCap ?? 0;

      let alreadyMet = false;
      switch (type) {
        case "price_above": alreadyMet = currentPrice >= value; break;
        case "price_below": alreadyMet = currentPrice <= value; break;
        case "mc_above": alreadyMet = mc >= value; break;
        case "mc_below": alreadyMet = mc <= value; break;
      }

      if (alreadyMet) {
        return ctx.reply(
          `⚠️ Condition already met! Current price: $${best.priceUsd}, MC: $${mc.toLocaleString()}.\nAlert not created.`,
          { parse_mode: "Markdown" }
        );
      }

      const alert: AlertRule = {
        id,
        chatId: ctx.chat.id,
        token,
        symbol: best.baseToken.symbol,
        chainId: best.chainId,
        pairAddress: best.pairAddress,
        type: type as AlertRule["type"],
        target: value,
        currentPrice,
        createdAt: Date.now(),
        triggered: false,
      };

      alerts.set(id, alert);

      return ctx.reply(
        [
          `✅ *Alert set!*`,
          "",
          `Token: *${best.baseToken.symbol}* (${best.chainId})`,
          `Rule: ${type.replace("_", " ")} ${value}`,
          `Current: ${best.priceUsd}`,
          `ID: \`${id}\``,
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    return ctx.reply("Unknown subcommand. Use `/alert` for help.", { parse_mode: "Markdown" });
  });
}
