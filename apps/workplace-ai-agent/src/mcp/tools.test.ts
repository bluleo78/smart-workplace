import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
    listEvents: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue({}),
    createWikiPage: vi.fn().mockResolvedValue({}),
    updateWikiPage: vi.fn().mockResolvedValue({}),
    listMail: vi.fn().mockResolvedValue([]),
    getMail: vi.fn().mockResolvedValue({}),
    listContacts: vi.fn().mockResolvedValue([]),
    getExternalContact: vi.fn().mockResolvedValue({}),
    createExternalContact: vi.fn().mockResolvedValue({}),
    updateExternalContact: vi.fn().mockResolvedValue({}),
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockResolvedValue({}),
    listProjectMembers: vi.fn().mockResolvedValue([]),
    listMySpaces: vi.fn().mockResolvedValue([]),
    listSpaceItems: vi.fn().mockResolvedValue([]),
    searchDrive: vi.fn().mockResolvedValue([]),
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

  it('신규 search_issues 는 여전히 포함하지 않는다(기존 도구 경계)', () => {
    expect(names).not.toContain('search_issues');
  });

  it('messaging 읽기/쓰기 도구를 노출한다(get_channel_messages / add_channel_message)', () => {
    expect(names).toContain('get_channel_messages');
    expect(names).toContain('add_channel_message');
  });
});

// #333: assistant 프로파일 — 이슈 + 위키읽기 + home show_* + 캘린더 읽기 의 union(M1+M2).
describe('buildTools(assistant)', () => {
  const fakeClient = {} as never;

  const names = buildTools(fakeClient, 1, 'assistant').map((t) => t.name).sort();

  it('신규 search_issues 는 포함하지 않는다(M1 기존 도구 경계)', () => {
    expect(names).not.toContain('search_issues');
  });

  it('list_events 핸들러가 client.listEvents 를 호출한다', async () => {
    const calls: unknown[] = [];
    const fake = { listEvents: async (...a: unknown[]) => { calls.push(a); return []; } } as never;
    const tool = buildTools(fake, 7, 'assistant').find((t) => t.name === 'list_events')!;
    await tool.handler({ from: '2026-06-19T00:00:00Z', to: '2026-06-26T00:00:00Z' });
    expect(calls[0]).toEqual([7, '2026-06-19T00:00:00Z', '2026-06-26T00:00:00Z']);
  });

  it('propose_create_event 는 API 미호출, 사이드카에 제안 객체를 쓰고 ack 반환', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const fake = {} as never; // API 미호출이므로 빈 client
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

  it('propose_send_mail 은 API 미호출, 사이드카에 mail.send 제안(accountId 포함)을 쓰고 ack 반환', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-mail-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const tool = buildTools({} as never, 7, 'assistant').find((t) => t.name === 'propose_send_mail')!;
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
});

// #333 M3: 연락처 도구 — assistant union 멤버십 + propose_delete_contact 사이드카 테스트.
describe('buildTools(assistant) 연락처 도구 (M3)', () => {
  it('assistant union 에 연락처 도구(list/get/create/update + propose_delete_contact) 노출', () => {
    const names = buildTools({} as never, 1, 'assistant').map((t) => t.name);
    for (const n of ['list_contacts', 'get_external_contact', 'create_external_contact', 'update_external_contact', 'propose_delete_contact']) {
      expect(names).toContain(n);
    }
  });

  it('propose_delete_contact 는 API 미호출, 사이드카에 contacts.delete_contact 제안을 쓰고 ack 반환', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-contact-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const tool = buildTools({} as never, 7, 'assistant').find((t) => t.name === 'propose_delete_contact')!;
      await tool.handler({ id: 9, summary: '"김거래" 연락처 삭제' });
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

  it('propose_create_project 는 사이드카에 project.create_project 제안을 쓴다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-proj-'));
    const sidecar = path.join(dir, 'pending-action.json');
    process.env.WORKPLACE_PENDING_ACTION_PATH = sidecar;
    try {
      const tool = buildTools({} as never, 7, 'assistant').find((t) => t.name === 'propose_create_project')!;
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
