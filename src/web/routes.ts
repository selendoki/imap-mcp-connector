import { Router, type Request, type Response } from 'express';
import type { AppDeps } from '../app.js';
import { login, type LoginDeps } from '../auth/login.js';
import { deleteSessionsForUser } from '../auth/session.js';
import { mcpUrl } from '../config.js';
import { encryptSecret } from '../crypto.js';
import { addLink, countLinks, findLink, listLinks, ownerLabel, purgeOrphanedLinked, removeLink, uniqueLabel } from '../db/links.js';
import { listActiveGrants, revokeUserGrant } from '../db/oauth.js';
import { deleteUser, serverSettingsOf, setPermissionLevel, updateSmtpSettings, type User } from '../db/users.js';
import { GuardError } from '../guard.js';
import { log } from '../log.js';
import type { MailServerSettings, PermissionLevel, Security } from '../types.js';
import { csrfToken, verifyCsrf } from './csrf.js';
import { LEVELS } from './levels.js';
import { requireUser, safeNext } from './middleware.js';

type Body = Record<string, string | undefined>;
const SECURITIES: Security[] = ['tls', 'starttls', 'none'];

const isPort = (n: number) => Number.isInteger(n) && n > 0 && n < 65536;
const isSecurity = (s: string | undefined): s is Security => SECURITIES.includes(s as Security);

function parseManual(b: Body): MailServerSettings | undefined {
  const imapPort = Number(b.imap_port);
  const smtpPort = Number(b.smtp_port);
  if (!b.imap_host?.trim() || !b.smtp_host?.trim() || !isPort(imapPort) || !isPort(smtpPort)) return undefined;
  if (!isSecurity(b.imap_security) || !isSecurity(b.smtp_security)) return undefined;
  return {
    imapHost: b.imap_host.trim(),
    imapPort,
    imapSecurity: b.imap_security,
    smtpHost: b.smtp_host.trim(),
    smtpPort,
    smtpSecurity: b.smtp_security,
    autoSavesSent: false,
  };
}

interface LoginView {
  email?: string;
  error?: string | null;
  needsSettings?: boolean;
  manual?: Body;
  next?: unknown;
  status?: number;
}

function renderLogin(req: Request, res: Response, view: LoginView): void {
  res.status(view.status ?? 200).render('login', {
    title: 'Sign in',
    csrf: csrfToken(req),
    next: safeNext(view.next ?? req.query.next, ''),
    email: view.email ?? '',
    error: view.error ?? null,
    needsSettings: view.needsSettings ?? false,
    manual: view.manual ?? {},
    deleted: req.query.deleted === '1',
  });
}

export const LINK_ROWS = 10;

interface LinkResult {
  email: string;
  ok: boolean;
  message: string;
}

function renderSettings(
  deps: AppDeps,
  req: Request,
  res: Response,
  error: string | null = null,
  status = 200,
  linkResults: LinkResult[] = [],
): void {
  const user = res.locals.user as User;
  res.status(status).render('settings', {
    title: 'Settings',
    user,
    ownerLabel: ownerLabel(user),
    mailboxes: listLinks(deps.db, user.id),
    maxMailboxes: deps.config.maxLinkedMailboxes,
    linkRows: LINK_ROWS,
    linkResults,
    csrf: csrfToken(req),
    connectorUrl: mcpUrl(deps.config).href,
    grants: listActiveGrants(deps.db, user.id, Date.now()),
    levels: LEVELS,
    saved: typeof req.query.saved === 'string' ? req.query.saved : null,
    welcome: req.query.welcome === '1',
    error,
  });
}

