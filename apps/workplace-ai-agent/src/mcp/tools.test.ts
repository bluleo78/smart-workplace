// ai-agent MCP 도구 테스트(#846 이후).
// 공유 도구(buildSharedTools)의 핸들러 동작은 packages/mcp-tools-shared 테스트가 담당한다.
// 여기서는 ai-agent 고유 영역만 검증한다: 프로필 구성, 스레드 바인딩 배선, propose_*(사이드카·브리지·사전검증),
// 구성원 해석, ai-agent 전용 도구 핸들러, 그리고 공유 도구를 로컬에서 재정의하지 않았는지(패리티).
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSharedTools, isDisplayableTool, TOOL_LABELS, type SharedToolClient } from '@smart-workplace/mcp-tools-shared';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { z } from 'zod';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { buildTools, type HostBridge, type McpProfile } from './tools.js';

// #842: 서버가 응답한 검증 실패(4xx)를 흉내 낸다 — 인터셉터가 message 를 서버 사유로 채운 AxiosError 형태.
function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { response: { status } });
}

/** SharedToolClient 의 모든 메서드를 vi.fn 으로 채운 목 타입 — 테스트가 c.sc.X 로 꺼내 단언한다. */
type MockedShared = { [K in keyof SharedToolClient]: Mock<SharedToolClient[K]> };

/** 공유 도구용 클라이언트 목. 기본값은 "빈 성공" — 테스트가 필요한 것만 mockResolvedValue 로 덮어쓴다. */
function sharedMock(): MockedShared {
  return {
    // 이슈(IssueToolClient)
    getIssueDetail: vi.fn().mockResolvedValue({}),
    createIssue: vi.fn().mockResolvedValue({}),
    updateIssueContent: vi.fn().mockResolvedValue({}),
    setIssueType: vi.fn().mockResolvedValue(undefined),
    setIssueParent: vi.fn().mockResolvedValue(undefined),
    replaceIssueAssignees: vi.fn().mockResolvedValue({}),
    replaceIssueLabels: vi.fn().mockResolvedValue({}),
    addComment: vi.fn().mockResolvedValue(undefined),
    editComment: vi.fn().mockResolvedValue(undefined),
    addIssueDependency: vi.fn().mockResolvedValue({}),
    removeIssueDependency: vi.fn().mockResolvedValue(undefined),
    replaceIssueCycles: vi.fn().mockResolvedValue([]),
    watchIssue: vi.fn().mockResolvedValue(undefined),
    unwatchIssue: vi.fn().mockResolvedValue(undefined),
    // 프로젝트 메타·목록(ProjectToolClient)
    getProjectTypes: vi.fn().mockResolvedValue([]),
    getProjectMembers: vi.fn().mockResolvedValue([]),
    getMe: vi.fn().mockResolvedValue({ id: 1, username: 'me' }),
    getProjectLabels: vi.fn().mockResolvedValue([]),
    getProjectMilestones: vi.fn().mockResolvedValue([]),
    getProjectCycles: vi.fn().mockResolvedValue([]),
    updateProject: vi.fn().mockResolvedValue({}),
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockResolvedValue({}),
    listIssues: vi.fn().mockResolvedValue([]),
    // 노트
    listWikiSpaces: vi.fn().mockResolvedValue([]),
    searchWikiPages: vi.fn().mockResolvedValue([]),
    getWikiPage: vi.fn().mockResolvedValue({}),
    createWikiPage: vi.fn().mockResolvedValue({}),
    updateWikiPage: vi.fn().mockResolvedValue({}),
    listWikiPages: vi.fn().mockResolvedValue([]),
    getWikiBacklinks: vi.fn().mockResolvedValue([]),
    moveWikiPage: vi.fn().mockResolvedValue(undefined),
    // 캘린더
    listEvents: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue({}),
    rsvpEvent: vi.fn().mockResolvedValue(undefined),
    // 메일
    listMailAccounts: vi.fn().mockResolvedValue([]),
    listMail: vi.fn().mockResolvedValue([]),
    getMail: vi.fn().mockResolvedValue({}),
    getMailSummary: vi.fn().mockResolvedValue({}),
    draftMailReply: vi.fn().mockResolvedValue({}),
    draftIssueFromMail: vi.fn().mockResolvedValue({}),
    getMailLinkedIssue: vi.fn().mockResolvedValue(null),
    promoteMailToIssue: vi.fn().mockResolvedValue({ issueKey: 'WP-1' }),
    markMailRead: vi.fn().mockResolvedValue(undefined),
    // 구성원·연락처
    searchMembers: vi.fn().mockResolvedValue([]),
    getMemberContact: vi.fn().mockResolvedValue({}),
    listContacts: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getExternalContact: vi.fn().mockResolvedValue({}),
    // 연락처 부가 기능(#839)
    getContactFacets: vi.fn().mockResolvedValue({ organizations: [], titles: [] }),
    addContactFavorite: vi.fn().mockResolvedValue(undefined),
    removeContactFavorite: vi.fn().mockResolvedValue(undefined),
    listUserGroups: vi.fn().mockResolvedValue({ shared: [], personal: [] }),
    getUserGroup: vi.fn().mockResolvedValue({ id: 1, name: 'g', visibility: 'PERSONAL' }),
    createUserGroup: vi.fn().mockResolvedValue({ id: 1, name: 'g', visibility: 'PERSONAL' }),
    updateUserGroup: vi.fn().mockResolvedValue({ id: 1, name: 'g', visibility: 'PERSONAL' }),
    addUserGroupMember: vi.fn().mockResolvedValue({ id: 1, name: 'g', visibility: 'PERSONAL' }),
    removeUserGroupMember: vi.fn().mockResolvedValue(undefined),
    // 메시징
    listChannels: vi.fn().mockResolvedValue([]),
    getChannelMessages: vi.fn().mockResolvedValue([]),
    getThreadReplies: vi.fn().mockResolvedValue([]),
    addChannelMessage: vi.fn().mockResolvedValue(undefined),
    getChannel: vi.fn().mockResolvedValue({ id: 1, visibility: 'PUBLIC' }),
    createChannel: vi.fn().mockResolvedValue({}),
    openDm: vi.fn().mockResolvedValue({ id: 1, participants: [] }),
    leaveChannel: vi.fn().mockResolvedValue(undefined),
    // 드라이브
    listDriveSpaces: vi.fn().mockResolvedValue([]),
    listDriveItems: vi.fn().mockResolvedValue({ folders: [], files: [] }),
    searchDrive: vi.fn().mockResolvedValue({ folders: [], files: [] }),
    getDriveFileSummary: vi.fn().mockResolvedValue({}),
    searchDriveContent: vi.fn().mockResolvedValue({ hits: [] }),
    listDriveTrash: vi.fn().mockResolvedValue([]),
    restoreDriveFile: vi.fn().mockResolvedValue(undefined),
    restoreDriveFolder: vi.fn().mockResolvedValue(undefined),
    // 알림
    listNotifications: vi.fn().mockResolvedValue([]),
    countUnreadNotifications: vi.fn().mockResolvedValue(0),
    markNotificationRead: vi.fn().mockResolvedValue(undefined),
    markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
  };
}

type TestClient = WorkplaceApiClient & { sc: MockedShared };

/** ai-agent 클라이언트 목. toolClient() 는 항상 같은 sc 를 돌려주므로 c.sc 로 공유 호출을 단언할 수 있다. */
function client(): TestClient {
  const sc = sharedMock();
  const c: WorkplaceApiClient = {
    toolClient: vi.fn(() => sc),
    // #719: 이 스위트는 도구 핸들러 자체를 검증하므로 테넌트 스코프는 자기 자신을 반환.
    withOnBehalfOfTenant: () => c,
    // #842: 확인카드 사전검증 — propose_* 는 카드 등록 전에 반드시 이 호출을 통과해야 한다.
    validateAction: vi.fn().mockResolvedValue(undefined),
    updateIssueStatus: vi.fn().mockResolvedValue(undefined),
    unassignSelf: vi.fn().mockResolvedValue(undefined),
    getProviderCredential: vi.fn(),
    getChatMessages: vi.fn().mockResolvedValue([]),
    addChatMessage: vi.fn().mockResolvedValue(undefined),
    postChatProgress: vi.fn().mockResolvedValue(undefined),
    postMessagingProgress: vi.fn().mockResolvedValue(undefined),
    discoverChannels: vi.fn().mockResolvedValue([]),
    syncMail: vi.fn().mockResolvedValue({}),
    createExternalContact: vi.fn().mockResolvedValue({} as never),
    updateExternalContact: vi.fn().mockResolvedValue({} as never),
    createFolder: vi.fn().mockResolvedValue({} as never),
    renameFolder: vi.fn().mockResolvedValue({} as never),
    moveFolder: vi.fn().mockResolvedValue(undefined),
    moveFile: vi.fn().mockResolvedValue(undefined),
    proposeCreateIssue: vi.fn().mockResolvedValue(undefined),
    proposeCreateEvent: vi.fn().mockResolvedValue(undefined),
    listDelegationCandidates: vi.fn().mockResolvedValue([]),
    listIssueAttachments: vi.fn().mockResolvedValue([]),
    downloadIssueAttachment: vi.fn(),
  };
  return Object.assign(c, { sc });
}

const AGENT_ID = 201;

function find(tools: ReturnType<typeof buildTools>, name: string) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

