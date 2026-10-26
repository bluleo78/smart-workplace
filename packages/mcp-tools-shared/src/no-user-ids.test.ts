// 도구 응답에 숫자 사용자 ID 가 없다는 것을 도구 횡단으로 확인한다(#833, WP-353).
// 목은 서버 Java record(AttendeeResponse·WikiPageDetail·DriveSpaceResponse·ProjectResponse·MessageResponse·ChannelResponse 등)의
// 실제 필드를 그대로 따른다 — 필드가 빠진 목은 "userId 없음" 단언이 아무것도 검증하지 못하기 때문이다.
import { describe, expect, it, vi } from 'vitest';
import { buildAttachmentTools } from './attachment-tools.js';
import { buildCalendarTools } from './calendar-tools.js';
import { buildDriveTools } from './drive-tools.js';
import { buildHomeTools } from './home-tools.js';
import { buildSharedIssueTools } from './issue-tools.js';
import { resultText } from './mcp-content.js';
import { buildMemberTools } from './member-tools.js';
import { buildMessagingTools } from './messaging-tools.js';
import { buildProjectTools } from './project-tools.js';
import { buildWikiTools } from './wiki-tools.js';

/** 사용자 ID 를 담는 서버 필드 이름. 응답 어디에도 없어야 한다. */
const USER_ID_KEYS = new Set([
  'userId', 'ownerId', 'authorId', 'updatedBy', 'invitedBy', 'invitedByUserId', 'actorId', 'reporterId', 'attachedById', 'createdById', 'proposedByUserId',
  // WP-354: 드라이브 파일 버전의 업로더(DriveFileVersionResponse.uploadedBy) — 이름은 uploadedByName 으로만 둔다.
  'uploadedBy',
]);

/** 본문 문자열에 남은 멘션 토큰 `<@123>` — 숫자 사용자 ID 가 문자열 안에 숨은 모양이다. */
const MENTION_TOKEN = /<@\d+>/;

/**
 * 멘션 토큰 검사에서 명시적으로 빼는 문자열 경로(WP-353 최종 리뷰) — 도구별로 이유를 적어 넘긴다. 현재 예외는 후속으로 남긴 두 곳뿐이다:
 * (1) `get_wiki_page` 의 `body`(노트 본문은 서버가 토큰을 담은 채 준다 — 푸는 데 필요한 멘션 사전이 응답에 없다), (2) ai-agent 의 `list_chat_messages` 본문
 * (이 패키지 밖이라 여기서는 검사하지 않고 ai-agent 쪽 도구 테스트가 맡는다). 새 예외는 이유 없이 늘리지 않는다.
 */
const WIKI_BODY_TOKEN_EXCEPTION: ReadonlySet<string> = new Set(['body']);

/**
 * 파싱한 응답을 훑어 숫자 사용자 ID 의 흔적을 모은다: (1) USER_ID_KEYS 에 드는 키, (2) username 과 숫자 id 를 함께 가진 객체(사람 객체에 실린 id),
 * (3) 문자열 안의 멘션 토큰 `<@123>`(tokenOk 에 든 경로만 예외). `invitedBy` 는 {username,name} 객체일 때만 허용한다.
 */
function userIdLeaks(value: unknown, path = '', tokenOk: ReadonlySet<string> = new Set()): string[] {
  if (typeof value === 'string') return MENTION_TOKEN.test(value) && !tokenOk.has(path) ? [`${path || '$'}: <@id> 토큰`] : [];
  if (Array.isArray(value)) return value.flatMap((v) => userIdLeaks(v, `${path}[]`, tokenOk));
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  const leaks: string[] = [];
  if (typeof obj.username === 'string' && typeof obj.id === 'number') leaks.push(`${path || '$'}: username+id`);
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (USER_ID_KEYS.has(k) && !(k === 'invitedBy' && v && typeof v === 'object')) leaks.push(p);
    leaks.push(...userIdLeaks(v, p, tokenOk));
  }
  return leaks;
}

const out = (r: unknown) => JSON.parse(resultText(r as never));
const find = (tools: { name: string; handler: (a: unknown) => Promise<unknown> }[], name: string) => tools.find((t) => t.name === name)!;

describe('userIdLeaks (검사기 자체)', () => {
  it('금지 키와 username+id 객체를 찾고, 깨끗한 응답과 invitedBy 객체는 통과시킨다', () => {
    expect(userIdLeaks({ a: [{ ownerId: 1 }], p: { username: 'x', id: 3 } }).sort()).toEqual(['a[].ownerId', 'p: username+id'].sort());
    expect(userIdLeaks({ attendees: [{ username: 'a', name: 'A', invitedBy: { username: 'b', name: 'B' } }] })).toEqual([]);
    expect(userIdLeaks({ items: [{ id: 3, name: '채널' }] })).toEqual([]);
  });

  it('문자열 안의 <@id> 토큰을 찾고, 예외로 적은 경로만 통과시킨다', () => {
    expect(userIdLeaks({ body: '안녕 <@3>', items: [{ text: '<@12> 님' }] }).sort()).toEqual(['body: <@id> 토큰', 'items[].text: <@id> 토큰'].sort());
    expect(userIdLeaks({ body: '안녕 <@3>' }, '', new Set(['body']))).toEqual([]);
    expect(userIdLeaks({ body: '@김민수(minsu) 와 a@b.com <@abc>' })).toEqual([]); // 풀린 멘션·메일 주소·숫자가 아닌 꺾쇠는 아니다
  });
});

