export type PendingKind = "scan" | "audit" | "find" | "watch" | "top" | "snipers" | "brief" | "vl" | "nh";

interface Pending {
  kind: PendingKind;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const pendings = new Map<number, Pending>();

export function setPending(chatId: number, kind: PendingKind): void {
  pendings.set(chatId, { kind, expiresAt: Date.now() + TTL_MS });
}

export function takePending(chatId: number): PendingKind | null {
  const p = pendings.get(chatId);
  if (!p) return null;
  pendings.delete(chatId);
  if (Date.now() > p.expiresAt) return null;
  return p.kind;
}

export function clearPending(chatId: number): void {
  pendings.delete(chatId);
}
