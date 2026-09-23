import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { buildTools, type HostBridge } from './tools.js';

// #842: 서버가 응답한 검증 실패(4xx)를 흉내 낸다 — 인터셉터가 message 를 서버 사유로 채운 AxiosError 형태.
function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { response: { status } });
}

function client(): WorkplaceApiClient {
  const c: WorkplaceApiClient = {
    // #719: 이 테스트 스위트는 도구 핸들러 자체를 검증하므로 테넌트 스코프는 자기 자신을 반환.
    withOnBehalfOfTenant: () => c,
    // #842: 확인카드 사전검증 — propose_* 는 카드 등록 전에 반드시 이 호출을 통과해야 한다.
    validateAction: vi.fn().mockResolvedValue(undefined),
    addIssueComment: vi.fn().mockResolvedValue(undefined),
    updateIssueStatus: vi.fn().mockResolvedValue(undefined),
    getIssueDetail: vi.fn().mockResolvedValue({
      issueKey: 'WP-1',
      title: 't',
      status: 'TODO',
      priority: 'MID',
      assignees: [],
    }),
    listIssues: vi.fn().mockResolvedValue([]),
    unassignSelf: vi.fn().mockResolvedValue(undefined),
    getProviderCredential: vi.fn(),
    getChatMessages: vi.fn().mockResolvedValue([]),
    addChatMessage: vi.fn().mockResolvedValue(undefined),
    postChatProgress: vi.fn().mockResolvedValue(undefined),
    getChannelMessages: vi.fn().mockResolvedValue([]),
    addChannelMessage: vi.fn().mockResolvedValue(undefined),
    postMessagingProgress: vi.fn().mockResolvedValue(undefined),
    listIssueAttachments: vi.fn().mockResolvedValue([]),
    downloadIssueAttachment: vi.fn(),
    listWikiSpaces: vi.fn().mockResolvedValue([
      { id: 1, type: 'PERSONAL', name: '내 노트', role: 'OWNER' },
    ]),
    searchWikiPages: vi.fn().mockResolvedValue([
      { id: 7, spaceId: 2, spaceName: '팀', title: '릴리스', snippet: '배포', updatedAt: '2026-06-14T00:00:00Z' },
    ]),
    getWikiPage: vi.fn().mockResolvedValue({
      id: 7, spaceId: 2, parentId: null, title: '릴리스', body: '본문', version: 3, updatedAt: '2026-06-14T00:00:00Z',
    }),
    listEvents: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue({}),
    createWikiPage: vi.fn().mockResolvedValue({}),
    updateWikiPage: vi.fn().mockResolvedValue({}),
    listMail: vi.fn().mockResolvedValue([]),
    getMail: vi.fn().mockResolvedValue({}),
    listMailAccounts: vi.fn().mockResolvedValue([]),
    syncMail: vi.fn().mockResolvedValue({} as never),
    listContacts: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    searchMembers: vi.fn().mockResolvedValue([]),
    getMemberContact: vi.fn().mockResolvedValue({}),
    getExternalContact: vi.fn().mockResolvedValue({}),
    createExternalContact: vi.fn().mockResolvedValue({}),
    updateExternalContact: vi.fn().mockResolvedValue({}),
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockResolvedValue({}),
    listProjectMembers: vi.fn().mockResolvedValue([]),
    getProjectTypes: vi.fn().mockResolvedValue([]),
    getProjectLabels: vi.fn().mockResolvedValue([]),
    createIssue: vi.fn().mockResolvedValue({}),
    editIssueComment: vi.fn().mockResolvedValue(undefined),
    updateIssueContent: vi.fn().mockResolvedValue({}),
    setIssueType: vi.fn().mockResolvedValue(undefined),
    setIssueParent: vi.fn().mockResolvedValue(undefined),
    replaceIssueAssignees: vi.fn().mockResolvedValue({}),
    replaceIssueLabels: vi.fn().mockResolvedValue({}),
    addIssueDependency: vi.fn().mockResolvedValue({}),
    removeIssueDependency: vi.fn().mockResolvedValue(undefined),
    listMySpaces: vi.fn().mockResolvedValue([]),
    listSpaceItems: vi.fn().mockResolvedValue([]),
    searchDrive: vi.fn().mockResolvedValue([]),
    createFolder: vi.fn().mockResolvedValue({} as never),
    renameFolder: vi.fn().mockResolvedValue({} as never),
    moveFolder: vi.fn().mockResolvedValue(undefined),
    moveFile: vi.fn().mockResolvedValue(undefined),
    listChannels: vi.fn().mockResolvedValue([]),
    discoverChannels: vi.fn().mockResolvedValue([]),
    proposeCreateIssue: vi.fn().mockResolvedValue(undefined),
    proposeCreateEvent: vi.fn().mockResolvedValue(undefined),
    // L3 위임: 후보 프로젝트 목록 조회(Task 4 신규).
    listDelegationCandidates: vi.fn().mockResolvedValue([]),
  };
  return c;
}

const AGENT_ID = 201;

