import { describe, expect, it, vi } from 'vitest';
import { mockPatApiClient as mockClient } from './test-support.js';
import { buildMailTools } from './mail.js';

describe('buildMailTools', () => {
  it('list_mail_accounts → client.listMailAccounts()', async () => {
    const c = mockClient();
    (c.listMailAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, email: 'a@b.com' }]);
    const t = buildMailTools(c).find((x) => x.name === 'list_mail_accounts')!;
    const out = await t.handler({});
    expect(c.listMailAccounts).toHaveBeenCalled();
    expect(JSON.parse(out)).toEqual([{ id: 1, email: 'a@b.com' }]);
  });

  it('list_mail → folder 기본값 INBOX, limit 기본값 20 으로 client.listMail 호출', async () => {
    const c = mockClient();
    (c.listMail as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, subject: '메일' }]);
    const t = buildMailTools(c).find((x) => x.name === 'list_mail')!;
    const out = await t.handler({ accountId: 2 });
    expect(c.listMail).toHaveBeenCalledWith(2, { folder: 'INBOX', limit: 20, query: undefined });
    expect(JSON.parse(out)).toEqual([{ id: 1, subject: '메일' }]);
  });

  it('list_mail → folder/limit/query 지정 시 그대로 전달', async () => {
    const c = mockClient();
    const t = buildMailTools(c).find((x) => x.name === 'list_mail')!;
    await t.handler({ accountId: 2, folder: 'SENT', limit: 5, query: '검토' });
    expect(c.listMail).toHaveBeenCalledWith(2, { folder: 'SENT', limit: 5, query: '검토' });
  });

  it('list_mail → unread 지정 시 client.listMail 에 전달', async () => {
    const c = mockClient();
    const t = buildMailTools(c).find((x) => x.name === 'list_mail')!;
    await t.handler({ accountId: 2, unread: true });
    expect(c.listMail).toHaveBeenCalledWith(2, {
      folder: 'INBOX',
      limit: 20,
      query: undefined,
      unread: true,
    });
  });

  it('get_mail → client.getMail(messageId)', async () => {
    const c = mockClient();
    (c.getMail as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 9, body: '본문' });
    const t = buildMailTools(c).find((x) => x.name === 'get_mail')!;
    const out = await t.handler({ messageId: 9 });
    expect(c.getMail).toHaveBeenCalledWith(9);
    expect(JSON.parse(out)).toEqual({ id: 9, body: '본문' });
  });

  it('get_mail 은 messageId 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    const t = buildMailTools(c).find((x) => x.name === 'get_mail')!;
    await expect(t.handler({})).rejects.toThrow();
    expect(c.getMail).not.toHaveBeenCalled();
  });
});
