# memflow 🌊

> **Real-time meme token intelligence on Telegram.** memflow watches liquidity and volume flows across Solana, Ethereum and BNB Chain — tells you when real money enters, when momentum dies, and when smart money is heading for the exit.

**Bot:** [@Memeflow1_bot](https://t.me/Memeflow1_bot) · **Status:** `live — 8 commands` · **Cost to run:** $0 (free-tier engineering)

---

## Why memflow exists

Every meme scanner gives you a static snapshot: red flag or green flag. Traders don't die from snapshots — they die from **timing**. memflow is built around a different question:

> *Is real money flowing in right now — or is someone pumping into thin exits?*

## Commands

| Command | What it does |
|---------|-------------|
| `/scan <name\|ca>` | Multi-chain pair scan: liquidity ranking, buy/sell counts, mcap, pair age |
| `/find <symbol>` | **Real-token finder** — separates the original from same-name clones via liquidity dominance, CoinGecko legitimacy ranks and socials |
| `/audit <ca>` | **Security audit**: honeypot simulation, mint/blacklist/selfdestruct/proxy flags, taxes, holders → risk score 0–100 (ETH·BSC·Base·Solana) |
| `/watch <name\|ca>` | Live radar: 60s polling with per-token calibrated baselines |
| `/brief <symbol>` | **Analyst card**: RSI(14), EMA 9/21 crossover detection, support/resistance, volume regime + news headlines |
| `/watchlist` · `/unwatch` | Manage tracked tokens |

## The Flow Radar signal matrix

Every watched token is continuously measured against its own rolling baseline (z-scores, size-calibrated):

| Volume | Liquidity | Signal | Meaning |
|--------|-----------|--------|----------|
| ↑ | ↑ | 🟢 **HOP** | real money committing |
| ↑ | flat/↓ | 🟡 **TRAP** | pump into thin exits |
| ↓ | ↑ | 👀 **WATCH** | quiet accumulation |
| ↓ | ↓ | 🔴 **EXIT NOW** | momentum dead + draining |
| any | sharp drop | 🚨 **RUG ALERT** | rug in progress |

Plus **entry quality score (0–100)** on every state change: flow state × trap risk × buy/sell imbalance × timing.

## Smart money detection

- **Distribution Radar** *(all chains)*: sell-pressure vs price behavior over rolling windows → flags *selling into strength*, heavy distribution, quiet accumulation
- **Whale tracking** *(Ethereum)*: auto-discovers the largest recent accumulators of each watched token, monitors their balances, alerts when one dumps >40% while price holds

## Architecture

```
memflow/
├── src/
│   ├── core/          # pure logic — signals, indicators, audit scoring, finder
│   ├── sources/       # dexscreener, geckoterminal, coingecko, etherscan,
│   │                  # honeypot.is, rugcheck, solscan, cryptopanic adapters
│   ├── chains/        # evm / solana abstraction
│   ├── storage/       # SQLite (native node:sqlite) — snapshots, watchlist, whales
│   ├── watch/         # polling engine + alert broadcasting
│   └── bot/           # grammY command layer
```

The core engine never knows Telegram exists — the same brain can power a web dashboard or a paid HTTP API later.

## Tech stack

`TypeScript` · `Node.js 20+` · `grammY` · `tsup` · `node:sqlite` (zero native deps)

All data sources run on free tiers — rate-limit-aware caching keeps it there.

| Source | Used for |
|--------|----------|
| DexScreener | pairs, volume, liquidity, txns, socials |
| GeckoTerminal | OHLCV candles, pools |
| CoinGecko | legitimacy cross-check, prices |
| Etherscan v2 | ETH whale balance tracking, transfers |
| honeypot.is | EVM contract simulation + code flags |
| RugCheck | Solana token safety scoring |
| CryptoPanic | news headlines (optional key) |

## Setup

```bash
git clone https://github.com/Stewiedev-pyt/memflow.git
cd memflow
npm install
cp .env.example .env   # add keys (only TELEGRAM_BOT_TOKEN strictly required)
npm run bot            # Telegram mode
npm run dev            # same, with hot reload
```

## Roadmap

- [x] Multi-source data adapters (4 chains)
- [x] Flow Radar signal engine + live alerts
- [x] `/audit` suite (honeypot sim + RugCheck)
- [x] Real Token Finder (`/find`)
- [x] Distribution Radar + ETH whale tracking
- [x] Technical briefing (`/brief`) — RSI/EMA/S&R/volume
- [ ] Chart vision analysis (LLM)
- [ ] Narrative tracker (Twitter mention timeline)
- [ ] x402 paid API tier
- [ ] 24/7 deployment guide

## Disclaimer

memflow provides on-chain data analysis, not financial advice. Meme tokens can go to zero. They often do. Size accordingly.

---

*Built by [Stewiedev-pyt](https://github.com/Stewiedev-pyt) — trader-turned-builder.*