describe('buildTools (agentId bound)', () => {
  it('get_issue_detail → client.getIssueDetail(agentId, key)', async () => {
    const c = client();
    const tools = buildTools(c, AGENT_ID);
    const t = tools.find((x) => x.name === 'get_issue_detail')!;
    const out = await t.handler({ issueKey: 'WP-1' });
    expect(c.getIssueDetail).toHaveBeenCalledWith(AGENT_ID, 'WP-1');
    expect(JSON.parse(out)).toMatchObject({ issueKey: 'WP-1' });
  });

  // Task 6 (#373 회귀 가드 재배치): 공유 도구가 흡수한 normalizeIssueDetail(summary 언랩 +
  // flat comment author → nested + 의존성 top-level lift)를 ai-agent 통합 지점에서 검증한다.
  it('get_issue_detail → raw {summary,...} 를 normalizeIssueDetail 로 정규화한 JSON 을 반환한다', async () => {
    const c = client();
    vi.mocked(c.getIssueDetail).mockResolvedValue({
      key: 'WP-9',
      summary: {
        title: '분석', status: 'TODO', priority: 'MID',
        assignees: [{ id: 201, username: 'ai-bot', name: 'AI', kind: 'AGENT' }],
        blockedBy: [{ number: 3, title: '선행', status: 'DONE' }],
        blocks: [], blocked: true,
      },
      body: '본문',
      comments: [
        { id: 1, authorId: 3, authorName: '홍길동', authorKind: 'HUMAN', body: '코멘트', createdAt: '2026-06-07T00:00:00Z' },
      ],
    } as never);
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'get_issue_detail')!;
    const out = JSON.parse(await t.handler({ issueKey: 'WP-9' }));
    expect(c.getIssueDetail).toHaveBeenCalledWith(AGENT_ID, 'WP-9');
    // summary 언랩 + flat author → nested author 변환 + 의존성 top-level lift 확인.
    expect(out).toMatchObject({
      issueKey: 'WP-9',
      title: '분석',
      status: 'TODO',
      priority: 'MID',
      blocked: true,
      blockedBy: [{ number: 3, title: '선행', status: 'DONE' }],
      blocks: [],
    });
    expect(out.comments[0].author).toEqual({ id: 3, username: '홍길동', name: '홍길동', kind: 'HUMAN' });
    expect(out.comments[0].body).toBe('코멘트');
  });

  it('add_comment → client.addIssueComment(agentId, key, body)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'add_comment')!;
    await t.handler({ issueKey: 'WP-1', body: '안녕' });
    expect(c.addIssueComment).toHaveBeenCalledWith(AGENT_ID, 'WP-1', '안녕');
  });

  it('edit_comment → client.editIssueComment(agentId, issueKey, commentId, body)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'edit_comment')!;
    const out = await t.handler({ issueKey: 'WP-1', commentId: 42, body: '수정됨' });
    expect(c.editIssueComment).toHaveBeenCalledWith(AGENT_ID, 'WP-1', 42, '수정됨');
    expect(out).toBe('ok');
  });

  it('update_status → client.updateIssueStatus(agentId, key, status)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'update_status')!;
    await t.handler({ issueKey: 'WP-1', status: 'DONE' });
    expect(c.updateIssueStatus).toHaveBeenCalledWith(AGENT_ID, 'WP-1', 'DONE');
  });

  it('unassign_self → client.unassignSelf(agentId, key)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'unassign_self')!;
    await t.handler({ issueKey: 'WP-1' });
    expect(c.unassignSelf).toHaveBeenCalledWith(AGENT_ID, 'WP-1');
  });

  it('update_status — 잘못된 status 는 zod reject', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'update_status')!;
    await expect(t.handler({ issueKey: 'WP-1', status: 'WRONG' })).rejects.toThrow();
    expect(c.updateIssueStatus).not.toHaveBeenCalled();
  });

  describe('create_issue', () => {
    it('리졸브 후 client.createIssue 를 호출한다', async () => {
      const c = client();
      (c.getProjectTypes as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 2, name: 'BUG' }]);
      (c.listProjectMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { userId: 10, username: 'alice', name: 'Alice', role: 'MEMBER' },
      ]);
      (c.createIssue as ReturnType<typeof vi.fn>).mockResolvedValue({ issueKey: 'WP-9' });
      const t = buildTools(c, AGENT_ID).find((x) => x.name === 'create_issue')!;
      const out = await t.handler({
        projectKey: 'WP',
        title: '새 이슈',
        type: 'BUG',
        assignees: ['alice'],
      });
      expect(c.createIssue).toHaveBeenCalledWith(AGENT_ID, 'WP', {
        title: '새 이슈',
        typeId: 2,
        assigneeIds: [10],
      });
      expect(JSON.parse(out)).toEqual({ issueKey: 'WP-9' });
    });

    it('없는 유형이면 리졸브 에러를 그대로 throw', async () => {
      const c = client();
      (c.getProjectTypes as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, name: 'TASK' }]);
      const t = buildTools(c, AGENT_ID).find((x) => x.name === 'create_issue')!;
      await expect(
        t.handler({ projectKey: 'WP', title: '새 이슈', type: 'BUG' }),
      ).rejects.toThrow("유형 'BUG' 을(를) 찾을 수 없습니다. 사용 가능: TASK");
      expect(c.createIssue).not.toHaveBeenCalled();
    });

    it('type/assignees 없이도 생성 가능(선택 필드)', async () => {
      const c = client();
      (c.createIssue as ReturnType<typeof vi.fn>).mockResolvedValue({ issueKey: 'WP-10' });
      const t = buildTools(c, AGENT_ID).find((x) => x.name === 'create_issue')!;
      await t.handler({ projectKey: 'WP', title: '단순 이슈' });
      expect(c.createIssue).toHaveBeenCalledWith(AGENT_ID, 'WP', { title: '단순 이슈' });
    });
  });

  describe('update_issue', () => {
    it('값이 있는 필드만 팬아웃 호출하고 {ok:true,results} 를 반환한다', async () => {
      const c = client();
      const t = buildTools(c, AGENT_ID).find((x) => x.name === 'update_issue')!;
      const out = await t.handler({ issueKey: 'WP-1', title: '새 제목', priority: 'HIGH' });
      expect(c.updateIssueContent).toHaveBeenCalledWith(AGENT_ID, 'WP-1', {
        title: '새 제목',
        priority: 'HIGH',
      });
      expect(c.setIssueType).not.toHaveBeenCalled();
      expect(JSON.parse(out)).toEqual({ ok: true, results: { content: 'ok' } });
    });

    it('type/assignees/labels/parent 를 리졸브 후 개별 엔드포인트로 팬아웃한다', async () => {
      const c = client();
      (c.getProjectTypes as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 2, name: 'BUG' }]);
      (c.listProjectMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { userId: 10, username: 'alice', name: 'Alice', role: 'MEMBER' },
      ]);
      (c.getProjectLabels as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 100, name: 'urgent' },
      ]);
      const t = buildTools(c, AGENT_ID).find((x) => x.name === 'update_issue')!;
      const out = await t.handler({
        issueKey: 'WP-1',
        type: 'BUG',
        assignees: ['alice'],
        labels: ['urgent'],
        parent: 3,
      });
      expect(c.setIssueType).toHaveBeenCalledWith(AGENT_ID, 'WP-1', 2);
      expect(c.setIssueParent).toHaveBeenCalledWith(AGENT_ID, 'WP-1', 3);
      expect(c.replaceIssueAssignees).toHaveBeenCalledWith(AGENT_ID, 'WP-1', [10]);
      expect(c.replaceIssueLabels).toHaveBeenCalledWith(AGENT_ID, 'WP-1', [100]);
      expect(JSON.parse(out)).toEqual({
        ok: true,
        results: { type: 'ok', parent: 'ok', assignees: 'ok', labels: 'ok' },
      });
    });

    it('parent:null 이면 부모를 해제한다', async () => {
      const c = client();
      const t = buildTools(c, AGENT_ID).find((x) => x.name === 'update_issue')!;
      await t.handler({ issueKey: 'WP-1', parent: null });
      expect(c.setIssueParent).toHaveBeenCalledWith(AGENT_ID, 'WP-1', null);
    });

    it('없는 유형이면 아무 것도 쓰지 않고 throw', async () => {
      const c = client();
      (c.getProjectTypes as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, name: 'TASK' }]);
      const t = buildTools(c, AGENT_ID).find((x) => x.name === 'update_issue')!;
      await expect(t.handler({ issueKey: 'WP-1', type: 'BUG' })).rejects.toThrow(
        "유형 'BUG' 을(를) 찾을 수 없습니다. 사용 가능: TASK",
      );
      expect(c.setIssueType).not.toHaveBeenCalled();
    });

    it('한 필드 실패해도 나머지는 저장하고 부분실패를 보고한다', async () => {
      const c = client();
      (c.updateIssueContent as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error('boom'), { response: { data: '충돌' } }),
      );
      const t = buildTools(c, AGENT_ID).find((x) => x.name === 'update_issue')!;
      const out = await t.handler({ issueKey: 'WP-1', title: 'x', parent: 3 });
      expect(c.setIssueParent).toHaveBeenCalled();
      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(false);
      expect(parsed.results.content).toBe('failed: 충돌');
      expect(parsed.results.parent).toBe('ok');
    });
  });

  // --- 6c: 프로필 ---

  it('chat 프로필: 이슈 조회·chat 읽기/쓰기 + 위키 읽기 도구', () => {
    const names = buildTools(client(), AGENT_ID, 'chat').map((t) => t.name).sort();
    expect(names).toEqual([
      'add_chat_message',
      'get_chat_thread',
      'get_issue_detail',
      'get_wiki_page',
      'list_wiki_spaces',
      'search_wiki',
    ]);
  });

  it('issue 프로필(기본): 기존 4개 + 위키 읽기 도구', () => {
    const names = buildTools(client(), AGENT_ID, 'issue').map((t) => t.name).sort();
    expect(names).toEqual([
      'add_comment',
      'add_issue_dependency',
      'create_issue',
      'edit_comment',
      'get_issue_detail',
      'get_wiki_page',
      'list_wiki_spaces',
      'remove_issue_dependency',
      'search_wiki',
      'unassign_self',
      'update_issue',
      'update_status',
    ]);
  });

  describe('add_issue_dependency / remove_issue_dependency', () => {
    it('add_issue_dependency → client.addIssueDependency(agentId, issueKey, otherNumber, direction)', async () => {
      const c = client();
      const t = buildTools(c, AGENT_ID, 'issue').find((x) => x.name === 'add_issue_dependency')!;
      const out = await t.handler({ issueKey: 'WP-12', otherIssueKey: 'WP-7', direction: 'blocks' });
      expect(c.addIssueDependency).toHaveBeenCalledWith(AGENT_ID, 'WP-12', 7, 'blocks');
      expect(out).toBe(JSON.stringify({}));
    });

    it('프로젝트가 다르면 API 호출 없이 에러를 던진다', async () => {
      const c = client();
      const t = buildTools(c, AGENT_ID, 'issue').find((x) => x.name === 'add_issue_dependency')!;
      await expect(
        t.handler({ issueKey: 'WP-12', otherIssueKey: 'OTHER-7', direction: 'blocks' }),
      ).rejects.toThrow('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.');
      expect(c.addIssueDependency).not.toHaveBeenCalled();
    });

    it('remove_issue_dependency → client.removeIssueDependency(agentId, issueKey, otherNumber, direction)', async () => {
      const c = client();
      const t = buildTools(c, AGENT_ID, 'issue').find((x) => x.name === 'remove_issue_dependency')!;
      const out = await t.handler({ issueKey: 'WP-12', otherIssueKey: 'WP-7', direction: 'blockedBy' });
      expect(c.removeIssueDependency).toHaveBeenCalledWith(AGENT_ID, 'WP-12', 7, 'blockedBy');
      expect(out).toBe('ok');
    });

    it('assistant 프로필에도 노출된다', () => {
      const names = buildTools(client(), AGENT_ID, 'assistant').map((t) => t.name);
      expect(names).toContain('add_issue_dependency');
      expect(names).toContain('remove_issue_dependency');
    });
  });

  it('add_chat_message → client.addChatMessage(agentId, threadId, body)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID, 'chat').find((x) => x.name === 'add_chat_message')!;
    await t.handler({ threadId: 5, body: '답변' });
    expect(c.addChatMessage).toHaveBeenCalledWith(AGENT_ID, 5, '답변');
  });

  // #433: add_chat_message 중복 호출 차단 가드 검증.
  it('add_chat_message 2번째 호출 → API 미호출 + 차단 메시지 반환', async () => {
    const c = client();
    // 같은 buildTools 인스턴스(같은 MCP run) 내에서 동일 tool 객체를 2번 호출한다.
    const tools = buildTools(c, AGENT_ID, 'chat');
    const t = tools.find((x) => x.name === 'add_chat_message')!;

    const first = await t.handler({ threadId: 5, body: '첫 답변' });
    expect(first).toBe('ok');
    expect(c.addChatMessage).toHaveBeenCalledTimes(1);

    const second = await t.handler({ threadId: 5, body: '두 번째 답변' });
    expect(second).toContain('이미');          // 차단 메시지 포함 확인
    expect(c.addChatMessage).toHaveBeenCalledTimes(1); // API 재호출 없음
  });

  it('get_chat_thread → client.getChatMessages(agentId, threadId, 50)', async () => {
    const c = client();
    vi.mocked(c.getChatMessages).mockResolvedValue([
      { id: 1, authorName: 'A', authorKind: 'HUMAN', body: 'hi', createdAt: 't', deleted: false },
    ]);
    const t = buildTools(c, AGENT_ID, 'chat').find((x) => x.name === 'get_chat_thread')!;
    const out = await t.handler({ threadId: 5 });
    expect(c.getChatMessages).toHaveBeenCalledWith(AGENT_ID, 5, 50);
    expect(out).toContain('hi');
  });

  // --- S2: 위키 읽기 그라운딩 (issue·chat 프로필 공용) ---

  it('issue 프로필: search_wiki → client.searchWikiPages(agentId, query)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID, 'issue').find((x) => x.name === 'search_wiki')!;
    const out = await t.handler({ query: '배포' });
    expect(c.searchWikiPages).toHaveBeenCalledWith(AGENT_ID, '배포');
    expect(JSON.parse(out)[0]).toMatchObject({ id: 7, title: '릴리스' });
  });

  it('chat 프로필: get_wiki_page → client.getWikiPage(agentId, pageId)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID, 'chat').find((x) => x.name === 'get_wiki_page')!;
    const out = await t.handler({ pageId: 7 });
    expect(c.getWikiPage).toHaveBeenCalledWith(AGENT_ID, 7);
    expect(JSON.parse(out)).toMatchObject({ id: 7, body: '본문' });
  });

  it('issue·chat 프로필 모두 위키 읽기 도구를 포함한다', () => {
    const names = (p: 'issue' | 'chat') => buildTools(client(), AGENT_ID, p).map((t) => t.name);
    for (const p of ['issue', 'chat'] as const) {
      expect(names(p)).toEqual(expect.arrayContaining(['search_wiki', 'get_wiki_page']));
    }
  });

  // L3 위임 Task 4: propose_create_issue 가 projectKey 를 client 로 전달한다.
  it('propose_create_issue: projectKey 를 client 로 전달한다', async () => {
    const calls: unknown[] = [];
    const c = {
      proposeCreateIssue: async (...a: unknown[]) => { calls.push(a); },
      addChannelMessage: async () => {},
      listDelegationCandidates: async () => [],
    } as never;
    const tools = buildTools(c, 2, 'messaging', undefined, { actorId: 7, channelId: 9 });
    const tool = tools.find((t) => t.name === 'propose_create_issue')!;
    await tool.handler({ title: 'T', priority: 'HIGH', projectKey: 'DESIGN' });
    // 3번째 인자(req)에 projectKey 가 포함되어야 한다.
    expect(calls[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'T', priority: 'HIGH', proposedByUserId: 7, projectKey: 'DESIGN' }),
    ]));
  });
});

