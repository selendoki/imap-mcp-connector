import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { AppDeps } from '../app.js';
import { encryptSecret } from '../crypto.js';
import { loginFailuresSince, recordLoginFailure } from '../db/counters.js';
import { cleanLabel } from '../db/links.js';
import {
  deleteTelegramAccount, findTelegramAccount, saveTelegramAccount, setTelegramAllowSend, uniqueTelegramLabel,
} from '../db/telegram.js';
import type { User } from '../db/users.js';
import { log } from '../log.js';
import { TelegramError, type PendingTelegramLogin } from '../telegram/types.js';
import { verifyCsrf } from './csrf.js';
import { requireUser } from './middleware.js';
import type { SettingsRenderer } from './routes.js';

type Body = Record<string, string | undefined>;

interface Pending {
  ownerId: number;
  label: string;
  phone: string;
  apiId: number;
  apiHash: string;
  login: PendingTelegramLogin;
  hint?: string;
  step: 'code' | 'password';
  expiresAt: number;
}

const PENDING_MS = 10 * 60_000;
const START_WINDOW_MS = 15 * 60_000;
const MAX_STARTS = 5;

export interface TelegramView {
  step: 'code' | 'password';
  phone: string;
  hint?: string;
}

/**
 * Telegram sign-in: the user enters api_id/api_hash (from my.telegram.org) and a phone number; Telegram sends a code
 * to their app, which they type here, plus their two-step verification password if set. Only the resulting session
 * (encrypted) is stored. Pending sign-ins live in memory for ten minutes and are tied to the browser session.
 */
