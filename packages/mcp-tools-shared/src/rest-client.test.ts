import { describe, expect, it, vi } from 'vitest';
import { FileTooLargeError } from './attachment-read.js';
import { createSharedToolClient, type HttpLike } from './rest-client.js';

/** axios 인스턴스를 흉내 내는 HttpLike mock — 기본 응답은 { data: null }. */
function mockHttp() {
  const ok = () => vi.fn().mockResolvedValue({ data: null });
  const http = { get: ok(), post: ok(), put: ok(), patch: ok(), delete: ok() };
  return { http, client: createSharedToolClient(http as HttpLike) };
}

describe('createSharedToolClient 연락처 부가 기능 경로(#839)', () => {
  it('즐겨찾기 해제는 DELETE 본문(config.data)으로 대상을 보낸다', async () => {
    const { http, client } = mockHttp();
    await client.addContactFavorite({ targetType: 'MEMBER', targetId: 3 });
    expect(http.post).toHaveBeenCalledWith('/contacts/favorites', { targetType: 'MEMBER', targetId: 3 });
    await client.removeContactFavorite({ targetType: 'EXTERNAL', targetId: 9 });
    expect(http.delete).toHaveBeenCalledWith('/contacts/favorites', { data: { targetType: 'EXTERNAL', targetId: 9 } });
  });

  it('facets·그룹 조회/생성/수정/멤버 경로', async () => {
    const { http, client } = mockHttp();
    await client.getContactFacets();
    expect(http.get).toHaveBeenCalledWith('/contacts/facets');
    await client.listUserGroups();
    expect(http.get).toHaveBeenCalledWith('/user-groups');
    await client.getUserGroup(10);
    expect(http.get).toHaveBeenCalledWith('/user-groups/10');
    await client.createUserGroup({ name: 'g', visibility: 'PERSONAL' });
    expect(http.post).toHaveBeenCalledWith('/user-groups', { name: 'g', visibility: 'PERSONAL' });
    await client.updateUserGroup(10, { name: 'g', moveToRoot: true });
    expect(http.patch).toHaveBeenCalledWith('/user-groups/10', { name: 'g', moveToRoot: true });
    await client.addUserGroupMember(10, { targetType: 'MEMBER', targetId: 3 });
    expect(http.post).toHaveBeenCalledWith('/user-groups/10/members', { targetType: 'MEMBER', targetId: 3 });
    await client.removeUserGroupMember(10, { targetType: 'EXTERNAL', targetId: 9 });
    expect(http.delete).toHaveBeenCalledWith('/user-groups/10/members/EXTERNAL/9');
  });

  it('listUserGroups 는 빈 응답을 {} 로 채운다', async () => {
    const { client } = mockHttp();
    expect(await client.listUserGroups()).toEqual({});
  });
});

