import { describe, expect, it, vi } from 'vitest';
import { buildMailTools } from './mail-tools.js';
import type { AssigneeResolverClient } from './resolve.js';
import type { MailToolClient } from './tool-client.js';

type Client = MailToolClient & AssigneeResolverClient;

/** 메일 클라이언트 mock(메일→이슈 담당자 해석용 프로젝트 멤버 조회 포함). */
function mockClient(): Client {
  return {
    listMailAccounts: vi.fn().mockResolvedValue([]),
    listMail: vi.fn().mockResolvedValue([]),
    getMail: vi.fn().mockResolvedValue({}),
    getMailSummary: vi.fn().mockResolvedValue({ summary: '요약' }),
    draftMailReply: vi.fn().mockResolvedValue({ draftBody: '초안' }),
    draftIssueFromMail: vi.fn().mockResolvedValue({ title: 't' }),
    getMailLinkedIssue: vi.fn().mockResolvedValue(null),
    promoteMailToIssue: vi.fn().mockResolvedValue({ issueKey: 'WP-9' }),
    markMailRead: vi.fn().mockResolvedValue(undefined),
    getProjectMembers: vi.fn().mockResolvedValue([{ userId: 10, username: 'alice' }]),
    getMe: vi.fn().mockResolvedValue({ id: 10, username: 'alice' }),
  };
}

const tool = (c: Client, name: string) => buildMailTools(c).find((x) => x.name === name)!;

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

describe('메일 AI·처리 (#855)', () => {
  it('get_mail_summary / draft_mail_reply / draft_issue_from_mail 은 messageId 로 서버 결과를 그대로 준다', async () => {
    const c = mockClient();
    expect(JSON.parse(await tool(c, 'get_mail_summary').handler({ messageId: 3 }))).toEqual({ summary: '요약' });
    expect(JSON.parse(await tool(c, 'draft_mail_reply').handler({ messageId: 3 }))).toEqual({ draftBody: '초안' });
    expect(JSON.parse(await tool(c, 'draft_issue_from_mail').handler({ messageId: 3 }))).toEqual({ title: 't' });
    for (const fn of [c.getMailSummary, c.draftMailReply, c.draftIssueFromMail]) expect(fn).toHaveBeenCalledWith(3);
  });

  it('create_issue_from_mail → 담당자 username 을 해석해 이슈를 만든다', async () => {
    const c = mockClient();
    const out = JSON.parse(
      await tool(c, 'create_issue_from_mail').handler({ messageId: 3, projectKey: 'WP', title: '견적 회신', assignees: ['alice'] }),
    );
    expect(c.promoteMailToIssue).toHaveBeenCalledWith(3, { projectKey: 'WP', title: '견적 회신', assigneeIds: [10] });
    expect(out).toEqual({ issueKey: 'WP-9', created: true });
  });

  // 중복 판정은 서버(#859)가 한다 — 409 면 새로 만들지 않고 기존 연결 이슈 키를 알린다.
  it('create_issue_from_mail → 서버가 409 면 기존 연결 이슈 키를 알린다', async () => {
    const c = mockClient();
    vi.mocked(c.promoteMailToIssue).mockRejectedValue({ response: { status: 409 } });
    vi.mocked(c.getMailLinkedIssue).mockResolvedValue({ issueKey: 'WP-2' });
    const out = JSON.parse(await tool(c, 'create_issue_from_mail').handler({ messageId: 3, projectKey: 'WP', title: 't' }));
    expect(out).toEqual({ issueKey: 'WP-2', created: false });
  });

  it('create_issue_from_mail → 409 가 아닌 오류는 그대로 던진다', async () => {
    const c = mockClient();
    vi.mocked(c.promoteMailToIssue).mockRejectedValue({ response: { status: 403 } });
    await expect(tool(c, 'create_issue_from_mail').handler({ messageId: 3, projectKey: 'WP', title: 't' })).rejects.toEqual({
      response: { status: 403 },
    });
    expect(c.getMailLinkedIssue).not.toHaveBeenCalled();
  });

  it('create_issue_from_mail → 모르는 담당자면 만들지 않고 throw', async () => {
    const c = mockClient();
    await expect(
      tool(c, 'create_issue_from_mail').handler({ messageId: 3, projectKey: 'WP', title: 't', assignees: ['ghost'] }),
    ).rejects.toThrow('ghost');
    expect(c.promoteMailToIssue).not.toHaveBeenCalled();
  });

  it('mark_mail_read → client.markMailRead(messageId) 호출 후 ok', async () => {
    const c = mockClient();
    const out = await tool(c, 'mark_mail_read').handler({ messageId: 3 });
    expect(out).toBe('ok');
    expect(c.markMailRead).toHaveBeenCalledWith(3);
  });

  it('set_mail_needs_reply_done 도구는 더 이상 없다(WP-146)', () => {
    expect(buildMailTools(mockClient()).map((t) => t.name)).not.toContain('set_mail_needs_reply_done');
  });
});