describe('멤버', () => {
  const searchRow = { userId: 3, username: 'minsu', name: '김민수', email: 'm@x.com', title: '팀장', kind: 'HUMAN', active: true, membershipRole: 'USER', membershipStatus: 'ACTIVE' };
  const client = {
    searchMembers: vi.fn().mockResolvedValue([searchRow]),
    searchMembersPage: vi.fn().mockResolvedValue({ items: [searchRow], total: 1, hasMore: false, page: 0 }),
    getMember: vi.fn().mockResolvedValue(searchRow),
    getMe: vi.fn().mockResolvedValue({ id: 3, username: 'minsu' }),
    getMemberContact: vi.fn().mockResolvedValue({ id: 3, username: 'minsu', name: '김민수', email: 'm@x.com', title: '팀장', kind: 'HUMAN', groups: ['팀A'], isFavorite: false }),
    // 서버 ContactPage → ContactSummary(MEMBER 행은 username 을 싣고, EXTERNAL 은 null).
    listContacts: vi.fn().mockResolvedValue({
      items: [
        { type: 'MEMBER', id: 3, username: 'minsu', name: '김민수', email: 'm@x.com', title: '팀장', organization: null, isFavorite: false },
        { type: 'EXTERNAL', id: 3, username: null, name: '김외부', email: 'e@x.com', title: null, organization: 'X사', isFavorite: true },
      ],
      nextCursor: null,
      hasMore: false,
    }),
    getExternalContact: vi.fn(),
    // 서버 ChannelMemberResponse — 숫자 userId 와 username 이 함께 온다(WP-355).
    listChannelMembers: vi.fn().mockResolvedValue([{ userId: 3, username: 'minsu', name: '김민수', kind: 'HUMAN', role: 'MEMBER', joinedAt: 't' }]),
  };
  const tools = buildMemberTools(client as never) as never as Parameters<typeof find>[0];

  it('search_members·get_member·get_member_contact·list_contacts 는 username 으로만 사람을 가리킨다', async () => {
    for (const [name, args] of [
      ['search_members', { search: '김' }],
      ['search_members', { channelId: 5 }], // WP-355: 채널 멤버 — 서버 행의 숫자 userId 를 뺀다
      ['get_member', { username: 'minsu' }],
      ['get_member', { username: 'me' }], // WP-376: 단건 /members/{id} 응답의 숫자 userId 도 뺀다
      ['get_member_contact', { username: 'minsu' }],
      ['list_contacts', {}],
    ] as const) {
      const body = out(await find(tools, name).handler(args));
      expect(userIdLeaks(body), name).toEqual([]);
      expect(JSON.stringify(body), name).toContain('minsu');
    }
  });
});

describe('캘린더', () => {
  // 서버 CalendarEventResponse + AttendeeResponse. 초대자(2)는 참석자 목록에 있고, 3 은 목록에 없는 초대자다.
  const event = {
    id: 7, title: '회의', calendarId: 1, myRsvpStatus: 'ACCEPTED', myRole: 'ATTENDEE', external: false, attendeeCount: 3,
    attendees: [
      { userId: 2, username: 'alice', name: '앨리스', kind: 'HUMAN', role: 'ORGANIZER', rsvpStatus: 'ACCEPTED', invitedByUserId: 2, externalEmail: null },
      { userId: 1, username: 'me', name: '나', kind: 'HUMAN', role: 'ATTENDEE', rsvpStatus: 'NEEDS_ACTION', invitedByUserId: 2, externalEmail: null },
      { userId: null, username: null, name: null, kind: 'EXTERNAL', role: 'ATTENDEE', rsvpStatus: 'NEEDS_ACTION', invitedByUserId: 3, externalEmail: 'x@ext.com' },
    ],
  };
  const client = {
    listEvents: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue(event),
    createEvent: vi.fn().mockResolvedValue(event),
    getMe: vi.fn().mockResolvedValue({ id: 1, username: 'me' }),
    searchMembers: vi.fn().mockResolvedValue([]),
  };
  const tools = buildCalendarTools(client as never) as never as Parameters<typeof find>[0];

  it('get_event: 참석자의 userId 를 빼고, invitedByUserId 는 같은 응답의 참석자에서 풀어 invitedBy 로 준다', async () => {
    const body = out(await find(tools, 'get_event').handler({ eventId: 7 }));
    expect(userIdLeaks(body)).toEqual([]);
    // 주최자 자신(본인이 본인을 초대)은 invitedBy 를 싣지 않고, 값이 없는 externalEmail 도 생략한다.
    expect(body.attendees[0]).toEqual({ username: 'alice', name: '앨리스', kind: 'HUMAN', role: 'ORGANIZER', rsvpStatus: 'ACCEPTED' });
    expect(body.attendees[1].invitedBy).toEqual({ username: 'alice', name: '앨리스' });
    // 목록에 없는 초대자는 풀 수 없어 생략한다(추가 조회 없음).
    expect(body.attendees[2]).not.toHaveProperty('invitedBy');
    expect(body.attendees[2]).toMatchObject({ kind: 'EXTERNAL', externalEmail: 'x@ext.com' });
  });

  it('create_event 의 event 에도 같은 뷰를 쓴다', async () => {
    const body = out(await find(tools, 'create_event').handler({ title: '회의', startsAt: '2026-10-20T10:00:00+09:00', endsAt: '2026-10-20T11:00:00+09:00' }));
    expect(userIdLeaks(body)).toEqual([]);
    expect(body.event.attendees[1].invitedBy).toEqual({ username: 'alice', name: '앨리스' });
  });

  it('목 점검: 가공 전 원본에는 숫자 ID 가 실제로 들어 있다(검사가 빈 껍데기가 아님)', () => {
    expect(userIdLeaks(event).length).toBeGreaterThan(0);
  });

  it('참석자가 없는 응답(list_events 행 모양)은 참석자 가공을 건너뛰고 총원만 남긴다', async () => {
    client.getEvent.mockResolvedValueOnce({ id: 8, title: 'x', attendeeCount: 2, attendees: null });
    expect(out(await find(tools, 'get_event').handler({ eventId: 8 }))).toEqual({ id: 8, title: 'x', attendeeCount: 2 });
  });
});

