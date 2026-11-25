import { decryptSecret } from '../crypto.js';
import type { Db } from '../db/index.js';
import { setTelegramNeedsReauth, type TelegramAccount } from '../db/telegram.js';
import { toTelegramError } from './gramjs.js';
import { TelegramError, type TelegramFactory, type TelegramSession } from './types.js';

interface Entry {
  session: TelegramSession;
  idle?: NodeJS.Timeout;
}

/** One live Telegram connection per account, closed after a few idle minutes; calls per account run one at a time. */
export class TelegramPool {
  private readonly entries = new Map<number, Entry>();
  private readonly queues = new Map<number, Promise<unknown>>();

  constructor(
    private readonly opts: { db: Db; key: Buffer; factory: TelegramFactory; idleMs?: number; timeoutMs?: number },
  ) {}

  run<T>(account: TelegramAccount, fn: (s: TelegramSession) => Promise<T>): Promise<T> {
    const previous = this.queues.get(account.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.exec(account, fn));
    this.queues.set(account.id, next);
    void next.catch(() => undefined).finally(() => {
      if (this.queues.get(account.id) === next) this.queues.delete(account.id);
    });
    return next;
  }

  private async exec<T>(account: TelegramAccount, fn: (s: TelegramSession) => Promise<T>): Promise<T> {
    if (account.needsReauth) {
      throw new TelegramError('AUTH_FAILED', 'Telegram ended this session. Sign in to this account again on the settings page.');
    }
    let entry = this.entries.get(account.id);
    if (!entry) {
      let apiHash: string;
      let session: string;
      try {
        apiHash = decryptSecret(this.opts.key, account.apiHashEnc);
        session = decryptSecret(this.opts.key, account.sessionEnc);
      } catch {
        throw new TelegramError('AUTH_FAILED', 'The stored Telegram session could not be decrypted. Sign in again.');
      }
      try {
        entry = { session: await this.opts.factory.connect(account.apiId, apiHash, session) };
      } catch (err) {
        throw this.fail(account, err);
      }
      this.entries.set(account.id, entry);
    }
    clearTimeout(entry.idle);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        fn(entry.session),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new TelegramError('UPSTREAM_UNAVAILABLE', 'Telegram took too long to respond.')), this.opts.timeoutMs ?? 45_000);
        }),
      ]);
    } catch (err) {
      const e = this.fail(account, err);
      if (e.code === 'AUTH_FAILED' || e.code === 'UPSTREAM_UNAVAILABLE') await this.close(account.id);
      throw e;
    } finally {
      clearTimeout(timer);
      const current = this.entries.get(account.id);
      if (current) {
        current.idle = setTimeout(() => void this.close(account.id), this.opts.idleMs ?? 5 * 60_000);
        current.idle.unref();
      }
    }
  }

  private fail(account: TelegramAccount, err: unknown): TelegramError {
    const e = toTelegramError(err);
    if (e.code === 'AUTH_FAILED') setTelegramNeedsReauth(this.opts.db, account.id, true);
    return e;
  }

  async close(id: number): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    clearTimeout(entry.idle);
    await entry.session.close().catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.close(id)));
  }
}