describe('createSharedToolClient 경로 매핑', () => {
  it('issueKey → /projects/{key}/issues/{number}', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValue({ data: { summary: { id: 1 } } });
    await client.getIssueDetail('WP-12');
    expect(http.get).toHaveBeenCalledWith('/projects/WP/issues/12');
  });

  it('프로젝트 키는 경로 세그먼트로 인코딩한다', async () => {
    const { http, client } = mockHttp();
    await client.getProject('A B');
    expect(http.get).toHaveBeenCalledWith('/projects/A%20B');
  });

  it('updateIssueContent 는 이슈 경로로 PATCH', async () => {
    const { http, client } = mockHttp();
    await client.updateIssueContent('WP-12', { title: 't' });
    expect(http.patch).toHaveBeenCalledWith('/projects/WP/issues/12', { title: 't' });
  });

  it('addComment 는 상세 GET 으로 summary.id 를 얻어 /issues/{id}/comments 로 POST', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValue({ data: { summary: { id: 77 } } });
    await client.addComment('WP-12', '안녕');
    expect(http.get).toHaveBeenCalledWith('/projects/WP/issues/12');
    expect(http.post).toHaveBeenCalledWith('/issues/77/comments', { body: '안녕' });
  });

  it('editComment 는 /issues/{id}/comments/{commentId} 로 PATCH', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValue({ data: { summary: { id: 77 } } });
    await client.editComment('WP-12', 5, '수정');
    expect(http.patch).toHaveBeenCalledWith('/issues/77/comments/5', { body: '수정' });
  });

  it('removeIssueDependency 는 쿼리 파라미터로 DELETE', async () => {
    const { http, client } = mockHttp();
    await client.removeIssueDependency('WP-1', 2, 'blocks');
    expect(http.delete).toHaveBeenCalledWith('/projects/WP/issues/1/dependencies', {
      params: { otherNumber: 2, direction: 'blocks' },
    });
  });

  it('listIssues 는 /me/issues 에 쿼리(cursor 포함)를 그대로 싣고 { items, nextCursor, hasMore } 를 돌려준다(WP-352)', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValue({ data: { items: [{ issueKey: 'WP-1' }], nextCursor: 'c2', hasMore: true } });
    expect(await client.listIssues({ assignee: 'me', size: 30, cursor: 'c1' })).toEqual({
      items: [{ issueKey: 'WP-1' }],
      nextCursor: 'c2',
      hasMore: true,
    });
    expect(http.get).toHaveBeenCalledWith('/me/issues', { params: { assignee: 'me', size: 30, cursor: 'c1' } });
    http.get.mockResolvedValue({ data: { items: [{ issueKey: 'WP-2' }], nextCursor: null, hasMore: false } });
    expect(await client.listIssues({})).toEqual({ items: [{ issueKey: 'WP-2' }], nextCursor: null, hasMore: false });
    http.get.mockResolvedValue({ data: null });
    expect(await client.listIssues({})).toEqual({ items: [], nextCursor: undefined, hasMore: undefined });
  });

  it('listProjects 는 Spring 페이지의 total·다음 페이지 여부(page+1<totalPages)를 보존하고 bare 배열도 처리한다(WP-352)', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValueOnce({ data: { content: [{ key: 'WP' }], page: 0, size: 50, totalElements: 120, totalPages: 3 } });
    expect(await client.listProjects(0, 50)).toEqual({ items: [{ key: 'WP' }], total: 120, hasMore: true, page: 0 });
    expect(http.get).toHaveBeenCalledWith('/projects', { params: { page: 0, size: 50 } });
    // 마지막 페이지
    http.get.mockResolvedValueOnce({ data: { content: [{ key: 'ZZ' }], page: 2, size: 50, totalElements: 120, totalPages: 3 } });
    expect(await client.listProjects(2, 50)).toEqual({ items: [{ key: 'ZZ' }], total: 120, hasMore: false, page: 2 });
    http.get.mockResolvedValueOnce({ data: [{ key: 'AB' }] });
    expect(await client.listProjects(0, 50)).toEqual({ items: [{ key: 'AB' }], hasMore: false, page: 0 });
    http.get.mockResolvedValueOnce({ data: null });
    expect(await client.listProjects(0, 50)).toEqual({ items: [], total: undefined, hasMore: false, page: 0 });
  });

  it('searchWikiPages(query) 는 /wiki/search 에 params {q} 로 보낸다', async () => {
    const { http, client } = mockHttp();
    await client.searchWikiPages('배포');
    expect(http.get).toHaveBeenCalledWith('/wiki/search', { params: { q: '배포' } });
  });

  it('updateWikiPage 는 snapshot:false 를 동봉해 PUT', async () => {
    const { http, client } = mockHttp();
    await client.updateWikiPage(5, { version: 3, title: 't' });
    expect(http.put.mock.calls[0]).toStrictEqual(['/wiki/pages/5', { version: 3, title: 't', snapshot: false }]);
  });

  it('createWikiPage 는 스페이스 경로로 POST', async () => {
    const { http, client } = mockHttp();
    await client.createWikiPage(2, { parentId: null, title: 't' });
    expect(http.post).toHaveBeenCalledWith('/wiki/spaces/2/pages', { parentId: null, title: 't' });
  });

  it('listEvents 는 from/to 를 params 로 보낸다', async () => {
    const { http, client } = mockHttp();
    await client.listEvents('a', 'b');
    expect(http.get).toHaveBeenCalledWith('/calendar/events', { params: { from: 'a', to: 'b' } });
  });

  it('listMail 은 query/unread 가 없으면 키를 넣지 않는다', async () => {
    const { http, client } = mockHttp();
    await client.listMail(2, { folder: 'INBOX', limit: 20 });
    expect(http.get.mock.calls[0]).toStrictEqual(['/mail/accounts/2/messages', { params: { folder: 'INBOX', limit: 20 } }]);
  });

  it('listMail 은 query·unread 가 있으면 실어 보낸다(unread 는 true 일 때만)', async () => {
    const { http, client } = mockHttp();
    await client.listMail(2, { folder: 'INBOX', limit: 20, query: '검토', unread: true });
    expect(http.get).toHaveBeenCalledWith('/mail/accounts/2/messages', {
      params: { folder: 'INBOX', limit: 20, query: '검토', unread: true },
    });
    await client.listMail(2, { folder: 'INBOX', limit: 20, unread: false });
    expect(http.get.mock.calls[1][1].params).not.toHaveProperty('unread');
  });

  it('searchMembers 는 /members 를 쓰고 {content} 래퍼와 bare 배열을 모두 처리한다', async () => {
    const { http, client } = mockHttp();
    const params = { search: 'kim', kind: 'ALL' as const, page: 0, size: 50 };
    http.get.mockResolvedValueOnce({ data: { content: [{ userId: 1, username: 'kim', name: '김' }] } });
    expect(await client.searchMembers(params)).toEqual([{ userId: 1, username: 'kim', name: '김' }]);
    expect(http.get).toHaveBeenCalledWith('/members', { params });
    http.get.mockResolvedValueOnce({ data: [{ userId: 2, username: 'lee', name: '이' }] });
    expect(await client.searchMembers(params)).toEqual([{ userId: 2, username: 'lee', name: '이' }]);
    http.get.mockResolvedValueOnce({ data: null });
    expect(await client.searchMembers(params)).toEqual([]);
  });

  it('searchMembersPage 는 같은 /members 경로에서 total·다음 페이지 여부를 함께 돌려준다(WP-352)', async () => {
    const { http, client } = mockHttp();
    const params = { search: 'kim', kind: 'ALL' as const, page: 1, size: 20 };
    http.get.mockResolvedValueOnce({
      data: { content: [{ userId: 1, username: 'kim', name: '김' }], page: 1, size: 20, totalElements: 45, totalPages: 3 },
    });
    expect(await client.searchMembersPage(params)).toEqual({ items: [{ userId: 1, username: 'kim', name: '김' }], total: 45, hasMore: true, page: 1 });
    expect(http.get).toHaveBeenCalledWith('/members', { params });
  });

  it('연락처 경로 — 구성원은 /contacts/members/{userId}, 외부는 /contacts/external/{id}', async () => {
    const { http, client } = mockHttp();
    await client.getMemberContact(3);
    await client.getExternalContact(4);
    await client.listContacts({ limit: 20 });
    expect(http.get).toHaveBeenNthCalledWith(1, '/contacts/members/3');
    expect(http.get).toHaveBeenNthCalledWith(2, '/contacts/external/4');
    expect(http.get).toHaveBeenNthCalledWith(3, '/contacts', { params: { limit: 20 } });
  });

  it('listChannelMessages 는 limit·cursor 를 params 로 보내고 { items, nextCursor, hasMore } 를 돌려준다(WP-352)', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValueOnce({ data: { items: [{ id: 1 }], nextCursor: 'n1', hasMore: true } });
    expect(await client.listChannelMessages(7, { limit: 50 })).toEqual({ items: [{ id: 1 }], nextCursor: 'n1', hasMore: true });
    // cursor 를 안 주면 params 에 싣지 않는다.
    expect(http.get).toHaveBeenLastCalledWith('/messaging/channels/7/messages', { params: { limit: 50 } });
    http.get.mockResolvedValueOnce({ data: { items: [], nextCursor: null, hasMore: false } });
    await client.listChannelMessages(7, { limit: 50, cursor: 'n1' });
    expect(http.get).toHaveBeenLastCalledWith('/messaging/channels/7/messages', { params: { limit: 50, cursor: 'n1' } });
    http.get.mockResolvedValueOnce({ data: null });
    expect(await client.listChannelMessages(7, { limit: 50 })).toEqual({ items: [], nextCursor: undefined, hasMore: undefined });
  });

  it('addChannelMessage 는 parentMessageId 를 본문에 실어 POST', async () => {
    const { http, client } = mockHttp();
    await client.addChannelMessage(9, '답', 210);
    expect(http.post).toHaveBeenCalledWith('/messaging/channels/9/messages', { body: '답', parentMessageId: 210 });
  });

  it('listDriveItems 는 parentId 가 없으면 params undefined, 있으면 {parentId}', async () => {
    const { http, client } = mockHttp();
    await client.listDriveItems(3);
    expect(http.get).toHaveBeenNthCalledWith(1, '/drive/spaces/3/items', { params: undefined });
    await client.listDriveItems(3, 8);
    expect(http.get).toHaveBeenNthCalledWith(2, '/drive/spaces/3/items', { params: { parentId: 8 } });
  });

  it('listDriveItems 는 page 를 주면 limit·offset 을 params 로 싣고(WP-352), 안 주면 싣지 않는다', async () => {
    const { http, client } = mockHttp();
    await client.listDriveItems(3, undefined, { limit: 201, offset: 0 });
    expect(http.get).toHaveBeenNthCalledWith(1, '/drive/spaces/3/items', { params: { limit: 201, offset: 0 } });
    await client.listDriveItems(3, 8, { limit: 11, offset: 20 });
    expect(http.get).toHaveBeenNthCalledWith(2, '/drive/spaces/3/items', { params: { parentId: 8, limit: 11, offset: 20 } });
  });

  it('searchDrive 는 q 를 params 로 보낸다', async () => {
    const { http, client } = mockHttp();
    await client.searchDrive(3, '보고서');
    expect(http.get).toHaveBeenCalledWith('/drive/spaces/3/search', { params: { q: '보고서' } });
  });

  it('#850 조회 경로: 드라이브 요약·내용검색, 스레드 답글, 노트 페이지·백링크', async () => {
    const { http, client } = mockHttp();
    await client.getDriveFileSummary(5);
    expect(http.get).toHaveBeenCalledWith('/drive/files/5/summary');
    await client.searchDriveContent({ q: '매출', limit: 10 });
    expect(http.get).toHaveBeenCalledWith('/drive/search', { params: { q: '매출', limit: 10 } });
    http.get.mockResolvedValueOnce({ data: { items: [{ id: 31 }], nextCursor: null, hasMore: false } });
    expect(await client.getThreadReplies(30, { limit: 50 })).toEqual({ items: [{ id: 31 }], nextCursor: null, hasMore: false });
    expect(http.get).toHaveBeenCalledWith('/messaging/messages/30/replies', { params: { limit: 50 } });
    await client.listWikiPages(9);
    expect(http.get).toHaveBeenCalledWith('/wiki/spaces/9/pages');
    http.get.mockResolvedValueOnce({ data: { items: [{ pageId: 1 }] } });
    expect(await client.getWikiBacklinks(3)).toEqual([{ pageId: 1 }]);
    expect(http.get).toHaveBeenCalledWith('/wiki/pages/3/backlinks');
  });

  it('알림 경로: 목록·안읽음 수·단건/전체 읽음', async () => {
    const { http, client } = mockHttp();
    await client.listNotifications({ limit: 20, offset: 100 });
    expect(http.get).toHaveBeenCalledWith('/notifications', { params: { limit: 20, offset: 100 } });
    http.get.mockResolvedValueOnce({ data: { count: 4 } });
    expect(await client.countUnreadNotifications()).toBe(4);
    expect(http.get).toHaveBeenCalledWith('/notifications/unread-count');
    await client.markNotificationRead(11);
    expect(http.post).toHaveBeenCalledWith('/notifications/11/read');
    await client.markAllNotificationsRead();
    expect(http.post).toHaveBeenCalledWith('/notifications/read-all');
  });

  it('#854 업무 쓰기 경로: 사이클·워치·마일스톤/사이클 목록·프로젝트 수정·노트 이동·휴지통', async () => {
    const { http, client } = mockHttp();
    await client.replaceIssueCycles('WP-3', [1, 2]);
    expect(http.put).toHaveBeenCalledWith('/projects/WP/issues/3/cycles', { cycleIds: [1, 2] });
    await client.watchIssue('WP-3');
    expect(http.post).toHaveBeenCalledWith('/projects/WP/issues/3/watch');
    await client.unwatchIssue('WP-3');
    expect(http.delete).toHaveBeenCalledWith('/projects/WP/issues/3/watch');
    expect(await client.getProjectMilestones('WP')).toEqual([]);
    expect(http.get).toHaveBeenCalledWith('/projects/WP/milestones');
    expect(await client.getProjectCycles('WP')).toEqual([]);
    expect(http.get).toHaveBeenCalledWith('/projects/WP/cycles');
    // WP-53: 담당자 'me' 해석용 호출자 조회.
    http.get.mockResolvedValueOnce({ data: { id: 1, username: 'u' } });
    expect(await client.getMe()).toEqual({ id: 1, username: 'u' });
    expect(http.get).toHaveBeenLastCalledWith('/auth/me');
    await client.updateProject('WP', { clearDescription: true });
    expect(http.patch).toHaveBeenCalledWith('/projects/WP', { clearDescription: true });
    await client.moveWikiPage(4, { parentId: null, position: 0 });
    expect(http.patch).toHaveBeenCalledWith('/wiki/pages/4/move', { parentId: null, position: 0 });
    http.get.mockResolvedValueOnce({ data: { items: [{ type: 'FILE', id: 1 }] } });
    expect(await client.listDriveTrash(2)).toEqual([{ type: 'FILE', id: 1 }]);
    expect(http.get).toHaveBeenLastCalledWith('/drive/spaces/2/trash');
    await client.restoreDriveFile(5);
    await client.restoreDriveFolder(6);
    expect(http.post).toHaveBeenCalledWith('/drive/files/5/restore');
    expect(http.post).toHaveBeenCalledWith('/drive/folders/6/restore');
  });

  it('WP-147: getMail 은 AI 조회라 항상 markSeen=false 로 부른다(읽음 처리 안 함)', async () => {
    const { http, client } = mockHttp();
    await client.getMail(3);
    expect(http.get).toHaveBeenCalledWith('/mail/messages/3', { params: { markSeen: false } });
  });

  it('#855 소통 쓰기 경로: RSVP·채널·DM·메일 AI·회신필요', async () => {
    const { http, client } = mockHttp();
    await client.rsvpEvent(7, 'TENTATIVE');
    expect(http.patch).toHaveBeenCalledWith('/calendar/events/7/rsvp', { status: 'TENTATIVE' });
    // WP-348: 일정 생성·수정·참석자 — 알림 여부는 쿼리(notify), 반복 범위는 쿼리(scope·occurrenceDate)로 보낸다.
    const body = { title: 't', startsAt: 'a', endsAt: 'b', allDay: false };
    await client.createEvent({ ...body, attendeeUserIds: [2] }, { notify: false });
    expect(http.post).toHaveBeenCalledWith('/calendar/events', { ...body, attendeeUserIds: [2] }, { params: { notify: false } });
    await client.updateEvent(7, body, { scope: 'ALL' });
    expect(http.patch).toHaveBeenCalledWith('/calendar/events/7', body, { params: { scope: 'ALL' } });
    await client.updateEvent(7, body, { scope: 'THIS', occurrenceDate: 'o' });
    expect(http.patch).toHaveBeenCalledWith('/calendar/events/7', body, { params: { scope: 'THIS', occurrenceDate: 'o' } });
    await client.addEventAttendees(7, [2, 3], { notify: true });
    expect(http.post).toHaveBeenCalledWith('/calendar/events/7/attendees', { userIds: [2, 3] }, { params: { notify: true } });
    await client.removeEventAttendee(7, 3);
    expect(http.delete).toHaveBeenCalledWith('/calendar/events/7/attendees/3');
    await client.getChannel(9);
    expect(http.get).toHaveBeenCalledWith('/messaging/channels/9');
    await client.createChannel({ name: 'c', visibility: 'PRIVATE' });
    expect(http.post).toHaveBeenCalledWith('/messaging/channels', { name: 'c', visibility: 'PRIVATE' });
    await client.openDm([5]);
    expect(http.post).toHaveBeenCalledWith('/messaging/dms', { userIds: [5] });
    await client.leaveChannel(9);
    expect(http.post).toHaveBeenCalledWith('/messaging/channels/9/leave');
    await client.getMailSummary(3);
    expect(http.get).toHaveBeenCalledWith('/mail/messages/3/summary');
    await client.draftMailReply(3);
    expect(http.post).toHaveBeenCalledWith('/mail/messages/3/reply-draft');
    await client.draftIssueFromMail(3);
    expect(http.post).toHaveBeenCalledWith('/mail/messages/3/issue-draft');
    await client.promoteMailToIssue(3, { projectKey: 'WP', title: 't' });
    expect(http.post).toHaveBeenCalledWith('/mail/messages/3/issue', { projectKey: 'WP', title: 't' });
    await client.markMailRead(3);
    expect(http.post).toHaveBeenCalledWith('/mail/messages/3/read');
  });

  it('WP-349: 프로젝트 생성·멤버 추가·채널 초대 경로(확인 카드 실행기와 같은 서비스 메서드에 닿는 REST)', async () => {
    const { http, client } = mockHttp();
    http.post.mockResolvedValueOnce({ data: { key: 'NEW' } });
    expect(await client.createProject({ key: 'NEW', name: 'n', type: 'TEAM' })).toEqual({ key: 'NEW' });
    expect(http.post).toHaveBeenLastCalledWith('/projects', { key: 'NEW', name: 'n', type: 'TEAM' });
    http.post.mockResolvedValueOnce({ data: { userId: 5, username: 'minsu', role: 'MEMBER' } });
    expect(await client.addProjectMember('A B', { userId: 5, role: 'MEMBER' })).toEqual({ userId: 5, username: 'minsu', role: 'MEMBER' });
    // 프로젝트 키는 경로 세그먼트라 인코딩한다(다른 프로젝트 경로와 같은 규칙).
    expect(http.post).toHaveBeenLastCalledWith('/projects/A%20B/members', { userId: 5, role: 'MEMBER' });
    await client.addChannelMember(9, 5);
    expect(http.post).toHaveBeenLastCalledWith('/messaging/channels/9/members', { userId: 5 });
  });

  it('getMailLinkedIssue 는 서버의 { issueKey: null } 을 null 로 바꾼다', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValueOnce({ data: { issueKey: null } });
    expect(await client.getMailLinkedIssue(3)).toBeNull();
    http.get.mockResolvedValueOnce({ data: { issueKey: 'WP-2' } });
    expect(await client.getMailLinkedIssue(3)).toEqual({ issueKey: 'WP-2' });
    expect(http.get).toHaveBeenCalledWith('/mail/messages/3/linked-issue');
  });

  it('목록형 조회는 data 가 없으면 빈 배열로 대체한다', async () => {
    const { client } = mockHttp();
    expect(await client.listWikiSpaces()).toEqual([]);
    expect(await client.listMailAccounts()).toEqual([]);
    expect(await client.listChannels()).toEqual([]);
    expect(await client.listDriveSpaces()).toEqual([]);
    expect(await client.getProjectTypes('WP')).toEqual([]);
    expect(await client.listWikiPages(1)).toEqual([]);
    expect(await client.listNotifications({ limit: 20, offset: 0 })).toEqual([]);
    expect(await client.searchDriveContent({ q: 'x', limit: 10 })).toEqual({ hits: [] });
  });
});