describe('노트', () => {
  const client = {
    listWikiSpaces: vi.fn().mockResolvedValue([{ id: 1, type: 'PERSONAL', name: '내 노트', ownerId: 9, role: 'OWNER', createdAt: 't' }]),
    getWikiPage: vi.fn().mockResolvedValue({ id: 5, spaceId: 1, parentId: null, title: 'T', body: 'b', version: 3, updatedBy: 9, updatedAt: 't', aiLastUsedAt: null, aiLastAction: null }),
    createWikiPage: vi.fn().mockResolvedValue({ id: 6, spaceId: 1, parentId: null, title: 'N', body: '', version: 1, updatedBy: 9, updatedAt: 't' }),
    updateWikiPage: vi.fn().mockResolvedValue({ id: 5, spaceId: 1, parentId: null, title: 'T', body: 'c', version: 4, updatedBy: 9, updatedAt: 't' }),
  };
  const tools = buildWikiTools(client as never) as never as Parameters<typeof find>[0];

  it('get_wiki_page 본문의 <@id> 토큰은 명시적 예외다 — 예외 없이 검사하면 잡히고, 본문 밖에는 없다(후속)', async () => {
    client.getWikiPage.mockResolvedValueOnce({ id: 5, spaceId: 1, parentId: null, title: 'T', body: '담당 <@9>', version: 3, updatedBy: 9, updatedAt: 't' });
    const body = out(await find(tools, 'get_wiki_page').handler({ pageId: 5 }));
    expect(userIdLeaks(body)).toEqual(['body: <@id> 토큰']);
    expect(userIdLeaks(body, '', WIKI_BODY_TOKEN_EXCEPTION)).toEqual([]);
  });

  it('list_wiki_spaces: ownerId 를 빼고 나머지(역할 등)는 유지한다', async () => {
    const body = out(await find(tools, 'list_wiki_spaces').handler({}));
    expect(userIdLeaks(body)).toEqual([]);
    expect(body[0]).toEqual({ id: 1, type: 'PERSONAL', name: '내 노트', role: 'OWNER', createdAt: 't' });
  });

  it('get·create·update_wiki_page: updatedBy 를 빼고 version·updatedAt 은 유지한다', async () => {
    for (const [name, args] of [
      ['get_wiki_page', { pageId: 5 }],
      ['create_wiki_page', { spaceId: 1, title: 'N' }],
      ['update_wiki_page', { pageId: 5, version: 3, body: 'c' }],
    ] as const) {
      const body = out(await find(tools, name).handler(args));
      expect(userIdLeaks(body), name).toEqual([]);
      expect(body, name).toMatchObject({ version: expect.any(Number), updatedAt: 't' });
    }
  });
});

describe('노트 요약·판 기록·복원 (WP-357)', () => {
  const wikiClient = {
    // WP-357: 요약·판 기록·복원 — 서버 WikiPageSummaryState·WikiRevisionListResponse(Person 은 숫자 사용자 id 와 name).
    getWikiPage: vi.fn().mockResolvedValue({ id: 5, spaceId: 1, parentId: null, title: 'T', body: 'b', version: 3, updatedBy: 9, updatedAt: 't' }),
    getWikiPageSummary: vi.fn().mockResolvedValue({ summary: '요약', status: 'READY', summaryVersion: 3, pageVersion: 3, summarizedAt: 't' }),
    listWikiRevisions: vi.fn().mockResolvedValue({
      current: { version: 3, editedAt: 't', editors: [{ id: 9, name: '앨리스' }] },
      items: [{ version: 2, title: 'T', editedAt: 't', createdAt: 't', reason: 'AI', editors: [{ id: 9, name: '앨리스' }, { id: 10, name: '밥' }], aiActor: { id: 11, name: '캐럴' } }],
    }),
    restoreWikiRevision: vi.fn().mockResolvedValue({ id: 5, spaceId: 1, parentId: null, title: 'T', body: 'c', version: 5, updatedBy: 9, updatedAt: 't' }),
  };
  const tools = () => buildWikiTools(wikiClient as never) as never as Parameters<typeof find>[0];

  it('get_wiki_page includeRevisions: 편집자·AI 적용자는 이름으로만 두고 숫자 사용자 ID 를 내보내지 않는다', async () => {
    const body = out(await find(tools(), 'get_wiki_page').handler({ pageId: 5, includeRevisions: true, includeSummary: true }));
    expect(userIdLeaks(body, '', WIKI_BODY_TOKEN_EXCEPTION)).toEqual([]);
    expect(body.revisions[0]).toMatchObject({ editors: ['앨리스', '밥'], aiActor: '캐럴' });
    expect(JSON.stringify(body.revisions)).not.toMatch(/"id"|\b(9|10|11)\b/);
  });

  it('restore_wiki_revision: 저장과 같은 페이지 뷰라 updatedBy 가 없다', async () => {
    const body = out(await find(tools(), 'restore_wiki_revision').handler({ pageId: 5, version: 2 }));
    expect(userIdLeaks(body)).toEqual([]);
    expect(body).toMatchObject({ version: 5, updatedAt: 't' });
  });
});

