import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { PairSnapshot, WatchedPair } from "../core/types.js";

const DATA_DIR = path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "memflow.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS watched (
  pair_address TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  pair_address TEXT NOT NULL,
  ts INTEGER NOT NULL,
  price_usd REAL, liquidity_usd REAL,
  vol_m5 REAL, vol_h1 REAL, vol_h24 REAL,
  buys_m5 INTEGER, sells_m5 INTEGER, mcap REAL
);
CREATE INDEX IF NOT EXISTS idx_snap ON snapshots(pair_address, ts);
CREATE TABLE IF NOT EXISTS whales (
  pair_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  wallet TEXT NOT NULL,
  balance TEXT NOT NULL,
  price_at_track REAL,
  tracked_at INTEGER NOT NULL,
  PRIMARY KEY (pair_address, wallet)
);
`);

export interface WhaleRow {
  wallet: string;
  balance: string;
  priceAtTrack?: number;
}

export function replaceWhales(pairAddress: string, tokenAddress: string, rows: WhaleRow[]): void {
  db.prepare("DELETE FROM whales WHERE pair_address = ?").run(pairAddress);
  const ins = db.prepare(
    "INSERT INTO whales (pair_address, token_address, wallet, balance, price_at_track, tracked_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const r of rows) ins.run(pairAddress, tokenAddress.toLowerCase(), r.wallet, r.balance, r.priceAtTrack ?? null, Date.now());
}

export function getWhales(pairAddress: string): WhaleRow[] {
  return db
    .prepare("SELECT wallet, balance, price_at_track FROM whales WHERE pair_address = ?")
    .all(pairAddress) as unknown as WhaleRow[];
}

export function updateWhaleBalance(pairAddress: string, wallet: string, balance: string): void {
  db.prepare("UPDATE whales SET balance = ?, tracked_at = ? WHERE pair_address = ? AND wallet = ?").run(
    balance, Date.now(), pairAddress, wallet
  );
}

export function addWatched(w: Omit<WatchedPair, "addedAt">): boolean {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO watched (pair_address, chain_id, symbol, added_at) VALUES (?, ?, ?, ?)"
  );
  const res = stmt.run(w.pairAddress, w.chainId, w.symbol, Date.now());
  return res.changes > 0;
}

export function removeWatched(pairAddress: string): boolean {
  const res = db.prepare("DELETE FROM watched WHERE pair_address = ?").run(pairAddress);
  db.prepare("DELETE FROM snapshots WHERE pair_address = ?").run(pairAddress);
  return res.changes > 0;
}

export function listWatched(): WatchedPair[] {
  return db
    .prepare("SELECT pair_address, chain_id, symbol, added_at FROM watched ORDER BY added_at DESC")
    .all() as unknown as WatchedPair[];
}

const MAX_SNAPSHOTS = 120;

export function saveSnapshot(s: PairSnapshot): void {
  db.prepare(
    `INSERT INTO snapshots (pair_address, ts, price_usd, liquidity_usd, vol_m5, vol_h1, vol_h24, buys_m5, sells_m5, mcap)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    s.pairAddress, s.ts, s.priceUsd ?? null, s.liquidityUsd ?? null,
    s.volM5 ?? null, s.volH1 ?? null, s.volH24 ?? null,
    s.buysM5 ?? null, s.sellsM5 ?? null, s.mcap ?? null
  );
  db.prepare(
    `DELETE FROM snapshots WHERE pair_address = ? AND ts NOT IN (
       SELECT ts FROM snapshots WHERE pair_address = ? ORDER BY ts DESC LIMIT ${MAX_SNAPSHOTS}
     )`
  ).run(s.pairAddress, s.pairAddress);
}

export function loadSnapshots(pairAddress: string, limit = 60): PairSnapshot[] {
  const rows = db
    .prepare(
      `SELECT pair_address, ts, price_usd, liquidity_usd, vol_m5, vol_h1, vol_h24, buys_m5, sells_m5, mcap
       FROM snapshots WHERE pair_address = ? ORDER BY ts DESC LIMIT ?`
    )
    .all(pairAddress, limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    pairAddress: r.pair_address as string,
    chainId: "",
    symbol: "",
    priceUsd: (r.price_usd as number) ?? undefined,
    liquidityUsd: (r.liquidity_usd as number) ?? undefined,
    volM5: (r.vol_m5 as number) ?? undefined,
    volH1: (r.vol_h1 as number) ?? undefined,
    volH24: (r.vol_h24 as number) ?? undefined,
    buysM5: (r.buys_m5 as number) ?? undefined,
    sellsM5: (r.sells_m5 as number) ?? undefined,
    mcap: (r.mcap as number) ?? undefined,
    ts: r.ts as number,
  })).reverse();
}