export function telegramRouter(deps: AppDeps, render: SettingsRenderer): Router {
  const router = Router();
  const auth = requireUser(deps.db);
  const pending = new Map<string, Pending>();

  const sweep = () => {
    const now = Date.now();
    for (const [id, p] of pending) {
      if (p.expiresAt < now) {
        pending.delete(id);
        void p.login.cancel();
      }
    }
  };
  setInterval(sweep, 60_000).unref();

  function current(req: Request, owner: User): [string, Pending] | undefined {
    const id = req.session.tgPending;
    const p = id ? pending.get(id) : undefined;
    if (!id || !p || p.ownerId !== owner.id || p.expiresAt < Date.now()) return undefined;
    return [id, p];
  }

  const view = (p: Pending): TelegramView => ({ step: p.step, phone: p.phone, hint: p.hint });
  const fail = (req: Request, res: Response, message: string, p?: Pending) =>
    render(req, res, { status: 400, telegramError: message, telegram: p ? view(p) : null });

  function errorMessage(err: unknown): string {
    if (err instanceof TelegramError) return err.message;
    log('warn', 'telegram sign-in failed', { error: err instanceof Error ? err.message : String(err) });
    return 'Telegram did not respond. Try again shortly.';
  }

  async function finish(req: Request, res: Response, id: string, p: Pending, session: string, name: string) {
    pending.delete(id);
    req.session.tgPending = undefined;
    const account = saveTelegramAccount(deps.db, {
      ownerId: p.ownerId,
      label: p.label,
      phone: p.phone,
      apiId: p.apiId,
      apiHashEnc: encryptSecret(deps.config.encryptionKey, p.apiHash),
      sessionEnc: encryptSecret(deps.config.encryptionKey, session),
      displayName: name,
    });
    await deps.telegram?.close(account.id);
    res.redirect('/settings?saved=telegram#telegram');
  }

  router.post('/settings/telegram/start', auth, verifyCsrf, async (req, res) => {
    if (!deps.telegramFactory) return res.redirect('/settings');
    const owner = res.locals.user as User;
    const b = req.body as Body;
    const apiId = Number(b.api_id);
    const apiHash = (b.api_hash ?? '').trim();
    const phone = (b.phone ?? '').replace(/[\s()-]/g, '');
    if (!Number.isInteger(apiId) || apiId <= 0 || !/^[0-9a-f]{32}$/i.test(apiHash)) {
      return fail(req, res, 'Copy api_id (digits) and api_hash (32 characters) from my.telegram.org → API development tools.');
    }
    if (!/^\+\d{8,15}$/.test(phone)) return fail(req, res, 'The phone number is not valid. Use international format, e.g. +96871113813.');
    const key = `tg:${owner.id}`;
    const now = Date.now();
    if (loginFailuresSince(deps.db, key, now - START_WINDOW_MS) >= MAX_STARTS) {
      return fail(req, res, 'Too many Telegram sign-in attempts. Try again in 15 minutes.');
    }
    recordLoginFailure(deps.db, key, now);
    const old = current(req, owner);
    if (old) {
      pending.delete(old[0]);
      void old[1].login.cancel();
    }
    try {
      const login = await deps.telegramFactory.startLogin(apiId, apiHash, phone);
      const id = randomBytes(16).toString('hex');
      const label = uniqueTelegramLabel(deps.db, owner.id, cleanLabel(b.label) || 'telegram');
      const p: Pending = { ownerId: owner.id, label, phone, apiId, apiHash, login, step: 'code', expiresAt: now + PENDING_MS };
      pending.set(id, p);
      req.session.tgPending = id;
      render(req, res, { telegram: view(p) });
    } catch (err) {
      fail(req, res, errorMessage(err));
    }
  });

  router.post('/settings/telegram/code', auth, verifyCsrf, async (req, res) => {
    const found = current(req, res.locals.user as User);
    if (!found) return fail(req, res, 'The sign-in expired. Start again to get a new code.');
    const [id, p] = found;
    const code = ((req.body as Body).code ?? '').trim();
    if (!/^\d{4,8}$/.test(code.replace(/\s+/g, ''))) return fail(req, res, 'Enter the code Telegram sent to your app.', p);
    try {
      const r = await p.login.submitCode(code);
      if (r.status === 'password_needed') {
        p.step = 'password';
        p.hint = r.hint;
        return render(req, res, { telegram: view(p) });
      }
      await finish(req, res, id, p, r.session, r.name);
    } catch (err) {
      fail(req, res, errorMessage(err), p);
    }
  });

  router.post('/settings/telegram/password', auth, verifyCsrf, async (req, res) => {
    const found = current(req, res.locals.user as User);
    if (!found) return fail(req, res, 'The sign-in expired. Start again to get a new code.');
    const [id, p] = found;
    const password = (req.body as Body).password ?? '';
    if (!password) return fail(req, res, 'Enter your Telegram two-step verification password.', p);
    try {
      const r = await p.login.submitPassword(password);
      await finish(req, res, id, p, r.session, r.name);
    } catch (err) {
      fail(req, res, errorMessage(err), p);
    }
  });

  router.post('/settings/telegram/cancel', auth, verifyCsrf, (req, res) => {
    const found = current(req, res.locals.user as User);
    if (found) {
      pending.delete(found[0]);
      void found[1].login.cancel();
    }
    req.session.tgPending = undefined;
    res.redirect('/settings#telegram');
  });

  router.post('/settings/telegram/allow-send', auth, verifyCsrf, (req, res) => {
    const owner = res.locals.user as User;
    const b = req.body as Body;
    const id = Number(b.account_id);
    if (Number.isInteger(id) && findTelegramAccount(deps.db, owner.id, id)) setTelegramAllowSend(deps.db, owner.id, id, b.allow === '1');
    res.redirect('/settings?saved=telegram#telegram');
  });

  router.post('/settings/telegram/remove', auth, verifyCsrf, async (req, res) => {
    const owner = res.locals.user as User;
    const id = Number((req.body as Body).account_id);
    if (Number.isInteger(id) && findTelegramAccount(deps.db, owner.id, id)) {
      await deps.telegram?.close(id);
      deleteTelegramAccount(deps.db, owner.id, id);
    }
    res.redirect('/settings?saved=telegram#telegram');
  });

  return router;
}