describe('홈 개요 (WP-357)', () => {
  // 서버 ActivityEntryResponse·PriorityItemResponse·MailSummaryResponse·MessagingSummaryResponse·ThreadInboxPage 모양.
  const client = {
    getHomeActivity: vi.fn().mockResolvedValue({
      items: [{ id: 5001, issueId: 412, projectKey: 'WP', issueNumber: 12, issueTitle: 'T', actorId: 9, actorName: '앨리스', actorKind: 'HUMAN', eventType: 'COMMENTED', createdAt: 't' }],
      nextCursor: null,
    }),
    getPriorityItems: vi.fn().mockResolvedValue([{ sourceType: 'ISSUE_DUE', sourceId: '412', title: 'T', deepLink: '/projects/WP/issues/12', importanceScore: 1, urgencyScore: 1, reason: '마감' }]),
    getHomeMailSummary: vi.fn().mockResolvedValue({ unreadCount: 1, needsReplyCount: 0, classificationActive: true, recent: [{ id: 1, accountId: 3, threadId: 't', sender: 'a', subject: 's', seen: false }] }),
    getMessagingSummary: vi.fn().mockResolvedValue({
      unreadConversationCount: 1, needsReplyCount: 0, aiAttentionCount: 0, attentionCount: 0,
      recent: [{ kind: 'CHANNEL', conversationId: 5, label: '일반', lastAuthorName: '앨리스', lastMessagePreview: 'hi', lastMessageAt: 't', unreadCount: 1, mentioned: true, needsReply: false, newThreadReplyCount: 0, aiReason: null }],
    }),
    getThreadInbox: vi.fn().mockResolvedValue({
      items: [{
        rootMessage: { id: 40, channelId: 5, authorId: 9, authorName: '앨리스', authorKind: 'HUMAN', body: '안녕 <@3>', mentions: [{ id: 3, username: 'minsu', name: '김민수', kind: 'HUMAN' }], parentMessageId: null, replyCount: 0, unreadReplyCount: 1, followed: true, deleted: false, reactions: [], attachments: [], driveLinks: [], createdAt: 't' },
        channelName: '일반', lastReplyAt: 't',
      }],
      nextCursor: null, hasMore: false,
    }),
  };
  const tools = buildHomeTools(client as never) as never as Parameters<typeof find>[0];

  it('우선순위·메일·메시징·활동·스레드 다섯 섹션 모두에 숫자 사용자 ID 도 <@id> 토큰도 없다', async () => {
    const body = out(await find(tools, 'get_home_overview').handler({ sections: ['priority', 'mail', 'messaging', 'activity', 'threads'] }));
    expect(Object.keys(body)).toEqual(['priority', 'mail', 'messaging', 'activity', 'threads']);
    expect(userIdLeaks(body)).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/<@\d+>/);
  });

  it('목 점검: 가공 전 활동·스레드 원본에는 숫자 ID 가 실제로 들어 있다', async () => {
    expect(userIdLeaks(await client.getHomeActivity())).not.toEqual([]);
    expect(userIdLeaks(await client.getThreadInbox())).not.toEqual([]);
  });

  it('이어 읽기에 쓰는 식별자(channelId·issueKey·id)는 남는다', async () => {
    const body = out(await find(tools, 'get_home_overview').handler({ sections: ['messaging', 'threads'] }));
    expect(body.messaging.recent[0].channelId).toBe(5);
    expect(body.threads.items[0]).toMatchObject({ channelId: 5, id: 40 });
  });
});

