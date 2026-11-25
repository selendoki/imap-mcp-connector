import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addLink, listLinks } from '../../src/db/links.js';
import { findUserByEmail, findUserById } from '../../src/db/users.js';
import { guardMailSettings, guardStoredUser, isAllowed } from '../../src/guard.js';
import type { MailPool } from '../../src/mail/pool.js';
import { defaultSmtpFactory } from '../../src/mail/smtp.js';
import { registerTools, resolveMailbox } from '../../src/mcp/tools.js';
import type { MailServerSettings } from '../../src/types.js';
import { csrfFrom, signIn, testApp } from '../helpers/app.js';
import { testConfig } from '../helpers/config.js';
import { createTestUser, testDb } from '../helpers/db.js';

const publicLookup = async () => [{ address: '93.184.216.34' }];
const LINKED_ENV = {
  ALLOWED_EMAIL_DOMAINS: 'x.org',
  ALLOWED_IMAP_HOSTS: 'imap.x.org',
  LINKED_EMAIL_DOMAINS: 'gmail.com',
  LINKED_IMAP_HOSTS: 'imap.gmail.com',
};
const gmail: MailServerSettings = {
  imapHost: 'imap.gmail.com', imapPort: 993, imapSecurity: 'tls',
  smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecurity: 'tls', autoSavesSent: true,
};
const xorg: MailServerSettings = {
  imapHost: 'imap.x.org', imapPort: 993, imapSecurity: 'tls',
  smtpHost: 'smtp.x.org', smtpPort: 465, smtpSecurity: 'tls', autoSavesSent: false,
};

function linkedApp(env: Record<string, string> = LINKED_ENV) {
  const config = testConfig(env);
  return testApp(
    {
      discover: async (email) => (email.endsWith('@gmail.com') ? gmail : email.endsWith('@x.org') ? xorg : null),
      guard: (email, settings, linked) => guardMailSettings(config, email, settings, publicLookup, linked),
    },
    env,
  );
}

async function addMailboxes(agent: ReturnType<typeof request.agent>, rows: { label?: string; email: string; password: string }[]) {
  const page = await agent.get('/settings');
  const form: Record<string, string> = { _csrf: csrfFrom(page.text) };
  rows.forEach((r, i) => {
    form[`label_${i}`] = r.label ?? '';
    form[`email_${i}`] = r.email;
    form[`password_${i}`] = r.password;
  });
  return agent.post('/settings/mailboxes').type('form').send(form);
}

describe('linked mailbox allowlists', () => {
  it('LINKED_* lists apply only to linked mailboxes', () => {
    const c = testConfig(LINKED_ENV);
    expect(isAllowed(c, 'a@gmail.com', 'imap.gmail.com')).toBe(false);
    expect(isAllowed(c, 'a@gmail.com', 'imap.gmail.com', true)).toBe(true);
    expect(isAllowed(c, 'a@x.org', 'imap.x.org', true)).toBe(true);
    expect(isAllowed(c, 'a@evil.net', 'imap.gmail.com', true)).toBe(false);
    expect(isAllowed(c, 'a@gmail.com', 'imap.evil.net', true)).toBe(false);
  });

  it('stored linked-only accounts are checked with the linked lists', async () => {
    const c = testConfig(LINKED_ENV);
    const db = testDb();
    const member = createTestUser(db, { email: 'm@gmail.com', ...gmail, linkedOnly: true });
    await expect(guardStoredUser(c, member, publicLookup)).resolves.toBeDefined();
    const plain = createTestUser(db, { email: 'p@gmail.com', ...gmail });
    await expect(guardStoredUser(c, plain, publicLookup)).rejects.toThrow(/not allowed/);
  });
});