// #333 M3: assistant 프로파일 union — 멤버십 단언으로 완화(이후 M3 앱이 자기 도구만 toContain 으로 단언).
describe('buildTools(assistant) union (M3: 멤버십 단언)', () => {
  const names = buildTools({} as never, 1, 'assistant').map((t) => t.name);

  it('M1/M2 핵심 도구를 계속 포함한다(회귀 가드)', () => {
    for (const n of [
      'get_issue_detail', 'add_comment', 'update_status', 'unassign_self',
      'search_wiki', 'get_wiki_page',
      'list_events', 'get_event', 'propose_create_event',
      'show_my_tasks', 'show_issue_list', 'show_issue_detail', 'show_activity',
    ]) {
      expect(names).toContain(n);
    }
  });

  // #431: 메일 목록 표시 위젯 도구 — mail-agent 위임(표 텍스트 생성) 대신 직접 표시.
  it('#431 show_mail_list 를 노출한다', () => {
    expect(names).toContain('show_mail_list');
  });

  // #469: 안 읽은 메일 위젯 — show_mail_list 가 params.unreadOnly 를 허용해야 한다.
  it('#469 show_mail_list 가 params.unreadOnly 를 허용한다', () => {
    const tool = buildTools({} as never, 1, 'assistant').find((t) => t.name === 'show_mail_list')!;
    const parsed = tool.inputSchema.parse({ params: { folder: 'INBOX', unreadOnly: true } }) as {
      params: { unreadOnly?: boolean };
    };
    expect(parsed.params.unreadOnly).toBe(true);
  });

  // #371: 이슈 목록 데이터 조회 도구 list_issues 를 새로 노출한다(기존 "데이터 issue-list 도구 없음" 경계 해제).
  // 단, 전문(full-text) search_issues 는 여전히 별도로 제공하지 않는다.
  it('#371 list_issues 를 노출한다', () => {
    expect(names).toContain('list_issues');
  });

  it('search_issues(전문 검색)는 여전히 포함하지 않는다(미구현 경계)', () => {
    expect(names).not.toContain('search_issues');
  });

  it('messaging 읽기/쓰기 도구를 노출한다(get_channel_messages / add_channel_message)', () => {
    expect(names).toContain('get_channel_messages');
    expect(names).toContain('add_channel_message');
  });

  it('#350 채널 목록/탐색 도구를 노출한다(list_channels / discover_channels)', () => {
    expect(names).toContain('list_channels');
    expect(names).toContain('discover_channels');
  });
});

// #333: assistant 프로파일 — 이슈 + 위키읽기 + home show_* + 캘린더 읽기 의 union(M1+M2).
describe('buildTools(assistant)', () => {
  const fakeClient = {} as never;

  const names = buildTools(fakeClient, 1, 'assistant').map((t) => t.name).sort();

  it('search_issues(전문 검색)는 포함하지 않는다(미구현 경계)', () => {
    expect(names).not.toContain('search_issues');
  });

  // #371: list_issues 데이터 조회 도구.
  it('list_issues 핸들러가 client.listIssues 를 호출하고 JSON 배열을 반환한다', async () => {
    const c = client();
    vi.mocked(c.listIssues).mockResolvedValue([
      { issueKey: 'WP-3', title: '버그', status: 'IN_PROGRESS', priority: 'HIGH', assignees: [], dueDate: null, type: null, blocked: false },
    ]);
    const tool = buildTools(c, AGENT_ID, 'assistant').find((t) => t.name === 'list_issues')!;
    const out = await tool.handler({ status: 'IN_PROGRESS', priority: ['HIGH'] });
    expect(JSON.parse(out)[0]).toMatchObject({ issueKey: 'WP-3', status: 'IN_PROGRESS' });
    // assignee 미지정 — 핸들러는 파싱된 params 를 그대로 전달, 'me' 기본값은 client.listIssues 가 적용.
    expect(c.listIssues).toHaveBeenCalledWith(AGENT_ID, { status: 'IN_PROGRESS', priority: ['HIGH'] });
  });

  // #519: issueListFilterShape 스키마 검증 — reporter 필드 및 priority 열거값 변경.
  it('#519 list_issues 필터에 reporter 필드가 허용된다', async () => {
    const c = client();
    vi.mocked(c.listIssues).mockResolvedValue([]);
    const tool = buildTools(c, AGENT_ID, 'assistant').find((t) => t.name === 'list_issues')!;
    await tool.handler({ reporter: 'user42' });
    expect(c.listIssues).toHaveBeenCalledWith(AGENT_ID, { reporter: 'user42' });
  });

  it('#519 priority MID 가 zod 파싱을 통과한다', async () => {
    const c = client();
    vi.mocked(c.listIssues).mockResolvedValue([]);
    const tool = buildTools(c, AGENT_ID, 'assistant').find((t) => t.name === 'list_issues')!;
    await expect(tool.handler({ priority: ['MID'] })).resolves.toBeDefined();
  });

  it('#519 priority MEDIUM/CRITICAL 은 zod 파싱에서 거부된다', async () => {
    const c = client();
    const tool = buildTools(c, AGENT_ID, 'assistant').find((t) => t.name === 'list_issues')!;
    await expect(tool.handler({ priority: ['MEDIUM'] })).rejects.toThrow();
    await expect(tool.handler({ priority: ['CRITICAL'] })).rejects.toThrow();
  });

  it('list_events 핸들러가 client.listEvents 를 호출한다', async () => {
    const calls: unknown[] = [];
    const fake = { listEvents: async (...a: unknown[]) => { calls.push(a); return []; } } as never;
    const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'list_events')!;
    await tool.handler({ from: '2026-06-19T00:00:00Z', to: '2026-06-26T00:00:00Z' });
    expect(calls[0]).toEqual([7, '2026-06-19T00:00:00Z', '2026-06-26T00:00:00Z']);
  });

  it('propose_create_event 는 실행하지 않고 사이드카에 제안 객체를 쓰고 ack 반환', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const fake = client(); // #842: 사전검증 호출이 있으므로 목 client 필요
      const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'propose_create_event')!;
      const ack = await tool.handler({
        title: '팀 미팅', startsAt: '2026-06-26T01:00:00Z', endsAt: '2026-06-26T02:00:00Z',
        allDay: false, summary: '6/26 10시 팀 미팅(1시간)',
      });
      expect(typeof ack).toBe('string'); // 서브에이전트용 ack
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.actionType).toBe('calendar.create_event');
      expect(written.summary).toBe('6/26 10시 팀 미팅(1시간)');
      expect(written.params.title).toBe('팀 미팅');
      expect(written.params.endsAt).toBe('2026-06-26T02:00:00Z');
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('assistant union 에 propose_create_event 가 포함된다', () => {
    expect(buildTools({} as never, 1, 'assistant').map((t) => t.name)).toContain('propose_create_event');
  });

  // #463: respond_chat 제거됨 — 라우터는 자유 prose 로 직접 답한다. submit_response 만 잔존.

  // #381: submit_response 는 subagent 사이드카에 {text} 를 기록(위임 답 경로).
  it('submit_response 는 subagent 사이드카에 {text} 를 기록한다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sr-'));
    const sidecar = path.join(dir, 'subagent-response.json');
    process.env.WORKPLACE_SUBAGENT_RESPONSE_PATH = sidecar;
    try {
      const tool = buildTools({} as never, 7, 'assistant').find((t) => t.name === 'submit_response')!;
      await tool.handler({ text: 'EX-2 상태를 진행 중으로 변경했어요.' });
      expect(JSON.parse(readFileSync(sidecar, 'utf8')).text).toBe('EX-2 상태를 진행 중으로 변경했어요.');
    } finally {
      delete process.env.WORKPLACE_SUBAGENT_RESPONSE_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // #467: 과거 first-write-guard(existsSync 면 덮지 않음)는 한 턴 ≥2 위임 시 두 번째 이후
  // 서브에이전트 답을 조용히 버렸다. NDJSON append 로 전환해 모든 답을 줄 단위로 보존한다.
  it('#467 submit_response 를 두 번 호출하면 두 답 모두 NDJSON 줄로 보존된다(첫 답만 남기지 않음)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sr-multi-'));
    const sidecar = path.join(dir, 'subagent-response.ndjson');
    process.env.WORKPLACE_SUBAGENT_RESPONSE_PATH = sidecar;
    try {
      const tool = buildTools({} as never, 7, 'assistant').find((t) => t.name === 'submit_response')!;
      await tool.handler({ text: '첫 번째 서브에이전트 답' });
      await tool.handler({ text: '두 번째 서브에이전트 답' });
      const lines = readFileSync(sidecar, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).text).toBe('첫 번째 서브에이전트 답');
      expect(JSON.parse(lines[1]).text).toBe('두 번째 서브에이전트 답');
    } finally {
      delete process.env.WORKPLACE_SUBAGENT_RESPONSE_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // #463: respond_chat 제거 — submit_response 만 잔존.
  it('assistant union 에 submit_response 가 포함되고 respond_chat 은 없다', () => {
    const names = buildTools({} as never, 1, 'assistant').map((t) => t.name);
    expect(names).toContain('submit_response');
    expect(names).not.toContain('respond_chat');
  });

  // #395: 새 일정 충돌을 서버에서 결정론적으로 조회해 제안에 embed (모델 list_events 호출에 비의존).
  it('propose_create_event — 겹치는 기존 일정이 있으면 conflicts 를 params 에 담고 summary 에 경고를 덧붙인다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-conf-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    const calls: unknown[] = [];
    try {
      // listEvents 가 [startsAt,endsAt) 와 겹치는 기존 일정 1건을 반환하도록 mock.
      const fake = {
        ...client(),
        listEvents: async (...a: unknown[]) => {
          calls.push(a);
          return [{
            id: 11, title: '기존 회의', description: null,
            startsAt: '2026-06-26T01:30:00Z', endsAt: '2026-06-26T02:30:00Z',
            allDay: false, location: null, recurrenceRule: null,
          }];
        },
      } as never;
      const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'propose_create_event')!;
      const ack = await tool.handler({
        title: '팀 미팅', startsAt: '2026-06-26T01:00:00Z', endsAt: '2026-06-26T02:00:00Z',
        allDay: false, summary: '6/26 10시 팀 미팅(1시간)',
      });
      // 보정된 시간대로 listEvents 호출됨.
      expect(calls[0]).toEqual([7, '2026-06-26T01:00:00Z', '2026-06-26T02:00:00Z']);
      expect(typeof ack).toBe('string');
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.actionType).toBe('calendar.create_event');
      // conflicts 가 {id,title,startsAt,endsAt} 형태로 담긴다.
      expect(written.params.conflicts).toEqual([
        { id: 11, title: '기존 회의', startsAt: '2026-06-26T01:30:00Z', endsAt: '2026-06-26T02:30:00Z' },
      ]);
      // summary 에 충돌 경고가 덧붙고 기존 일정 제목이 포함된다(확인 카드 노출용).
      expect(written.summary).toContain('6/26 10시 팀 미팅(1시간)');
      expect(written.summary).toContain('[충돌]');
      expect(written.summary).toContain('기존 회의');
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('propose_create_event — 겹치는 일정이 없으면 conflicts 없이 기존과 동일하게 동작한다 (#395)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-noconf-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const fake = { ...client(), listEvents: async () => [] } as never; // 충돌 없음
      const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'propose_create_event')!;
      await tool.handler({
        title: '팀 미팅', startsAt: '2026-06-26T01:00:00Z', endsAt: '2026-06-26T02:00:00Z',
        allDay: false, summary: '6/26 10시 팀 미팅(1시간)',
      });
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      // summary 는 그대로, conflicts 키는 없다.
      expect(written.summary).toBe('6/26 10시 팀 미팅(1시간)');
      expect(written.params.conflicts).toBeUndefined();
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('propose_create_event — listEvents 실패 시 fail-open: 충돌 없이 제안을 정상 진행한다 (#395)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-failopen-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      // listEvents 가 reject(네트워크/권한 등) — 제안 자체는 막히면 안 된다.
      const fake = { ...client(), listEvents: async () => { throw new Error('network'); } } as never;
      const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'propose_create_event')!;
      const ack = await tool.handler({
        title: '팀 미팅', startsAt: '2026-06-26T01:00:00Z', endsAt: '2026-06-26T02:00:00Z',
        allDay: false, summary: '6/26 10시 팀 미팅(1시간)',
      });
      expect(typeof ack).toBe('string');
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.actionType).toBe('calendar.create_event');
      expect(written.summary).toBe('6/26 10시 팀 미팅(1시간)');
      expect(written.params.conflicts).toBeUndefined();
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// #333 M3: wiki 쓰기 도구 — assistant union 멤버십 + 핸들러 단위 테스트.
describe('buildTools(assistant) wiki 쓰기 도구 (M3)', () => {
  it('assistant union 에 위키 쓰기 도구(create_wiki_page/update_wiki_page)를 노출', () => {
    const names = buildTools({} as never, 1, 'assistant').map((t) => t.name);
    expect(names).toContain('create_wiki_page');
    expect(names).toContain('update_wiki_page');
  });

  it('create_wiki_page 핸들러가 client.createWikiPage 를 호출한다', async () => {
    const calls: unknown[] = [];
    const fake = { createWikiPage: async (...a: unknown[]) => { calls.push(a); return { id: 9 }; } } as never;
    const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'create_wiki_page')!;
    await tool.handler({ spaceId: 3, title: '새 페이지' });
    expect(calls[0]).toEqual([7, 3, '새 페이지', undefined]);
  });

  it('update_wiki_page 핸들러가 client.updateWikiPage 를 호출한다', async () => {
    const calls: unknown[] = [];
    const fake = { updateWikiPage: async (...a: unknown[]) => { calls.push(a); return { id: 9 }; } } as never;
    const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'update_wiki_page')!;
    await tool.handler({ pageId: 5, version: 3, title: '수정 제목', body: '수정 본문' });
    expect(calls[0]).toEqual([7, 5, 3, '수정 제목', '수정 본문']);
  });
});

