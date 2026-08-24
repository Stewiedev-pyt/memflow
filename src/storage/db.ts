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
CREATE TABLE IF NOT EXISTS alert_chats (
  chat_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recent_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT,
  symbol TEXT NOT NULL,
  pair_address TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  scanned_at INTEGER NOT NULL,
  mcap_at_scan REAL
);
CREATE TABLE IF NOT EXISTS scan_leaderboard (
  user_id INTEGER PRIMARY KEY,
  username TEXT,
  scan_count INTEGER DEFAULT 0,
  first_scan_at INTEGER,
  last_scan_at INTEGER,
  best_mcap REAL
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

export function saveAlertChat(chatId: number): void {
  db.prepare("INSERT OR IGNORE INTO alert_chats (chat_id, created_at) VALUES (?, ?)").run(chatId, Date.now());
}

export function loadAlertChats(): number[] {
  return db.prepare("SELECT chat_id FROM alert_chats").all().map((r: any) => r.chat_id as number);
}

export interface RecentScan {
  id: number;
  chatId: number;
  userId: number;
  username: string;
  symbol: string;
  pairAddress: string;
  chainId: string;
  scannedAt: number;
  mcapAtScan: number | null;
}

export function addRecentScan(s: { chatId: number; userId: number; username: string; symbol: string; pairAddress: string; chainId: string; mcap?: number }): void {
  db.prepare(
    "INSERT INTO recent_scans (chat_id, user_id, username, symbol, pair_address, chain_id, scanned_at, mcap_at_scan) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(s.chatId, s.userId, s.username, s.symbol, s.pairAddress, s.chainId, Date.now(), s.mcap ?? null);
  db.prepare("DELETE FROM recent_scans WHERE id NOT IN (SELECT id FROM recent_scans ORDER BY scanned_at DESC LIMIT 100)").run();
}

export function getRecentScans(limit = 10): RecentScan[] {
  return db.prepare("SELECT * FROM recent_scans ORDER BY scanned_at DESC LIMIT ?").all(limit) as unknown as RecentScan[];
}

export function updateLeaderboard(s: { userId: number; username: string; mcap?: number }): void {
  const existing = db.prepare("SELECT user_id FROM scan_leaderboard WHERE user_id = ?").get(s.userId) as { user_id: number } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE scan_leaderboard SET scan_count = scan_count + 1, last_scan_at = ?, username = ?, best_mcap = MAX(COALESCE(best_mcap, 0), COALESCE(?, 0)) WHERE user_id = ?"
    ).run(Date.now(), s.username, s.mcap ?? null, s.userId);
  } else {
    db.prepare(
      "INSERT INTO scan_leaderboard (user_id, username, scan_count, first_scan_at, last_scan_at, best_mcap) VALUES (?, ?, 1, ?, ?, ?)"
    ).run(s.userId, s.username, Date.now(), Date.now(), s.mcap ?? null);
  }
}

export interface LeaderboardEntry {
  user_id: number;
  username: string;
  scan_count: number;
  best_mcap: number | null;
}

export function getLeaderboard(limit = 10): LeaderboardEntry[] {
  return db.prepare("SELECT user_id, username, scan_count, best_mcap FROM scan_leaderboard ORDER BY scan_count DESC LIMIT ?").all(limit) as unknown as LeaderboardEntry[];
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