describe('이슈', () => {
  // 서버 IssueDetailResponse·IssueResponse — 담당자·작성자·코멘트·이력·첨부자에 숫자 id 를 담는다.
  const person = { id: 9, username: 'alice', name: '앨리스', kind: 'HUMAN' };
  const summary = {
    projectKey: 'WP', number: 12, title: 'T', status: 'TODO', priority: 'MID', type: { id: 2, name: 'BUG' }, assignees: [person], reporterId: 9,
    labels: [{ id: 100, name: 'urgent' }], blockedBy: [], blocks: [{ number: 13, title: 'x', status: 'TODO' }], blocked: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  };
  const detail = {
    issueKey: 'WP-12', summary, body: '본문', reporter: person,
    comments: [{ id: 1, body: '확인', authorId: 9, authorUsername: 'alice', authorName: '앨리스', authorKind: 'HUMAN', createdAt: '2026-10-01T00:00:00Z' }],
    history: [
      { eventType: 'STATUS_CHANGED', actorId: 9, actorUsername: 'alice', actorName: '앨리스', actorKind: 'HUMAN', fromValue: 'TODO', toValue: 'DONE', createdAt: '2026-10-01T00:00:00Z' },
      // WP-887: 관계 이력 payload 에도 유형 id 가 있다 — 도구는 풀어서 내보내되 id 류를 뺀다.
      { eventType: 'RELATION_ADDED', actorId: 9, actorUsername: 'alice', actorName: '앨리스', actorKind: 'HUMAN', fromValue: null, toValue: '{"typeId":2,"label":"관련","other":{"projectKey":"AB","number":7,"title":"T"}}', createdAt: '2026-10-01T00:00:00Z' },
    ],
    // WP-887: 관계·외부 링크 — 서버 IssueRelationView·IssueExternalLinkView 필드 그대로.
    relations: [{ id: 31, typeId: 2, typeCode: 'RELATES', label: '관련', issue: { projectKey: 'AB', number: 7, title: 'T', status: 'TODO', type: { id: 2, name: 'BUG' } } }],
    externalLinks: [{ id: 41, typeId: 6, typeCode: 'PARENT_EPIC', label: '에픽에 속함', url: 'https://jira.example/CLIM-1', key: 'CLIM-1', title: '외부 에픽' }],
    attachments: [{ fileId: 70, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 3, attachedById: 9, attachedByUsername: 'alice', attachedByName: '앨리스', attachedAt: '2026-10-01T00:00:00Z' }],
  };
  // WP-356: 워처(WatcherResponse)·드라이브 링크(DriveLinkResponse — 링크를 건 사람 createdById 와 core fileId 를 담는다).
  const watchers = [{ userId: 9, username: 'alice', name: '앨리스' }];
  const driveLinks = [
    { driveFileId: 77, fileId: 70, name: '견적서.pdf', mimeType: 'application/pdf', sizeBytes: 10, hasThumbnail: false, spaceId: 3, spaceName: '영업',
      availability: 'ACTIVE', createdById: 9, createdAt: '2026-10-01T00:00:00Z' },
  ];
  const client = {
    getIssueDetail: vi.fn().mockResolvedValue(detail),
    getIssueCycles: vi.fn().mockResolvedValue([]),
    getIssueWatchers: vi.fn().mockResolvedValue(watchers),
    getIssueDriveLinks: vi.fn().mockResolvedValue(driveLinks),
    createIssue: vi.fn().mockResolvedValue(summary),
    addIssueDependency: vi.fn().mockResolvedValue(detail),
    listIssueRelationTypes: vi.fn().mockResolvedValue([{ id: 2, code: 'RELATES', name: '관련', directed: false, outwardLabel: '관련', inwardLabel: null, externalOnly: false, hidden: false, sortOrder: 20 }]),
    addIssueRelation: vi.fn().mockResolvedValue([]),
    getProjectTypes: vi.fn().mockResolvedValue([]),
    getProjectMembers: vi.fn().mockResolvedValue([]),
  };
  const tools = buildSharedIssueTools(client as never) as never as Parameters<typeof find>[0];

  it('get_issue_detail·create_issue·link_issues·add_issue_relation 응답에 숫자 사용자 ID 도 <@id> 토큰도 없다', async () => {
    for (const [name, args] of [
      ['get_issue_detail', { issueKey: 'WP-12' }],
      ['create_issue', { projectKey: 'WP', title: 'T' }],
      ['link_issues', { issueKey: 'WP-12', otherIssueKey: 'WP-13', direction: 'blocks', linked: true }],
      ['add_issue_relation', { issueKey: 'WP-12', type: 'RELATES', otherIssueKey: 'AB-7' }],
    ] as const) {
      expect(userIdLeaks(out(await find(tools, name).handler(args))), name).toEqual([]);
    }
  });

  it('목 점검: 가공 전 원본 이슈 상세에는 숫자 ID 가 실제로 들어 있다', () => {
    expect(userIdLeaks(detail)).toEqual(expect.arrayContaining(['reporter: username+id', 'comments[].authorId', 'attachments[].attachedById']));
    // WP-356: 워처·드라이브 링크 원본에도 숫자 사용자 ID 가 있다.
    expect(userIdLeaks({ watchers, driveLinks })).toEqual(expect.arrayContaining(['watchers[].userId', 'driveLinks[].createdById']));
  });
});