// #333 M3: 메일 도구 — assistant union 멤버십 + propose_send_mail 사이드카 테스트.
describe('buildTools(assistant) 메일 도구 (M3)', () => {
  it('assistant union 에 list_mail/get_mail/propose_send_mail 노출', () => {
    const names = buildTools({} as never, 1, 'assistant').map((t) => t.name);
    for (const n of ['list_mail', 'get_mail', 'propose_send_mail']) expect(names).toContain(n);
  });

  it('propose_send_mail 은 실행하지 않고 사이드카에 mail.send 제안(accountId 포함)을 쓰고 ack 반환', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-mail-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const tool = buildTools(client(), 7, 'assistant').find((t) => t.name === 'propose_send_mail')!;
      const ack = await tool.handler({
        accountId: 5, to: ['a@x.com'], subject: '안녕하세요', bodyText: '본문입니다',
        summary: 'a@x.com 에게 "안녕하세요" 발송',
      });
      expect(typeof ack).toBe('string');
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.actionType).toBe('mail.send');
      expect(written.summary).toBe('a@x.com 에게 "안녕하세요" 발송');
      expect(written.params.accountId).toBe(5); // 계정-소유권 경계에 필수
      expect(written.params.to).toEqual(['a@x.com']);
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('list_mail: unreadOnly 를 클라이언트로 관통한다 (#466)', async () => {
    const c = client();
    const tool = buildTools(c, AGENT_ID, 'assistant').find((t) => t.name === 'list_mail')!;
    await tool.handler({ accountId: 1, folder: 'INBOX', unreadOnly: true, limit: 20 });
    expect(c.listMail).toHaveBeenCalledWith(AGENT_ID, 1, 'INBOX', undefined, true, 20);
  });
});

// #333 M4: 메일 계정/동기화 도구 — assistant union 멤버십 테스트.
describe('buildTools(assistant) 메일 계정·동기화 도구 (M4)', () => {
  it('assistant union 에 list_mail_accounts/sync_mail 노출', () => {
    const names = buildTools({} as never, 1, 'assistant').map((t) => t.name);
    expect(names).toContain('list_mail_accounts');
    expect(names).toContain('sync_mail');
  });

  it('list_mail_accounts — client.listMailAccounts(agentId) 호출 후 JSON 반환', async () => {
    const c = client();
    vi.mocked(c.listMailAccounts).mockResolvedValue([{ id: 3, emailAddress: 'me@test.com', displayName: '내 계정', aiEnabled: true }]);
    const tool = buildTools(c, AGENT_ID, 'assistant').find((t) => t.name === 'list_mail_accounts')!;
    const out = await tool.handler({});
    expect(JSON.parse(out)[0].id).toBe(3);
    expect(c.listMailAccounts).toHaveBeenCalledWith(AGENT_ID);
  });

  it('sync_mail — client.syncMail(agentId, accountId) 호출 후 완료 문자열 반환', async () => {
    const c = client();
    const tool = buildTools(c, AGENT_ID, 'assistant').find((t) => t.name === 'sync_mail')!;
    const out = await tool.handler({ accountId: 5 });
    expect(typeof out).toBe('string');
    expect(c.syncMail).toHaveBeenCalledWith(AGENT_ID, 5);
  });
});

