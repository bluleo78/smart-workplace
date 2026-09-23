import { describe, expect, it, vi } from 'vitest';
import { buildMailTools } from './mail-tools.js';
import type { MailToolClient } from './tool-client.js';

/** 메일 클라이언트 mock. */
function mockClient(): MailToolClient {
  return {
    listMailAccounts: vi.fn().mockResolvedValue([]),
    listMail: vi.fn().mockResolvedValue([]),
    getMail: vi.fn().mockResolvedValue({}),
  };
}

const tool = (c: MailToolClient, name: string) => buildMailTools(c).find((x) => x.name === name)!;

describe('buildMailTools', () => {
  it('list_mail_accounts → client.listMailAccounts() 결과를 그대로 반환', async () => {
    const c = mockClient();
    vi.mocked(c.listMailAccounts).mockResolvedValue([
      { id: 3, emailAddress: 'me@test.com', displayName: '내 계정', aiEnabled: true },
    ]);
    const out = await tool(c, 'list_mail_accounts').handler({});
    expect(c.listMailAccounts).toHaveBeenCalled();
    expect(JSON.parse(out)[0].id).toBe(3);
  });

  it('list_mail → folder 기본값 INBOX, limit 기본값 20 으로 client.listMail 호출', async () => {
    const c = mockClient();
    vi.mocked(c.listMail).mockResolvedValue([{ id: 1, subject: '메일' }]);
    const out = await tool(c, 'list_mail').handler({ accountId: 2 });
    expect(c.listMail).toHaveBeenCalledWith(2, { folder: 'INBOX', limit: 20 });
    expect(JSON.parse(out)).toEqual([{ id: 1, subject: '메일' }]);
  });

  it('list_mail → folder/limit/query 지정 시 그대로 전달', async () => {
    const c = mockClient();
    await tool(c, 'list_mail').handler({ accountId: 2, folder: 'SENT', limit: 5, query: '검토' });
    expect(c.listMail).toHaveBeenCalledWith(2, { folder: 'SENT', limit: 5, query: '검토' });
  });

  it('list_mail → unreadOnly 를 클라이언트의 unread 로 관통한다 (#466)', async () => {
    const c = mockClient();
    await tool(c, 'list_mail').handler({ accountId: 1, folder: 'INBOX', unreadOnly: true, limit: 20 });
    expect(c.listMail).toHaveBeenCalledWith(1, { folder: 'INBOX', limit: 20, unread: true });
  });

  it('list_mail 은 옛 파라미터 unread 를 인식하지 않는다(unreadOnly 만)', async () => {
    // 모르는 키는 zod 가 버린다 — 옛 이름으로 보내면 안 읽은 필터가 걸리지 않는다는 점을 고정한다.
    const c = mockClient();
    await tool(c, 'list_mail').handler({ accountId: 1, unread: true });
    expect(vi.mocked(c.listMail).mock.calls[0][1].unread).toBeUndefined();
  });

  it('get_mail → client.getMail(messageId)', async () => {
    const c = mockClient();
    vi.mocked(c.getMail).mockResolvedValue({ id: 9, body: '본문' });
    const out = await tool(c, 'get_mail').handler({ messageId: 9 });
    expect(c.getMail).toHaveBeenCalledWith(9);
    expect(JSON.parse(out)).toEqual({ id: 9, body: '본문' });
  });

  it('get_mail 은 messageId 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'get_mail').handler({})).rejects.toThrow();
    expect(c.getMail).not.toHaveBeenCalled();
  });
});
