import type { Db } from './index.js';
import { deleteUser, findUserById, type User } from './users.js';

/** Label of the signed-in (owner) mailbox: the local part of its address. */
export function ownerLabel(owner: User): string {
  return owner.email.slice(0, owner.email.indexOf('@')).toLowerCase();
}

export interface LinkedMailbox {
  label: string;
  user: User;
  createdAt: number;
}

interface LinkRow {
  member_id: number;
  label: string;
  created_at: number;
}

/** Mailboxes linked to an owner account, oldest first. */
export function listLinks(db: Db, ownerId: number): LinkedMailbox[] {
  const rows = db
    .prepare('SELECT member_id, label, created_at FROM mailbox_links WHERE owner_id = ? ORDER BY created_at, rowid')
    .all(ownerId) as LinkRow[];
  return rows.flatMap((r) => {
    const user = findUserById(db, r.member_id);
    return user ? [{ label: r.label, user, createdAt: r.created_at }] : [];
  });
}

export function countLinks(db: Db, ownerId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM mailbox_links WHERE owner_id = ?').get(ownerId) as { n: number }).n;
}

export function findLink(db: Db, ownerId: number, memberId: number): LinkedMailbox | undefined {
  return listLinks(db, ownerId).find((l) => l.user.id === memberId);
}

/** Turns user input into a label: lower case, letters/digits/._-; an address becomes its local part. */
export function cleanLabel(raw: string | undefined): string {
  let v = (raw ?? '').trim().toLowerCase();
  if (v.includes('@')) v = v.slice(0, v.indexOf('@'));
  return v
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40);
}

function takenLabels(db: Db, ownerId: number, ownerLbl: string, exceptMemberId?: number): Set<string> {
  return new Set([
    ownerLbl,
    'all',
    ...listLinks(db, ownerId)
      .filter((l) => l.user.id !== exceptMemberId)
      .map((l) => l.label),
  ]);
}

/** A short, unique (per owner) label for a new link: the requested one, or the address' local part, plus -2, -3... */
export function uniqueLabel(db: Db, ownerId: number, requested: string | undefined, email: string, ownerLbl: string): string {
  const base = cleanLabel(requested) || cleanLabel(email) || 'mailbox';
  const taken = takenLabels(db, ownerId, ownerLbl);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }
}

export type RenameResult = { ok: true; label: string } | { ok: false; reason: 'empty' | 'taken' | 'not_found' };

/** Renames one of the owner's links. Labels stay unique per owner and can't shadow the owner's own label or "all". */
export function renameLink(db: Db, ownerId: number, memberId: number, requested: string, ownerLbl: string): RenameResult {
  if (!findLink(db, ownerId, memberId)) return { ok: false, reason: 'not_found' };
  const label = cleanLabel(requested);
  if (!label) return { ok: false, reason: 'empty' };
  if (takenLabels(db, ownerId, ownerLbl, memberId).has(label)) return { ok: false, reason: 'taken' };
  db.prepare('UPDATE mailbox_links SET label = ? WHERE owner_id = ? AND member_id = ?').run(label, ownerId, memberId);
  return { ok: true, label };
}

/** Links a member to an owner, keeping the existing label when the link already exists. Returns the label in use. */
export function addLink(db: Db, ownerId: number, memberId: number, label: string, now = Date.now()): string {
  const existing = db
    .prepare('SELECT label FROM mailbox_links WHERE owner_id = ? AND member_id = ?')
    .get(ownerId, memberId) as { label: string } | undefined;
  if (existing) return existing.label;
  db.prepare('INSERT INTO mailbox_links (owner_id, member_id, label, created_at) VALUES (?, ?, ?, ?)').run(
    ownerId,
    memberId,
    label,
    now,
  );
  return label;
}

export function removeLink(db: Db, ownerId: number, memberId: number): boolean {
  return db.prepare('DELETE FROM mailbox_links WHERE owner_id = ? AND member_id = ?').run(ownerId, memberId).changes > 0;
}

function linkCountAsMember(db: Db, memberId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM mailbox_links WHERE member_id = ?').get(memberId) as { n: number }).n;
}

/**
 * Deletes the stored credentials of linked-only accounts that no owner links to any more. Returns their ids so the
 * caller can drop cached connections.
 */
export function purgeOrphanedLinked(db: Db, candidateIds: number[]): number[] {
  const removed: number[] = [];
  for (const id of candidateIds) {
    const user = findUserById(db, id);
    if (user?.linkedOnly && linkCountAsMember(db, id) === 0) {
      deleteUser(db, id);
      removed.push(id);
    }
  }
  return removed;
}