// #333 M3: 연락처 도구 — assistant union 멤버십 + propose_delete_contact 사이드카 테스트.
describe('buildTools(assistant) 연락처 도구 (M3)', () => {
  it('assistant union 에 연락처 도구(list/get/create/update + propose_delete_contact) 노출', () => {
    const names = buildTools({} as never, 1, 'assistant').map((t) => t.name);
    for (const n of ['list_contacts', 'get_external_contact', 'create_external_contact', 'update_external_contact', 'propose_delete_contact']) {
      expect(names).toContain(n);
    }
  });

  it('propose_delete_contact 는 실행하지 않고 사이드카에 contacts.delete_contact 제안을 쓰고 ack 반환', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-contact-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const tool = buildTools(client(), 7, 'assistant').find((t) => t.name === 'propose_delete_contact')!;
      // #833: 도구 표면은 externalId(외부 연락처 전용 식별자), 실행기 params 는 여전히 id.
      await tool.handler({ externalId: 9, summary: '"김거래" 연락처 삭제' });
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.actionType).toBe('contacts.delete_contact');
      expect(written.params.id).toBe(9);
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// #333 M3: 프로젝트 도구 — assistant union 멤버십 + propose 사이드카 테스트.
describe('buildTools(assistant) 프로젝트 도구 (M3)', () => {
  it('assistant union 에 프로젝트 도구(read 3 + propose 3) 노출', () => {
    const names = buildTools({} as never, 1, 'assistant').map((t) => t.name);
    for (const n of ['list_projects', 'get_project', 'list_project_members', 'propose_create_project', 'propose_delete_project', 'propose_add_project_member']) {
      expect(names).toContain(n);
    }
  });

  it('#844: get_project 는 이슈 유형·라벨 이름 목록을 함께 돌려준다(쓰기 값 조달 경로)', async () => {
    const c = client();
    (c.getProject as ReturnType<typeof vi.fn>).mockResolvedValue({ key: 'WP', name: '워크플레이스', description: null, type: 'TEAM' });
    (c.getProjectTypes as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, name: 'TASK' }, { id: 2, name: 'BUG' }]);
    (c.getProjectLabels as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 3, name: 'frontend' }]);
    const tool = buildTools(c, 7, 'assistant').find((t) => t.name === 'get_project')!;
    const out = JSON.parse(await tool.handler({ key: 'WP' }));
    expect(out).toEqual({
      key: 'WP', name: '워크플레이스', description: null, type: 'TEAM',
      issueTypes: ['TASK', 'BUG'], labels: ['frontend'],
    });
    expect(c.getProjectTypes).toHaveBeenCalledWith(7, 'WP');
    expect(c.getProjectLabels).toHaveBeenCalledWith(7, 'WP');
  });

  it('propose_create_project 는 사이드카에 project.create_project 제안을 쓴다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-proj-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const tool = buildTools(client(), 7, 'assistant').find((t) => t.name === 'propose_create_project')!;
      await tool.handler({ key: 'NEW', name: '새 프로젝트', summary: '"새 프로젝트"(NEW) 생성' });
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.actionType).toBe('project.create_project');
      expect(written.params.key).toBe('NEW');
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// #333 M3: 드라이브 읽기 도구 — assistant union 멤버십 + 핸들러 단위 테스트.
describe('buildTools(assistant) 드라이브 읽기 도구 (M3)', () => {
  it('assistant union 에 드라이브 읽기 도구(list_drive_spaces/list_drive_items/search_drive) 노출', () => {
    const names = buildTools({} as never, 1, 'assistant').map((t) => t.name);
    for (const n of ['list_drive_spaces', 'list_drive_items', 'search_drive']) expect(names).toContain(n);
  });

  it('search_drive 핸들러가 client.searchDrive 를 호출한다', async () => {
    const calls: unknown[] = [];
    const fake = { searchDrive: async (...a: unknown[]) => { calls.push(a); return { folders: [], files: [] }; } } as never;
    const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'search_drive')!;
    await tool.handler({ spaceId: 1, q: '보고서' });
    expect(calls[0]).toEqual([7, 1, '보고서']);
  });
});

