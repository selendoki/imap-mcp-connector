import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import type { Entity } from 'telegram/define.js';
import {
  TelegramError, type CodeResult, type PendingTelegramLogin, type TelegramFactory, type TelegramSession, type TgChat, type TgMessage,
} from './types.js';

const MAX_TEXT = 4000;

function newClient(apiId: number, apiHash: string, session: string): TelegramClient {
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 3,
    deviceModel: 'Mail Agent',
    appVersion: '1.0',
  });
  client.setLogLevel('none' as never);
  return client;
}

function errorText(err: unknown): string {
  const e = err as { errorMessage?: string; message?: string };
  return e?.errorMessage ?? e?.message ?? String(err);
}

/** Maps Telegram RPC errors to the codes the tools report. */
export function toTelegramError(err: unknown): TelegramError {
  if (err instanceof TelegramError) return err;
  const text = errorText(err);
  if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED|AUTH_KEY_UNREGISTERED/.test(text)) {
    return new TelegramError('AUTH_FAILED', 'Telegram ended this session. Sign in to this account again on the settings page.');
  }
  if (/PHONE_CODE_INVALID|PHONE_CODE_EMPTY/.test(text)) return new TelegramError('INVALID_INPUT', 'The code is wrong. Check it and try again.');
  if (/PHONE_CODE_EXPIRED/.test(text)) return new TelegramError('INVALID_INPUT', 'The code expired. Start again to get a new one.');
  if (/PASSWORD_HASH_INVALID/.test(text)) return new TelegramError('INVALID_INPUT', 'The two-step verification password is wrong.');
  if (/PHONE_NUMBER_INVALID/.test(text)) return new TelegramError('INVALID_INPUT', 'The phone number is not valid. Use international format, e.g. +96871113813.');
  if (/API_ID_INVALID|API_ID_PUBLISHED_FLOOD/.test(text)) return new TelegramError('INVALID_INPUT', 'Telegram rejected the api_id / api_hash. Copy them again from my.telegram.org.');
  const flood = /FLOOD_WAIT_(\d+)/.exec(text);
  if (flood) return new TelegramError('RATE_LIMITED', `Telegram asks to wait ${flood[1]} seconds before trying again.`);
  if (/USERNAME_INVALID|USERNAME_NOT_OCCUPIED|PEER_ID_INVALID|CHANNEL_PRIVATE|Cannot find any entity|Could not find the input entity/i.test(text)) {
    return new TelegramError('NOT_FOUND', 'Chat not found. Use an id or @username from telegram_list_chats.');
  }
  return new TelegramError('UPSTREAM_UNAVAILABLE', `Telegram did not complete the request (${text.slice(0, 120)}).`);
}

function displayName(e: Entity | undefined): string {
  if (!e) return 'unknown';
  if (e instanceof Api.User) return [e.firstName, e.lastName].filter(Boolean).join(' ') || (e.username ? `@${e.username}` : String(e.id));
  if (e instanceof Api.Chat || e instanceof Api.Channel) return e.title;
  return 'unknown';
}

function kindOf(e: Entity | undefined): TgChat['kind'] {
  if (e instanceof Api.User) return e.bot ? 'bot' : 'user';
  if (e instanceof Api.Channel) return e.megagroup ? 'group' : 'channel';
  return 'group';
}

function mediaLabel(m: Api.Message): string | undefined {
  if (!m.media) return undefined;
  if (m.media instanceof Api.MessageMediaPhoto) return 'photo';
  if (m.media instanceof Api.MessageMediaDocument) {
    const doc = m.media.document;
    if (doc instanceof Api.Document) {
      const name = doc.attributes.find((a): a is Api.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename);
      if (doc.attributes.some((a) => a instanceof Api.DocumentAttributeAudio)) return 'voice/audio';
      return name ? `file: ${name.fileName}` : `file (${doc.mimeType})`;
    }
    return 'file';
  }
  if (m.media instanceof Api.MessageMediaGeo || m.media instanceof Api.MessageMediaVenue) return 'location';
  if (m.media instanceof Api.MessageMediaContact) return 'contact';
  if (m.media instanceof Api.MessageMediaWebPage) return undefined;
  return 'media';
}