describe('드라이브', () => {
  it('list_drive_spaces: ownerId 를 뺀다', async () => {
    const client = { listDriveSpaces: vi.fn().mockResolvedValue([{ id: 2, type: 'TEAM', name: '팀', ownerId: 9, role: 'EDITOR', archived: false, createdAt: 't' }]) };
    const body = out(await find(buildDriveTools(client as never) as never, 'list_drive_spaces').handler({}));
    expect(userIdLeaks(body)).toEqual([]);
    expect(body[0]).toMatchObject({ id: 2, role: 'EDITOR' });
  });

  // WP-354: 서버 DriveFileVersionResponse(uploadedBy 숫자 ID)·BacklinkResponse(sourceId) 필드 그대로.
  it('get_drive_file_summary: includeVersions·includeBacklinks 응답에 업로더 숫자 ID·core fileId 가 없다', async () => {
    const client = {
      getDriveFileSummary: vi.fn().mockResolvedValue({ summary: '요약', status: 'DONE', reason: null }),
      listDriveFileVersions: vi.fn().mockResolvedValue([
        { versionNo: 2, fileId: 901, sizeBytes: 200, uploadedBy: 9, uploadedByName: '김하나', createdAt: 't2', comment: null, current: true },
        { versionNo: 1, fileId: 900, sizeBytes: 100, uploadedBy: 9, uploadedByName: '김하나', createdAt: 't1', comment: '최초', current: false },
      ]),
      listDriveFileBacklinks: vi.fn().mockResolvedValue([{ sourceType: 'ISSUE', sourceId: 41, label: 'WP-12 제목', deepLink: '/projects/WP/issues/12' }]),
    };
    const body = out(await find(buildDriveTools(client as never) as never, 'get_drive_file_summary').handler({ driveFileId: 5, includeVersions: true, includeBacklinks: true }));
    expect(userIdLeaks(body)).toEqual([]);
    expect(body.versions[0]).toMatchObject({ versionNo: 2, uploadedByName: '김하나' });
    expect(body.versions[0]).not.toHaveProperty('fileId');
    expect(body.backlinks[0]).not.toHaveProperty('sourceId');
  });

  it('rename_drive_item·copy_drive_item·import_attachment_to_drive: 파일·폴더 행에 core fileId·사용자 ID 가 없다', async () => {
    // 서버 DriveFileResponse / DriveFolderResponse 필드 그대로.
    const fileRow = { id: 5, folderId: 3, fileId: 812, name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 5, category: 'DOCUMENT', createdAt: 't', updatedAt: 't', versionCount: 1, available: true };
    const client = {
      renameDriveFile: vi.fn().mockResolvedValue(fileRow),
      copyDriveFile: vi.fn().mockResolvedValue(fileRow),
      copyDriveFolder: vi.fn().mockResolvedValue({ id: 11, parentId: 3, name: '자료', createdAt: 't', updatedAt: 't' }),
      importAttachmentToDrive: vi.fn().mockResolvedValue(fileRow),
    };
    const tools = buildDriveTools(client as never) as never;
    const outs = [
      out(await find(tools, 'rename_drive_item').handler({ driveFileId: 5, name: 'a.pdf' })),
      out(await find(tools, 'copy_drive_item').handler({ driveFileId: 5, targetFolderId: 3 })),
      out(await find(tools, 'copy_drive_item').handler({ folderId: 8 })),
      out(await find(tools, 'import_attachment_to_drive').handler({ spaceId: 2, attachmentId: 812 })),
    ];
    for (const body of outs) expect(userIdLeaks(body)).toEqual([]);
    for (const body of [outs[0], outs[1], outs[3]]) {
      expect(body).toMatchObject({ driveFileId: 5 });
      expect(body).not.toHaveProperty('fileId');
    }
    expect(outs[2]).toMatchObject({ folderId: 11 });
  });

  // WP-369: 전송 링크·텍스트로 만들기 응답 — 서버 계약 그대로의 목(DriveDownloadLink·DriveUploadLink·DriveFileResponse).
  // 다운로드 링크 목에는 서버에 나중에 생길 수 있는 발급자 id(createdById)를 일부러 얹었다 — 뷰가 허용 목록으로 고르지 않으면 이 검사가 잡는다.
  // driveFileId 모드(Task 3: 기존 파일의 새 버전 — 텍스트 갱신·파일에 묶인 업로드 링크)도 같은 뷰를 거친다.
  it('create_drive_download_link·create_drive_file(내용·링크·기존 파일): 링크·파일 행에 사용자 ID·core fileId 가 없다', async () => {
    const fileRow = { id: 5, folderId: null, fileId: 812, name: '회의록.md', mimeType: 'text/markdown', sizeBytes: 9, category: 'TEXT', createdAt: 't', updatedAt: 't', versionCount: 1, available: true };
    const uploadLink = { url: 'https://w.example/api/v1/public/drive/transfer/ul_x', method: 'PUT', expiresAt: 't', maxBytes: 10485760, name: '결과.md', singleUse: true };
    const client = {
      createDriveDownloadLink: vi.fn().mockResolvedValue({ url: 'https://w.example/api/v1/public/drive/transfer/dl_x', expiresAt: 't', name: 'a.pdf', sizeBytes: 5, mimeType: 'application/pdf', singleUse: true, createdById: 9 }),
      createDriveUploadLink: vi.fn().mockResolvedValue(uploadLink),
      createDriveTextFile: vi.fn().mockResolvedValue(fileRow),
      updateDriveTextFile: vi.fn().mockResolvedValue({ ...fileRow, fileId: 813, versionCount: 2 }),
      createDriveVersionUploadLink: vi.fn().mockResolvedValue(uploadLink),
    };
    const tools = buildDriveTools(client as never) as never;
    const outs = [
      out(await find(tools, 'create_drive_download_link').handler({ driveFileId: 5 })),
      out(await find(tools, 'create_drive_file').handler({ spaceId: 2, name: '결과.md' })),
      out(await find(tools, 'create_drive_file').handler({ spaceId: 2, name: '회의록.md', content: '# 회의록' })),
      out(await find(tools, 'create_drive_file').handler({ driveFileId: 5, content: '# 고친 회의록' })),
      out(await find(tools, 'create_drive_file').handler({ driveFileId: 5 })),
    ];
    for (const body of outs) expect(userIdLeaks(body)).toEqual([]);
    expect(outs[0]).toEqual({ url: 'https://w.example/api/v1/public/drive/transfer/dl_x', expiresAt: 't', name: 'a.pdf', sizeBytes: 5, mimeType: 'application/pdf', singleUse: true });
    for (const body of [outs[2], outs[3]]) {
      expect(body).toMatchObject({ driveFileId: 5 });
      expect(body).not.toHaveProperty('fileId');
    }
  });
});

