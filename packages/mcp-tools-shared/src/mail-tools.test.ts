import { describe, expect, it, vi } from 'vitest';
import { buildMailTools } from './mail-tools.js';
import type { AssigneeResolverClient } from './resolve.js';
import type { MailToolClient } from './tool-client.js';
import { resultText } from './mcp-content.js';

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
    syncMail: vi.fn().mockResolvedValue({ fetched: 3, saved: 2, seenChanged: 1 }),
    getMailSyncStatus: vi.fn().mockResolvedValue({ phase: 'IDLE', total: 0, done: 0, running: false }),
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
    expect(JSON.parse(resultText(out))[0].id).toBe(3);
  });

  it('list_mail → folder 기본값 INBOX, limit 기본값 20 으로 client.listMail 호출', async () => {
    const c = mockClient();
    vi.mocked(c.listMail).mockResolvedValue([{ id: 1, subject: '메일' }]);
    const out = await tool(c, 'list_mail').handler({ accountId: 2 });
    expect(c.listMail).toHaveBeenCalledWith(2, { folder: 'INBOX', limit: 20 });
    expect(JSON.parse(resultText(out))).toEqual([{ id: 1, subject: '메일' }]);
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
    vi.mocked(c.getMail).mockResolvedValue({ id: 9, bodyText: '본문' });
    const out = await tool(c, 'get_mail').handler({ messageId: 9 });
    expect(c.getMail).toHaveBeenCalledWith(9);
    expect(JSON.parse(resultText(out))).toEqual({ id: 9, bodyText: '본문' });
  });

  // 서버 EmailMessageDetail 형태.
  const detail = {
    id: 9, threadId: 't-1', messageId: '<abc@mail>', fromAddress: 'a@x.com', fromName: '앨리스', toAddresses: 'me@x.com', ccAddresses: null, bccAddresses: null,
    subject: '견적', sentAt: '2026-10-01T00:00:00Z', receivedAt: '2026-10-01T00:00:05Z', seen: false,
    bodyText: '안녕하세요\n견적 보냅니다.', bodyHtml: '<html><head><style>p{color:red}</style></head><body><p style="margin:0">안녕하세요</p><p>견적 보냅니다.</p></body></html>',
    attachments: [{ id: 1, filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10, contentId: null }],
  };

  it('WP-353: get_mail 은 bodyHtml 을 빼고 bodyText 만 주며, 내부 헤더 id·값 없는 키·첨부 contentId 를 정리한다', async () => {
    const c = mockClient();
    vi.mocked(c.getMail).mockResolvedValue(detail);
    const out = JSON.parse(resultText(await tool(c, 'get_mail').handler({ messageId: 9 })));
    expect(out).not.toHaveProperty('bodyHtml');
    expect(out).not.toHaveProperty('threadId');
    expect(out).not.toHaveProperty('messageId');
    expect(out).not.toHaveProperty('ccAddresses');
    expect(out.bodyText).toBe('안녕하세요\n견적 보냅니다.');
    expect(out.attachments).toEqual([{ id: 1, filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 }]);
    expect(out).toMatchObject({ id: 9, subject: '견적', fromAddress: 'a@x.com', seen: false });
    expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(detail).length * 0.75);
  });

  it('WP-353: 평문이 비었거나 공백뿐이고 HTML 이 있으면 HTML 을 평문으로 바꿔 bodyText 를 채운다', async () => {
    const c = mockClient();
    for (const bodyText of [null, '', '   \n ']) {
      vi.mocked(c.getMail).mockResolvedValue({ ...detail, bodyText });
      const out = JSON.parse(resultText(await tool(c, 'get_mail').handler({ messageId: 9 })));
      expect(out.bodyText).toBe('안녕하세요\n견적 보냅니다.');
      expect(out).not.toHaveProperty('bodyHtml');
    }
  });

  it('WP-353: 평문도 HTML 도 없으면 빈 bodyText 를 준다', async () => {
    const c = mockClient();
    vi.mocked(c.getMail).mockResolvedValue({ ...detail, bodyText: null, bodyHtml: null });
    expect(JSON.parse(resultText(await tool(c, 'get_mail').handler({ messageId: 9 }))).bodyText).toBe('');
  });

  it('WP-353: list_mail 행은 accountId·threadId 와 값 없는 키를 빼고, categoryPending 은 true 일 때만 남긴다', async () => {
    const c = mockClient();
    const row = { id: 1, accountId: 2, threadId: 't', fromAddress: 'a@x.com', fromName: '앨리스', subject: '견적', snippet: '안녕', receivedAt: '2026-10-01T00:00:00Z', seen: false, hasAttachment: false, aiCategory: null, aiNeedsReply: null, categoryPending: false };
    vi.mocked(c.listMail).mockResolvedValue([row, { ...row, id: 2, aiCategory: '업무', aiNeedsReply: true }, { ...row, id: 3, categoryPending: true }]);
    const out = JSON.parse(resultText(await tool(c, 'list_mail').handler({ accountId: 2 })));
    expect(out[0]).toEqual({ id: 1, fromAddress: 'a@x.com', fromName: '앨리스', subject: '견적', snippet: '안녕', receivedAt: '2026-10-01T00:00:00Z', seen: false, hasAttachment: false });
    expect(out[1]).toMatchObject({ aiCategory: '업무', aiNeedsReply: true });
    expect(out[1]).not.toHaveProperty('categoryPending');
    expect(out[2].categoryPending).toBe(true);
    expect(JSON.stringify(out[0]).length).toBeLessThan(JSON.stringify(row).length * 0.8);
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
    expect(JSON.parse(resultText(await tool(c, 'get_mail_summary').handler({ messageId: 3 })))).toEqual({ summary: '요약' });
    expect(JSON.parse(resultText(await tool(c, 'draft_mail_reply').handler({ messageId: 3 })))).toEqual({ draftBody: '초안' });
    expect(JSON.parse(resultText(await tool(c, 'draft_issue_from_mail').handler({ messageId: 3 })))).toEqual({ title: 't' });
    for (const fn of [c.getMailSummary, c.draftMailReply, c.draftIssueFromMail]) expect(fn).toHaveBeenCalledWith(3);
  });

  it('create_issue_from_mail → 담당자 username 을 해석해 이슈를 만든다', async () => {
    const c = mockClient();
    const out = JSON.parse(
      resultText(await tool(c, 'create_issue_from_mail').handler({ messageId: 3, projectKey: 'WP', title: '견적 회신', assignees: ['alice'] })),
    );
    expect(c.promoteMailToIssue).toHaveBeenCalledWith(3, { projectKey: 'WP', title: '견적 회신', assigneeIds: [10] });
    expect(out).toEqual({ issueKey: 'WP-9', created: true });
  });

  // 중복 판정은 서버(#859)가 한다 — 409 면 새로 만들지 않고 기존 연결 이슈 키를 알린다.
  it('create_issue_from_mail → 서버가 409 면 기존 연결 이슈 키를 알린다', async () => {
    const c = mockClient();
    vi.mocked(c.promoteMailToIssue).mockRejectedValue({ response: { status: 409 } });
    vi.mocked(c.getMailLinkedIssue).mockResolvedValue({ issueKey: 'WP-2' });
    const out = JSON.parse(resultText(await tool(c, 'create_issue_from_mail').handler({ messageId: 3, projectKey: 'WP', title: 't' })));
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

  it('sync_mail → 서버 MailSyncResult 의 건수(fetched·saved·seenChanged)를 JSON 으로 돌려준다 (WP-353)', async () => {
    const c = mockClient();
    expect(JSON.parse(resultText(await tool(c, 'sync_mail').handler({ accountId: 5 })))).toEqual({ fetched: 3, saved: 2, seenChanged: 1 });
    expect(c.syncMail).toHaveBeenCalledWith(5);
    await expect(tool(c, 'sync_mail').handler({ accountId: 0 })).rejects.toThrow();
  });

  it('sync_mail 은 서버 결과 필드가 빠져도 0 으로 채운다(알 수 없는 필드는 싣지 않는다)', async () => {
    const c = mockClient();
    vi.mocked(c.syncMail).mockResolvedValue({ saved: 4, extra: 'x' });
    expect(JSON.parse(resultText(await tool(c, 'sync_mail').handler({ accountId: 5 })))).toEqual({ fetched: 0, saved: 4, seenChanged: 0 });
    vi.mocked(c.syncMail).mockResolvedValue(undefined);
    expect(JSON.parse(resultText(await tool(c, 'sync_mail').handler({ accountId: 5 })))).toEqual({ fetched: 0, saved: 0, seenChanged: 0 });
  });

  it('sync_mail 은 이미 동기화 중이면 새로 시작하지 않고 alreadySyncing 과 진행 상태를 알린다 (WP-353)', async () => {
    const c = mockClient();
    vi.mocked(c.getMailSyncStatus).mockResolvedValue({ phase: 'BODIES', total: 40, done: 12, running: true });
    expect(JSON.parse(resultText(await tool(c, 'sync_mail').handler({ accountId: 5 })))).toEqual({ alreadySyncing: true, phase: 'BODIES', done: 12, total: 40 });
    expect(c.getMailSyncStatus).toHaveBeenCalledWith(5);
    expect(c.syncMail).not.toHaveBeenCalled();
  });

  it('sync_mail 설명은 결과 필드와 이미 동기화 중인 경우를 안내한다', () => {
    expect(tool(mockClient(), 'sync_mail').description).toMatch(/saved/);
    expect(tool(mockClient(), 'sync_mail').description).toMatch(/alreadySyncing/);
    expect(tool(mockClient(), 'sync_mail').description).toMatch(/best effort/); // 확인-호출 사이 경쟁 구간을 밝힌다
  });

  it('sync_mail 은 원본 메일 서버에 닿으므로 openWorld 이고, 읽음 상태 덮어쓰기·삭제 반영이 있어 destructive, 멱등은 아니다', () => {
    expect(tool(mockClient(), 'sync_mail')).toMatchObject({
      kind: 'write',
      hints: { destructive: true, idempotent: false, openWorld: true },
    });
  });

  it('set_mail_needs_reply_done 도구는 더 이상 없다(WP-146)', () => {
    expect(buildMailTools(mockClient()).map((t) => t.name)).not.toContain('set_mail_needs_reply_done');
  });
});