describe('adding mailboxes in one batch', () => {
  it('verifies each row, links the good ones and reports every row', async () => {
    const { app, deps } = linkedApp();
    const agent = request.agent(app);
    await signIn(agent, 'alice@x.org');
    const res = await addMailboxes(agent, [
      { label: 'Sales', email: 'bob@x.org', password: 'right' },
      { email: 'carol@gmail.com', password: 'right' },
      { email: 'dave@evil.net', password: 'right' },
      { email: 'erin@x.org', password: 'wrong' },
      { email: 'alice@x.org', password: 'right' },
    ]);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Connected as &#34;sales&#34;');
    expect(res.text).toContain('Connected as &#34;carol&#34;');
    expect(res.text).toMatch(/dave@evil\.net[\s\S]*?✗/);
    expect(res.text).toMatch(/erin@x\.org[\s\S]*?Email or password incorrect/);
    expect(res.text).toContain('This is the mailbox you are signed in with.');
    expect(res.text).not.toContain('value="right"');

    const owner = findUserByEmail(deps.db, 'alice@x.org')!;
    expect(listLinks(deps.db, owner.id).map((l) => [l.label, l.user.email, l.user.linkedOnly])).toEqual([
      ['sales', 'bob@x.org', true],
      ['carol', 'carol@gmail.com', true],
    ]);
    expect(findUserByEmail(deps.db, 'dave@evil.net')).toBeUndefined();
  });

  it('uses the signed-in server for same-domain mailboxes that publish no settings', async () => {
    const env = { ...LINKED_ENV };
    const config = testConfig(env);
    const { app, deps } = testApp(
      {
        discover: async () => null,
        guard: (email, settings, linked) => guardMailSettings(config, email, settings, publicLookup, linked),
      },
      env,
    );
    const agent = request.agent(app);
    const page = await agent.get('/login');
    await agent.post('/login').type('form').send({
      _csrf: csrfFrom(page.text), email: 'alice@x.org', password: 'right',
      imap_host: 'imap.x.org', imap_port: '993', imap_security: 'tls',
      smtp_host: 'smtp.x.org', smtp_port: '465', smtp_security: 'tls',
    });
    const res = await addMailboxes(agent, [{ email: 'ops@x.org', password: 'right' }]);
    expect(res.text).toContain('Connected as &#34;ops&#34;');
    expect(findUserByEmail(deps.db, 'ops@x.org')).toMatchObject({ imapHost: 'imap.x.org', settingsSource: 'manual' });
  });

  it('a linked-only mailbox on a linked-only domain cannot be used to sign in', async () => {
    const { app } = linkedApp();
    const owner = request.agent(app);
    await signIn(owner, 'alice@x.org');
    await addMailboxes(owner, [{ email: 'carol@gmail.com', password: 'right' }]);
    const stranger = request.agent(app);
    const res = await signIn(stranger, 'carol@gmail.com');
    expect(res.status).toBe(400);
    expect(res.text).toContain('not allowed');
  });

  it('removing a link deletes the stored credentials of a linked-only mailbox', async () => {
    const { app, deps } = linkedApp();
    const agent = request.agent(app);
    await signIn(agent, 'alice@x.org');
    await addMailboxes(agent, [{ email: 'carol@gmail.com', password: 'right' }]);
    const owner = findUserByEmail(deps.db, 'alice@x.org')!;
    const member = findUserByEmail(deps.db, 'carol@gmail.com')!;
    const page = await agent.get('/settings');
    const res = await agent.post('/settings/mailboxes/remove').type('form').send({ _csrf: csrfFrom(page.text), member_id: String(member.id) });
    expect(res.headers.location).toBe('/settings?saved=mailboxes');
    expect(listLinks(deps.db, owner.id)).toEqual([]);
    expect(findUserById(deps.db, member.id)).toBeUndefined();
  });

  it('cannot remove another owner\'s link', async () => {
    const { app, deps } = linkedApp();
    const db = deps.db;
    const other = createTestUser(db, { email: 'zed@x.org', ...xorg });
    const member = createTestUser(db, { email: 'm@gmail.com', ...gmail, linkedOnly: true });
    addLink(db, other.id, member.id, 'm');
    const agent = request.agent(app);
    await signIn(agent, 'alice@x.org');
    const page = await agent.get('/settings');
    await agent.post('/settings/mailboxes/remove').type('form').send({ _csrf: csrfFrom(page.text), member_id: String(member.id) });
    expect(listLinks(db, other.id)).toHaveLength(1);
  });

  it('deleting the account removes its linked-only mailboxes', async () => {
    const { app, deps } = linkedApp();
    const agent = request.agent(app);
    await signIn(agent, 'alice@x.org');
    await addMailboxes(agent, [{ email: 'carol@gmail.com', password: 'right' }]);
    const page = await agent.get('/settings');
    await agent.post('/settings/delete').type('form').send({ _csrf: csrfFrom(page.text) });
    expect(findUserByEmail(deps.db, 'carol@gmail.com')).toBeUndefined();
  });
});

