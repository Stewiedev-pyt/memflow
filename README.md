# memflow 🌊

> **Real-time meme token intelligence on Telegram.** memflow watches liquidity and volume flows across Solana, Ethereum and BNB Chain — tells you when real money enters, when momentum dies, and when to walk away.

**Bot:** [@Memeflow1_bot](https://t.me/Memeflow1_bot) · **Status:** `under active development` · **Cost to run:** $0 (free-tier engineering)

---

## Why memflow exists

Every meme scanner gives you a static snapshot: red flag or green flag. Traders don't die from snapshots — they die from **timing**. memflow is built around a different question:

> *Is real money flowing in right now — or is someone pumping into thin exits?*

It monitors volume/liquidity dynamics continuously, scores entry quality, detects smart-money distribution, and holds your hand out the door when the music stops.

## Features

### 🔮 Flow Radar *(core engine)*
Continuous monitoring of every watched pair against its own rolling baseline:

| Volume | Liquidity | Signal |
|--------|-----------|--------|
| ↑ | ↑ | 🟢 **HOP** — real money committing |
| ↑ | flat/↓ | 🟡 **TRAP** — pump into thin exits |
| ↓ | ↑ | 👀 **WATCH** — quiet accumulation |
| ↓ | ↓ | 🔴 **EXIT NOW** — momentum dead + draining |
| any | sharp drop | 🚨 **RUG ALERT** |

- Size-calibrated thresholds — inflows measured *relative to each meme's mcap & age*
- Buy vs sell imbalance detection
- Entry quality score: flow state × trap risk × timing

### 🛡️ Audit Mode
`/audit <contract>` → honeypot simulation, LP lock status, mint/blacklist functions, verified source, top-holder concentration → risk score 0–100 in plain trader language.

### 🕵️ Smart Money Detector
Records early buyers + dev wallet on watched tokens → alerts when they start selling while price still pumps.

### 🎯 Real Token Finder
Same-name meme tokens ranked by mcap/liquidity/age, socials cross-checked → "this CA is real, the rest are clones."

### 📰 Fundamentals & Technicals
News feeds per token, RSI/EMA/volume-profile from live OHLCV, combined briefing cards.

## Multi-chain from birth

| Chain | Flow Radar | Audit | Smart Money |
|-------|:---:|:---:|:---:|
| Solana | ✅ | ✅ | ✅ |
| Ethereum | ✅ | ✅ | ✅ |
| BNB Chain | ✅ | ✅ | ✅ |

## Architecture

```
memflow/
├── src/
│   ├── core/        # signal engine — pure logic, zero I/O
│   ├── sources/     # dexscreener, geckoterminal, coingecko adapters
│   ├── chains/      # evm.ts, solana.ts
│   ├── bot/         # Telegram interface layer
│   └── api/         # future HTTP/x402 endpoints
```

The core engine never knows Telegram exists — same brain can later power a web dashboard or paid API.

## Tech stack

`TypeScript` · `Node.js 20+` · `tsup` · `SQLite` · `grammY` · free-tier APIs only

## Setup

```bash
git clone https://github.com/stewieDev/memflow.git
cd memflow
npm install
cp .env.example .env   # add your keys
npm run bot            # Telegram bot mode
```

Required keys (all have free tiers): `TELEGRAM_BOT_TOKEN`, `ETHERSCAN_API_KEY`, `COINGECKO_API_KEY`, `SOLSCAN_API_KEY`

## Roadmap

- [x] Project scaffold + multi-source data adapters
- [x] Flow Radar signal engine
- [x] `/audit` command suite (honeypot sim, contract flags, RugCheck for Solana)
- [x] Real Token Finder (`/find` — clone detection via liquidity + CoinGecko + socials)
- [ ] Smart-money tracking
- [ ] Fundamentals + technicals briefing
- [ ] Chart vision analysis (LLM)
- [ ] x402 paid API tier

## Disclaimer

memflow provides on-chain data analysis, not financial advice. Meme tokens can go to zero. They often do. Size accordingly.

---

*Built by [stewieDev](https://github.com/stewieDev) — trader-turned-builder.*