// #333 M4: 드라이브 쓰기/삭제 도구 — assistant union 멤버십 + 핸들러 단위 테스트.
describe('buildTools(assistant) 드라이브 쓰기/삭제 도구 (M4)', () => {
  it('assistant union 에 드라이브 쓰기/삭제 도구 6개 노출', () => {
    const names = buildTools({} as never, 1, 'assistant').map((t) => t.name);
    for (const n of [
      'create_folder', 'rename_folder', 'move_folder', 'move_file',
      'propose_delete_file', 'propose_delete_folder',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('create_folder 핸들러가 client.createFolder 를 호출한다', async () => {
    const folder = { id: 10, name: '신규폴더', type: 'FOLDER' };
    const calls: unknown[] = [];
    const fake = { createFolder: async (...a: unknown[]) => { calls.push(a); return folder; } } as never;
    const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'create_folder')!;
    const out = await tool.handler({ spaceId: 1, name: '신규폴더' });
    expect(calls[0]).toEqual([7, 1, null, '신규폴더']);
    expect(JSON.parse(out)).toMatchObject({ id: 10, name: '신규폴더' });
  });

  it('propose_delete_file 은 실행하지 않고 사이드카에 drive.delete_file 제안을 쓰고 ack 반환', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-drive-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const tool = buildTools(client(), 7, 'assistant').find((t) => t.name === 'propose_delete_file')!;
      const ack = await tool.handler({ driveFileId: 99, summary: '보고서.pdf 삭제' });
      expect(typeof ack).toBe('string');
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.actionType).toBe('drive.delete_file');
      expect(written.summary).toBe('보고서.pdf 삭제');
      expect(written.params.id).toBe(99);
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// #840: 드라이브 식별자 봉합 — 목록 응답에서 core fileId 를 지우고, 이동·삭제는 driveFileId/folderId 로만 받는다.
describe('드라이브 식별자 봉합 (#840)', () => {
  it('list_drive_items 는 파일 행에서 core fileId 를 제거하고 drive_file.id 를 driveFileId 로 노출한다', async () => {
    const fake = {
      listSpaceItems: async () => ({
        folders: [{ id: 3, parentId: null, name: '폴더', createdAt: 't' }],
        files: [{ id: 5, folderId: 3, fileId: 812, name: '보고서.pdf', mimeType: 'application/pdf', sizeBytes: 10, category: 'DOCUMENT', createdAt: 't', updatedAt: 'u', versionCount: 2, available: false }],
      }),
    } as never;
    const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'list_drive_items')!;
    const out = JSON.parse(await tool.handler({ spaceId: 1 }));
    expect(out.folders).toEqual([{ id: 3, parentId: null, name: '폴더', createdAt: 't' }]);
    // fileId 외 필드(원본 유실 available 등)는 그대로 전달돼야 한다.
    expect(out.files[0]).toEqual({ driveFileId: 5, folderId: 3, name: '보고서.pdf', mimeType: 'application/pdf', sizeBytes: 10, category: 'DOCUMENT', createdAt: 't', updatedAt: 'u', versionCount: 2, available: false });
    expect(JSON.stringify(out)).not.toContain('812');
  });

  it('move_file 은 driveFileId 를 client.moveFile 에 넘기고, 옛 fileId 파라미터는 거부한다', async () => {
    const calls: unknown[] = [];
    const fake = { moveFile: async (...a: unknown[]) => { calls.push(a); } } as never;
    const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'move_file')!;
    await tool.handler({ driveFileId: 5, targetFolderId: 3 });
    expect(calls[0]).toEqual([7, 5, 3]);
    await expect(tool.handler({ fileId: 812, targetFolderId: 3 })).rejects.toThrow();
  });

  it('propose_delete_folder 는 folderId 를 실행기 파라미터 id 로 매핑한다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-folder-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const tool = buildTools(client(), 7, 'assistant').find((t) => t.name === 'propose_delete_folder')!;
      await tool.handler({ folderId: 3, summary: '폴더 삭제' });
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.actionType).toBe('drive.delete_folder');
      expect(written.params).toEqual({ id: 3 });
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// #351: propose 사이드카 다건 누적 — 같은 턴에 여러 propose 를 NDJSON 으로 append 한다.
describe('propose 사이드카 다건 누적 (#351)', () => {
  it('두 번 propose 하면 NDJSON 두 줄이 쌓인다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'propose-test-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const tools = buildTools(client(), 1, 'assistant');
      const del = tools.find((t) => t.name === 'propose_delete_file')!;
      // propose_delete_file inputSchema: { summary, driveFileId: number } (#840)
      await del.handler({ driveFileId: 1, summary: '파일 A 삭제' });
      await del.handler({ driveFileId: 2, summary: '파일 B 삭제' });
      const lines = readFileSync(sidecar, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).params.id).toBe(1);
      expect(JSON.parse(lines[1]).params.id).toBe(2);
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// #333 M4: 캘린더 수정/삭제 propose 도구 — assistant union 멤버십 + 사이드카 테스트.
describe('buildTools(assistant) 캘린더 수정/삭제 제안 도구 (M4)', () => {
  it('assistant union 에 propose_update_event / propose_delete_event 가 포함된다', () => {
    const names = buildTools({} as never, 1, 'assistant').map((t) => t.name);
    expect(names).toContain('propose_update_event');
    expect(names).toContain('propose_delete_event');
  });

  it('propose_update_event 는 사이드카에 calendar.update_event 제안을 쓰고 ack 반환', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-upd-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const fake = client();
      const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'propose_update_event')!;
      const ack = await tool.handler({
        id: 42, title: '팀 미팅 (변경)', startsAt: '2026-07-01T01:00:00Z', endsAt: '2026-07-01T02:00:00Z',
        scope: 'THIS', summary: '#42 팀 미팅 제목 변경',
      });
      expect(typeof ack).toBe('string');
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.actionType).toBe('calendar.update_event');
      expect(written.summary).toBe('#42 팀 미팅 제목 변경');
      expect(written.params.id).toBe(42);
      expect(written.params.title).toBe('팀 미팅 (변경)');
      expect(written.params.scope).toBe('THIS');
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('propose_update_event — 존재하지 않는 id 는 서버 사전검증 사유로 실패한다 (#397/#842)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-upd-nf-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      // #842: 존재 확인은 서버 validate 가 담당한다. 오류 문구를 자체 문구로 바꾸지 않고 그대로 전파해
      // LLM 이 id 를 교정할 수 있게 하고, 카드(사이드카 기록)는 만들지 않는다.
      const fake = {
        validateAction: async () => { throw apiError(404, 'API 오류 404: 일정을 찾을 수 없습니다'); },
      } as never;
      const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'propose_update_event')!;
      await expect(tool.handler({
        id: 9999, title: '변경', startsAt: '2026-07-01T01:00:00Z', endsAt: '2026-07-01T02:00:00Z',
        scope: 'ALL', summary: 'id 9999 수정',
      })).rejects.toThrow('일정을 찾을 수 없습니다');
      // 사이드카 파일이 생성되지 않아야 한다.
      expect(() => readFileSync(sidecar, 'utf8')).toThrow();
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('propose_delete_event 는 사이드카에 calendar.delete_event 제안을 쓰고 ack 반환', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-del-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const fake = client();
      const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'propose_delete_event')!;
      const ack = await tool.handler({ id: 55, scope: 'ALL', summary: '#55 팀 미팅 전체 삭제' });
      expect(typeof ack).toBe('string');
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.actionType).toBe('calendar.delete_event');
      expect(written.summary).toBe('#55 팀 미팅 전체 삭제');
      expect(written.params.id).toBe(55);
      expect(written.params.scope).toBe('ALL');
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// 스레드 mirror: threadBinding — add_channel_message 가 바인딩 채널에 parentMessageId 를 전달.
describe('buildTools threadBinding — add_channel_message 스레드 mirror', () => {
  it('threadBinding 채널과 일치하면 add_channel_message 가 parentMessageId 를 넘긴다', async () => {
    const calls: Array<[number, number, string, number | undefined]> = [];
    const fake = {
      addChannelMessage: async (a: number, c: number, b: string, pid?: number) => {
        calls.push([a, c, b, pid]);
      },
    } as never;
    const tools = buildTools(fake, 2, 'messaging', { channelId: 9, parentMessageId: 210 });
    const tool = tools.find((t) => t.name === 'add_channel_message')!;
    await tool.handler({ channelId: 9, body: '답' });
    expect(calls[0]).toEqual([2, 9, '답', 210]);
  });

  it('threadBinding 과 다른 채널이면 parentMessageId 없이(인라인) 넘긴다', async () => {
    const calls: Array<[number, number, string, number | undefined]> = [];
    const fake = {
      addChannelMessage: async (a: number, c: number, b: string, pid?: number) => {
        calls.push([a, c, b, pid]);
      },
    } as never;
    const tools = buildTools(fake, 2, 'messaging', { channelId: 9, parentMessageId: 210 });
    const tool = tools.find((t) => t.name === 'add_channel_message')!;
    await tool.handler({ channelId: 5, body: '딴채널' });
    expect(calls[0]).toEqual([2, 5, '딴채널', undefined]);
  });
});

// #844: 멘션 토큰은 숫자 id(<@id>)뿐이라 LLM 이 쓴 @username 을 도구가 변환한다.
describe('add_channel_message @username → <@userId> 멘션 변환', () => {
  const member = (username: string, userId: number) => ({ userId, username, name: username, email: null, title: null, kind: 'HUMAN', active: true, membershipRole: null });
  const post = async (body: string, members: ReturnType<typeof member>[], failSearch = false) => {
    let posted = '';
    const fake = {
      // 부분일치 검색을 흉내 — 서버처럼 검색어를 포함하는 행을 돌려준다.
      searchMembers: async (_a: number, o: { search?: string }) => {
        if (failSearch) throw new Error('boom');
        return members.filter((m) => m.username.includes(o.search ?? '') || m.name.includes(o.search ?? ''));
      },
      addChannelMessage: async (_a: number, _c: number, b: string) => { posted = b; },
    } as never;
    const tool = buildTools(fake, 2, 'messaging').find((t) => t.name === 'add_channel_message')!;
    await tool.handler({ channelId: 1, body });
    return posted;
  };

  it('구성원으로 확인된 @username 만 <@id> 로 바꾸고, 문장 끝 마침표는 보존한다', async () => {
    const out = await post('@kim.cs 확인 부탁드립니다. 참고: @lee.', [member('kim.cs', 42), member('lee', 7)]);
    expect(out).toBe('<@42> 확인 부탁드립니다. 참고: <@7>.');
  });

  it('없는 식별자·메일 주소의 @ 는 그대로 둔다', async () => {
    const out = await post('@박영희 님, a@kim.cs 로 메일 주세요 @ghost', [member('kim.cs', 42)]);
    expect(out).toBe('@박영희 님, a@kim.cs 로 메일 주세요 @ghost');
  });

  it('username 이 아니어도 표시 이름이 정확히 한 명이면 멘션하고, 동명이인이면 그대로 둔다', async () => {
    const kim = { ...member('kim.cs', 42), name: '김철수' };
    expect(await post('@김철수 확인요', [kim])).toBe('<@42> 확인요');
    const twin = { ...member('kim.cs2', 43), name: '김철수' };
    expect(await post('@김철수 확인요', [kim, twin])).toBe('@김철수 확인요');
  });

  it('이름에 붙은 호칭·조사는 떼고 찾되 원문에는 남긴다', async () => {
    const kim = { ...member('kim.cs', 42), name: '김철수' };
    expect(await post('@김철수님 확인요, @kim.cs에게도 전달', [kim])).toBe('<@42>님 확인요, <@42>에게도 전달');
  });

  it('부분일치만 되는 username 은 멘션하지 않는다(정확일치만)', async () => {
    expect(await post('@kim 안녕', [member('kim.cs', 42)])).toBe('@kim 안녕');
  });

  it('구성원 조회가 실패해도 원문 그대로 게시한다', async () => {
    expect(await post('@kim.cs 안녕', [], true)).toBe('@kim.cs 안녕');
  });
});

// L3 위임: propose_create_issue — delegationContext 존재 여부에 따른 도구 노출/차단 검증.
describe('buildTools messaging 위임 — propose_create_issue', () => {
  it('propose_create_issue: delegationContext 의 위임자/채널/parent 를 스탬프하고 add_channel_message 를 호출하지 않는다', async () => {
    const calls: { propose: unknown[]; add: number } = { propose: [], add: 0 };
    const c = {
      proposeCreateIssue: async (...a: unknown[]) => { calls.propose.push(a); },
      addChannelMessage: async () => { calls.add++; },
    } as unknown as WorkplaceApiClient;
    const tools = buildTools(c, 2, 'messaging', undefined, { actorId: 7, channelId: 9, parentMessageId: 100 });
    const tool = tools.find((t) => t.name === 'propose_create_issue')!;
    expect(tool).toBeTruthy();
    const out = await tool.handler({ title: '로그인 버그', body: '상세', priority: 'HIGH' });
    expect(calls.add).toBe(0); // add_channel_message 미호출
    const [agentId, channelId, req] = calls.propose[0] as [number, number, Record<string, unknown>];
    expect(agentId).toBe(2);
    expect(channelId).toBe(9);
    expect(req).toMatchObject({ title: '로그인 버그', body: '상세', priority: 'HIGH', proposedByUserId: 7, parentMessageId: 100 });
    expect(typeof out).toBe('string');
  });

  it('propose_create_issue: delegationContext 가 없으면 messaging 프로파일에 노출되지 않는다', () => {
    const tools = buildTools({} as unknown as WorkplaceApiClient, 2, 'messaging');
    expect(tools.find((t) => t.name === 'propose_create_issue')).toBeUndefined();
  });

  // guard 를 await 성공 후 설정: 실패 시 재시도 가능 검증.
  it('propose_create_issue: 첫 호출 실패(reject) 시 오류 문자열 반환 + guard 미래치 — 재시도 시 client 재호출', async () => {
    let callCount = 0;
    const c = {
      // 첫 호출은 reject, 두 번째는 resolve.
      proposeCreateIssue: vi.fn().mockImplementationOnce(() => {
        callCount++;
        return Promise.reject(new Error('서버 500'));
      }).mockImplementationOnce(() => {
        callCount++;
        return Promise.resolve(undefined);
      }),
      addChannelMessage: vi.fn(),
    } as unknown as WorkplaceApiClient;
    const tools = buildTools(c, 3, 'messaging', undefined, { actorId: 5, channelId: 11 });
    const tool = tools.find((t) => t.name === 'propose_create_issue')!;

    // 1차 호출 — 실패: 오류 문자열 반환, 예외 미전파.
    const firstResult = await tool.handler({ title: '버그 보고', priority: 'HIGH' });
    expect(typeof firstResult).toBe('string');
    expect(firstResult).toContain('실패');
    expect(firstResult).toContain('서버 500');
    expect(callCount).toBe(1);

    // 2차 호출 — guard 가 세워지지 않았으므로 client 를 다시 호출해야 한다.
    const secondResult = await tool.handler({ title: '버그 보고', priority: 'HIGH' });
    expect(secondResult).toBe('제안 카드를 올렸습니다. 위임자의 승인을 기다립니다.');
    expect(callCount).toBe(2); // 재시도 시 실제로 API 재호출됨
  });
});

// L3 위임: propose_create_event — messaging 프로파일에서 delegationContext 유무에 따른 노출/차단 검증.
describe('buildTools messaging 위임 — propose_create_event', () => {
  it('messaging profile exposes propose_create_event under delegationContext and calls client', async () => {
    const calls: unknown[][] = [];
    const client = {
      // 필요한 메서드만 스텁 — listEvents 는 충돌 없음([]) 반환.
      listEvents: async () => [],
      proposeCreateEvent: async (...args: unknown[]) => { calls.push(args); },
    } as unknown as WorkplaceApiClient;
    const tools = buildTools(client, 42, 'messaging', undefined, {
      actorId: 7,
      channelId: 9,
      parentMessageId: undefined,
    });
    const tool = tools.find((t) => t.name === 'propose_create_event');
    expect(tool).toBeDefined();

    await tool!.handler({
      title: '스프린트 리뷰',
      startsAt: '2026-07-05T14:00:00+09:00',
      endsAt: '2026-07-05T15:00:00+09:00',
      summary: '7/5 14:00 스프린트 리뷰',
    });
    expect(calls).toHaveLength(1);
    // [agentId, channelId, req] — req.proposedByUserId=actorId, actionType 은 client 가 스탬프.
    const [, channelId, req] = calls[0] as [number, number, { title: string; proposedByUserId: number }];
    expect(channelId).toBe(9);
    expect(req.title).toBe('스프린트 리뷰');
    expect(req.proposedByUserId).toBe(7);
  });

  // #848: 서버가 위임자 권한으로 사전검증해 카드를 거절하면, 그 사유가 툴 결과로 AI 에게 전달되고 재시도가 막히지 않아야 한다.
  it('서버 사전검증 거절(403) 사유를 툴 결과로 돌려주고 재시도를 허용한다 (#848)', async () => {
    const proposeCreateEvent = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, '필요 권한 없음: calendar:write'))
      .mockResolvedValueOnce(undefined);
    const c = { listEvents: async () => [], proposeCreateEvent } as unknown as WorkplaceApiClient;
    const tool = buildTools(c, 42, 'messaging', undefined, { actorId: 7, channelId: 9 }).find(
      (t) => t.name === 'propose_create_event',
    )!;
    const args = { title: '리뷰', summary: '7/5 리뷰', startsAt: '2026-07-05T14:00:00+09:00', endsAt: '2026-07-05T15:00:00+09:00' };

    await expect(tool.handler(args)).resolves.toContain('필요 권한 없음: calendar:write');
    // 거절은 guard 를 세우지 않는다 — 고친 뒤 다시 제안할 수 있어야 한다.
    await expect(tool.handler(args)).resolves.toContain('일정 제안 카드를 올렸습니다');
    expect(proposeCreateEvent).toHaveBeenCalledTimes(2);
  });

  it('messaging profile WITHOUT delegationContext does not expose propose_create_event', () => {
    const tools = buildTools({} as unknown as WorkplaceApiClient, 42, 'messaging');
    expect(tools.find((t) => t.name === 'propose_create_event')).toBeUndefined();
  });
});

// home 프로필은 표시 지시 도구만 노출하고 데이터 조회를 하지 않는다.
describe('buildTools home 프로필', () => {
  const fakeClient = {} as never; // home 도구는 client 를 호출하지 않으므로 빈 객체로 충분
  const tools = buildTools(fakeClient, 1, 'home');

  it('show_* 표시 도구만 노출(#431 show_mail_list 포함)', () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      'show_activity',
      'show_issue_detail',
      'show_issue_list',
      'show_mail_list',
      'show_my_tasks',
    ]);
  });

  it('각 도구는 {displayed:true} 만 반환 (데이터 조회 X)', async () => {
    for (const t of tools) {
      const out = await t.handler({});
      expect(JSON.parse(out)).toEqual({ displayed: true });
    }
  });

  it('show_issue_list 는 params/layout 입력 스키마를 통과시킨다', () => {
    const t = tools.find((x) => x.name === 'show_issue_list')!;
    expect(() =>
      t.inputSchema.parse({
        params: { status: 'IN_PROGRESS', priority: ['HIGH'], assignee: 'me' },
        layout: { page: 'current' },
      }),
    ).not.toThrow();
  });
});

// #393/#394: propose_create_event 스키마 결정론적 보정 테스트.
describe('propose_create_event 스키마 결정론적 보정 (#393/#394)', () => {
  it('#393: attendees 배열(이메일 목록)이 params에 포함된다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'att-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const tool = buildTools(client(), 7, 'assistant').find((t) => t.name === 'propose_create_event')!;
      await tool.handler({
        title: '스프린트 리뷰', startsAt: '2026-06-20T14:00:00+09:00', endsAt: '2026-06-20T15:00:00+09:00',
        attendees: ['user@example.com', 'admin@company.com'], summary: '스프린트 리뷰',
      });
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.params.attendees).toEqual(['user@example.com', 'admin@company.com']);
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('#394: 타임존 오프셋 없는 naive datetime에 +09:00이 자동 보정된다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tz-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const tool = buildTools(client(), 7, 'assistant').find((t) => t.name === 'propose_create_event')!;
      await tool.handler({
        title: '업무 점검', startsAt: '2026-06-19T15:00:00', endsAt: '2026-06-19T15:30:00',
        summary: '6/19 15시 업무 점검',
      });
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      // naive datetime에 +09:00 보정이 적용되어야 한다.
      expect(written.params.startsAt).toBe('2026-06-19T15:00:00+09:00');
      expect(written.params.endsAt).toBe('2026-06-19T15:30:00+09:00');
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('#394: 이미 오프셋이 있는 datetime은 그대로 유지된다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tz2-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const tool = buildTools(client(), 7, 'assistant').find((t) => t.name === 'propose_create_event')!;
      await tool.handler({
        title: '회의', startsAt: '2026-06-20T05:00:00Z', endsAt: '2026-06-20T05:30:00Z',
        summary: '6/20 14시 회의',
      });
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      // Z 오프셋은 변경되면 안 된다.
      expect(written.params.startsAt).toBe('2026-06-20T05:00:00Z');
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// #402: propose_update_event 스키마에 attendees 필드가 포함되어야 한다.
// 기존 스키마에 attendees 가 없어 haiku가 참석자 수정 요청 시 params에서 해당 필드를 생략했음.
describe('propose_update_event attendees 스키마 (#402)', () => {
  it('attendees 배열(이메일 목록)이 params에 포함된다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'upd-att-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const fake = client();
      const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'propose_update_event')!;
      await tool.handler({
        id: 77, title: '팀 회의', startsAt: '2026-07-01T10:00:00+09:00', endsAt: '2026-07-01T11:00:00+09:00',
        scope: 'THIS', summary: '팀 회의에 김철수 추가',
        attendees: ['kim@example.com', 'park@example.com'],
      });
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.actionType).toBe('calendar.update_event');
      expect(written.params.attendees).toEqual(['kim@example.com', 'park@example.com']);
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('attendees 미포함 시에도 기존 수정 제안은 정상 동작', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'upd-noatt-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const fake = client();
      const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'propose_update_event')!;
      await tool.handler({
        id: 42, title: '수정된 제목', startsAt: '2026-07-01T01:00:00Z', endsAt: '2026-07-01T02:00:00Z',
        scope: 'ALL', summary: '제목만 변경',
      });
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.params.title).toBe('수정된 제목');
      expect(written.params.attendees).toBeUndefined(); // 선택 필드 — 미포함 시 undefined
    } finally {
      delete process.env.WORKPLACE_PENDING_ACTION_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('HostBridge 콜백 (#462 슬라이스4)', () => {
  function findTool(tools: ReturnType<typeof buildTools>, name: string) {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`tool ${name} not found`);
    return t;
  }
  const fakeClient = {
    ...client(),
    unassignSelf: async () => { /* 성공 */ },
  } as never;

  it('propose_* 핸들러가 hostBridge.onProposal 을 호출(파일 미사용)', async () => {
    const proposals: unknown[] = [];
    const bridge: HostBridge = { onProposal: (p) => proposals.push(p), onSubmitResponse: () => {}, onUnassignResult: () => {} };
    const tools = buildTools(fakeClient, 1, 'assistant', undefined, undefined, bridge);
    const propose = findTool(tools, 'propose_create_event');
    const out = await propose.handler({ title: '회의', summary: '회의', startsAt: '2026-06-26T10:00:00+09:00', endsAt: '2026-06-26T11:00:00+09:00' });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ actionType: 'calendar.create_event' });
    expect(out).toContain('제안');
  });

  it('submit_response 핸들러가 hostBridge.onSubmitResponse 를 호출', async () => {
    let submitted: string | null = null;
    const bridge: HostBridge = { onProposal: () => {}, onSubmitResponse: (t) => { submitted = t; }, onUnassignResult: () => {} };
    const tools = buildTools(fakeClient, 1, 'assistant', undefined, undefined, bridge);
    const submit = findTool(tools, 'submit_response');
    await submit.handler({ text: '최종 답변' });
    expect(submitted).toBe('최종 답변');
  });

  it('unassign_self 성공 시 onUnassignResult({ok:true})', async () => {
    const results: Array<{ ok: boolean; canonical?: string }> = [];
    const bridge: HostBridge = { onProposal: () => {}, onSubmitResponse: () => {}, onUnassignResult: (r) => results.push(r) };
    const tools = buildTools(fakeClient, 1, 'assistant', undefined, undefined, bridge);
    const unassign = findTool(tools, 'unassign_self');
    await unassign.handler({ issueKey: 'EX-2' });
    expect(results).toEqual([{ ok: true }]);
  });

  it('unassign_self 실패 시 onUnassignResult({ok:false, canonical}) + canonical 반환', async () => {
    const failingClient = { unassignSelf: async () => { throw new Error('403'); } } as never;
    const results: Array<{ ok: boolean; canonical?: string }> = [];
    const bridge: HostBridge = { onProposal: () => {}, onSubmitResponse: () => {}, onUnassignResult: (r) => results.push(r) };
    const tools = buildTools(failingClient, 1, 'assistant', undefined, undefined, bridge);
    const unassign = findTool(tools, 'unassign_self');
    const out = await unassign.handler({ issueKey: 'EX-2' });
    expect(results[0].ok).toBe(false);
    expect(results[0].canonical).toContain('담당자 해제 요청을 처리하지 못했습니다');
    expect(out).toContain('담당자 해제 요청을 처리하지 못했습니다');
  });
});

// #833: 구성원 도메인 도구 + 연락처 id 네임스페이스 분리.
// 회귀 방지 대상 — 에이전트가 연락처 id 를 프로젝트 멤버 userId 로 오용하던 사고.
describe('#833 구성원/연락처 도메인 경계', () => {
  const find = (tools: ReturnType<typeof buildTools>, name: string) => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`tool ${name} not found`);
    return t;
  };

  it('assistant 프로파일에 구성원 도구 5종이 노출된다', () => {
    const names = buildTools(client(), AGENT_ID, 'assistant').map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'search_members',
        'get_member',
        'get_member_contact',
        'propose_set_member_role',
        'propose_set_member_active',
      ]),
    );
  });

  it('list_contacts 는 MEMBER→userId, EXTERNAL→externalId 로 식별자를 분리하고 공용 id 를 내보내지 않는다', async () => {
    const c = client();
    c.listContacts = vi.fn().mockResolvedValue({
      items: [
        { id: 7, type: 'MEMBER', name: '김구성원', email: 'm@x.com', title: null, organization: null, isFavorite: false },
        { id: 7, type: 'EXTERNAL', name: '김외부', email: 'e@x.com', title: null, organization: 'X사', isFavorite: true },
      ],
      nextCursor: 'c1',
    });
    const t = find(buildTools(c, AGENT_ID, 'assistant'), 'list_contacts');
    const out = JSON.parse(await t.handler({ limit: 20 })) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    expect(out.items[0]).toMatchObject({ type: 'MEMBER', userId: 7 });
    expect(out.items[0]).not.toHaveProperty('externalId');
    expect(out.items[1]).toMatchObject({ type: 'EXTERNAL', externalId: 7 });
    expect(out.items[1]).not.toHaveProperty('userId');
    // 공용 id 를 남겨두면 두 네임스페이스가 다시 섞인다 — 반드시 제거되어야 한다.
    expect(out.items[0]).not.toHaveProperty('id');
    expect(out.items[1]).not.toHaveProperty('id');
    expect(out.nextCursor).toBe('c1');
  });

  it('get_external_contact 는 externalId 를 받는다 (id 키는 스키마 거부)', async () => {
    const c = client();
    c.getExternalContact = vi.fn().mockResolvedValue({ id: 3, name: '외부' });
    const t = find(buildTools(c, AGENT_ID, 'assistant'), 'get_external_contact');
    await t.handler({ externalId: 3 });
    expect(c.getExternalContact).toHaveBeenCalledWith(AGENT_ID, 3);
    await expect(t.handler({ id: 3 })).rejects.toThrow();
  });

  it('propose_delete_contact 는 externalId 를 실행기 params.id 로 매핑한다', async () => {
    const c = client();
    const proposals: { actionType: string; params: unknown }[] = [];
    const bridge: HostBridge = {
      onProposal: (p) => proposals.push(p as never),
      onSubmitResponse: () => {},
      onUnassignResult: () => {},
    };
    const t = find(buildTools(c, AGENT_ID, 'assistant', undefined, undefined, bridge), 'propose_delete_contact');
    await t.handler({ externalId: 42, summary: '외부 연락처 삭제' });
    expect(proposals[0].actionType).toBe('contacts.delete_contact');
    expect(proposals[0].params).toMatchObject({ id: 42 });
  });

  describe('propose_add_project_member 사전검증', () => {
    const bridgeWith = (sink: unknown[]): HostBridge => ({
      onProposal: (p) => sink.push(p),
      onSubmitResponse: () => {},
      onUnassignResult: () => {},
    });

    it('구성원이 아닌 userId 는 제안을 만들지 않고 오류를 반환한다', async () => {
      const c = client();
      // 검색 결과에 해당 username 이 없으면 구성원이 아니다.
      c.searchMembers = vi.fn().mockResolvedValue([]);
      const sink: unknown[] = [];
      const t = find(
        buildTools(c, AGENT_ID, 'assistant', undefined, undefined, bridgeWith(sink)),
        'propose_add_project_member',
      );
      const out = await t.handler({ key: 'WP', username: 'ghost', role: 'MEMBER', summary: 's' });
      expect(out).toContain('찾을 수 없습니다');
      expect(sink).toHaveLength(0); // 확인 카드가 만들어지면 안 된다
    });

    it('비활성 구성원은 제안을 만들지 않는다', async () => {
      const c = client();
      c.searchMembers = vi.fn().mockResolvedValue([{ userId: 5, username: 'retired', name: '퇴사자', kind: 'HUMAN', active: false }]);
      const sink: unknown[] = [];
      const t = find(
        buildTools(c, AGENT_ID, 'assistant', undefined, undefined, bridgeWith(sink)),
        'propose_add_project_member',
      );
      const out = await t.handler({ key: 'WP', username: 'retired', role: 'MEMBER', summary: 's' });
      expect(out).toContain('비활성');
      expect(sink).toHaveLength(0);
    });

    it('활성 구성원이면 제안을 만든다', async () => {
      const c = client();
      c.searchMembers = vi.fn().mockResolvedValue([{ userId: 5, username: 'minsu', name: '김민수', kind: 'HUMAN', active: true }]);
      const sink: { actionType: string; params: unknown }[] = [];
      const t = find(
        buildTools(c, AGENT_ID, 'assistant', undefined, undefined, bridgeWith(sink as never)),
        'propose_add_project_member',
      );
      await t.handler({ key: 'WP', username: 'minsu', role: 'MEMBER', summary: 's' });
      expect(sink[0].actionType).toBe('project.add_member');
      // 도구 표면은 username, 실행기에는 해석된 userId 가 간다.
      expect(sink[0].params).toMatchObject({ key: 'WP', userId: 5, role: 'MEMBER' });
    });
  });

  it('propose_set_member_role 은 역할명을 그대로 실행기에 넘긴다(roleId 해석은 서버 몫)', async () => {
    const c = client();
    c.searchMembers = vi.fn().mockResolvedValue([{ userId: 5, username: 'minsu', name: '김민수', kind: 'HUMAN', active: true }]);
    const sink: { actionType: string; params: unknown }[] = [];
    const bridge: HostBridge = {
      onProposal: (p) => sink.push(p as never),
      onSubmitResponse: () => {},
      onUnassignResult: () => {},
    };
    const t = find(buildTools(c, AGENT_ID, 'assistant', undefined, undefined, bridge), 'propose_set_member_role');
    await t.handler({ username: 'minsu', roles: ['ADMIN'], summary: '관리자로 승격' });
    expect(sink[0].actionType).toBe('user.set_roles');
    expect(sink[0].params).toMatchObject({ userId: 5, roles: ['ADMIN'] });
  });
});