describe('createSharedToolClient WP-343 이동 도구 경로', () => {
  it('드라이브 폴더·파일 정리: 생성·이름변경은 응답 raw, 이동은 본문에 null(루트) 그대로', async () => {
    const { http, client } = mockHttp();
    http.post.mockResolvedValueOnce({ data: { id: 10, name: '새 폴더' } });
    expect(await client.createDriveFolder(1, null, '새 폴더')).toEqual({ id: 10, name: '새 폴더' });
    expect(http.post).toHaveBeenLastCalledWith('/drive/spaces/1/folders', { parentId: null, name: '새 폴더' });
    await client.createDriveFolder(1, 5, '하위');
    expect(http.post).toHaveBeenLastCalledWith('/drive/spaces/1/folders', { parentId: 5, name: '하위' });
    http.patch.mockResolvedValueOnce({ data: { id: 10, name: '변경' } });
    expect(await client.renameDriveFolder(10, '변경')).toEqual({ id: 10, name: '변경' });
    expect(http.patch).toHaveBeenLastCalledWith('/drive/folders/10', { name: '변경' });
    await client.moveDriveFolder(10, null);
    expect(http.patch).toHaveBeenLastCalledWith('/drive/folders/10/move', { targetParentId: null });
    await client.moveDriveFile(5, 10);
    expect(http.patch).toHaveBeenLastCalledWith('/drive/files/5/move', { targetFolderId: 10 });
  });

  it('외부 연락처 생성·수정: force 는 true 일 때만 쿼리로 붙는다(#839)', async () => {
    const { http, client } = mockHttp();
    const body = { name: '신규', visibility: 'SHARED' as const };
    await client.createExternalContact(body);
    expect(http.post).toHaveBeenLastCalledWith('/contacts/external', body, undefined);
    await client.createExternalContact(body, false);
    expect(http.post).toHaveBeenLastCalledWith('/contacts/external', body, undefined);
    await client.createExternalContact(body, true);
    expect(http.post).toHaveBeenLastCalledWith('/contacts/external', body, { params: { force: true } });
    await client.updateExternalContact(9, { phone: '010-1' }, true);
    expect(http.patch).toHaveBeenLastCalledWith('/contacts/external/9', { phone: '010-1' }, { params: { force: true } });
    await client.updateExternalContact(9, { phone: '010-1' });
    expect(http.patch).toHaveBeenLastCalledWith('/contacts/external/9', { phone: '010-1' }, undefined);
  });

  it('메일 동기화는 POST /mail/accounts/{id}/sync 의 응답을 그대로 돌려준다', async () => {
    const { http, client } = mockHttp();
    http.post.mockResolvedValueOnce({ data: { saved: 5 } });
    expect(await client.syncMail(3)).toEqual({ saved: 5 });
    expect(http.post).toHaveBeenCalledWith('/mail/accounts/3/sync', {});
  });

  it('메일 동기화 진행 상태는 GET /mail/accounts/{id}/sync-status 의 응답을 그대로 돌려준다(WP-353)', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValueOnce({ data: { phase: 'LIST', total: 0, done: 0, running: true } });
    expect(await client.getMailSyncStatus(3)).toEqual({ phase: 'LIST', total: 0, done: 0, running: true });
    expect(http.get).toHaveBeenCalledWith('/mail/accounts/3/sync-status');
  });

  it('채널 탐색은 q 를 쿼리로 보내고 비배열 응답은 빈 배열로 대체한다', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValueOnce({ data: [{ id: 2, name: '개발팀' }] });
    expect(await client.discoverChannels('개발팀')).toEqual([{ id: 2, name: '개발팀' }]);
    expect(http.get).toHaveBeenLastCalledWith('/messaging/channels/discover', { params: { q: '개발팀' } });
    expect(await client.discoverChannels('없음')).toEqual([]);
  });
});