describe('프로젝트', () => {
  // 서버 ProjectResponse.
  const project = {
    id: 3, key: 'WP', name: '워크플레이스', description: null, ownerId: 9, type: 'TEAM', isDefault: false, createdAt: 't', updatedAt: 't',
    issueTotal: 1, issueDone: 0, memberCount: 2, memberNames: ['앨리스'], viewerIsMember: true,
  };
  const client = {
    listProjects: vi.fn().mockResolvedValue({ items: [project], total: 1, hasMore: false, page: 0 }),
    getProject: vi.fn().mockResolvedValue(project),
    getProjectTypes: vi.fn().mockResolvedValue([]),
    getProjectLabels: vi.fn().mockResolvedValue([]),
    getProjectComponents: vi.fn().mockResolvedValue([]),
    getProjectVersions: vi.fn().mockResolvedValue([]),
    getProjectMilestones: vi.fn().mockResolvedValue([]),
    getProjectCycles: vi.fn().mockResolvedValue([{ id: 5, projectId: 3, name: 'S1', goal: null, startDate: null, endDate: null, status: 'ACTIVE' }]),
    // WP-356: 커스텀 필드 정의(IssueFieldDefResponse)·메타 생성/수정 응답(LabelResponse 등)은 사용자 ID 를 담지 않지만, 숫자 id·projectId 는 뺀다.
    getProjectFields: vi.fn().mockResolvedValue([{ id: 8, projectId: 3, name: '고객사', type: 'SELECT', options: ['A'], position: 0 }]),
    // WP-807: 프로젝트 상태 — 숫자 id 는 get_project 출력에서 빠진다.
    getProjectStatuses: vi.fn().mockResolvedValue([{ id: 12, name: '검토 중', category: 'IN_PROGRESS', position: 2 }]),
    listIssueRelationTypes: vi.fn().mockResolvedValue([]),
    getProjectMembers: vi.fn().mockResolvedValue([{ userId: 9, username: 'alice', name: '앨리스', role: 'OWNER' }]),
    createProject: vi.fn().mockResolvedValue(project),
    updateProject: vi.fn().mockResolvedValue(project),
    createProjectMeta: vi.fn().mockResolvedValue({ id: 6, projectId: 3, name: 'bug', colorToken: 'RED', createdAt: 't', updatedAt: 't' }),
    updateProjectMeta: vi.fn().mockResolvedValue({ id: 5, projectId: 3, name: 'S2', goal: null, status: 'ACTIVE', createdAt: 't', updatedAt: 't' }),
    searchMembers: vi.fn(),
  };
  const tools = buildProjectTools(client as never) as never as Parameters<typeof find>[0];

  it('list_projects·get_project·create_project·update_project 는 ownerId 를 빼고, 소유자는 get_project 의 members(OWNER)로 드러난다', async () => {
    for (const [name, args] of [
      ['list_projects', {}],
      ['get_project', { projectKey: 'WP' }],
      ['create_project', { projectKey: 'WP', name: '워크플레이스' }],
      ['update_project', { projectKey: 'WP', name: '워크플레이스' }],
      ['create_project_meta', { projectKey: 'WP', kind: 'label', name: 'bug', color: 'RED' }],
      ['update_project_meta', { projectKey: 'WP', kind: 'cycle', name: 'S1', newName: 'S2' }],
    ] as const) {
      const body = out(await find(tools, name).handler(args));
      expect(userIdLeaks(body), name).toEqual([]);
    }
    // 커스텀 필드 정의·메타 응답에는 숫자 id·projectId 도 싣지 않는다(이름으로만 가리킨다).
    const meta = JSON.stringify(out(await find(tools, 'create_project_meta').handler({ projectKey: 'WP', kind: 'label', name: 'bug' })));
    expect(meta).not.toMatch(/"id"|projectId/);
    expect(JSON.stringify(out(await find(tools, 'get_project').handler({ projectKey: 'WP' })).fields)).not.toMatch(/"id"|projectId/);
    const detail = out(await find(tools, 'get_project').handler({ projectKey: 'WP' }));
    expect(detail.members).toEqual([{ username: 'alice', name: '앨리스', role: 'OWNER' }]);
    expect(detail).toMatchObject({ projectKey: 'WP', memberCount: 2 });
  });
});

