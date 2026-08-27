import * as actions from "./actions.js";

export interface AgentConfig {
  telegramToken?: string;
  autoRun?: boolean;
  callIntervalHours?: number;
  chartAlertIntervalHours?: number;
  onAlert?: (message: string) => void;
  onCall?: (calls: any[]) => void;
}

export interface AgentResponse {
  action: string;
  success: boolean;
  data: any;
  error?: string;
  timestamp: number;
}

export class MemflowAgent {
  private config: AgentConfig;
  private running = false;
  private timers: NodeJS.Timeout[] = [];

  constructor(config: AgentConfig = {}) {
    this.config = {
      autoRun: false,
      callIntervalHours: 4,
      chartAlertIntervalHours: 5,
      ...config,
    };
  }

  // ─── NATURAL LANGUAGE ROUTER ──────────────────────────────
  async process(input: string): Promise<AgentResponse> {
    const text = input.toLowerCase().trim();
    const timestamp = Date.now();

    // Scan
    if (text.startsWith("scan ") || text.includes("scan") && text.split(" ").length <= 3) {
      const query = this.extractQuery(text, ["scan"]);
      const result = await actions.actionScan(query);
      return { action: "scan", ...result, timestamp };
    }

    // Audit
    if (text.startsWith("audit ") || text.includes("audit")) {
      const query = this.extractQuery(text, ["audit", "check", "rug"]);
      const result = await actions.actionAudit(query);
      return { action: "audit", ...result, timestamp };
    }

    // Calls
    if (text.includes("call") || text.includes("signal") || text.includes("trade") || text === "calls") {
      const result = await actions.actionCalls();
      return { action: "calls", ...result, timestamp };
    }

    // Holders
    if (text.includes("holder") || text.includes("whale")) {
      const query = this.extractQuery(text, ["holder", "whale", "check"]);
      const result = await actions.actionHolders(query);
      return { action: "holders", ...result, timestamp };
    }

    // Top traders
    if (text.includes("top trader") || text.includes("trader") || text.includes("smart money")) {
      const query = this.extractQuery(text, ["trader", "smart money", "check"]);
      const result = await actions.actionTopTraders(query);
      return { action: "topTraders", ...result, timestamp };
    }

    // Gems
    if (text.includes("gem") || text.includes("low cap") || text.includes("low mc")) {
      const chain = this.extractChain(text);
      const result = await actions.actionLowCapGems(chain);
      return { action: "gems", ...result, timestamp };
    }

    // Top tokens (high MC, real tokens, not honeypots)
    if (text.includes("top token") || text.includes("blue chip") || text.includes("list token") || text.includes("high mc") || text.includes("big token") || text.includes("real token") || text.includes("generate list")) {
      const chain = this.extractChain(text);
      const result = await actions.actionTopTokens(chain);
      return { action: "topTokens", ...result, timestamp };
    }

    // Market
    if (text.includes("market") || text.includes("overview") || text.includes("global")) {
      const result = await actions.actionMarket();
      return { action: "market", ...result, timestamp };
    }

    // Fear & Greed
    if (text.includes("fear") || text.includes("greed") || text.includes("sentiment")) {
      const result = await actions.actionMarket();
      return { action: "fearGreed", ...result, timestamp };
    }

    // News
    if (text.includes("news") || text.includes("headline")) {
      const query = this.extractQuery(text, ["news", "headline", "for"]);
      const result = await actions.actionNews(query);
      return { action: "news", ...result, timestamp };
    }

    // Wallet analyzer
    if (text.includes("wallet") || text.includes("analyze") || text.includes("holder")) {
      const addr = text.match(/[\w]{32,44}/)?.[0];
      if (addr) {
        const result = await actions.actionWalletAnalyzer(addr);
        return { action: "wallet", ...result, timestamp };
      }
    }

    // Trenches
    if (text.includes("trench") || text.includes("new token") || text.includes("launch") || text.includes("pump.fun")) {
      const result = await actions.actionTrenches();
      return { action: "trenches", ...result, timestamp };
    }

    // Portfolio
    if (text.includes("portfolio") || text.includes("position") || text.includes("my bag")) {
      return { action: "portfolio", success: true, data: { message: "Use /portfolio add <SYMBOL> <price> <amount> or /portfolio to view" }, timestamp };
    }

    // Help
    if (text === "help" || text === "?") {
      return {
        action: "help",
        success: true,
        data: {
          commands: [
            "scan <token> — full token analysis",
            "audit <token> — security check (honeypot, rug)",
            "calls — get trading signals with entry/exit",
            "holders <token> — holder distribution",
            "traders <token> — smart money activity",
            "wallet <address> — analyze any Solana wallet",
            "track <wallet> — track wallet activity",
            "trenches — new token discovery",
            "portfolio — track your PnL",
            "top tokens — list high MC tokens ($1M+) by chain",
            "gems — find low MC gems ($50K-$500K)",
            "market — global market overview",
            "news <ticker> — latest news",
          ],
        },
        timestamp,
      };
    }

    // Default: try to scan whatever they typed
    const result = await actions.actionScan(text);
    return { action: "scan", ...result, timestamp };
  }

  // ─── AUTO MODE ──────────────────────────────────────
  async startAuto(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Auto calls
    const callInterval = (this.config.callIntervalHours ?? 4) * 3_600_000;
    const callTimer = setInterval(async () => {
      if (!this.running) return;
      try {
        const result = await actions.actionCalls();
        if (result.success && this.config.onCall) {
          this.config.onCall(result.data);
        }
      } catch (err) {
        console.error("[agent] auto-calls error:", (err as Error).message);
      }
    }, callInterval);
    this.timers.push(callTimer);

    // Initial call
    try {
      const result = await actions.actionCalls();
      if (result.success && this.config.onCall) {
        this.config.onCall(result.data);
      }
    } catch (err) {
      console.error("[agent] initial calls error:", (err as Error).message);
    }

    console.log(`[agent] auto mode started — calls every ${this.config.callIntervalHours}h`);
  }

  stopAuto(): void {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    console.log("[agent] auto mode stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─── HELPERS ──────────────────────────────────────
  private extractQuery(text: string, triggers: string[]): string {
    let cleaned = text;
    for (const t of triggers) {
      cleaned = cleaned.replace(new RegExp(`\\b${t}\\b`, "gi"), "");
    }
    return cleaned.replace(/[^\w\s]/g, "").trim();
  }

  private extractChain(text: string): string | undefined {
    if (text.includes("solana") || text.includes("sol")) return "solana";
    if (text.includes("ethereum") || text.includes("eth")) return "ethereum";
    if (text.includes("bsc") || text.includes("bnb") || text.includes("bnb chain")) return "bsc";
    if (text.includes("base")) return "base";
    return undefined;
  }
}