/** 제안을 배열에 모으는 브리지 — 카드 생성 여부·params 를 단언하는 데 쓴다. */
function collectingBridge(proposals: { actionType: string; summary: string; params: Record<string, unknown> }[]): HostBridge {
  return { onProposal: (p) => proposals.push(p), onSubmitResponse: () => {}, onUnassignResult: () => {} };
}

/** 사이드카(WORKPLACE_PENDING_ACTION_PATH) 경로를 임시로 세팅하고 본문 실행 후 정리한다. */
async function withSidecar(fn: (sidecar: string) => Promise<void>, envKey = 'WORKPLACE_PENDING_ACTION_PATH') {
  const dir = mkdtempSync(path.join(tmpdir(), 'sidecar-'));
  const sidecar = path.join(dir, 'sidecar.ndjson');
  process.env[envKey] = sidecar;
  try {
    await fn(sidecar);
  } finally {
    delete process.env[envKey];
    rmSync(dir, { recursive: true, force: true });
  }
}
const readLines = (p: string) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// ---------------------------------------------------------------------------
// 프로필 구성(멤버십)
// ---------------------------------------------------------------------------
describe('프로필 구성', () => {
  it('issue 프로필(기본): 이슈 읽기/쓰기 + 위키 읽기 도구', () => {
    const names = buildTools(client(), AGENT_ID).map((t) => t.name).sort();
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

  it('home 프로필: show_* 표시 도구만 노출(#431 show_mail_list 포함)', () => {
    const names = buildTools(client(), AGENT_ID, 'home').map((t) => t.name).sort();
    expect(names).toEqual(['show_activity', 'show_issue_detail', 'show_issue_list', 'show_mail_list', 'show_my_tasks']);
  });

  it('messaging 프로필: 위임 컨텍스트가 없으면 채널 도구 5종만', () => {
    const names = buildTools(client(), AGENT_ID, 'messaging').map((t) => t.name).sort();
    expect(names).toEqual(['add_channel_message', 'discover_channels', 'get_channel_messages', 'get_thread_replies', 'list_channels']);
  });

  it('messaging 프로필 + delegationContext: propose_create_issue/propose_create_event + 참석자 조회용 search_members 추가', () => {
    const names = buildTools(client(), AGENT_ID, 'messaging', undefined, { actorId: 7, channelId: 9 }).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['propose_create_issue', 'propose_create_event', 'search_members']));
    expect(names).toHaveLength(8);
  });

  it('assistant 프로필: 전 앱 도구 union 을 노출한다', () => {
    const names = buildTools(client(), AGENT_ID, 'assistant').map((t) => t.name);
    for (const n of [
      // 이슈
      'get_issue_detail', 'list_issues', 'add_comment', 'edit_comment', 'update_status', 'create_issue', 'update_issue',
      'unassign_self', 'add_issue_dependency', 'remove_issue_dependency',
      // 노트
      'list_wiki_spaces', 'search_wiki', 'get_wiki_page', 'create_wiki_page', 'update_wiki_page',
      'list_wiki_pages', 'get_wiki_backlinks',
      // 캘린더
      'list_events', 'get_event', 'propose_create_event', 'propose_update_event', 'propose_delete_event',
      // 메시징
      'get_channel_messages', 'get_thread_replies', 'add_channel_message', 'list_channels', 'discover_channels',
      // 메일
      'list_mail', 'get_mail', 'propose_send_mail', 'list_mail_accounts', 'sync_mail',
      // 연락처·구성원(#833)
      'list_contacts', 'get_external_contact', 'create_external_contact', 'update_external_contact', 'propose_delete_contact',
      'search_members', 'get_member', 'get_member_contact', 'propose_set_member_role', 'propose_set_member_active',
      // 연락처 부가 기능(#839)
      'get_contact_facets', 'add_contact_favorite', 'remove_contact_favorite', 'list_user_groups', 'get_user_group',
      'create_user_group', 'update_user_group', 'add_user_group_member', 'remove_user_group_member', 'propose_delete_user_group',
      // 프로젝트
      'list_projects', 'get_project', 'list_project_members',
      'propose_create_project', 'propose_delete_project', 'propose_add_project_member',
      // 드라이브
      'list_drive_spaces', 'list_drive_items', 'search_drive', 'get_drive_file_summary', 'search_drive_content',
      // 알림(#850)
      'list_notifications', 'mark_notification_read', 'mark_all_notifications_read',
      'create_folder', 'rename_folder', 'move_folder', 'move_file', 'propose_delete_file', 'propose_delete_folder',
      // #856 확인카드 제안
      'propose_add_attendees', 'propose_remove_attendee', 'propose_update_project_member_role', 'propose_remove_project_member',
      'propose_add_channel_member', 'propose_leave_channel', 'propose_delete_issue', 'propose_delete_comment', 'propose_delete_wiki_page',
      // 위임 답 제출 + 표시 위젯
      'submit_response',
      'show_my_tasks', 'show_issue_list', 'show_issue_detail', 'show_activity', 'show_mail_list',
      'show_calendar', 'show_event', 'show_channels', 'show_wiki', 'show_wiki_page',
      'show_contacts', 'show_contact', 'show_projects', 'show_project', 'show_drive',
    ]) {
      expect(names).toContain(n);
    }
    // 미구현 경계(search_issues)·제거된 도구(respond_chat, #463)는 없어야 한다.
    expect(names).not.toContain('search_issues');
    expect(names).not.toContain('respond_chat');
  });

  it('home 표시 도구는 {displayed:true} 만 반환한다(데이터 조회 X)', async () => {
    for (const t of buildTools(client(), AGENT_ID, 'home')) {
      expect(JSON.parse(await t.handler({}))).toEqual({ displayed: true });
    }
  });

  it('show_issue_list 는 params/layout 입력 스키마를 통과시킨다', () => {
    const t = find(buildTools(client(), AGENT_ID, 'home'), 'show_issue_list');
    expect(() =>
      t.inputSchema.parse({ params: { status: 'IN_PROGRESS', priority: ['HIGH'], assignee: 'me' }, layout: { page: 'current' } }),
    ).not.toThrow();
  });

  it('#469 show_mail_list 가 params.unreadOnly 를 허용한다', () => {
    const t = find(buildTools(client(), AGENT_ID, 'assistant'), 'show_mail_list');
    const parsed = t.inputSchema.parse({ params: { folder: 'INBOX', unreadOnly: true } }) as { params: { unreadOnly?: boolean } };
    expect(parsed.params.unreadOnly).toBe(true);
  });

  it('buildTools 는 해당 agentId 로 toolClient 를 얻는다(에이전트 신원 바인딩)', () => {
    const c = client();
    buildTools(c, AGENT_ID, 'assistant');
    expect(c.toolClient).toHaveBeenCalledWith(AGENT_ID);
  });
});

// ---------------------------------------------------------------------------
// 공유 도구 패리티(#846) — 로컬 재정의 방지
// ---------------------------------------------------------------------------
describe('공유 도구 패리티 (#846)', () => {
  const bridge: HostBridge = { onProposal: () => {}, onSubmitResponse: () => {}, onUnassignResult: () => {} };
  const variants: { label: string; build: (c: TestClient) => ReturnType<typeof buildTools> }[] = [
    ...(['issue', 'chat', 'home', 'messaging', 'assistant'] as McpProfile[]).map((p) => ({
      label: p,
      build: (c: TestClient) => buildTools(c, AGENT_ID, p),
    })),
    { label: 'messaging+threadBinding', build: (c) => buildTools(c, AGENT_ID, 'messaging', { channelId: 9, parentMessageId: 1 }) },
    {
      label: 'messaging+delegationContext',
      build: (c) => buildTools(c, AGENT_ID, 'messaging', undefined, { actorId: 7, channelId: 9, parentMessageId: 1 }),
    },
    { label: 'assistant+hostBridge', build: (c) => buildTools(c, AGENT_ID, 'assistant', undefined, undefined, bridge) },
  ];

  for (const v of variants) {
    it(`${v.label}: 공유 도구와 같은 이름의 도구는 입력 스키마가 공유본과 같고, 모든 inputSchema 는 ZodObject 다`, () => {
      const c = client();
      const shared = new Map(buildSharedTools(c.sc).map((t) => [t.name, t]));
      const tools = v.build(c);
      // 같은 프로필 안에서 이름 중복이 있으면 SDK 가 하나를 조용히 덮는다.
      expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
      for (const t of tools) {
        // 서버 레이어(sdk-mcp-server·stdio-entry)가 inputSchema.shape 를 쓰므로 반드시 ZodObject 여야 한다.
        expect(t.inputSchema, t.name).toBeInstanceOf(z.ZodObject);
        const s = shared.get(t.name);
        if (s) expect(z.toJSONSchema(t.inputSchema), t.name).toEqual(z.toJSONSchema(s.inputSchema));
      }
    });
  }

  // 공유 패키지에 도구를 추가하고 ai-agent 에 연결하지 않으면 AI Chat 에서 조용히 못 쓰는 도구가 된다(#850).
  it('assistant 프로필은 공유 도구를 전부 노출한다', () => {
    const c = client();
    const names = new Set(buildTools(c, AGENT_ID, 'assistant').map((t) => t.name));
    const missing = buildSharedTools(c.sc).map((t) => t.name).filter((n) => !names.has(n));
    expect(missing).toEqual([]);
  });

  // 알림 API 는 호출자 본인 알림만 돌려준다. 에이전트 신원으로 도는 프로필에 두면 사람이 아닌 에이전트의 알림을 답하게 된다(#850).
  it('에이전트 신원 프로필(issue·chat·messaging)에는 알림 도구가 없다', () => {
    for (const p of ['issue', 'chat', 'messaging'] as McpProfile[]) {
      const names = buildTools(client(), AGENT_ID, p, undefined, { actorId: 7, channelId: 9 }).map((t) => t.name);
      expect(names.filter((n) => n.includes('notification')), p).toEqual([]);
    }
  });

  it('list_issues 설명은 show_issue_list 안내를 앞에 붙이고 공유본 설명으로 끝난다', () => {
    const c = client();
    const sharedDesc = buildSharedTools(c.sc).find((t) => t.name === 'list_issues')!.description;
    const desc = find(buildTools(c, AGENT_ID, 'assistant'), 'list_issues').description;
    expect(desc).toContain('show_issue_list');
    expect(desc.endsWith(sharedDesc)).toBe(true);
    expect(desc).not.toBe(sharedDesc);
  });
});

