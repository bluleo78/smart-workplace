import { describe, expect, it, vi } from 'vitest';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { buildTools } from './tools.js';

function client(): WorkplaceApiClient {
  return {
    addIssueComment: vi.fn().mockResolvedValue(undefined),
    updateIssueStatus: vi.fn().mockResolvedValue(undefined),
    getIssueDetail: vi.fn().mockResolvedValue({
      issueKey: 'WP-1',
      title: 't',
      status: 'TODO',
      priority: 'MID',
      assignees: [],
    }),
    unassignSelf: vi.fn().mockResolvedValue(undefined),
    getOAuthToken: vi.fn(),
    getChatMessages: vi.fn().mockResolvedValue([]),
    addChatMessage: vi.fn().mockResolvedValue(undefined),
    postChatProgress: vi.fn().mockResolvedValue(undefined),
    getChannelMessages: vi.fn().mockResolvedValue([]),
    addChannelMessage: vi.fn().mockResolvedValue(undefined),
    postMessagingProgress: vi.fn().mockResolvedValue(undefined),
    listIssueAttachments: vi.fn().mockResolvedValue([]),
    downloadIssueAttachment: vi.fn(),
    searchWikiPages: vi.fn().mockResolvedValue([
      { id: 7, spaceId: 2, spaceName: '팀', title: '릴리스', snippet: '배포', updatedAt: '2026-06-14T00:00:00Z' },
    ]),
    getWikiPage: vi.fn().mockResolvedValue({
      id: 7, spaceId: 2, parentId: null, title: '릴리스', body: '본문', version: 3, updatedAt: '2026-06-14T00:00:00Z',
    }),
  };
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

  it('add_comment → client.addIssueComment(agentId, key, body)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'add_comment')!;
    await t.handler({ issueKey: 'WP-1', body: '안녕' });
    expect(c.addIssueComment).toHaveBeenCalledWith(AGENT_ID, 'WP-1', '안녕');
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

  // --- 6c: 프로필 ---

  it('chat 프로필: 이슈 조회·chat 읽기/쓰기 + 위키 읽기 도구', () => {
    const names = buildTools(client(), AGENT_ID, 'chat').map((t) => t.name).sort();
    expect(names).toEqual([
      'add_chat_message',
      'get_chat_thread',
      'get_issue_detail',
      'get_wiki_page',
      'search_wiki',
    ]);
  });

  it('issue 프로필(기본): 기존 4개 + 위키 읽기 도구', () => {
    const names = buildTools(client(), AGENT_ID, 'issue').map((t) => t.name).sort();
    expect(names).toEqual([
      'add_comment',
      'get_issue_detail',
      'get_wiki_page',
      'search_wiki',
      'unassign_self',
      'update_status',
    ]);
  });

  it('add_chat_message → client.addChatMessage(agentId, threadId, body)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID, 'chat').find((x) => x.name === 'add_chat_message')!;
    await t.handler({ threadId: 5, body: '답변' });
    expect(c.addChatMessage).toHaveBeenCalledWith(AGENT_ID, 5, '답변');
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
});

// #333: assistant 프로파일 — 이슈 + 위키읽기 + home show_* 의 union(M1).
describe('buildTools(assistant)', () => {
  const fakeClient = {} as never;

  const names = buildTools(fakeClient, 1, 'assistant').map((t) => t.name).sort();

  it('기존 이슈 + 위키읽기 + home show_* 의 union 을 노출', () => {
    expect(names).toEqual(
      [
        'add_comment',
        'get_issue_detail',
        'get_wiki_page',
        'search_wiki',
        'show_activity',
        'show_issue_detail',
        'show_issue_list',
        'show_my_tasks',
        'unassign_self',
        'update_status',
      ].sort(),
    );
  });

  it('신규 search_issues 는 포함하지 않는다(M1 기존 도구 경계)', () => {
    expect(names).not.toContain('search_issues');
  });
});

// home 프로필은 4개의 표시 지시 도구만 노출하고 데이터 조회를 하지 않는다.
describe('buildTools home 프로필', () => {
  const fakeClient = {} as never; // home 도구는 client 를 호출하지 않으므로 빈 객체로 충분
  const tools = buildTools(fakeClient, 1, 'home');

  it('show_* 4개 도구만 노출', () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      'show_activity',
      'show_issue_detail',
      'show_issue_list',
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
