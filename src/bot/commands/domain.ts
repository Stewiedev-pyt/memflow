import { Bot, Context } from "grammy";

export async function handleDomainCheck(ctx: Context, domain: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(`🌐 checking domain *${esc(domain)}*…`, { parse_mode: "Markdown" });
  try {
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();

    const lines: string[] = [
      `🌐 *DOMAIN CHECK — ${esc(cleanDomain)}*`,
      "",
    ];

    // WHOIS lookup via rdap.org
    try {
      const res = await fetch(`https://rdap.org/domain/${cleanDomain}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = await res.json() as {
          events?: Array<{ eventDate?: string; eventAction?: string }>;
          status?: string[];
          nameservers?: Array<{ ldhName?: string }>;
        };

        const creationEvent = data.events?.find((e) => e.eventAction === "registration");
        const expiryEvent = data.events?.find((e) => e.eventAction === "expiration");

        if (creationEvent?.eventDate) {
          const created = new Date(creationEvent.eventDate);
          const ageDays = Math.floor((Date.now() - created.getTime()) / 86_400_000);
          lines.push(`*Created:* ${created.toISOString().split("T")[0]} (${ageDays} days ago)`);

          if (ageDays < 30) lines.push("🔴 *VERY NEW — high scam risk*");
          else if (ageDays < 90) lines.push("🟡 *New — be cautious*");
          else if (ageDays < 365) lines.push("🟢 *Established*");
          else lines.push("✅ *Old domain — good sign*");
        }

        if (expiryEvent?.eventDate) {
          const expiry = new Date(expiryEvent.eventDate);
          const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
          lines.push(`*Expires:* ${expiry.toISOString().split("T")[0]} (${daysLeft} days)`);
          if (daysLeft < 30) lines.push("⚠️ *Expiring soon — domain may be abandoned*");
        }

        if (data.status) {
          lines.push(`*Status:* ${data.status.join(", ")}`);
        }

        if (data.nameservers && data.nameservers.length > 0) {
          lines.push(`*Nameservers:* ${data.nameservers.map((n) => n.ldhName).join(", ")}`);
        }
      } else {
        lines.push("⚠️ Could not fetch RDAP data");
      }
    } catch {
      lines.push("⚠️ RDAP lookup failed");
    }

    if (lines.length === 1) {
      lines.push("No data found for this domain.");
    }

    const card = lines.join("\n");
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, { parse_mode: "Markdown" });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ domain check failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ domain check failed: ${(err as Error).message}`);
    }
  }
}

function esc(s: string): string {
  return s.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

export function registerDomainCommand(bot: Bot): void {
  bot.command("do", async (ctx) => {
    if (!ctx.chat) return;
    const domain = ctx.match?.trim();
    if (!domain) {
      await ctx.reply("🌐 Send a *domain* to check its age and registration info.\nExample: `/do example.com`", { parse_mode: "Markdown" });
      return;
    }
    await handleDomainCheck(ctx, domain);
  });
}