async function toMessage(m: Api.Message, chatId: string, chatTitle?: string): Promise<TgMessage> {
  let from = m.out ? 'me' : 'unknown';
  if (!m.out) {
    try {
      from = displayName((await m.getSender()) as Entity | undefined);
    } catch {
      from = 'unknown';
    }
  }
  return {
    id: m.id,
    chatId,
    chatTitle,
    date: new Date(m.date * 1000).toISOString(),
    from,
    out: Boolean(m.out),
    text: (m.message ?? '').slice(0, MAX_TEXT),
    replyTo: m.replyTo?.replyToMsgId,
    media: mediaLabel(m),
  };
}

class GramSession implements TelegramSession {
  constructor(private readonly client: TelegramClient) {}

  async me() {
    const me = (await this.client.getMe()) as Api.User;
    return { name: displayName(me), username: me.username ?? undefined };
  }

  /** Accepts a numeric id, @username, or (part of) a chat title from the dialog list. */
  private async resolve(chat: string): Promise<{ entity: Entity; id: string; title: string }> {
    const raw = chat.trim();
    if (!raw) throw new TelegramError('INVALID_INPUT', 'chat is required.');
    if (/^-?\d+$/.test(raw) || raw.startsWith('@')) {
      const entity = (await this.client.getEntity(/^-?\d+$/.test(raw) ? raw : raw.slice(1))) as Entity;
      return { entity, id: String(await this.client.getPeerId(entity)), title: displayName(entity) };
    }
    const needle = raw.toLowerCase();
    for await (const d of this.client.iterDialogs({ limit: 300 })) {
      if ((d.title ?? '').toLowerCase().includes(needle) && d.entity) {
        return { entity: d.entity, id: String(d.id), title: d.title ?? '' };
      }
    }
    throw new TelegramError('NOT_FOUND', `No chat matches "${raw}". Use an id or @username from telegram_list_chats.`);
  }

  async listChats(opts: { limit: number; unreadOnly: boolean }): Promise<TgChat[]> {
    const out: TgChat[] = [];
    for await (const d of this.client.iterDialogs({ limit: opts.unreadOnly ? 300 : opts.limit })) {
      if (opts.unreadOnly && !d.unreadCount) continue;
      const e = d.entity;
      out.push({
        id: String(d.id),
        title: d.title ?? displayName(e),
        kind: kindOf(e),
        username: (e as { username?: string } | undefined)?.username ?? undefined,
        unread: d.unreadCount ?? 0,
        lastDate: d.message?.date ? new Date(d.message.date * 1000).toISOString() : undefined,
        lastText: d.message?.message?.slice(0, 200),
      });
      if (out.length >= opts.limit) break;
    }
    return out;
  }

  async readMessages(chat: string, opts: { limit: number; beforeId?: number }) {
    const target = await this.resolve(chat);
    // getMessages reads history without sending a read receipt.
    const list = await this.client.getMessages(target.entity, { limit: opts.limit, offsetId: opts.beforeId ?? 0 });
    const messages: TgMessage[] = [];
    for (const m of list) if (m instanceof Api.Message) messages.push(await toMessage(m, target.id));
    const dialogChat: TgChat = { id: target.id, title: target.title, kind: kindOf(target.entity), unread: 0 };
    return { chat: dialogChat, messages };
  }

