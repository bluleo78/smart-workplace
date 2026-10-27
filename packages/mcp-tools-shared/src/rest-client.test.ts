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

  it('이슈 챗: 스레드 id 를 구하고 메시지를 after / afterMine 으로 읽는다(WP-373)', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValueOnce({ data: { threadId: 55 } });
    expect(await client.getIssueChatThreadId('WP-1')).toBe(55);
    expect(http.get).toHaveBeenLastCalledWith('/projects/WP/issues/1/chat/thread');
    http.get.mockResolvedValueOnce({ data: { items: [{ id: 1 }], nextCursor: '1', hasMore: true } });
    expect(await client.listIssueChatMessages(55, {})).toEqual({ items: [{ id: 1 }], nextCursor: '1', hasMore: true });
    expect(http.get).toHaveBeenLastCalledWith('/chat/threads/55/messages', { params: { afterMine: true, limit: undefined } });
    http.get.mockResolvedValueOnce({ data: null });
    expect(await client.listIssueChatMessages(55, { after: 10, limit: 5 })).toEqual({ items: [], nextCursor: undefined, hasMore: false });
    expect(http.get).toHaveBeenLastCalledWith('/chat/threads/55/messages', { params: { after: 10, limit: 5 } });
  });

  it('이슈 챗 첨부: 스레드 id 를 구해 텍스트·변환본(/view) 경로로 읽는다(WP-373)', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValueOnce({ data: { threadId: 55 } }).mockResolvedValueOnce({ data: { status: 'READY' } });
    await client.readIssueChatAttachmentText('WP-1', 11, 900, { offset: 0, limit: 100 });
    expect(http.get).toHaveBeenLastCalledWith('/chat/threads/55/attachments/900/text', { params: { offset: 0, limit: 100 } });
    // 같은 이슈의 스레드 id 는 캐시되어 다시 구하지 않는다.
    http.get.mockResolvedValueOnce({ data: new Uint8Array([7]).buffer, headers: { 'content-type': 'image/png' } });
    expect((await client.viewIssueChatAttachment('WP-1', 900, 2)).mimeType).toBe('image/png');
    expect(http.get).toHaveBeenLastCalledWith('/chat/threads/55/attachments/900/view?page=2', expect.objectContaining({ responseType: 'arraybuffer' }));
  });

  it('이슈 챗 스레드(참여자 포함)는 캐시 없이 매번 읽고, 받은 스레드 id 는 캐시에 넣는다(WP-1009)', async () => {
    const { http, client } = mockHttp();
    const members = [{ userId: 3, username: 'dh', name: '양동희', kind: 'HUMAN' }];
    http.get.mockResolvedValue({ data: { threadId: 55, members } });
    expect(await client.getIssueChatThread('WP-1')).toEqual({ threadId: 55, members });
    expect(await client.getIssueChatThread('WP-1')).toEqual({ threadId: 55, members });
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get).toHaveBeenLastCalledWith('/projects/WP/issues/1/chat/thread');
    expect(await client.getIssueChatThreadId('WP-1')).toBe(55);
    expect(http.get).toHaveBeenCalledTimes(2);
    http.get.mockResolvedValueOnce({ data: { threadId: 66 } });
    expect(await client.getIssueChatThread('WP-2')).toEqual({ threadId: 66, members: [] });
  });

  it('이슈 챗 스레드 id 는 같은 issueKey 로 한 번만 조회하고, 실패하면 캐시하지 않는다', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValueOnce({ data: { threadId: 55 } });
    expect(await client.getIssueChatThreadId('WP-1')).toBe(55);
    expect(await client.getIssueChatThreadId('WP-1')).toBe(55);
    expect(http.get).toHaveBeenCalledTimes(1);
    http.get.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ data: { threadId: 66 } });
    await expect(client.getIssueChatThreadId('WP-2')).rejects.toThrow('boom');
    expect(await client.getIssueChatThreadId('WP-2')).toBe(66);
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

  it('WP-357: searchWikiPages(query, spaceId) 는 spaceId 가 있을 때만 params 에 싣는다', async () => {
    const { http, client } = mockHttp();
    await client.searchWikiPages('배포', 4);
    expect(http.get).toHaveBeenCalledWith('/wiki/search', { params: { q: '배포', spaceId: 4 } });
  });

  it('WP-357: 노트 요약은 GET(AI 생성 POST 가 아니다), 판 기록 목록·복원 경로', async () => {
    const { http, client } = mockHttp();
    await client.getWikiPageSummary(5);
    expect(http.get).toHaveBeenCalledWith('/wiki/pages/5/summary');
    expect(http.post).not.toHaveBeenCalled();
    await client.listWikiRevisions(5);
    expect(http.get).toHaveBeenCalledWith('/wiki/pages/5/revisions');
    await client.restoreWikiRevision(5, 3);
    expect(http.post).toHaveBeenCalledWith('/wiki/pages/5/revisions/3/restore');
  });

  it('WP-357: listMail 은 category·needsReply 를 있을 때만 params 에 싣고, markMailUnread 는 /unread 로 POST', async () => {
    const { http, client } = mockHttp();
    await client.listMail(2, { folder: 'INBOX', limit: 20 });
    expect(http.get).toHaveBeenLastCalledWith('/mail/accounts/2/messages', { params: { folder: 'INBOX', limit: 20 } });
    await client.listMail(2, { folder: 'INBOX', limit: 20, category: '업무', needsReply: true });
    expect(http.get).toHaveBeenLastCalledWith('/mail/accounts/2/messages', { params: { folder: 'INBOX', limit: 20, category: '업무', needsReply: true } });
    await client.markMailUnread(9);
    expect(http.post).toHaveBeenCalledWith('/mail/messages/9/unread');
  });

  it('WP-357: 홈 개요 경로 — 활동·우선순위·메일 요약·메시징 요약·스레드 인박스', async () => {
    const { http, client } = mockHttp();
    await client.getHomeActivity({ size: 10 });
    expect(http.get).toHaveBeenLastCalledWith('/me/activity', { params: { size: 10 } });
    await client.getHomeActivity({ size: 10, cursor: 'C' });
    expect(http.get).toHaveBeenLastCalledWith('/me/activity', { params: { size: 10, cursor: 'C' } });
    http.get.mockResolvedValueOnce({ data: { items: [{ sourceType: 'ISSUE_DUE' }] } });
    expect(await client.getPriorityItems()).toEqual([{ sourceType: 'ISSUE_DUE' }]); // 래퍼 { items } 를 벗긴다
    expect(await client.getPriorityItems()).toEqual([]);
    await client.getHomeMailSummary();
    expect(http.get).toHaveBeenLastCalledWith('/me/mail-summary');
    await client.getMessagingSummary();
    expect(http.get).toHaveBeenLastCalledWith('/me/messaging-summary');
    await client.getThreadInbox({ limit: 10 });
    expect(http.get).toHaveBeenLastCalledWith('/messaging/threads/inbox', { params: { limit: 10 } });
    await client.getThreadInbox({ limit: 10, cursor: 'C2' });
    expect(http.get).toHaveBeenLastCalledWith('/messaging/threads/inbox', { params: { limit: 10, cursor: 'C2' } });
  });

  it('updateWikiPage 는 snapshot:false 를 동봉해 PUT', async () => {
    const { http, client } = mockHttp();
    await client.updateWikiPage(5, { version: 3, title: 't' });
    expect(http.put.mock.calls[0]).toStrictEqual(['/wiki/pages/5', { version: 3, title: 't', snapshot: false }]);
  });

  it('claimWikiImages 는 페이지 첨부 claim 경로로 fileIds 를 POST 하고 응답을 돌려준다 (WP-424)', async () => {
    const { http, client } = mockHttp();
    http.post.mockResolvedValue({ data: [{ fileId: 9, url: '/u' }] });
    await expect(client.claimWikiImages(5, [9])).resolves.toEqual([{ fileId: 9, url: '/u' }]);
    expect(http.post).toHaveBeenCalledWith('/wiki/pages/5/attachments/claim', { fileIds: [9] });
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

  it('getMember 는 구성원 단건 /members/{userId} 를 읽는다(WP-376 — get_member 의 me)', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValueOnce({ data: { userId: 7, username: 'ai-dev', name: 'AI', kind: 'AGENT' } });
    expect(await client.getMember(7)).toEqual({ userId: 7, username: 'ai-dev', name: 'AI', kind: 'AGENT' });
    expect(http.get).toHaveBeenCalledWith('/members/7');
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

  // WP-423: 첨부 id 는 서버 CreateMessageRequest 에 그대로 싣고, 빈 배열·본문 없음은 생략한다.
  it('addChannelMessage 는 fileIds·driveFileIds 를 싣고 빈 배열은 생략한다', async () => {
    const { http, client } = mockHttp();
    await client.addChannelMessage(9, undefined, 210, { fileIds: [11], driveFileIds: [] });
    expect(http.post).toHaveBeenLastCalledWith('/messaging/channels/9/messages', { parentMessageId: 210, fileIds: [11] });
    await client.addChannelMessage(9, '글', undefined, { fileIds: [], driveFileIds: [5, 6] });
    expect(http.post).toHaveBeenLastCalledWith('/messaging/channels/9/messages', { body: '글', driveFileIds: [5, 6] });
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
    // WP-720: 이슈 단위 읽음 — 이슈 키를 숫자 id 로 바꿔 부른다.
    http.get.mockResolvedValueOnce({ data: { summary: { id: 77 } } });
    await client.markIssueNotificationsRead('WP-3');
    expect(http.get).toHaveBeenCalledWith('/projects/WP/issues/3');
    expect(http.post).toHaveBeenCalledWith('/notifications/issues/77/read');
  });

  it('WP-356 이슈·프로젝트 보강 경로: 워처·드라이브 링크·커스텀 필드·프로젝트 메타', async () => {
    const { http, client } = mockHttp();
    expect(await client.getIssueWatchers('WP-3')).toEqual([]);
    expect(http.get).toHaveBeenCalledWith('/projects/WP/issues/3/watchers');
    expect(await client.getIssueDriveLinks('WP-3')).toEqual([]);
    expect(http.get).toHaveBeenCalledWith('/projects/WP/issues/3/drive-links');
    expect(await client.getProjectFields('WP')).toEqual([]);
    expect(http.get).toHaveBeenCalledWith('/projects/WP/fields');
    // WP-807: 프로젝트 상태 목록
    expect(await client.getProjectStatuses('WP')).toEqual([]);
    expect(http.get).toHaveBeenCalledWith('/projects/WP/statuses');
    await client.updateIssueFields('WP-3', [{ defId: 8, value: 'A' }]);
    expect(http.put).toHaveBeenCalledWith('/projects/WP/issues/3/fields', { values: [{ defId: 8, value: 'A' }] });
    await client.addIssueDriveLink('WP-3', 77);
    expect(http.post).toHaveBeenCalledWith('/projects/WP/issues/3/drive-links', { driveFileId: 77 });
    await client.claimIssueAttachments('WP-3', [5, 6]);
    expect(http.post).toHaveBeenCalledWith('/projects/WP/issues/3/attachments/claim', { fileIds: [5, 6] });
    // WP-800: 대기열 이슈 가져가기 — POST .../claim 에 queueLabel 만 보내고 응답 본문을 그대로 돌려준다.
    http.post.mockResolvedValueOnce({ data: { assignees: [{ username: 'ai' }], labels: [] } });
    expect(await client.claimIssue('WP-9', 'AI 개발팀')).toEqual({ assignees: [{ username: 'ai' }], labels: [] });
    expect(http.post).toHaveBeenLastCalledWith('/projects/WP/issues/9/claim', { queueLabel: 'AI 개발팀' });
    await client.createProjectMeta('WP', 'label', { name: 'bug', colorToken: 'RED' });
    expect(http.post).toHaveBeenCalledWith('/projects/WP/labels', { name: 'bug', colorToken: 'RED' });
    await client.createProjectMeta('WP', 'milestone', { name: 'M', dueDate: '2026-12-01' });
    expect(http.post).toHaveBeenCalledWith('/projects/WP/milestones', { name: 'M', dueDate: '2026-12-01' });
    await client.updateProjectMeta('WP', 'cycle', 5, { name: 'C' });
    expect(http.patch).toHaveBeenCalledWith('/projects/WP/cycles/5', { name: 'C' });
    // WP-1005: 버전 — 메타 경로는 versions, 출시·출시 취소는 별도 POST.
    await client.createProjectMeta('WP', 'version', { name: 'v1.0.0' });
    expect(http.post).toHaveBeenCalledWith('/projects/WP/versions', { name: 'v1.0.0' });
    await client.releaseProjectVersion('WP', 7);
    expect(http.post).toHaveBeenLastCalledWith('/projects/WP/versions/7/release', {});
    await client.unreleaseProjectVersion('WP', 7);
    expect(http.post).toHaveBeenLastCalledWith('/projects/WP/versions/7/unrelease', {});
  });

  it('WP-933: 구성요소 — 목록은 /projects/{key}/components(없으면 빈 배열), 교체는 PUT .../components 에 componentIds', async () => {
    const { http, client } = mockHttp();
    expect(await client.getProjectComponents('WP')).toEqual([]);
    expect(http.get).toHaveBeenLastCalledWith('/projects/WP/components');
    http.put.mockResolvedValueOnce({ data: [{ id: 21, name: 'Compute', archived: false }] });
    expect(await client.replaceIssueComponents('WP-3', [21])).toEqual([{ id: 21, name: 'Compute', archived: false }]);
    expect(http.put).toHaveBeenLastCalledWith('/projects/WP/issues/3/components', { componentIds: [21] });
  });

  it('WP-888: 버전 — 목록은 /projects/{key}/versions(없으면 빈 배열), 교체는 PUT .../versions 에 준 종류만', async () => {
    const { http, client } = mockHttp();
    expect(await client.getProjectVersions('WP')).toEqual([]);
    expect(http.get).toHaveBeenLastCalledWith('/projects/WP/versions');
    http.put.mockResolvedValueOnce({ data: { fixVersions: [], affectsVersions: [] } });
    await client.replaceIssueVersions('WP-3', { fixVersionIds: [31] });
    expect(http.put).toHaveBeenLastCalledWith('/projects/WP/issues/3/versions', { fixVersionIds: [31] });
  });

  it('WP-887: 관계·외부 링크 경로 — 추가는 POST 본문 그대로, 삭제는 id 경로, 유형 목록은 /issue-relation-types', async () => {
    const { http, client } = mockHttp();
    http.post.mockResolvedValueOnce({ data: [{ id: 5 }] });
    expect(await client.addIssueRelation('WP-3', { typeId: 2, side: 'source', target: { projectKey: 'AB', number: 7 } })).toEqual([{ id: 5 }]);
    expect(http.post).toHaveBeenLastCalledWith('/projects/WP/issues/3/relations', { typeId: 2, side: 'source', target: { projectKey: 'AB', number: 7 } });
    await client.removeIssueRelation('WP-3', 5);
    expect(http.delete).toHaveBeenLastCalledWith('/projects/WP/issues/3/relations/5');
    await client.addIssueExternalLink('WP-3', { typeId: 2, side: 'target', url: 'https://jira.example/CLIM-1', key: 'CLIM-1', title: '외부' });
    expect(http.post).toHaveBeenLastCalledWith('/projects/WP/issues/3/external-links', { typeId: 2, side: 'target', url: 'https://jira.example/CLIM-1', key: 'CLIM-1', title: '외부' });
    await client.removeIssueExternalLink('WP-3', 8);
    expect(http.delete).toHaveBeenLastCalledWith('/projects/WP/issues/3/external-links/8');
    expect(await client.listIssueRelationTypes()).toEqual([]);
    expect(http.get).toHaveBeenLastCalledWith('/issue-relation-types');
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

  // WP-354: 파일 이름변경·복사·백링크·첨부 가져오기 경로 — 첨부 가져오기는 폴더 유무로 경로가 갈린다.
  it('WP-354 드라이브 파일 이름변경·복사·백링크·첨부 가져오기 경로', async () => {
    const { http, client } = mockHttp();
    await client.renameDriveFile(5, '새이름.pdf');
    expect(http.patch).toHaveBeenCalledWith('/drive/files/5', { name: '새이름.pdf' });
    await client.copyDriveFile(5, 3);
    expect(http.post).toHaveBeenCalledWith('/drive/files/5/copy', { targetFolderId: 3 });
    await client.copyDriveFolder(8, null);
    expect(http.post).toHaveBeenCalledWith('/drive/folders/8/copy', { targetParentId: null });
    http.get.mockResolvedValueOnce({ data: [{ sourceType: 'ISSUE' }] });
    expect(await client.listDriveFileBacklinks(5)).toEqual([{ sourceType: 'ISSUE' }]);
    expect(http.get).toHaveBeenLastCalledWith('/drive/files/5/backlinks');
    http.get.mockResolvedValueOnce({ data: null });
    expect(await client.listDriveFileBacklinks(5)).toEqual([]);
    await client.importAttachmentToDrive(2, null, 900);
    expect(http.post).toHaveBeenLastCalledWith('/drive/spaces/2/import-attachment', { fileId: 900 });
    await client.importAttachmentToDrive(2, 4, 900);
    expect(http.post).toHaveBeenLastCalledWith('/drive/spaces/2/folders/4/import-attachment', { fileId: 900 });
  });

  // WP-369: 전송 링크·텍스트로 만들기 — 모두 JSON 본문이고 폴더 null 은 루트로 그대로 보낸다(서버 계약 task-1b 보고서 §1~3).
  it('WP-369 다운로드 링크·업로드 링크·텍스트로 만들기 경로', async () => {
    const { http, client } = mockHttp();
    http.post.mockResolvedValueOnce({ data: { url: 'u' } });
    expect(await client.createDriveDownloadLink(5)).toEqual({ url: 'u' });
    expect(http.post).toHaveBeenLastCalledWith('/drive/files/5/download-link');
    await client.createDriveUploadLink(2, null, '결과.md');
    expect(http.post).toHaveBeenLastCalledWith('/drive/spaces/2/upload-link', { folderId: null, name: '결과.md' });
    await client.createDriveUploadLink(2, 4, '결과.md');
    expect(http.post).toHaveBeenLastCalledWith('/drive/spaces/2/upload-link', { folderId: 4, name: '결과.md' });
    await client.createDriveTextFile(2, null, '회의록.md', '# 회의록');
    expect(http.post).toHaveBeenLastCalledWith('/drive/spaces/2/files/text', { folderId: null, name: '회의록.md', content: '# 회의록' });
  });

  // WP-369 Task 3: 기존 파일의 새 버전 — 파일 id 경로이고, 텍스트는 {content} 만(mimeType 은 서버가 이름으로), 링크는 본문 없음.
  it('WP-369 기존 파일 새 버전: 텍스트 갱신·파일에 묶인 업로드 링크 경로', async () => {
    const { http, client } = mockHttp();
    await client.updateDriveTextFile(8, '# 고친 회의록');
    expect(http.post).toHaveBeenLastCalledWith('/drive/files/8/text', { content: '# 고친 회의록' });
    await client.updateDriveTextFile(8, '');
    expect(http.post).toHaveBeenLastCalledWith('/drive/files/8/text', { content: '' });
    http.post.mockResolvedValueOnce({ data: { url: 'u2' } });
    expect(await client.createDriveVersionUploadLink(8)).toEqual({ url: 'u2' });
    expect(http.post).toHaveBeenLastCalledWith('/drive/files/8/upload-link');
  });

  // WP-421: 스테이징 업로드 — 텍스트·링크 모두 JSON 본문이고 어느 도메인에 붙일지는 클레임(fileIds) 때 정한다.
  it('WP-421 스테이징 텍스트 파일·업로드 링크 경로', async () => {
    const { http, client } = mockHttp();
    http.post.mockResolvedValueOnce({ data: { fileId: 9 } });
    expect(await client.createStagedTextFile('요약.md', '# 요약')).toEqual({ fileId: 9 });
    expect(http.post).toHaveBeenLastCalledWith('/staged-files/text', { name: '요약.md', content: '# 요약' });
    http.post.mockResolvedValueOnce({ data: { url: 'u' } });
    expect(await client.createStagedUploadLink('보고서.pdf')).toEqual({ url: 'u' });
    expect(http.post).toHaveBeenLastCalledWith('/staged-files/upload-link', { name: '보고서.pdf' });
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

  it('WP-355: 메시징 보강 경로 — 참여·리액션·수정·읽음·채널 멤버', async () => {
    const { http, client } = mockHttp();
    await client.joinChannel(9);
    expect(http.post).toHaveBeenLastCalledWith('/messaging/channels/9/join');
    await client.addReaction(40, '👍');
    expect(http.post).toHaveBeenLastCalledWith('/messaging/messages/40/reactions', { emoji: '👍' });
    // 제거는 DELETE 쿼리 파라미터로 이모지를 보낸다(서버 @RequestParam).
    await client.removeReaction(40, '👍');
    expect(http.delete).toHaveBeenLastCalledWith('/messaging/messages/40/reactions', { params: { emoji: '👍' } });
    http.patch.mockResolvedValueOnce({ data: { id: 40, body: '수정' } });
    expect(await client.updateChannelMessage(40, '수정')).toEqual({ id: 40, body: '수정' });
    expect(http.patch).toHaveBeenLastCalledWith('/messaging/messages/40', { body: '수정' });
    await client.markChannelRead(9, 99);
    expect(http.post).toHaveBeenLastCalledWith('/messaging/channels/9/read', { uptoMessageId: 99 });
    http.get.mockResolvedValueOnce({ data: [{ userId: 1, username: 'a', name: 'A' }] });
    expect(await client.listChannelMembers(9)).toEqual([{ userId: 1, username: 'a', name: 'A' }]);
    expect(http.get).toHaveBeenLastCalledWith('/messaging/channels/9/members');
    // 비배열 응답(null)은 빈 목록으로 다룬다.
    expect(await client.listChannelMembers(9)).toEqual([]);
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

  // WP-358: 노트·메시지·메일 첨부 — /text 구간 읽기
  it('노트·메시지·메일 첨부 텍스트 — 소스별 경로 + offset/limit 쿼리', async () => {
    const { http, client } = mockHttp();
    await client.readWikiAttachmentText(7, 55, { offset: 6, limit: 100 });
    expect(http.get).toHaveBeenLastCalledWith('/wiki/pages/7/attachments/55/text', { params: { offset: 6, limit: 100 } });
    await client.readMessageAttachmentText(3, 40, 55, { limit: 12000 });
    expect(http.get).toHaveBeenLastCalledWith('/messaging/channels/3/messages/40/attachments/55/text', { params: { limit: 12000 } });
    await client.readMailAttachmentText(55, { offset: 0, limit: 500 });
    expect(http.get).toHaveBeenLastCalledWith('/mail/attachments/55/text', { params: { offset: 0, limit: 500 } });
  });

  it('드라이브 버전 목록 — 배열이 아니면 빈 배열', async () => {
    const { http, client } = mockHttp();
    expect(await client.listDriveFileVersions(9)).toEqual([]);
    expect(http.get).toHaveBeenCalledWith('/drive/files/9/versions');
    http.get.mockResolvedValue({ data: [{ versionNo: 1, sizeBytes: 4, current: true }] });
    expect(await client.listDriveFileVersions(9)).toEqual([{ versionNo: 1, sizeBytes: 4, current: true }]);
  });

  // 바이트 받기(getBytes) 공통 규칙 — 메일 첨부 /view(WP-388)로 확인한다(모든 /view 가 같은 함수를 쓴다).
  it('바이트 받기 — arraybuffer 로 요청하고 Content-Type 을 함께 돌려준다(Buffer·ArrayBuffer 모두)', async () => {
    const { http, client } = mockHttp();
    const opts = { responseType: 'arraybuffer', maxContentLength: 3_932_160, maxBodyLength: 3_932_160 };
    http.get.mockResolvedValueOnce({ data: Buffer.from([1, 2]), headers: { 'content-type': 'image/png' } });
    const a = await client.viewMailAttachment(55);
    expect(http.get).toHaveBeenCalledWith('/mail/attachments/55/view', opts);
    expect([...a.data]).toEqual([1, 2]);
    expect(a.mimeType).toBe('image/png');

    http.get.mockResolvedValueOnce({ data: new Uint8Array([7]).buffer, headers: {} });
    const b = await client.viewMailAttachment(56);
    expect(http.get).toHaveBeenLastCalledWith('/mail/attachments/56/view', opts);
    expect([...b.data]).toEqual([7]);
    expect(b.mimeType).toBe('application/octet-stream');
  });

  it('바이트 받기 — 다운로드 상한(이미지 3.75MB)을 건다: axios 의 maxContentLength 초과는 FileTooLargeError 로 바뀐다', async () => {
    const { http, client } = mockHttp();
    http.get.mockRejectedValueOnce(Object.assign(new Error('maxContentLength size of 3932160 exceeded'), { code: 'ERR_BAD_RESPONSE' }));
    await expect(client.viewMailAttachment(55)).rejects.toBeInstanceOf(FileTooLargeError);
    // 상한과 무관한 오류는 그대로 던진다.
    http.get.mockRejectedValueOnce(new Error('Network Error'));
    await expect(client.viewMailAttachment(55)).rejects.toThrow('Network Error');
  });
  // WP-250: 모델 입력용 이미지(/view) — PDF 쪽은 ?page= 쿼리, 이미지 변환본은 쿼리 없이. X-Page-Count 는 전체 쪽수로.
  it('첨부·파일 이미지 보기 — 소스별 /view 경로, page 는 줄 때만 쿼리로', async () => {
    const { http, client } = mockHttp();
    const opts = { responseType: 'arraybuffer', maxContentLength: 3_932_160, maxBodyLength: 3_932_160 };
    for (const [call, url] of [
      [() => client.viewIssueAttachment('WP-12', 3, 2), '/projects/WP/issues/12/attachments/3/view?page=2'],
      [() => client.viewIssueAttachment('WP-12', 3), '/projects/WP/issues/12/attachments/3/view'],
      [() => client.viewDriveFile(9, 1), '/drive/files/9/view?page=1'],
      [() => client.viewWikiAttachment(7, 55), '/wiki/pages/7/attachments/55/view'],
      [() => client.viewMessageAttachment(3, 40, 55, 4), '/messaging/channels/3/messages/40/attachments/55/view?page=4'],
      [() => client.viewMailAttachment(55, 2), '/mail/attachments/55/view?page=2'],
    ] as const) {
      http.get.mockResolvedValueOnce({ data: Buffer.from([1]), headers: { 'content-type': 'image/png', 'x-page-count': '6' } });
      const v = await call();
      expect(http.get).toHaveBeenLastCalledWith(url, opts);
      expect(v).toMatchObject({ mimeType: 'image/png', pageCount: 6 });
    }
    // 헤더가 없으면(이미지 변환본) pageCount 도 없다.
    http.get.mockResolvedValueOnce({ data: Buffer.from([1]), headers: { 'content-type': 'image/jpeg' } });
    expect((await client.viewDriveFile(9)).pageCount).toBeUndefined();
  });

  it('바이너리 요청의 서버 오류 본문(바이트)을 ErrorResponse 로 풀어 한국어 사유를 message 로 올린다', async () => {
    const { http, client } = mockHttp();
    const body = Buffer.from(JSON.stringify({ message: '이 PDF 는 6쪽입니다. 1~6 사이 페이지를 지정하세요.' }));
    http.get.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: body } }),
    );
    const err = await client.viewDriveFile(9, 9).catch((e) => e);
    expect(err.message).toBe('API 오류 400: 이 PDF 는 6쪽입니다. 1~6 사이 페이지를 지정하세요.');
    // 앱 서버 레이어(workplace-mcp)는 response.data 로 다시 요약하므로 본문도 객체로 바꿔 둔다.
    expect(err.response.data).toEqual({ message: '이 PDF 는 6쪽입니다. 1~6 사이 페이지를 지정하세요.' });
  });

  // 리뷰 M1: 프록시가 준 HTML 502 같은 JSON 이 아닌 본문은 message 에 통째로 싣지 않는다(describeApiError 의 300자 자르기).
  it('JSON 이 아닌 바이트 오류 본문은 잘라서 message 로', async () => {
    const { http, client } = mockHttp();
    const html = `<html>${'x'.repeat(5000)}</html>`;
    http.get.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 502'), { response: { status: 502, data: Buffer.from(html) } }),
    );
    const err = await client.viewDriveFile(9, 1).catch((e) => e);
    expect(err.message.startsWith('API 오류 502: <html>')).toBe(true);
    expect(err.message.length).toBeLessThan(400);
  });
});
