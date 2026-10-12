// 도구 응답에 숫자 사용자 ID 가 없다는 것을 도구 횡단으로 확인한다(#833, WP-353).
// 목은 서버 Java record(AttendeeResponse·WikiPageDetail·DriveSpaceResponse·ProjectResponse·MessageResponse·ChannelResponse 등)의
// 실제 필드를 그대로 따른다 — 필드가 빠진 목은 "userId 없음" 단언이 아무것도 검증하지 못하기 때문이다.
import { describe, expect, it, vi } from 'vitest';
import { buildCalendarTools } from './calendar-tools.js';
import { buildDriveTools } from './drive-tools.js';
import { resultText } from './mcp-content.js';
import { buildMemberTools } from './member-tools.js';
import { buildMessagingTools } from './messaging-tools.js';
import { buildProjectTools } from './project-tools.js';
import { buildWikiTools } from './wiki-tools.js';

/** 사용자 ID 를 담는 서버 필드 이름. 응답 어디에도 없어야 한다. */
const USER_ID_KEYS = new Set([
  'userId', 'ownerId', 'authorId', 'updatedBy', 'invitedBy', 'invitedByUserId', 'actorId', 'reporterId', 'attachedById', 'createdById', 'proposedByUserId',
]);

/**
 * 파싱한 응답을 훑어 숫자 사용자 ID 의 흔적을 모은다: (1) USER_ID_KEYS 에 드는 키, (2) username 과 숫자 id 를 함께 가진 객체(사람 객체에 실린 id).
 * `invitedBy` 는 {username,name} 객체일 때만 허용한다. 허용 목록은 없다(WP-353 에서 모두 정리됨).
 */
function userIdLeaks(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => userIdLeaks(v, `${path}[]`));
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  const leaks: string[] = [];
  if (typeof obj.username === 'string' && typeof obj.id === 'number') leaks.push(`${path || '$'}: username+id`);
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (USER_ID_KEYS.has(k) && !(k === 'invitedBy' && v && typeof v === 'object')) leaks.push(p);
    leaks.push(...userIdLeaks(v, p));
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
});

describe('멤버', () => {
  const searchRow = { userId: 3, username: 'minsu', name: '김민수', email: 'm@x.com', title: '팀장', kind: 'HUMAN', active: true, membershipRole: 'USER', membershipStatus: 'ACTIVE' };
  const client = {
    searchMembers: vi.fn().mockResolvedValue([searchRow]),
    searchMembersPage: vi.fn().mockResolvedValue({ items: [searchRow], total: 1, hasMore: false, page: 0 }),
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
  };
  const tools = buildMemberTools(client as never) as never as Parameters<typeof find>[0];

  it('search_members·get_member·get_member_contact·list_contacts 는 username 으로만 사람을 가리킨다', async () => {
    for (const [name, args] of [
      ['search_members', { search: '김' }],
      ['get_member', { username: 'minsu' }],
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

describe('드라이브', () => {
  it('list_drive_spaces: ownerId 를 뺀다', async () => {
    const client = { listDriveSpaces: vi.fn().mockResolvedValue([{ id: 2, type: 'TEAM', name: '팀', ownerId: 9, role: 'EDITOR', archived: false, createdAt: 't' }]) };
    const body = out(await find(buildDriveTools(client as never) as never, 'list_drive_spaces').handler({}));
    expect(userIdLeaks(body)).toEqual([]);
    expect(body[0]).toMatchObject({ id: 2, role: 'EDITOR' });
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
    getProjectMilestones: vi.fn().mockResolvedValue([]),
    getProjectCycles: vi.fn().mockResolvedValue([]),
    getProjectMembers: vi.fn().mockResolvedValue([{ userId: 9, username: 'alice', name: '앨리스', role: 'OWNER' }]),
    createProject: vi.fn().mockResolvedValue(project),
    updateProject: vi.fn().mockResolvedValue(project),
    searchMembers: vi.fn(),
  };
  const tools = buildProjectTools(client as never) as never as Parameters<typeof find>[0];

  it('list_projects·get_project·create_project·update_project 는 ownerId 를 빼고, 소유자는 get_project 의 members(OWNER)로 드러난다', async () => {
    for (const [name, args] of [
      ['list_projects', {}],
      ['get_project', { projectKey: 'WP' }],
      ['create_project', { projectKey: 'WP', name: '워크플레이스' }],
      ['update_project', { projectKey: 'WP', name: '워크플레이스' }],
    ] as const) {
      const body = out(await find(tools, name).handler(args));
      expect(userIdLeaks(body), name).toEqual([]);
    }
    const detail = out(await find(tools, 'get_project').handler({ projectKey: 'WP' }));
    expect(detail.members).toEqual([{ username: 'alice', name: '앨리스', role: 'OWNER' }]);
    expect(detail).toMatchObject({ key: 'WP', memberCount: 2 });
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
    searchMembers: vi.fn(),
  };
  const tools = buildMessagingTools(client as never) as never as Parameters<typeof find>[0];

  it('채널 도구 3종은 id 를 channelId 로 바꾸고 마지막 메시지 미리보기의 authorId 를 뺀다', async () => {
    const list = out(await find(tools, 'list_channels').handler({}));
    expect(userIdLeaks(list)).toEqual([]);
    expect(list.items[0]).toMatchObject({ channelId: 5, name: '일반', lastMessage: { id: 40, authorName: '앨리스', preview: '안녕' } });
    expect(list.items[0]).not.toHaveProperty('id');
    const discovered = out(await find(tools, 'discover_channels').handler({ q: '일' }));
    expect(userIdLeaks(discovered)).toEqual([]);
    expect(discovered[0]).toMatchObject({ channelId: 5 });
    expect(discovered[0]).not.toHaveProperty('lastMessage'); // 값이 없는 키는 생략
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