// ---------------------------------------------------------------------------
// 도구 표시 라벨(#879)
// ---------------------------------------------------------------------------
describe('도구 표시 라벨 (#879)', () => {
  // 모든 프로필 × 선택 인자 전부를 채워 조건부 도구까지 포함한 전체 도구 이름 + 공유 도구 전부(workplace-mcp 전용 포함).
  const c = client();
  const bridge: HostBridge = { onProposal: () => {}, onSubmitResponse: () => {}, onUnassignResult: () => {} };
  const allNames = new Set(buildSharedTools(c.sc).map((t) => t.name));
  for (const p of ['issue', 'chat', 'home', 'messaging', 'assistant'] as McpProfile[]) {
    const tools = buildTools(c, AGENT_ID, p, { channelId: 9, parentMessageId: 1 }, { actorId: 7, channelId: 9, parentMessageId: 1 }, bridge);
    for (const t of tools) allNames.add(t.name);
  }

  // 라벨이 없으면 AI 채팅에 원래 도구 이름(update_issue 등)이 영어로 그대로 노출된다. 표시 규칙은 웹과 같은 공유 정의.
  it('표시되는 도구 전부에 라벨이 있다', () => {
    const missing = [...allNames].filter((n) => isDisplayableTool(n) && !TOOL_LABELS[n]);
    expect(missing).toEqual([]);
  });

  // 도구 이름 변경·삭제 후 라벨이 남으면 새 이름은 라벨 없이 노출된다 — 죽은 키로 드러나게 한다.
  it('실존하지 않거나 숨김인 도구의 라벨이 없다', () => {
    const stale = Object.keys(TOOL_LABELS).filter((k) => !allNames.has(k) || !isDisplayableTool(k));
    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ai-agent 전용 이슈 도구
// ---------------------------------------------------------------------------
describe('update_status / unassign_self', () => {
  it('update_status → client.updateIssueStatus(agentId, key, status)', async () => {
    const c = client();
    expect(await find(buildTools(c, AGENT_ID), 'update_status').handler({ issueKey: 'WP-1', status: 'DONE' })).toBe('ok');
    expect(c.updateIssueStatus).toHaveBeenCalledWith(AGENT_ID, 'WP-1', 'DONE');
  });

  it('update_status — 잘못된 status 는 zod reject', async () => {
    const c = client();
    await expect(find(buildTools(c, AGENT_ID), 'update_status').handler({ issueKey: 'WP-1', status: 'WRONG' })).rejects.toThrow();
    expect(c.updateIssueStatus).not.toHaveBeenCalled();
  });

  it('unassign_self → client.unassignSelf(agentId, key)', async () => {
    const c = client();
    expect(await find(buildTools(c, AGENT_ID), 'unassign_self').handler({ issueKey: 'WP-1' })).toBe('ok');
    expect(c.unassignSelf).toHaveBeenCalledWith(AGENT_ID, 'WP-1');
  });

  it('unassign_self 실패(브리지 없음) → 고정 안내 문구 + 에러 사이드카 기록(#378)', async () => {
    const c = client();
    vi.mocked(c.unassignSelf).mockRejectedValue(new Error('status code 405'));
    await withSidecar(async (sidecar) => {
      const out = await find(buildTools(c, AGENT_ID), 'unassign_self').handler({ issueKey: 'WP-1' });
      expect(out).toContain('담당자 해제 요청을 처리하지 못했습니다');
      expect(out).not.toContain('405'); // raw HTTP 오류는 사용자 문구에 노출하지 않는다
      const written = JSON.parse(readFileSync(sidecar, 'utf8'));
      expect(written.error).toContain('405');
      expect(written.canonical).toBe(out);
    }, 'WORKPLACE_UNASSIGN_ERROR_PATH');
  });
});

// ---------------------------------------------------------------------------
// chat 프로필
// ---------------------------------------------------------------------------
describe('chat 도구', () => {
  it('add_chat_message → client.addChatMessage(agentId, threadId, body)', async () => {
    const c = client();
    await find(buildTools(c, AGENT_ID, 'chat'), 'add_chat_message').handler({ threadId: 5, body: '답변' });
    expect(c.addChatMessage).toHaveBeenCalledWith(AGENT_ID, 5, '답변');
  });

  // #433: 같은 run(같은 buildTools 인스턴스) 안에서 2번째 호출은 API 를 부르지 않는다.
  it('add_chat_message 2번째 호출 → API 미호출 + 차단 메시지 반환', async () => {
    const c = client();
    const t = find(buildTools(c, AGENT_ID, 'chat'), 'add_chat_message');
    expect(await t.handler({ threadId: 5, body: '첫 답변' })).toBe('ok');
    expect(await t.handler({ threadId: 5, body: '두 번째 답변' })).toContain('이미');
    expect(c.addChatMessage).toHaveBeenCalledTimes(1);
  });

  it('get_chat_thread → client.getChatMessages(agentId, threadId, 50)', async () => {
    const c = client();
    vi.mocked(c.getChatMessages).mockResolvedValue([
      { id: 1, authorName: 'A', authorKind: 'HUMAN', body: 'hi', createdAt: 't', deleted: false },
    ]);
    const out = await find(buildTools(c, AGENT_ID, 'chat'), 'get_chat_thread').handler({ threadId: 5 });
    expect(c.getChatMessages).toHaveBeenCalledWith(AGENT_ID, 5, 50);
    expect(out).toContain('hi');
  });
});

// ---------------------------------------------------------------------------
// 메시징: 스레드 바인딩 배선 + 채널 탐색
// ---------------------------------------------------------------------------
describe('threadBinding — add_channel_message 스레드 mirror', () => {
  it('바인딩 채널이면 sc.addChannelMessage 3번째 인자로 parentMessageId 를 넘긴다', async () => {
    const c = client();
    await find(buildTools(c, 2, 'messaging', { channelId: 9, parentMessageId: 210 }), 'add_channel_message').handler({
      channelId: 9,
      body: '답',
    });
    expect(c.sc.addChannelMessage).toHaveBeenCalledWith(9, '답', 210);
  });

  it('다른 채널이면 parentMessageId 없이(인라인) 넘긴다', async () => {
    const c = client();
    await find(buildTools(c, 2, 'messaging', { channelId: 9, parentMessageId: 210 }), 'add_channel_message').handler({
      channelId: 5,
      body: '딴채널',
    });
    expect(c.sc.addChannelMessage).toHaveBeenCalledWith(5, '딴채널', undefined);
  });

  it('바인딩이 없으면 항상 인라인이다', async () => {
    const c = client();
    await find(buildTools(c, 2, 'messaging'), 'add_channel_message').handler({ channelId: 9, body: '답' });
    expect(c.sc.addChannelMessage).toHaveBeenCalledWith(9, '답', undefined);
  });
});

describe('discover_channels (#350)', () => {
  it('client.discoverChannels(agentId, q) 결과를 JSON 으로 반환한다', async () => {
    const c = client();
    vi.mocked(c.discoverChannels).mockResolvedValue([{ id: 3, name: '공지', kind: 'PUBLIC' }] as never);
    const out = await find(buildTools(c, AGENT_ID, 'messaging'), 'discover_channels').handler({ q: '공지' });
    expect(c.discoverChannels).toHaveBeenCalledWith(AGENT_ID, '공지');
    expect(JSON.parse(out)).toEqual([{ id: 3, name: '공지', kind: 'PUBLIC' }]);
  });
});

// ---------------------------------------------------------------------------
// messaging 위임(L3) — propose_create_issue / propose_create_event
// ---------------------------------------------------------------------------
describe('messaging 위임 — propose_create_issue', () => {
  it('delegationContext 의 위임자/채널/parent 와 projectKey 를 스탬프하고 add_channel_message 는 호출하지 않는다', async () => {
    const c = client();
    const t = find(buildTools(c, 2, 'messaging', undefined, { actorId: 7, channelId: 9, parentMessageId: 100 }), 'propose_create_issue');
    const out = await t.handler({ title: '로그인 버그', body: '상세', priority: 'HIGH', projectKey: 'DESIGN' });
    expect(c.proposeCreateIssue).toHaveBeenCalledWith(2, 9, {
      title: '로그인 버그',
      body: '상세',
      priority: 'HIGH',
      proposedByUserId: 7,
      parentMessageId: 100,
      projectKey: 'DESIGN',
    });
    expect(c.sc.addChannelMessage).not.toHaveBeenCalled();
    expect(out).toBe('제안 카드를 올렸습니다. 위임자의 승인을 기다립니다.');
  });

  it('성공 후 재호출은 차단된다(guard)', async () => {
    const c = client();
    const t = find(buildTools(c, 2, 'messaging', undefined, { actorId: 7, channelId: 9 }), 'propose_create_issue');
    await t.handler({ title: 'A' });
    expect(await t.handler({ title: 'A' })).toContain('이미');
    expect(c.proposeCreateIssue).toHaveBeenCalledTimes(1);
  });

  it('첫 호출 실패 시 오류 문자열 반환 + guard 미설정 — 재시도 시 client 재호출', async () => {
    const c = client();
    vi.mocked(c.proposeCreateIssue).mockRejectedValueOnce(new Error('서버 500')).mockResolvedValueOnce(undefined);
    const t = find(buildTools(c, 3, 'messaging', undefined, { actorId: 5, channelId: 11 }), 'propose_create_issue');
    const first = await t.handler({ title: '버그 보고', priority: 'HIGH' });
    expect(first).toContain('실패');
    expect(first).toContain('서버 500');
    expect(await t.handler({ title: '버그 보고', priority: 'HIGH' })).toBe('제안 카드를 올렸습니다. 위임자의 승인을 기다립니다.');
    expect(c.proposeCreateIssue).toHaveBeenCalledTimes(2);
  });
});

describe('messaging 위임 — propose_create_event', () => {
  const args = { title: '스프린트 리뷰', summary: '7/5 리뷰', startsAt: '2026-07-05T14:00:00+09:00', endsAt: '2026-07-05T15:00:00+09:00' };

  it('위임자/채널을 스탬프해 client.proposeCreateEvent 를 호출한다', async () => {
    const c = client();
    const t = find(buildTools(c, 42, 'messaging', undefined, { actorId: 7, channelId: 9 }), 'propose_create_event');
    expect(await t.handler(args)).toContain('일정 제안 카드를 올렸습니다');
    expect(c.proposeCreateEvent).toHaveBeenCalledWith(
      42,
      9,
      expect.objectContaining({ title: '스프린트 리뷰', startsAt: args.startsAt, endsAt: args.endsAt, proposedByUserId: 7 }),
    );
  });

  it('#852: attendees(username) 를 attendeeUserIds 로 해석해 넘기고, 확정 못 하면 카드를 만들지 않는다', async () => {
    const c = client();
    c.sc.searchMembers.mockImplementation(async ({ search }: { search?: string }) =>
      search === 'minsu' ? [{ userId: 5, username: 'minsu', name: '김민수', active: true }] : [],
    );
    const t = find(buildTools(c, 42, 'messaging', undefined, { actorId: 7, channelId: 9 }), 'propose_create_event');
    expect(await t.handler({ ...args, attendees: ['ghost'] })).toContain('찾을 수 없는 username: ghost');
    expect(c.proposeCreateEvent).not.toHaveBeenCalled();
    await t.handler({ ...args, attendees: ['minsu'] });
    expect(c.proposeCreateEvent).toHaveBeenCalledWith(42, 9, expect.objectContaining({ attendeeUserIds: [5] }));
  });

  it('#852: 위임자 본인은 참석자에서 뺀다(서버가 주최자로 자동 포함)', async () => {
    const c = client();
    c.sc.searchMembers.mockImplementation(async ({ search }: { search?: string }) =>
      search === 'me' ? [{ userId: 7, username: 'me', name: '나', active: true }] : [],
    );
    const t = find(buildTools(c, 42, 'messaging', undefined, { actorId: 7, channelId: 9 }), 'propose_create_event');
    await t.handler({ ...args, attendees: ['me'] });
    expect(c.proposeCreateEvent).toHaveBeenCalledWith(42, 9, expect.objectContaining({ attendeeUserIds: undefined }));
  });

  // #846 회귀: 충돌 조회 헬퍼가 messaging 분기 뒤에 선언돼 TDZ 로 조용히 실패(fail-open)하던 문제.
  it('겹치는 기존 일정을 sc.listEvents 로 조회해 conflicts 로 넘긴다(#395)', async () => {
    const c = client();
    vi.mocked(c.sc.listEvents).mockResolvedValue([
      { id: 5, title: '주간회의', startsAt: '2026-07-05T14:30:00+09:00', endsAt: '2026-07-05T15:30:00+09:00', location: 'x' },
    ]);
    const t = find(buildTools(c, 42, 'messaging', undefined, { actorId: 7, channelId: 9 }), 'propose_create_event');
    await t.handler(args);
    expect(c.sc.listEvents).toHaveBeenCalledWith(args.startsAt, args.endsAt);
    expect(c.proposeCreateEvent).toHaveBeenCalledWith(
      42,
      9,
      expect.objectContaining({
        conflicts: [{ id: 5, title: '주간회의', startsAt: '2026-07-05T14:30:00+09:00', endsAt: '2026-07-05T15:30:00+09:00' }],
      }),
    );
  });

  it('naive datetime 은 +09:00 으로 보정해 넘긴다(#394)', async () => {
    const c = client();
    const t = find(buildTools(c, 42, 'messaging', undefined, { actorId: 7, channelId: 9 }), 'propose_create_event');
    await t.handler({ ...args, startsAt: '2026-07-05T14:00:00', endsAt: '2026-07-05T15:00:00' });
    expect(c.proposeCreateEvent).toHaveBeenCalledWith(
      42,
      9,
      expect.objectContaining({ startsAt: '2026-07-05T14:00:00+09:00', endsAt: '2026-07-05T15:00:00+09:00' }),
    );
  });

  // #848: 서버가 위임자 권한으로 사전검증해 카드를 거절하면, 그 사유가 툴 결과로 AI 에게 전달되고 재시도가 막히지 않아야 한다.
  it('서버 사전검증 거절(403) 사유를 툴 결과로 돌려주고 재시도를 허용한다 (#848)', async () => {
    const c = client();
    vi.mocked(c.proposeCreateEvent)
      .mockRejectedValueOnce(apiError(403, '필요 권한 없음: calendar:write'))
      .mockResolvedValueOnce(undefined);
    const t = find(buildTools(c, 42, 'messaging', undefined, { actorId: 7, channelId: 9 }), 'propose_create_event');
    await expect(t.handler(args)).resolves.toContain('필요 권한 없음: calendar:write');
    await expect(t.handler(args)).resolves.toContain('일정 제안 카드를 올렸습니다');
    expect(c.proposeCreateEvent).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// propose_* (assistant) — 사이드카·브리지·매핑
// ---------------------------------------------------------------------------
describe('propose_create_event (assistant)', () => {
  const base = { title: '팀 미팅', startsAt: '2026-06-26T01:00:00Z', endsAt: '2026-06-26T02:00:00Z', allDay: false, summary: '6/26 10시 팀 미팅(1시간)' };

  it('실행하지 않고 사이드카에 제안 객체를 쓰고 ack 반환', async () => {
    await withSidecar(async (sidecar) => {
      const ack = await find(buildTools(client(), 7, 'assistant'), 'propose_create_event').handler(base);
      expect(typeof ack).toBe('string');
      const [w] = readLines(sidecar);
      expect(w.actionType).toBe('calendar.create_event');
      expect(w.summary).toBe(base.summary);
      expect(w.params).toMatchObject({ title: '팀 미팅', endsAt: '2026-06-26T02:00:00Z' });
      expect(w.params).not.toHaveProperty('summary');
    });
  });

  // #395: 충돌은 핸들러가 sc.listEvents 로 결정적으로 조회해 제안에 embed 한다.
  it('겹치는 기존 일정이 있으면 conflicts 를 params 에 담고 summary 에 경고를 덧붙인다 (#395)', async () => {
    const c = client();
    c.sc.listEvents.mockResolvedValue([
      { id: 11, title: '기존 회의', description: null, startsAt: '2026-06-26T01:30:00Z', endsAt: '2026-06-26T02:30:00Z', allDay: false },
    ]);
    await withSidecar(async (sidecar) => {
      await find(buildTools(c, 7, 'assistant'), 'propose_create_event').handler(base);
      expect(c.sc.listEvents).toHaveBeenCalledWith('2026-06-26T01:00:00Z', '2026-06-26T02:00:00Z');
      const [w] = readLines(sidecar);
      expect(w.params.conflicts).toEqual([
        { id: 11, title: '기존 회의', startsAt: '2026-06-26T01:30:00Z', endsAt: '2026-06-26T02:30:00Z' },
      ]);
      expect(w.summary).toContain(base.summary);
      expect(w.summary).toContain('[충돌]');
      expect(w.summary).toContain('기존 회의');
    });
  });

  it('겹치는 일정이 없으면 conflicts 없이 동작한다 (#395)', async () => {
    await withSidecar(async (sidecar) => {
      await find(buildTools(client(), 7, 'assistant'), 'propose_create_event').handler(base);
      const [w] = readLines(sidecar);
      expect(w.summary).toBe(base.summary);
      expect(w.params.conflicts).toBeUndefined();
    });
  });

  it('listEvents 실패 시 fail-open: 충돌 없이 제안을 정상 진행한다 (#395)', async () => {
    const c = client();
    c.sc.listEvents.mockRejectedValue(new Error('network'));
    await withSidecar(async (sidecar) => {
      await find(buildTools(c, 7, 'assistant'), 'propose_create_event').handler(base);
      const [w] = readLines(sidecar);
      expect(w.actionType).toBe('calendar.create_event');
      expect(w.params.conflicts).toBeUndefined();
    });
  });

  // #852: 서버는 attendeeUserIds 만 읽는다 — username 을 id 로 해석해 싣고, 카드(summary)에 확정된 이름을 붙인다.
  it('#852: attendees(username) 를 attendeeUserIds 로 해석하고 summary 에 참석자를 덧붙인다', async () => {
    const c = client();
    c.sc.searchMembers.mockImplementation(async ({ search }: { search?: string }) =>
      [
        { userId: 5, username: 'minsu', name: '김민수', active: true },
        { userId: 6, username: 'jiyoung', name: '이지영', active: true },
      ].filter((m) => m.username === search),
    );
    await withSidecar(async (sidecar) => {
      await find(buildTools(c, 7, 'assistant'), 'propose_create_event').handler({ ...base, attendees: ['minsu', 'jiyoung', 'minsu'] });
      const [w] = readLines(sidecar);
      expect(w.params.attendeeUserIds).toEqual([5, 6]);
      expect(w.params).not.toHaveProperty('attendees');
      expect(w.summary).toBe(`${base.summary}\n참석자: 김민수(minsu), 이지영(jiyoung)`);
    });
  });

  it('#852: 찾을 수 없거나 비활성인 참석자는 한 번에 모아 오류로 돌려주고 제안을 만들지 않는다', async () => {
    const c = client();
    c.sc.searchMembers.mockImplementation(async ({ search }: { search?: string }) =>
      search === 'retired' ? [{ userId: 9, username: 'retired', name: '퇴사자', active: false }] : [],
    );
    await withSidecar(async (sidecar) => {
      const out = await find(buildTools(c, 7, 'assistant'), 'propose_create_event').handler({
        ...base,
        attendees: ['kim@example.com', 'retired'],
      });
      expect(out).toContain('찾을 수 없는 username: kim@example.com');
      expect(out).toContain('비활성 계정: retired');
      expect(existsSync(sidecar) ? readLines(sidecar) : []).toHaveLength(0);
    });
  });

  it('#394: naive datetime 에 +09:00 이 보정되고, 오프셋이 있으면 그대로 둔다', async () => {
    await withSidecar(async (sidecar) => {
      const t = find(buildTools(client(), 7, 'assistant'), 'propose_create_event');
      await t.handler({ ...base, startsAt: '2026-06-19T15:00:00', endsAt: '2026-06-19T15:30:00' });
      await t.handler(base);
      const [naive, zoned] = readLines(sidecar);
      expect(naive.params.startsAt).toBe('2026-06-19T15:00:00+09:00');
      expect(naive.params.endsAt).toBe('2026-06-19T15:30:00+09:00');
      expect(zoned.params.startsAt).toBe('2026-06-26T01:00:00Z');
    });
  });
});

describe('propose_update_event / propose_delete_event — eventId → params.id 매핑 (#846)', () => {
  it('propose_update_event 는 eventId 를 실행기 params.id 로 옮겨 사이드카에 쓴다', async () => {
    await withSidecar(async (sidecar) => {
      const ack = await find(buildTools(client(), 7, 'assistant'), 'propose_update_event').handler({
        eventId: 42, title: '팀 미팅 (변경)', startsAt: '2026-07-01T01:00:00Z', endsAt: '2026-07-01T02:00:00Z',
        scope: 'THIS', summary: '#42 팀 미팅 제목 변경',
      });
      expect(typeof ack).toBe('string');
      const [w] = readLines(sidecar);
      expect(w.actionType).toBe('calendar.update_event');
      expect(w.summary).toBe('#42 팀 미팅 제목 변경');
      expect(w.params).toMatchObject({ id: 42, title: '팀 미팅 (변경)', scope: 'THIS' });
      expect(w.params).not.toHaveProperty('eventId');
      expect(w.params.attendees).toBeUndefined();
    });
  });

  // #852: 서버 수정은 참석자를 바꾸지 않으므로 스키마에서 뺐다 — 들어와도 params 에 싣지 않는다(승인해도 반영 안 되는 거짓 약속 방지).
  it('#852: propose_update_event 는 attendees 를 params 에 싣지 않는다', async () => {
    await withSidecar(async (sidecar) => {
      await find(buildTools(client(), 7, 'assistant'), 'propose_update_event').handler({
        eventId: 77, title: '팀 회의', startsAt: '2026-07-01T10:00:00+09:00', endsAt: '2026-07-01T11:00:00+09:00',
        summary: '팀 회의 시간 변경', attendees: ['minsu'],
      });
      const [w] = readLines(sidecar);
      expect(w.params).not.toHaveProperty('attendees');
      expect(w.params.scope).toBe('ALL'); // 기본값
    });
  });

  it('propose_delete_event 는 eventId 를 params.id 로 옮긴다', async () => {
    await withSidecar(async (sidecar) => {
      await find(buildTools(client(), 7, 'assistant'), 'propose_delete_event').handler({ eventId: 55, scope: 'ALL', summary: '#55 삭제' });
      const [w] = readLines(sidecar);
      expect(w.actionType).toBe('calendar.delete_event');
      expect(w.params).toEqual({ id: 55, scope: 'ALL' });
    });
  });

  it('옛 파라미터 id 는 스키마가 거부한다(eventId 필수)', async () => {
    const c = client();
    const tools = buildTools(c, 7, 'assistant');
    await expect(find(tools, 'propose_delete_event').handler({ id: 55, summary: 's' })).rejects.toThrow();
    await expect(
      find(tools, 'propose_update_event').handler({ id: 42, title: 't', startsAt: 'a', endsAt: 'b', summary: 's' }),
    ).rejects.toThrow();
    expect(c.validateAction).not.toHaveBeenCalled();
  });

  it('존재하지 않는 일정은 서버 사전검증 사유로 실패하고 카드를 만들지 않는다 (#397/#842)', async () => {
    const c = client();
    vi.mocked(c.validateAction).mockRejectedValue(apiError(404, 'API 오류 404: 일정을 찾을 수 없습니다'));
    await withSidecar(async (sidecar) => {
      await expect(
        find(buildTools(c, 7, 'assistant'), 'propose_update_event').handler({
          eventId: 9999, title: '변경', startsAt: '2026-07-01T01:00:00Z', endsAt: '2026-07-01T02:00:00Z', summary: 's',
        }),
      ).rejects.toThrow('일정을 찾을 수 없습니다');
      expect(c.validateAction).toHaveBeenCalledWith(7, 'calendar.update_event', expect.objectContaining({ id: 9999 }));
      expect(() => readFileSync(sidecar, 'utf8')).toThrow(); // 사이드카 미생성
    });
  });
});

describe('propose_send_mail / propose_delete_contact / 드라이브 삭제 제안', () => {
  it('propose_send_mail 은 mail.send 제안(accountId 포함)을 사이드카에 쓴다', async () => {
    await withSidecar(async (sidecar) => {
      await find(buildTools(client(), 7, 'assistant'), 'propose_send_mail').handler({
        accountId: 5, to: ['a@x.com'], subject: '안녕하세요', bodyText: '본문입니다', summary: 'a@x.com 에게 발송',
      });
      const [w] = readLines(sidecar);
      expect(w.actionType).toBe('mail.send');
      expect(w.params).toMatchObject({ accountId: 5, to: ['a@x.com'], subject: '안녕하세요' });
    });
  });

  it('propose_delete_contact 는 externalId 를 실행기 params.id 로 매핑한다(#833)', async () => {
    await withSidecar(async (sidecar) => {
      await find(buildTools(client(), 7, 'assistant'), 'propose_delete_contact').handler({ externalId: 9, summary: '삭제' });
      const [w] = readLines(sidecar);
      expect(w.actionType).toBe('contacts.delete_contact');
      expect(w.params).toEqual({ id: 9 });
    });
  });

  it('propose_delete_user_group 은 groupId 를 실행기 params.id 로 매핑한다(#839)', async () => {
    await withSidecar(async (sidecar) => {
      await find(buildTools(client(), 7, 'assistant'), 'propose_delete_user_group').handler({ groupId: 12, summary: '영업팀 그룹 삭제' });
      const [w] = readLines(sidecar);
      expect(w.actionType).toBe('contacts.delete_user_group');
      expect(w.params).toEqual({ id: 12 });
    });
  });

  it('propose_delete_file 은 driveFileId 를 params.id 로 매핑한다(#840)', async () => {
    await withSidecar(async (sidecar) => {
      await find(buildTools(client(), 7, 'assistant'), 'propose_delete_file').handler({ driveFileId: 99, summary: '보고서.pdf 삭제' });
      const [w] = readLines(sidecar);
      expect(w.actionType).toBe('drive.delete_file');
      expect(w.params).toEqual({ id: 99 });
    });
  });

  it('propose_delete_folder 는 folderId 를 params.id 로 매핑한다(#840)', async () => {
    await withSidecar(async (sidecar) => {
      await find(buildTools(client(), 7, 'assistant'), 'propose_delete_folder').handler({ folderId: 3, summary: '폴더 삭제' });
      const [w] = readLines(sidecar);
      expect(w.actionType).toBe('drive.delete_folder');
      expect(w.params).toEqual({ id: 3 });
    });
  });

  // #351: 한 턴에 여러 제안을 NDJSON 으로 누적한다.
  it('두 번 propose 하면 NDJSON 두 줄이 쌓인다 (#351)', async () => {
    await withSidecar(async (sidecar) => {
      const del = find(buildTools(client(), 1, 'assistant'), 'propose_delete_file');
      await del.handler({ driveFileId: 1, summary: '파일 A 삭제' });
      await del.handler({ driveFileId: 2, summary: '파일 B 삭제' });
      const lines = readLines(sidecar);
      expect(lines.map((l) => l.params.id)).toEqual([1, 2]);
    });
  });

  it('사이드카 경로도 브리지도 없으면 제안을 등록하지 못했다고 알린다', async () => {
    const out = await find(buildTools(client(), 1, 'assistant'), 'propose_delete_file').handler({ driveFileId: 1, summary: 's' });
    expect(out).toContain('등록하지 못했습니다');
  });
});

describe('프로젝트 제안 — projectKey → params.key 매핑 (#846)', () => {
  it('propose_create_project 는 projectKey 를 params.key 로 옮긴다', async () => {
    const proposals: Parameters<HostBridge['onProposal']>[0][] = [];
    const c = client();
    await find(buildTools(c, 7, 'assistant', undefined, undefined, collectingBridge(proposals)), 'propose_create_project').handler({
      projectKey: 'NEW', name: '새 프로젝트', summary: '"새 프로젝트"(NEW) 생성',
    });
    expect(proposals[0].actionType).toBe('project.create_project');
    expect(proposals[0].params).toEqual({ key: 'NEW', name: '새 프로젝트' });
    expect(c.validateAction).toHaveBeenCalledWith(7, 'project.create_project', { key: 'NEW', name: '새 프로젝트' });
  });

  it('propose_delete_project 는 projectKey 를 params.key 로 옮긴다', async () => {
    const proposals: Parameters<HostBridge['onProposal']>[0][] = [];
    await find(buildTools(client(), 7, 'assistant', undefined, undefined, collectingBridge(proposals)), 'propose_delete_project').handler({
      projectKey: 'WP', summary: '삭제',
    });
    expect(proposals[0]).toMatchObject({ actionType: 'project.delete_project', params: { key: 'WP' } });
  });

  it('옛 파라미터 key 는 스키마가 거부한다(projectKey 필수)', async () => {
    const tools = buildTools(client(), 7, 'assistant');
    await expect(find(tools, 'propose_create_project').handler({ key: 'NEW', name: 'n', summary: 's' })).rejects.toThrow();
    await expect(find(tools, 'propose_delete_project').handler({ key: 'WP', summary: 's' })).rejects.toThrow();
    await expect(
      find(tools, 'propose_add_project_member').handler({ key: 'WP', username: 'u', role: 'MEMBER', summary: 's' }),
    ).rejects.toThrow();
    await expect(find(tools, 'list_project_members').handler({ key: 'WP' })).rejects.toThrow();
  });
});

describe('list_project_members (#846)', () => {
  it('userId 없이 username·name·role 만 반환한다', async () => {
    const c = client();
    c.sc.getProjectMembers.mockResolvedValue([
      { userId: 5, username: 'minsu', name: '김민수', role: 'OWNER' } as never,
    ]);
    const out = JSON.parse(await find(buildTools(c, 7, 'assistant'), 'list_project_members').handler({ projectKey: 'WP' }));
    expect(c.sc.getProjectMembers).toHaveBeenCalledWith('WP');
    expect(out).toEqual([{ username: 'minsu', name: '김민수', role: 'OWNER' }]);
  });
});

// ---------------------------------------------------------------------------
// #833 구성원 해석(sc.searchMembers) — 구성원 쓰기 제안
// ---------------------------------------------------------------------------
describe('#833 구성원 해석이 쓰이는 제안', () => {
  const member = (o: Partial<{ userId: number; username: string; name: string; kind: string; active: boolean }>) => ({
    userId: 5, username: 'minsu', name: '김민수', kind: 'HUMAN', active: true, ...o,
  });

  describe('propose_add_project_member', () => {
    it('구성원이 아니면 제안을 만들지 않고 오류를 반환한다', async () => {
      const c = client();
      const sink: Parameters<HostBridge['onProposal']>[0][] = [];
      const out = await find(buildTools(c, AGENT_ID, 'assistant', undefined, undefined, collectingBridge(sink)), 'propose_add_project_member')
        .handler({ projectKey: 'WP', username: 'ghost', role: 'MEMBER', summary: 's' });
      expect(out).toContain('찾을 수 없습니다');
      expect(sink).toHaveLength(0);
    });

    it('비활성 구성원은 제안을 만들지 않는다', async () => {
      const c = client();
      c.sc.searchMembers.mockResolvedValue([member({ username: 'retired', name: '퇴사자', active: false })]);
      const sink: Parameters<HostBridge['onProposal']>[0][] = [];
      const out = await find(buildTools(c, AGENT_ID, 'assistant', undefined, undefined, collectingBridge(sink)), 'propose_add_project_member')
        .handler({ projectKey: 'WP', username: 'retired', role: 'MEMBER', summary: 's' });
      expect(out).toContain('비활성');
      expect(sink).toHaveLength(0);
    });

    it('활성 구성원이면 해석된 userId 와 key 로 제안을 만든다', async () => {
      const c = client();
      c.sc.searchMembers.mockResolvedValue([member({})]);
      const sink: Parameters<HostBridge['onProposal']>[0][] = [];
      await find(buildTools(c, AGENT_ID, 'assistant', undefined, undefined, collectingBridge(sink)), 'propose_add_project_member')
        .handler({ projectKey: 'WP', username: 'minsu', role: 'MEMBER', summary: 's' });
      expect(sink[0].actionType).toBe('project.add_member');
      expect(sink[0].params).toEqual({ key: 'WP', userId: 5, role: 'MEMBER' });
    });

    it('조회 오류는 비구성원으로 뭉개지 않고 그대로 전파한다', async () => {
      const c = client();
      c.sc.searchMembers.mockRejectedValue({ response: { status: 403 } });
      await expect(
        find(buildTools(c, AGENT_ID, 'assistant'), 'propose_add_project_member').handler({ projectKey: 'WP', username: 'minsu', role: 'MEMBER', summary: 's' }),
      ).rejects.toBeDefined();
    });

    it('부분일치는 채택하지 않는다 — username 정확일치만', async () => {
      const c = client();
      c.sc.searchMembers.mockResolvedValue([member({ userId: 7, username: 'minsu2' })]);
      const out = await find(buildTools(c, AGENT_ID, 'assistant'), 'propose_add_project_member')
        .handler({ projectKey: 'WP', username: 'minsu', role: 'MEMBER', summary: 's' });
      expect(out).toContain('찾을 수 없습니다');
    });
  });

  it('propose_set_member_role 은 역할명을 그대로 실행기에 넘긴다(roleId 해석은 서버 몫)', async () => {
    const c = client();
    c.sc.searchMembers.mockResolvedValue([member({})]);
    const sink: Parameters<HostBridge['onProposal']>[0][] = [];
    await find(buildTools(c, AGENT_ID, 'assistant', undefined, undefined, collectingBridge(sink)), 'propose_set_member_role')
      .handler({ username: 'minsu', roles: ['ADMIN'], summary: '관리자로 승격' });
    expect(sink[0]).toMatchObject({ actionType: 'user.set_roles', params: { userId: 5, roles: ['ADMIN'] } });
  });

  it('AI 에이전트 계정은 역할 변경 대상에서 제외된다 — AGENT 역할 소실 방지', async () => {
    const c = client();
    c.sc.searchMembers.mockResolvedValue([member({ userId: 9, username: 'assistant', name: '개인 비서', kind: 'AGENT' })]);
    const sink: Parameters<HostBridge['onProposal']>[0][] = [];
    const out = await find(buildTools(c, AGENT_ID, 'assistant', undefined, undefined, collectingBridge(sink)), 'propose_set_member_role')
      .handler({ username: 'assistant', roles: ['USER'], summary: 's' });
    expect(out).toContain('AI 에이전트');
    expect(sink).toHaveLength(0);
  });

  it('propose_set_member_active 는 해석된 userId 와 active 로 제안을 만든다', async () => {
    const c = client();
    c.sc.searchMembers.mockResolvedValue([member({})]);
    const sink: Parameters<HostBridge['onProposal']>[0][] = [];
    await find(buildTools(c, AGENT_ID, 'assistant', undefined, undefined, collectingBridge(sink)), 'propose_set_member_active')
      .handler({ username: 'minsu', active: false, summary: '퇴사 처리' });
    expect(sink[0]).toMatchObject({ actionType: 'user.set_active', params: { userId: 5, active: false } });
  });

  it('propose_set_member_active — 없는 username 이면 제안을 만들지 않는다', async () => {
    const c = client();
    const sink: Parameters<HostBridge['onProposal']>[0][] = [];
    const out = await find(buildTools(c, AGENT_ID, 'assistant', undefined, undefined, collectingBridge(sink)), 'propose_set_member_active')
      .handler({ username: 'ghost', active: false, summary: 's' });
    expect(out).toContain('찾을 수 없습니다');
    expect(sink).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// #842 사전검증 + #462 HostBridge
// ---------------------------------------------------------------------------
describe('propose 사전검증 (#842)', () => {
  it('propose 전에 같은 actionType·params 로 validateAction 을 호출한다', async () => {
    const c = client();
    const proposals: Parameters<HostBridge['onProposal']>[0][] = [];
    await find(buildTools(c, 7, 'assistant', undefined, undefined, collectingBridge(proposals)), 'propose_delete_file')
      .handler({ driveFileId: 5, summary: '파일 삭제' });
    expect(c.validateAction).toHaveBeenCalledWith(7, 'drive.delete_file', { id: 5 });
    expect(proposals).toHaveLength(1);
  });

  it('사전검증이 4xx 로 실패하면 카드를 등록하지 않고 서버 사유를 그대로 전파한다', async () => {
    const c = client();
    vi.mocked(c.validateAction).mockRejectedValue(apiError(403, 'API 오류 403: 필요 권한 없음: project:manage'));
    const proposals: Parameters<HostBridge['onProposal']>[0][] = [];
    await expect(
      find(buildTools(c, 7, 'assistant', undefined, undefined, collectingBridge(proposals)), 'propose_delete_project')
        .handler({ projectKey: 'WP', summary: '프로젝트 삭제' }),
    ).rejects.toThrow('project:manage');
    expect(proposals).toHaveLength(0);
  });

  it('응답 없는 전송 실패·5xx 는 일시 장애로 보고 카드 생성을 막지 않는다(fail-open)', async () => {
    const c = client();
    vi.mocked(c.validateAction)
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockRejectedValueOnce(apiError(500, 'API 오류 500'));
    const proposals: Parameters<HostBridge['onProposal']>[0][] = [];
    const t = find(buildTools(c, 7, 'assistant', undefined, undefined, collectingBridge(proposals)), 'propose_delete_file');
    await t.handler({ driveFileId: 1, summary: 'a' });
    await t.handler({ driveFileId: 2, summary: 'b' });
    expect(proposals).toHaveLength(2);
  });
});

describe('HostBridge 콜백 (#462 슬라이스4)', () => {
  it('propose_* 핸들러가 hostBridge.onProposal 을 호출하고 사이드카는 쓰지 않는다', async () => {
    const proposals: Parameters<HostBridge['onProposal']>[0][] = [];
    await withSidecar(async (sidecar) => {
      const out = await find(buildTools(client(), 1, 'assistant', undefined, undefined, collectingBridge(proposals)), 'propose_create_event')
        .handler({ title: '회의', summary: '회의', startsAt: '2026-06-26T10:00:00+09:00', endsAt: '2026-06-26T11:00:00+09:00' });
      expect(out).toContain('제안');
      expect(() => readFileSync(sidecar, 'utf8')).toThrow();
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ actionType: 'calendar.create_event', summary: '회의' });
  });

  it('submit_response 핸들러가 hostBridge.onSubmitResponse 를 호출', async () => {
    let submitted: string | null = null;
    const bridge: HostBridge = { onProposal: () => {}, onSubmitResponse: (t) => { submitted = t; }, onUnassignResult: () => {} };
    await find(buildTools(client(), 1, 'assistant', undefined, undefined, bridge), 'submit_response').handler({ text: '최종 답변' });
    expect(submitted).toBe('최종 답변');
  });

  it('unassign_self 성공 시 onUnassignResult({ok:true})', async () => {
    const results: { ok: boolean; canonical?: string }[] = [];
    const bridge: HostBridge = { onProposal: () => {}, onSubmitResponse: () => {}, onUnassignResult: (r) => results.push(r) };
    await find(buildTools(client(), 1, 'assistant', undefined, undefined, bridge), 'unassign_self').handler({ issueKey: 'EX-2' });
    expect(results).toEqual([{ ok: true }]);
  });

  it('unassign_self 실패 시 onUnassignResult({ok:false, canonical}) + canonical 반환', async () => {
    const c = client();
    vi.mocked(c.unassignSelf).mockRejectedValue(new Error('403'));
    const results: { ok: boolean; canonical?: string }[] = [];
    const bridge: HostBridge = { onProposal: () => {}, onSubmitResponse: () => {}, onUnassignResult: (r) => results.push(r) };
    const out = await find(buildTools(c, 1, 'assistant', undefined, undefined, bridge), 'unassign_self').handler({ issueKey: 'EX-2' });
    expect(results[0].ok).toBe(false);
    expect(results[0].canonical).toContain('담당자 해제 요청을 처리하지 못했습니다');
    expect(out).toBe(results[0].canonical);
  });
});

// ---------------------------------------------------------------------------
// submit_response 사이드카 (#381/#467)
// ---------------------------------------------------------------------------
describe('submit_response 사이드카', () => {
  it('subagent 사이드카에 {text} 를 기록한다 (#381)', async () => {
    await withSidecar(async (sidecar) => {
      await find(buildTools(client(), 7, 'assistant'), 'submit_response').handler({ text: 'EX-2 상태를 진행 중으로 변경했어요.' });
      expect(readLines(sidecar)[0].text).toBe('EX-2 상태를 진행 중으로 변경했어요.');
    }, 'WORKPLACE_SUBAGENT_RESPONSE_PATH');
  });

  it('두 번 호출하면 두 답 모두 NDJSON 줄로 보존된다 (#467)', async () => {
    await withSidecar(async (sidecar) => {
      const t = find(buildTools(client(), 7, 'assistant'), 'submit_response');
      await t.handler({ text: '첫 번째 서브에이전트 답' });
      await t.handler({ text: '두 번째 서브에이전트 답' });
      expect(readLines(sidecar).map((l) => l.text)).toEqual(['첫 번째 서브에이전트 답', '두 번째 서브에이전트 답']);
    }, 'WORKPLACE_SUBAGENT_RESPONSE_PATH');
  });
});

// ---------------------------------------------------------------------------
// ai-agent 전용 쓰기 도구(메일 동기화·외부연락처·드라이브)
// ---------------------------------------------------------------------------
describe('sync_mail', () => {
  it('client.syncMail(agentId, accountId) 호출 후 완료 문자열 반환', async () => {
    const c = client();
    const out = await find(buildTools(c, AGENT_ID, 'assistant'), 'sync_mail').handler({ accountId: 5 });
    expect(c.syncMail).toHaveBeenCalledWith(AGENT_ID, 5);
    expect(out).toBe('동기화를 완료했습니다.');
  });
});

describe('외부 연락처 쓰기', () => {
  it('create_external_contact → client.createExternalContact(agentId, input)', async () => {
    const c = client();
    vi.mocked(c.createExternalContact).mockResolvedValue({ id: 3, name: '김거래' } as never);
    const input = { name: '김거래', email: 'k@x.com', visibility: 'SHARED' as const };
    const out = await find(buildTools(c, AGENT_ID, 'assistant'), 'create_external_contact').handler(input);
    expect(c.createExternalContact).toHaveBeenCalledWith(AGENT_ID, input, undefined);
    expect(JSON.parse(out)).toEqual({ id: 3, name: '김거래' });
  });

  it('update_external_contact 는 externalId 를 경로 id 로 분리하고 나머지를 본문으로 넘긴다', async () => {
    const c = client();
    await find(buildTools(c, AGENT_ID, 'assistant'), 'update_external_contact').handler({
      externalId: 9, name: '김거래', visibility: 'PERSONAL',
    });
    expect(c.updateExternalContact).toHaveBeenCalledWith(AGENT_ID, 9, { name: '김거래', visibility: 'PERSONAL' }, undefined);
  });

  it('create_external_contact 의 force 는 본문이 아니라 별도 인자로 넘긴다(#839 중복 경고 우회)', async () => {
    const c = client();
    await find(buildTools(c, AGENT_ID, 'assistant'), 'create_external_contact').handler({
      name: '김거래', email: 'k@x.com', visibility: 'SHARED', force: true,
    });
    expect(c.createExternalContact).toHaveBeenCalledWith(AGENT_ID, { name: '김거래', email: 'k@x.com', visibility: 'SHARED' }, true);
  });

  it('update_external_contact 는 부분 수정 — 준 필드만 보내고 force 를 분리한다(#839)', async () => {
    const c = client();
    await find(buildTools(c, AGENT_ID, 'assistant'), 'update_external_contact').handler({ externalId: 9, phone: '010-1', force: true });
    expect(c.updateExternalContact).toHaveBeenCalledWith(AGENT_ID, 9, { phone: '010-1' }, true);
  });

  it('update_external_contact 는 바꿀 필드가 없으면 호출하지 않고 거절한다', async () => {
    const c = client();
    await expect(find(buildTools(c, AGENT_ID, 'assistant'), 'update_external_contact').handler({ externalId: 9 })).rejects.toThrow(
      '하나 이상',
    );
    expect(c.updateExternalContact).not.toHaveBeenCalled();
  });

  it('visibility 누락은 스키마가 거부한다', async () => {
    const c = client();
    await expect(find(buildTools(c, AGENT_ID, 'assistant'), 'create_external_contact').handler({ name: 'x' })).rejects.toThrow();
    expect(c.createExternalContact).not.toHaveBeenCalled();
  });
});

describe('드라이브 쓰기 (#333 M4, #840)', () => {
  it('create_folder — parentId 생략 시 null(루트)로 넘기고 결과를 JSON 으로 반환', async () => {
    const c = client();
    vi.mocked(c.createFolder).mockResolvedValue({ id: 10, name: '신규폴더' } as never);
    const out = await find(buildTools(c, 7, 'assistant'), 'create_folder').handler({ spaceId: 1, name: '신규폴더' });
    expect(c.createFolder).toHaveBeenCalledWith(7, 1, null, '신규폴더');
    expect(JSON.parse(out)).toMatchObject({ id: 10, name: '신규폴더' });
  });

  it('rename_folder → client.renameFolder(agentId, folderId, name)', async () => {
    const c = client();
    await find(buildTools(c, 7, 'assistant'), 'rename_folder').handler({ folderId: 4, name: '새이름' });
    expect(c.renameFolder).toHaveBeenCalledWith(7, 4, '새이름');
  });

  it('move_folder — targetParentId 생략 시 루트(null)로 이동', async () => {
    const c = client();
    expect(await find(buildTools(c, 7, 'assistant'), 'move_folder').handler({ folderId: 4 })).toBe('ok');
    expect(c.moveFolder).toHaveBeenCalledWith(7, 4, null);
  });

  it('move_file 은 driveFileId 를 client.moveFile 에 넘기고, 옛 fileId 파라미터는 거부한다', async () => {
    const c = client();
    await find(buildTools(c, 7, 'assistant'), 'move_file').handler({ driveFileId: 5, targetFolderId: 3 });
    expect(c.moveFile).toHaveBeenCalledWith(7, 5, 3);
    await expect(find(buildTools(c, 7, 'assistant'), 'move_file').handler({ fileId: 812, targetFolderId: 3 })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// #856 확인카드 제안 — 참석자·프로젝트 멤버·채널 초대·이슈/코멘트/노트 삭제
// ---------------------------------------------------------------------------
describe('#856 propose 도구', () => {
  type Proposal = Parameters<HostBridge['onProposal']>[0];
  const member = (o: Partial<{ userId: number; username: string; name: string; active: boolean }>) => ({
    userId: 5, username: 'minsu', name: '김민수', kind: 'HUMAN', active: true, ...o,
  });
  /** username 정확일치로만 찾히는 디렉터리. */
  const directory = (c: TestClient, rows: ReturnType<typeof member>[]) =>
    c.sc.searchMembers.mockImplementation(async (p: { search?: string }) => rows.filter((r) => r.username.includes(p.search ?? '')));
  const run = async (c: TestClient, name: string, args: Record<string, unknown>) => {
    const sink: Proposal[] = [];
    const out = await find(buildTools(c, AGENT_ID, 'assistant', undefined, undefined, collectingBridge(sink)), name).handler(args);
    return { out, sink };
  };

  it('propose_add_attendees → username 을 id 로 해석하고 주최자(요청자)는 빼며 이름을 summary 에 덧붙인다', async () => {
    const c = client();
    directory(c, [member({}), member({ userId: AGENT_ID, username: 'me', name: '나' })]);
    const { sink } = await run(c, 'propose_add_attendees', { eventId: 9, attendees: ['minsu', 'me'], summary: '회의에 초대' });
    expect(sink[0]).toMatchObject({ actionType: 'calendar.add_attendees', params: { id: 9, userIds: [5] } });
    expect(sink[0].summary).toContain('김민수(minsu)');
    expect(c.validateAction).toHaveBeenCalledWith(AGENT_ID, 'calendar.add_attendees', { id: 9, userIds: [5] });
  });

  it('propose_add_attendees → 없는 username·주최자뿐이면 카드를 만들지 않는다', async () => {
    const c = client();
    directory(c, [member({ userId: AGENT_ID, username: 'me', name: '나' })]);
    expect((await run(c, 'propose_add_attendees', { eventId: 9, attendees: ['ghost'], summary: 's' })).out).toContain('ghost');
    const onlyMe = await run(c, 'propose_add_attendees', { eventId: 9, attendees: ['me'], summary: 's' });
    expect(onlyMe.out).toContain('초대할 참석자가 없습니다');
    expect(onlyMe.sink).toHaveLength(0);
  });

  it('propose_remove_attendee → 대상 id 로 제안, 주최자 본인이면 거절(서버는 조용히 무시하므로)', async () => {
    const c = client();
    directory(c, [member({}), member({ userId: AGENT_ID, username: 'me', name: '나' })]);
    const ok = await run(c, 'propose_remove_attendee', { eventId: 9, username: 'minsu', summary: 's' });
    expect(ok.sink[0]).toMatchObject({ actionType: 'calendar.remove_attendee', params: { id: 9, userId: 5 } });
    const self = await run(c, 'propose_remove_attendee', { eventId: 9, username: 'me', summary: 's' });
    expect(self.out).toContain('주최자 본인');
    expect(self.sink).toHaveLength(0);
  });

  it('propose_update_project_member_role / propose_remove_project_member → key·userId 로 매핑, 제거는 담당자 해제를 알린다', async () => {
    const c = client();
    directory(c, [member({})]);
    const role = await run(c, 'propose_update_project_member_role', { projectKey: 'WP', username: 'minsu', role: 'OWNER', summary: 's' });
    expect(role.sink[0]).toMatchObject({ actionType: 'project.update_member_role', params: { key: 'WP', userId: 5, role: 'OWNER' } });
    const rm = await run(c, 'propose_remove_project_member', { projectKey: 'WP', username: 'minsu', summary: '민수 제외' });
    expect(rm.sink[0]).toMatchObject({ actionType: 'project.remove_member', params: { key: 'WP', userId: 5 } });
    expect(rm.sink[0].summary).toContain('담당자 지정도 해제');
  });

  it('propose_add_channel_member → 활성 구성원만, channelId 는 params.id', async () => {
    const c = client();
    directory(c, [member({}), member({ userId: 6, username: 'retired', name: '퇴사자', active: false })]);
    const ok = await run(c, 'propose_add_channel_member', { channelId: 3, username: 'minsu', summary: 's' });
    expect(ok.sink[0]).toMatchObject({ actionType: 'messaging.add_channel_member', params: { id: 3, userId: 5 } });
    const inactive = await run(c, 'propose_add_channel_member', { channelId: 3, username: 'retired', summary: 's' });
    expect(inactive.out).toContain('비활성');
    expect(inactive.sink).toHaveLength(0);
  });

  it('propose_leave_channel → 비공개 채널만 제안(params.id), 공개 채널은 leave_channel 로 안내', async () => {
    const c = client();
    c.sc.getChannel.mockResolvedValueOnce({ id: 3, name: '인사팀', visibility: 'PRIVATE' });
    const priv = await run(c, 'propose_leave_channel', { channelId: 3, summary: '인사팀 채널 나가기' });
    expect(priv.sink[0]).toMatchObject({ actionType: 'messaging.leave_channel', params: { id: 3 } });
    expect(priv.sink[0].summary).toContain('다시 초대받아야');
    c.sc.getChannel.mockResolvedValueOnce({ id: 4, name: '공지', visibility: 'PUBLIC' });
    const pub = await run(c, 'propose_leave_channel', { channelId: 4, summary: 's' });
    expect(pub.out).toContain('leave_channel');
    expect(pub.sink).toHaveLength(0);
  });

  it('propose_delete_issue → key·number 로 매핑하고 하위 이슈 연쇄 삭제를 summary 에 보인다', async () => {
    const c = client();
    c.sc.getIssueDetail.mockResolvedValue({ summary: { title: '에픽', childCount: 3 } });
    const { sink } = await run(c, 'propose_delete_issue', { issueKey: 'WP-12', summary: '에픽 삭제' });
    expect(sink[0]).toMatchObject({ actionType: 'issue.delete', params: { key: 'WP', number: 12 } });
    expect(sink[0].summary).toContain('하위 이슈 3건도 함께 삭제');
  });

  it('propose_delete_comment → issueKey 를 key·number 로, commentId 는 그대로', async () => {
    const c = client();
    const { sink } = await run(c, 'propose_delete_comment', { issueKey: 'WP-12', commentId: 44, summary: 's' });
    expect(sink[0]).toMatchObject({ actionType: 'issue.delete_comment', params: { key: 'WP', number: 12, commentId: 44 } });
  });

  it('propose_delete_wiki_page → 하위 페이지(손자 포함) 수와 영구 삭제를 summary 에 보인다', async () => {
    const c = client();
    c.sc.getWikiPage.mockResolvedValue({ spaceId: 2, title: '설계' });
    c.sc.listWikiPages.mockResolvedValue([
      { id: 10, parentId: null, title: '설계', position: 0 },
      { id: 11, parentId: 10, title: 'A', position: 0 },
      { id: 12, parentId: 11, title: 'A-1', position: 0 },
      { id: 13, parentId: null, title: '무관', position: 1 },
    ]);
    const { sink } = await run(c, 'propose_delete_wiki_page', { pageId: 10, summary: '설계 삭제' });
    expect(sink[0]).toMatchObject({ actionType: 'wiki.delete_page', params: { id: 10 } });
    expect(sink[0].summary).toContain('하위 페이지 2개 포함, 영구 삭제');
  });

  it('서버 사전검증 4xx 면 카드를 만들지 않고 사유를 전파한다', async () => {
    const c = client();
    vi.mocked(c.validateAction).mockRejectedValue(Object.assign(new Error('소유자가 최소 1명 이상 있어야 합니다'), { response: { status: 409 } }));
    directory(c, [member({})]);
    const sink: Proposal[] = [];
    await expect(
      find(buildTools(c, AGENT_ID, 'assistant', undefined, undefined, collectingBridge(sink)), 'propose_remove_project_member').handler({
        projectKey: 'WP', username: 'minsu', summary: 's',
      }),
    ).rejects.toThrow('소유자가 최소 1명');
    expect(sink).toHaveLength(0);
  });
});