describe('mailbox selection in tools', () => {
  type Handler = (args: unknown) => Promise<{ isError?: boolean; content: { text: string }[] }>;

  function setup() {
    const db = testDb();
    const owner = createTestUser(db, { email: 'gs@x.org', permissionLevel: 'full' });
    const sales = createTestUser(db, { email: 'sales@x.org', linkedOnly: true });
    const mail = createTestUser(db, { email: 'me@gmail.com', linkedOnly: true });
    addLink(db, owner.id, sales.id, 'sales');
    addLink(db, owner.id, mail.id, 'personal');
    const seen: string[] = [];
    const pool = {
      withImap: async (user: { email: string }) => {
        seen.push(user.email);
        return [{ path: 'INBOX', name: 'INBOX', role: 'inbox', total: 1, unread: 0 }];
      },
    } as unknown as MailPool;
    const handlers = new Map<string, Handler>();
    const fake = { registerTool: (name: string, _c: unknown, cb: Handler) => handlers.set(name, cb) } as unknown as McpServer;
    registerTools(fake, { db, config: testConfig(), pool, smtpFactory: defaultSmtpFactory, userId: owner.id }, 'full');
    return { db, owner, handlers, seen };
  }

  it('resolves by label or address, defaulting to the signed-in mailbox', () => {
    const { db, owner } = setup();
    expect(resolveMailbox(db, owner, undefined).email).toBe('gs@x.org');
    expect(resolveMailbox(db, owner, 'gs').email).toBe('gs@x.org');
    expect(resolveMailbox(db, owner, 'Sales').email).toBe('sales@x.org');
    expect(resolveMailbox(db, owner, 'ME@gmail.com').email).toBe('me@gmail.com');
    expect(() => resolveMailbox(db, owner, 'nope')).toThrow(/list_mailboxes/);
  });

  it('never reaches a mailbox linked to someone else', () => {
    const { db, owner } = setup();
    const stranger = createTestUser(db, { email: 'x@x.org' });
    const theirs = createTestUser(db, { email: 'theirs@x.org', linkedOnly: true });
    addLink(db, stranger.id, theirs.id, 'theirs');
    expect(() => resolveMailbox(db, owner, 'theirs@x.org')).toThrow(/Unknown mailbox/);
  });

  it('list_mailboxes lists the signed-in and linked mailboxes; tools act on the chosen one', async () => {
    const { handlers, seen } = setup();
    const list = await handlers.get('list_mailboxes')!({});
    expect(JSON.parse(list.content[0].text)).toEqual([
      { mailbox: 'gs', address: 'gs@x.org', primary: true, needs_reauth: false },
      { mailbox: 'sales', address: 'sales@x.org', primary: false, needs_reauth: false },
      { mailbox: 'personal', address: 'me@gmail.com', primary: false, needs_reauth: false },
    ]);
    await handlers.get('list_folders')!({ mailbox: 'personal' });
    await handlers.get('list_folders')!({});
    expect(seen).toEqual(['me@gmail.com', 'gs@x.org']);
    const bad = await handlers.get('list_folders')!({ mailbox: 'nope' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/^NOT_FOUND/);
  });

  it('search with mailbox "all" refuses a cursor', async () => {
    const { handlers } = setup();
    const res = await handlers.get('search_messages')!({ mailbox: 'all', cursor: 'abc' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^INVALID_INPUT/);
  });
});

describe('managing linked mailboxes', () => {
  it('cleans labels: an address becomes its local part, Cyrillic is kept', async () => {
    const { cleanLabel } = await import('../../src/db/links.js');
    expect(cleanLabel('commercial@nexus.example')).toBe('commercial');
    expect(cleanLabel('Gennady S.')).toBe('gennady-s');
    expect(cleanLabel('  Коммерция ')).toBe('коммерция');
    expect(cleanLabel('!!!')).toBe('');
  });

  it('renames a link, refusing duplicates and the owner label', async () => {
    const { app, deps } = linkedApp();
    const agent = request.agent(app);
    await signIn(agent, 'alice@x.org');
    await addMailboxes(agent, [
      { label: 'b', email: 'bob@x.org', password: 'right' },
      { label: 'c', email: 'carol@gmail.com', password: 'right' },
    ]);
    const bob = findUserByEmail(deps.db, 'bob@x.org')!;
    const rename = async (label: string) => {
      const page = await agent.get('/settings');
      return agent.post('/settings/mailboxes/rename').type('form').send({ _csrf: csrfFrom(page.text), member_id: String(bob.id), label });
    };
    expect((await rename('Sales Team')).text).toContain('Renamed to &#34;sales-team&#34;');
    expect((await rename('c')).status).toBe(400);
    expect((await rename('alice')).status).toBe(400);
    const owner = findUserByEmail(deps.db, 'alice@x.org')!;
    expect(listLinks(deps.db, owner.id).map((l) => l.label)).toEqual(['sales-team', 'c']);
  });

  it('updates a linked mailbox password after a real sign-in check', async () => {
    const { app, deps } = linkedApp();
    const agent = request.agent(app);
    await signIn(agent, 'alice@x.org');
    await addMailboxes(agent, [{ email: 'carol@gmail.com', password: 'right' }]);
    const carol = findUserByEmail(deps.db, 'carol@gmail.com')!;
    const send = async (password: string) => {
      const page = await agent.get('/settings');
      return agent.post('/settings/mailboxes/password').type('form').send({ _csrf: csrfFrom(page.text), member_id: String(carol.id), password });
    };
    expect((await send('wrong')).text).toContain('Email or password incorrect');
    const ok = await send('right');
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('Password updated.');
  });

  it('"Check all mailboxes" reports inbox counts per mailbox and errors without failing the page', async () => {
    const pool = {
      withImap: async (user: { email: string }) => {
        if (user.email === 'carol@gmail.com') {
          const { MailError } = await import('../../src/mail/errors.js');
          throw new MailError('AUTH_FAILED', 'The mailbox password no longer works.');
        }
        return { total: 12, unread: 3 };
      },
      close: async () => undefined,
    } as unknown as MailPool;
    const config = testConfig(LINKED_ENV);
    const { app } = testApp(
      {
        pool,
        discover: async (email) => (email.endsWith('@gmail.com') ? gmail : xorg),
        guard: (email, settings, linked) => guardMailSettings(config, email, settings, publicLookup, linked),
      },
      LINKED_ENV,
    );
    const agent = request.agent(app);
    await signIn(agent, 'alice@x.org');
    await addMailboxes(agent, [{ email: 'carol@gmail.com', password: 'right' }]);
    const page = await agent.get('/settings');
    const res = await agent.post('/settings/mailboxes/check').type('form').send({ _csrf: csrfFrom(page.text) });
    expect(res.status).toBe(200);
    expect(res.text).toContain('3 unread of 12');
    expect(res.text).toContain('The password no longer works: set a new one in the ⋯ menu.');
  });

  it('rename_mailbox tool renames linked mailboxes but not the signed-in one', async () => {
    const db = testDb();
    const owner = createTestUser(db, { email: 'gs@x.org', permissionLevel: 'draft' });
    const sales = createTestUser(db, { email: 'sales@x.org', linkedOnly: true });
    addLink(db, owner.id, sales.id, 'sales-x.org');
    type Handler = (args: unknown) => Promise<{ isError?: boolean; content: { text: string }[] }>;
    const handlers = new Map<string, Handler>();
    const fake = { registerTool: (name: string, _c: unknown, cb: Handler) => handlers.set(name, cb) } as unknown as McpServer;
    registerTools(fake, { db, config: testConfig(), pool: {} as MailPool, smtpFactory: defaultSmtpFactory, userId: owner.id }, 'draft');
    const ok = await handlers.get('rename_mailbox')!({ mailbox: 'sales@x.org', label: 'sales' });
    expect(JSON.parse(ok.content[0].text)).toEqual({ mailbox: 'sales', address: 'sales@x.org' });
    const self = await handlers.get('rename_mailbox')!({ mailbox: 'gs', label: 'boss' });
    expect(self.isError).toBe(true);
  });
});

describe('Russian interface', () => {
  it('renders pages and messages in Russian with UI_LANG=ru', async () => {
    const env = { ...LINKED_ENV, UI_LANG: 'ru' };
    const config = testConfig(env);
    const { app } = testApp(
      {
        discover: async (email) => (email.endsWith('@gmail.com') ? gmail : xorg),
        guard: (email, settings, linked) => guardMailSettings(config, email, settings, publicLookup, linked),
      },
      env,
    );
    const agent = request.agent(app);
    const login = await agent.get('/login');
    expect(login.text).toContain('<html lang="ru">');
    expect(login.text).toContain('Подключите почту к ИИ');
    await signIn(agent, 'alice@x.org');
    const res = await addMailboxes(agent, [
      { email: 'carol@gmail.com', password: 'right' },
      { email: 'erin@x.org', password: 'wrong' },
    ]);
    expect(res.text).toContain('Ящики');
    expect(res.text).toContain('Подключён как «carol»');
    expect(res.text).toContain('Неверный адрес или пароль');
    expect((await agent.get('/nope')).text).toContain('Такой страницы нет.');
  });
});