// #833: 비구성원(404)과 그 밖의 실패를 구분한다. 모든 실패를 "구성원 아님"으로 뭉개면 권한 부족이나
// 일시 장애에도 "그런 사람 없습니다"가 되어 멤버 추가가 통째로 막히고 재검색 루프가 돈다.
describe('#833 구성원 해석', () => {
  it('조회 오류는 비구성원으로 뭉개지 않고 그대로 전파한다', async () => {
    const c = client();
    c.searchMembers = vi.fn().mockRejectedValue({ response: { status: 403 } });
    const t = buildTools(c, AGENT_ID, 'assistant').find((x) => x.name === 'propose_add_project_member')!;
    await expect(t.handler({ key: 'WP', username: 'minsu', role: 'MEMBER', summary: 's' })).rejects.toBeDefined();
  });

  it('부분일치는 채택하지 않는다 — username 정확일치만', async () => {
    const c = client();
    c.searchMembers = vi.fn().mockResolvedValue([
      { userId: 7, username: 'minsu2', name: '김민수2', kind: 'HUMAN', active: true },
    ]);
    const t = buildTools(c, AGENT_ID, 'assistant').find((x) => x.name === 'propose_add_project_member')!;
    const out = await t.handler({ key: 'WP', username: 'minsu', role: 'MEMBER', summary: 's' });
    expect(out).toContain('찾을 수 없습니다');
  });

  it('AI 에이전트 계정은 역할 변경 대상에서 제외된다 — AGENT 역할 소실 방지', async () => {
    const c = client();
    c.searchMembers = vi.fn().mockResolvedValue([
      { userId: 9, username: 'assistant', name: '개인 비서', kind: 'AGENT', active: true },
    ]);
    const t = buildTools(c, AGENT_ID, 'assistant').find((x) => x.name === 'propose_set_member_role')!;
    const out = await t.handler({ username: 'assistant', roles: ['USER'], summary: 's' });
    expect(out).toContain('AI 에이전트');
  });
});

