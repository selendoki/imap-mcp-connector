export interface TgChat {
  /** Stable id to pass back as "chat" (numeric peer id as text). */
  id: string;
  title: string;
  kind: 'user' | 'group' | 'channel' | 'bot';
  username?: string;
  unread: number;
  lastDate?: string;
  lastText?: string;
}

export interface TgMessage {
  id: number;
  chatId: string;
  chatTitle?: string;
  date: string;
  from: string;
  out: boolean;
  text: string;
  replyTo?: number;
  media?: string;
}

/** A signed-in Telegram account. Reading never marks anything as read. */
export interface TelegramSession {
  me(): Promise<{ name: string; username?: string }>;
  listChats(opts: { limit: number; unreadOnly: boolean }): Promise<TgChat[]>;
  readMessages(chat: string, opts: { limit: number; beforeId?: number }): Promise<{ chat: TgChat; messages: TgMessage[] }>;
  search(query: string, opts: { chat?: string; limit: number }): Promise<TgMessage[]>;
  sendMessage(chat: string, text: string, replyTo?: number): Promise<{ id: number; chatId: string }>;
  close(): Promise<void>;
}

export type CodeResult = { status: 'ok'; session: string; name: string } | { status: 'password_needed'; hint?: string };

/** A sign-in in progress: the code was sent to the user's Telegram app. */
export interface PendingTelegramLogin {
  submitCode(code: string): Promise<CodeResult>;
  submitPassword(password: string): Promise<{ session: string; name: string }>;
  cancel(): Promise<void>;
}

export interface TelegramFactory {
  connect(apiId: number, apiHash: string, session: string): Promise<TelegramSession>;
  startLogin(apiId: number, apiHash: string, phone: string): Promise<PendingTelegramLogin>;
}

export class TelegramError extends Error {
  override name = 'TelegramError';
  constructor(
    readonly code: 'AUTH_FAILED' | 'NOT_FOUND' | 'INVALID_INPUT' | 'UPSTREAM_UNAVAILABLE' | 'RATE_LIMITED',
    message: string,
  ) {
    super(message);
  }
}