  async search(query: string, opts: { chat?: string; limit: number }): Promise<TgMessage[]> {
    if (!query.trim()) throw new TelegramError('INVALID_INPUT', 'query is required.');
    if (opts.chat) {
      const target = await this.resolve(opts.chat);
      const list = await this.client.getMessages(target.entity, { search: query, limit: opts.limit });
      const out: TgMessage[] = [];
      for (const m of list) if (m instanceof Api.Message) out.push(await toMessage(m, target.id, target.title));
      return out;
    }
    const res = await this.client.invoke(
      new Api.messages.SearchGlobal({
        q: query,
        filter: new Api.InputMessagesFilterEmpty(),
        minDate: 0,
        maxDate: 0,
        offsetRate: 0,
        offsetPeer: new Api.InputPeerEmpty(),
        offsetId: 0,
        limit: opts.limit,
      }),
    );
    const out: TgMessage[] = [];
    if ('messages' in res) {
      const titles = new Map<string, string>();
      for (const u of 'users' in res ? res.users : []) if (u instanceof Api.User) titles.set(`user:${String(u.id)}`, displayName(u));
      for (const c of 'chats' in res ? res.chats : []) if (c instanceof Api.Chat || c instanceof Api.Channel) titles.set(`chat:${String(c.id)}`, c.title);
      for (const m of res.messages) {
        if (!(m instanceof Api.Message)) continue;
        const peer = m.peerId;
        const key =
          peer instanceof Api.PeerUser ? `user:${String(peer.userId)}` : peer instanceof Api.PeerChat ? `chat:${String(peer.chatId)}` : `chat:${String((peer as Api.PeerChannel).channelId)}`;
        const chatId = String(await this.client.getPeerId(peer));
        out.push(await toMessage(m, chatId, titles.get(key)));
      }
    }
    return out;
  }

  async sendMessage(chat: string, text: string, replyTo?: number) {
    const target = await this.resolve(chat);
    const sent = await this.client.sendMessage(target.entity, { message: text, replyTo, parseMode: false });
    return { id: sent.id, chatId: target.id };
  }

  async close(): Promise<void> {
    await this.client.destroy().catch(() => undefined);
  }
}

class GramPendingLogin implements PendingTelegramLogin {
  constructor(
    private readonly client: TelegramClient,
    private readonly apiId: number,
    private readonly apiHash: string,
    private readonly phone: string,
    private readonly phoneCodeHash: string,
  ) {}

  private async finish(user: Api.TypeUser | undefined) {
    const session = (this.client.session as StringSession).save();
    await this.client.destroy().catch(() => undefined);
    return { session, name: displayName(user as Entity | undefined) };
  }

  async submitCode(code: string): Promise<CodeResult> {
    try {
      const res = await this.client.invoke(
        new Api.auth.SignIn({ phoneNumber: this.phone, phoneCodeHash: this.phoneCodeHash, phoneCode: code.replace(/\s+/g, '') }),
      );
      if (res instanceof Api.auth.AuthorizationSignUpRequired) {
        throw new TelegramError('INVALID_INPUT', 'This phone number has no Telegram account.');
      }
      return { status: 'ok', ...(await this.finish(res.user)) };
    } catch (err) {
      if (/SESSION_PASSWORD_NEEDED/.test(errorText(err))) {
        let hint: string | undefined;
        try {
          const pw = await this.client.invoke(new Api.account.GetPassword());
          hint = pw.hint ?? undefined;
        } catch {
          hint = undefined;
        }
        return { status: 'password_needed', hint };
      }
      throw toTelegramError(err);
    }
  }

  async submitPassword(password: string) {
    let failure: unknown;
    const user = await this.client.signInWithPassword(
      { apiId: this.apiId, apiHash: this.apiHash },
      {
        password: async () => password,
        onError: async (err) => {
          failure = err;
          return true;
        },
      },
    ).catch((err: unknown) => {
      throw toTelegramError(failure ?? err);
    });
    return this.finish(user);
  }

  async cancel(): Promise<void> {
    await this.client.destroy().catch(() => undefined);
  }
}

export const gramjsFactory: TelegramFactory = {
  async connect(apiId, apiHash, session) {
    const client = newClient(apiId, apiHash, session);
    try {
      await client.connect();
      if (!(await client.checkAuthorization())) {
        await client.destroy().catch(() => undefined);
        throw new TelegramError('AUTH_FAILED', 'Telegram ended this session. Sign in to this account again on the settings page.');
      }
    } catch (err) {
      await client.destroy().catch(() => undefined);
      throw toTelegramError(err);
    }
    return new GramSession(client);
  },

  async startLogin(apiId, apiHash, phone) {
    const client = newClient(apiId, apiHash, '');
    try {
      await client.connect();
      const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phone);
      return new GramPendingLogin(client, apiId, apiHash, phone, phoneCodeHash);
    } catch (err) {
      await client.destroy().catch(() => undefined);
      throw toTelegramError(err);
    }
  },
};
