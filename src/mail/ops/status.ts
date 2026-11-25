import type { ImapFlow } from 'imapflow';

export interface InboxStatus {
  total: number;
  unread: number;
}

/** Message and unread counts of INBOX, without selecting it (so nothing is marked as read). */
export async function inboxStatus(client: ImapFlow): Promise<InboxStatus> {
  const s = await client.status('INBOX', { messages: true, unseen: true });
  return { total: s.messages ?? 0, unread: s.unseen ?? 0 };
}