export function webRouter(deps: AppDeps): Router {
  const router = Router();
  const auth = requireUser(deps.db);
  const loginDeps: LoginDeps = {
    db: deps.db,
    config: deps.config,
    discover: deps.discover,
    verifyImap: deps.verifyImap,
    guard: deps.guard,
  };

  router.get('/', (req, res) => res.redirect(req.session.userId ? '/settings' : '/login'));

  router.get('/login', (req, res) => renderLogin(req, res, {}));

  router.post('/login', verifyCsrf, async (req, res) => {
    const body = req.body as Body;
    const manual = body.imap_host !== undefined ? parseManual(body) : undefined;
    if (body.imap_host !== undefined && !manual) {
      return renderLogin(req, res, { email: body.email, error: 'Check the server settings.', needsSettings: true, manual: body, next: body.next, status: 400 });
    }
    const result = await login(loginDeps, { email: body.email ?? '', password: body.password ?? '', ip: req.ip ?? 'unknown', manual });
    if (result.status === 'needs_settings') {
      return renderLogin(req, res, { email: body.email, error: result.message, needsSettings: true, next: body.next });
    }
    if (result.status === 'error') {
      return renderLogin(req, res, { email: body.email, error: result.message, needsSettings: Boolean(manual), manual: body, next: body.next, status: 400 });
    }
    const fallback = result.isNew ? '/settings?welcome=1' : '/settings';
    const next = safeNext(body.next, fallback);
    try {
      await deps.pool.close(result.user.id);
    } catch (err) {
      log('warn', 'closing cached mail connection failed', {
        userId: result.user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.userId = result.user.id;
    res.redirect(next);
  });

  router.post('/logout', verifyCsrf, (req, res, next) => {
    req.session.destroy((err) => (err ? next(err) : res.redirect('/login')));
  });

  router.get('/settings', auth, (req, res) => renderSettings(deps, req, res));

  router.post('/settings/permission', auth, verifyCsrf, (req, res) => {
    const level = (req.body as Body).level as PermissionLevel;
    if (!LEVELS.some((l) => l.value === level)) return renderSettings(deps, req, res, 'Choose a valid permission level.', 400);
    setPermissionLevel(deps.db, (res.locals.user as User).id, level);
    res.redirect('/settings?saved=permission');
  });

  router.post('/settings/smtp', auth, verifyCsrf, async (req, res) => {
    const user = res.locals.user as User;
    const b = req.body as Body;
    const smtpPort = Number(b.smtp_port);
    if (!b.smtp_host?.trim() || !isPort(smtpPort) || !isSecurity(b.smtp_security) || !b.smtp_username?.trim()) {
      return renderSettings(deps, req, res, 'Check the SMTP settings.', 400);
    }
    const smtp = { smtpHost: b.smtp_host.trim(), smtpPort, smtpSecurity: b.smtp_security };
    try {
      await deps.guard(user.email, { ...serverSettingsOf(user), ...smtp }, user.linkedOnly);
    } catch (err) {
      if (err instanceof GuardError) return renderSettings(deps, req, res, err.message, 400);
      throw err;
    }
    const smtpPasswordEnc =
      b.use_imap_password === 'on'
        ? null
        : b.smtp_password
          ? encryptSecret(deps.config.encryptionKey, b.smtp_password)
          : user.smtpPasswordEnc;
    updateSmtpSettings(deps.db, user.id, { ...smtp, smtpUsername: b.smtp_username.trim(), smtpPasswordEnc });
    res.redirect('/settings?saved=smtp');
  });

  // Adds up to LINK_ROWS mailboxes at once. Each one is verified exactly like a sign-in (allowlists, discovery or a
  // listed server, a real IMAP login) and stored as its own account with an encrypted password.
  router.post('/settings/mailboxes', auth, verifyCsrf, async (req, res) => {
    const owner = res.locals.user as User;
    const b = req.body as Body;
    const results: LinkResult[] = [];
    for (let i = 0; i < LINK_ROWS; i++) {
      const email = (b[`email_${i}`] ?? '').trim().toLowerCase();
      const password = b[`password_${i}`] ?? '';
      if (!email && !password) continue;
      if (!email || !password) {
        results.push({ email: email || `row ${i + 1}`, ok: false, message: 'Enter both the address and the password.' });
        continue;
      }
      if (email === owner.email) {
        results.push({ email, ok: false, message: 'This is the mailbox you are signed in with.' });
        continue;
      }
      if (countLinks(deps.db, owner.id) >= deps.config.maxLinkedMailboxes) {
        results.push({ email, ok: false, message: `At most ${deps.config.maxLinkedMailboxes} linked mailboxes.` });
        continue;
      }
      // Mailboxes on the owner's own domain usually publish no discoverable settings: offer the owner's server, which
      // login() accepts only if discovery finds nothing and the server is listed by name.
      const sameDomain = email.slice(email.lastIndexOf('@')) === owner.email.slice(owner.email.lastIndexOf('@'));
      const result = await login(loginDeps, {
        email,
        password,
        ip: req.ip ?? 'unknown',
        linked: true,
        manual: sameDomain ? serverSettingsOf(owner) : undefined,
      });
      if (result.status !== 'ok') {
        results.push({ email, ok: false, message: result.message });
        continue;
      }
      if (result.user.id === owner.id) {
        results.push({ email, ok: false, message: 'This is the mailbox you are signed in with.' });
        continue;
      }
      const label = addLink(deps.db, owner.id, result.user.id, uniqueLabel(deps.db, owner.id, b[`label_${i}`], email, ownerLabel(owner)));
      try {
        await deps.pool.close(result.user.id);
      } catch (err) {
        log('warn', 'closing cached mail connection failed', { userId: result.user.id, error: err instanceof Error ? err.message : String(err) });
      }
      results.push({ email, ok: true, message: `Connected as "${label}".` });
    }
    if (results.length === 0) return renderSettings(deps, req, res, 'Fill in at least one mailbox.', 400);
    renderSettings(deps, req, res, null, 200, results);
  });

  router.post('/settings/mailboxes/remove', auth, verifyCsrf, async (req, res) => {
    const owner = res.locals.user as User;
    const memberId = Number((req.body as Body).member_id);
    if (Number.isInteger(memberId) && findLink(deps.db, owner.id, memberId)) {
      removeLink(deps.db, owner.id, memberId);
      for (const id of purgeOrphanedLinked(deps.db, [memberId])) await deps.pool.close(id);
    }
    res.redirect('/settings?saved=mailboxes');
  });

  router.post('/settings/revoke', auth, verifyCsrf, (req, res) => {
    const grantId = (req.body as Body).grant_id;
    if (grantId) revokeUserGrant(deps.db, (res.locals.user as User).id, grantId, Date.now());
    res.redirect('/settings?saved=revoked');
  });

  router.post('/settings/delete', auth, verifyCsrf, async (req, res, next) => {
    const user = res.locals.user as User;
    const memberIds = listLinks(deps.db, user.id).map((l) => l.user.id);
    await deps.pool.close(user.id);
    deleteUser(deps.db, user.id);
    for (const id of purgeOrphanedLinked(deps.db, memberIds)) await deps.pool.close(id);
    deleteSessionsForUser(deps.db, user.id);
    req.session.destroy((err) => (err ? next(err) : res.redirect('/login?deleted=1')));
  });

  return router;
}