describe('createSharedToolClient 첨부·파일 내용 읽기 경로(WP-346)', () => {
  it('이슈 첨부 텍스트 — issueKey 경로 + offset/limit 쿼리, 생략한 값은 싣지 않는다', async () => {
    const { http, client } = mockHttp();
    await client.readIssueAttachmentText('WP-12', 3, { offset: 6, limit: 100 });
    expect(http.get).toHaveBeenCalledWith('/projects/WP/issues/12/attachments/3/text', { params: { offset: 6, limit: 100 } });
    await client.readIssueAttachmentText('WP-12', 3, { limit: 12000 });
    expect(http.get).toHaveBeenLastCalledWith('/projects/WP/issues/12/attachments/3/text', { params: { limit: 12000 } });
  });

  it('드라이브 파일 텍스트 — /drive/files/{id}/text', async () => {
    const { http, client } = mockHttp();
    await client.readDriveFileText(9, { offset: 0, limit: 500 });
    expect(http.get).toHaveBeenCalledWith('/drive/files/9/text', { params: { offset: 0, limit: 500 } });
  });

  it('이슈 첨부 목록·드라이브 버전 목록 — 배열이 아니면 빈 배열', async () => {
    const { http, client } = mockHttp();
    expect(await client.listIssueAttachments('WP-12')).toEqual([]);
    expect(http.get).toHaveBeenCalledWith('/projects/WP/issues/12/attachments');
    expect(await client.listDriveFileVersions(9)).toEqual([]);
    expect(http.get).toHaveBeenCalledWith('/drive/files/9/versions');
    http.get.mockResolvedValue({ data: [{ versionNo: 1, sizeBytes: 4, current: true }] });
    expect(await client.listDriveFileVersions(9)).toEqual([{ versionNo: 1, sizeBytes: 4, current: true }]);
  });

  it('원본 받기 — arraybuffer 로 요청하고 Content-Type 을 함께 돌려준다(Buffer·ArrayBuffer 모두)', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValueOnce({ data: Buffer.from([1, 2]), headers: { 'content-type': 'image/png' } });
    const a = await client.downloadIssueAttachment('WP-12', 3);
    expect(http.get).toHaveBeenCalledWith('/projects/WP/issues/12/attachments/3/content', { responseType: 'arraybuffer', maxContentLength: 3_932_160, maxBodyLength: 3_932_160 });
    expect([...a.data]).toEqual([1, 2]);
    expect(a.mimeType).toBe('image/png');

    http.get.mockResolvedValueOnce({ data: new Uint8Array([7]).buffer, headers: {} });
    const b = await client.downloadDriveFile(9);
    expect(http.get).toHaveBeenLastCalledWith('/drive/files/9/content', { responseType: 'arraybuffer', maxContentLength: 3_932_160, maxBodyLength: 3_932_160 });
    expect([...b.data]).toEqual([7]);
    expect(b.mimeType).toBe('application/octet-stream');
  });

  it('원본 받기 — 다운로드 상한(이미지 3.75MB)을 건다: axios 의 maxContentLength 초과는 FileTooLargeError 로 바뀐다', async () => {
    const { http, client } = mockHttp();
    http.get.mockRejectedValueOnce(Object.assign(new Error('maxContentLength size of 3932160 exceeded'), { code: 'ERR_BAD_RESPONSE' }));
    await expect(client.downloadDriveFile(9)).rejects.toBeInstanceOf(FileTooLargeError);
    // 상한과 무관한 오류는 그대로 던진다.
    http.get.mockRejectedValueOnce(new Error('Network Error'));
    await expect(client.downloadIssueAttachment('WP-12', 3)).rejects.toThrow('Network Error');
  });
});