describe('메시징', () => {
  // 서버 MessageResponse(작성자는 authorId·authorName 뿐, username 없음).
  const message = {
    id: 40, channelId: 5, authorId: 9, authorName: '앨리스', authorKind: 'HUMAN', body: '안녕 <@3>',
    mentions: [{ id: 3, username: 'minsu', name: '김민수', kind: 'HUMAN' }], parentMessageId: null, replyCount: 1, reactions: [{ emoji: '👍', count: 1, reacted: false }],
    attachments: [{ fileId: 70, messageId: 40, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 3, attachedById: 9, attachedByName: '앨리스', attachedAt: 't' }],
    driveLinks: [{ driveFileId: 8, fileId: 801, name: 'd.pdf', mimeType: 'application/pdf', sizeBytes: 5, hasThumbnail: false, spaceId: 2, spaceName: '팀', availability: 'OK', createdById: 9, createdAt: 't' }],
    createdAt: 't', editedAt: null, deleted: false, unreadReplyCount: 0, followed: false,
    proposal: { id: 1, proposedByUserId: 9, actionType: 'CREATE_EVENT', status: 'PENDING', title: '회의', attendees: [{ userId: 3, name: '김민수' }] },
  };
  const channel = {
    id: 5, kind: 'PUBLIC', name: '일반', visibility: 'PUBLIC', member: true, role: 'MEMBER', archived: false, memberCount: 3, unreadCount: 0, createdAt: 't',
    hasUnreadThreads: false, lastReadMessageId: null, lastMessage: { id: 40, authorId: 9, authorName: '앨리스', preview: '안녕', createdAt: 't' },
  };
  const client = {
    listChannels: vi.fn().mockResolvedValue([channel]),
    discoverChannels: vi.fn().mockResolvedValue([{ ...channel, lastMessage: null }]),
    createChannel: vi.fn().mockResolvedValue({ ...channel, lastMessage: null }),
    listChannelMessages: vi.fn().mockResolvedValue({ items: [message], nextCursor: null, hasMore: false }),
    getThreadReplies: vi.fn().mockResolvedValue({ items: [{ ...message, id: 41, parentMessageId: 40 }], nextCursor: null, hasMore: false }),
    updateChannelMessage: vi.fn().mockResolvedValue(message),
    searchMembers: vi.fn().mockResolvedValue([]),
  };
  const tools = buildMessagingTools(client as never) as never as Parameters<typeof find>[0];

  it('채널 도구는 id 를 channelId 로 바꾸고 마지막 메시지 미리보기의 authorId 를 뺀다', async () => {
    const list = out(await find(tools, 'list_channels').handler({}));
    expect(userIdLeaks(list)).toEqual([]);
    expect(list.items[0]).toMatchObject({ channelId: 5, name: '일반', lastMessage: { id: 40, authorName: '앨리스', preview: '안녕' } });
    expect(list.items[0]).not.toHaveProperty('id');
    const discovered = out(await find(tools, 'list_channels').handler({ q: '일' }));
    expect(userIdLeaks(discovered)).toEqual([]);
    expect(discovered.items[0]).toMatchObject({ channelId: 5 });
    expect(discovered.items[0]).not.toHaveProperty('lastMessage'); // 값이 없는 키는 생략
    const created = out(await find(tools, 'create_channel').handler({ name: '일반' }));
    expect(created).toMatchObject({ channelId: 5 });
    expect(created).not.toHaveProperty('id');
  });

  it('list_channel_messages·list_thread_replies 행은 작성자를 이름으로만 두고 첨부자·링크 생성자·제안 작성자의 숫자 ID 를 뺀다', async () => {
    const page = out(await find(tools, 'list_channel_messages').handler({ channelId: 5 }));
    expect(userIdLeaks(page)).toEqual([]);
    expect(page.items[0]).toMatchObject({ id: 40, authorName: '앨리스', authorKind: 'HUMAN', replyCount: 1 });
    expect(page.items[0].driveLinks[0]).toMatchObject({ driveFileId: 8 });
    expect(page.items[0].driveLinks[0]).not.toHaveProperty('fileId'); // 드라이브 표면에는 core fileId 를 내보내지 않는다(#840)
    expect(page.items[0].proposal.attendees).toEqual([{ name: '김민수' }]);
    const replies = out(await find(tools, 'list_thread_replies').handler({ messageId: 40 }));
    expect(userIdLeaks(replies)).toEqual([]);
  });

  it('목 점검: 가공 전 원본 메시지에는 숫자 ID 가 실제로 들어 있다', () => {
    expect(userIdLeaks(message)).toEqual(
      expect.arrayContaining(['authorId', 'attachments[].attachedById', 'driveLinks[].createdById', 'proposal.proposedByUserId', 'mentions[]: username+id']),
    );
  });

  it('update_channel_message 가 돌려주는 저장된 행도 읽기 뷰와 같다 — 작성자·첨부자·멘션의 숫자 ID 와 <@id> 토큰이 없다(WP-355)', async () => {
    const saved = out(await find(tools, 'update_channel_message').handler({ messageId: 40, body: '안녕' }));
    expect(userIdLeaks(saved)).toEqual([]);
    expect(saved).toMatchObject({ id: 40, authorName: '앨리스', body: '안녕 @김민수(minsu)' });
    expect(JSON.stringify(saved)).not.toMatch(/<@\d+>/);
  });

  it('멘션 토큰 <@id> 는 @이름(username) 으로 풀리고 mentions 에서 id 가 빠진다(허용 목록 없이 누수 0)', async () => {
    const page = out(await find(tools, 'list_channel_messages').handler({ channelId: 5 }));
    expect(page.items[0].mentions).toEqual([{ username: 'minsu', name: '김민수', kind: 'HUMAN' }]);
    expect(page.items[0].body).toBe('안녕 @김민수(minsu)');
    expect(JSON.stringify(page)).not.toMatch(/<@\d+>/);
    const replies = out(await find(tools, 'list_thread_replies').handler({ messageId: 40 }));
    expect(replies.items[0].body).toBe('안녕 @김민수(minsu)');
    expect(replies.items[0].mentions).toEqual([{ username: 'minsu', name: '김민수', kind: 'HUMAN' }]);
  });
});

// WP-358: read_file 의 노트·메시지·메일 갈래 — 서버 구간 응답(ExtractedTextSlice)에는 사용자 ID 가 없고, 내부 file id 는 attachmentId 로만 나간다.
describe('첨부 읽기 (WP-358)', () => {
  const sliceRow = { fileId: 70, status: 'READY', offset: 0, totalChars: 3, truncated: false, nextOffset: null, text: '안녕 <@3>', reasonCode: null, reason: null };
  const client = {
    readWikiAttachmentText: vi.fn().mockResolvedValue(sliceRow),
    readMessageAttachmentText: vi.fn().mockResolvedValue(sliceRow),
    readMailAttachmentText: vi.fn().mockResolvedValue({ ...sliceRow, fileId: 9 }),
  };
  const [tool] = buildAttachmentTools(client as never);
  const tools = [tool] as never as Parameters<typeof find>[0];

  it.each([
    [{ source: 'wiki', pageId: 7, attachmentId: 70 }],
    [{ source: 'message', channelId: 5, messageId: 40, attachmentId: 70 }],
    [{ source: 'mail', attachmentId: 9 }],
  ])('%j: 응답에 서버 fileId 가 없고 attachmentId 로 나간다', async (args) => {
    const res = out(await find(tools, 'read_file').handler(args));
    expect(res).not.toHaveProperty('fileId');
    expect(res.attachmentId).toBe(args.attachmentId);
    // 본문 텍스트는 첨부 원문이라 그대로 둔다 — 멘션 토큰 검사는 여기서 제외한다.
    expect(userIdLeaks({ ...res, text: undefined })).toEqual([]);
  });
});
