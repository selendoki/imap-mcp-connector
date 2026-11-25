import type { Db } from './index.js';

export interface TelegramAccount {
  id: number;
  ownerId: number;
  label: string;
  phone: string;
  apiId: number;
  apiHashEnc: string;
  sessionEnc: string;
  displayName: string | null;
  allowSend: boolean;
  needsReauth: boolean;
  createdAt: number;
}

interface Row {
  id: number;
  owner_id: number;
  label: string;
  phone: string;
  api_id: number;
  api_hash_enc: string;
  session_enc: string;
  display_name: string | null;
  allow_send: number;
  needs_reauth: number;
  created_at: number;
}

const toAccount = (r: Row): TelegramAccount => ({
  id: r.id,
  ownerId: r.owner_id,
  label: r.label,
  phone: r.phone,
  apiId: r.api_id,
  apiHashEnc: r.api_hash_enc,
  sessionEnc: r.session_enc,
  displayName: r.display_name,
  allowSend: r.allow_send === 1,
  needsReauth: r.needs_reauth === 1,
  createdAt: r.created_at,
});

export function listTelegramAccounts(db: Db, ownerId: number): TelegramAccount[] {
  return (db.prepare('SELECT * FROM telegram_accounts WHERE owner_id = ? ORDER BY created_at, id').all(ownerId) as Row[]).map(toAccount);
}

export function findTelegramAccount(db: Db, ownerId: number, id: number): TelegramAccount | undefined {
  const row = db.prepare('SELECT * FROM telegram_accounts WHERE owner_id = ? AND id = ?').get(ownerId, id) as Row | undefined;
  return row && toAccount(row);
}

/** Masks a phone number for display: +968 7••• ••13. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return digits.length <= 6 ? digits : `${digits.slice(0, 5)}•••${digits.slice(-2)}`;
}

/** Adds an account, or replaces the session of the owner's account with the same phone (signing in again). */
export function saveTelegramAccount(
  db: Db,
  a: { ownerId: number; label: string; phone: string; apiId: number; apiHashEnc: string; sessionEnc: string; displayName: string },
  now = Date.now(),
): TelegramAccount {
  const existing = db.prepare('SELECT id FROM telegram_accounts WHERE owner_id = ? AND phone = ?').get(a.ownerId, a.phone) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      'UPDATE telegram_accounts SET api_id = ?, api_hash_enc = ?, session_enc = ?, display_name = ?, needs_reauth = 0 WHERE id = ?',
    ).run(a.apiId, a.apiHashEnc, a.sessionEnc, a.displayName, existing.id);
    return findTelegramAccount(db, a.ownerId, existing.id)!;
  }
  const info = db
    .prepare(
      `INSERT INTO telegram_accounts (owner_id, label, phone, api_id, api_hash_enc, session_enc, display_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(a.ownerId, a.label, a.phone, a.apiId, a.apiHashEnc, a.sessionEnc, a.displayName, now);
  return findTelegramAccount(db, a.ownerId, Number(info.lastInsertRowid))!;
}

export function uniqueTelegramLabel(db: Db, ownerId: number, wanted: string): string {
  const taken = new Set(listTelegramAccounts(db, ownerId).map((a) => a.label));
  const base = wanted || 'telegram';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function setTelegramAllowSend(db: Db, ownerId: number, id: number, allow: boolean): void {
  db.prepare('UPDATE telegram_accounts SET allow_send = ? WHERE owner_id = ? AND id = ?').run(allow ? 1 : 0, ownerId, id);
}

export function setTelegramNeedsReauth(db: Db, id: number, value: boolean): void {
  db.prepare('UPDATE telegram_accounts SET needs_reauth = ? WHERE id = ?').run(value ? 1 : 0, id);
}

export function deleteTelegramAccount(db: Db, ownerId: number, id: number): boolean {
  return db.prepare('DELETE FROM telegram_accounts WHERE owner_id = ? AND id = ?').run(ownerId, id).changes > 0;
}