// #842: 확인카드 사전검증(dry-run) — 카드 등록 전에 서버 validate 를 거치고,
// 실패하면 카드를 만들지 않고 서버가 준 사유를 그대로 LLM 에 돌려준다.
// #842: 등록된 제안을 배열에 모으는 브리지 — 카드 생성 여부를 단언하는 데 쓴다.
function collectingBridge(proposals: unknown[]): HostBridge {
  return { onProposal: (p) => proposals.push(p), onSubmitResponse: () => {}, onUnassignResult: () => {} };
}

describe('propose 사전검증 (#842)', () => {
  it('propose 전에 같은 actionType·params 로 validateAction 을 호출한다', async () => {
    const c = client();
    const proposals: unknown[] = [];
    const bridge = collectingBridge(proposals);
    const tool = buildTools(c, 7, 'assistant', undefined, undefined, bridge).find(
      (t) => t.name === 'propose_delete_file',
    )!;
    await tool.handler({ driveFileId: 5, summary: '파일 삭제' });
    expect(c.validateAction).toHaveBeenCalledWith(7, 'drive.delete_file', { id: 5 });
    expect(proposals).toHaveLength(1);
  });

  it('사전검증이 실패하면 카드를 등록하지 않고 서버 사유를 그대로 전파한다', async () => {
    const c = client();
    // 인터셉터가 describeApiError 로 채운 서버 사유가 담긴 오류.
    c.validateAction = vi
      .fn()
      .mockRejectedValue(apiError(403, 'API 오류 403: 필요 권한 없음: project:manage'));
    const proposals: unknown[] = [];
    const bridge = collectingBridge(proposals);
    const tool = buildTools(c, 7, 'assistant', undefined, undefined, bridge).find(
      (t) => t.name === 'propose_delete_project',
    )!;
    await expect(tool.handler({ key: 'WP', summary: '프로젝트 삭제' })).rejects.toThrow(
      'project:manage',
    );
    expect(proposals).toHaveLength(0);
  });

  it('응답 없는 전송 실패·5xx 는 일시 장애로 보고 카드 생성을 막지 않는다(fail-open)', async () => {
    const c = client();
    // 네트워크 오류(응답 없음) → 1회차, 서버 500 → 2회차.
    c.validateAction = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockRejectedValueOnce(apiError(500, 'API 오류 500'));
    const proposals: unknown[] = [];
    const bridge = collectingBridge(proposals);
    const tool = buildTools(c, 7, 'assistant', undefined, undefined, bridge).find(
      (t) => t.name === 'propose_delete_file',
    )!;
    await tool.handler({ driveFileId: 1, summary: 'a' });
    await tool.handler({ driveFileId: 2, summary: 'b' });
    expect(proposals).toHaveLength(2);
  });
});
