import { describe, expect, it, vi } from 'vitest';
import { createSharedToolClient, type HttpLike } from './rest-client.js';

/** axios 인스턴스를 흉내 내는 HttpLike mock — 기본 응답은 { data: null }. */
function mockHttp() {
  const ok = () => vi.fn().mockResolvedValue({ data: null });
  const http = { get: ok(), post: ok(), put: ok(), patch: ok(), delete: ok() };
  return { http, client: createSharedToolClient(http as HttpLike) };
}

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

  it('listIssues 는 /me/issues 에 쿼리를 그대로 싣고 items 를 벗긴다', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValue({ data: { items: [{ issueKey: 'WP-1' }] } });
    expect(await client.listIssues({ assignee: 'me', size: 30 })).toEqual([{ issueKey: 'WP-1' }]);
    expect(http.get).toHaveBeenCalledWith('/me/issues', { params: { assignee: 'me', size: 30 } });
    http.get.mockResolvedValue({ data: null });
    expect(await client.listIssues({})).toEqual([]);
  });

  it('listProjects 는 {content} 래퍼와 bare 배열을 모두 처리한다', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValueOnce({ data: { content: [{ key: 'WP' }] } });
    expect(await client.listProjects(0, 50)).toEqual([{ key: 'WP' }]);
    expect(http.get).toHaveBeenCalledWith('/projects', { params: { page: 0, size: 50 } });
    http.get.mockResolvedValueOnce({ data: [{ key: 'AB' }] });
    expect(await client.listProjects(0, 50)).toEqual([{ key: 'AB' }]);
    http.get.mockResolvedValueOnce({ data: null });
    expect(await client.listProjects(0, 50)).toEqual([]);
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

  it('연락처 경로 — 구성원은 /contacts/members/{userId}, 외부는 /contacts/external/{id}', async () => {
    const { http, client } = mockHttp();
    await client.getMemberContact(3);
    await client.getExternalContact(4);
    await client.listContacts({ limit: 20 });
    expect(http.get).toHaveBeenNthCalledWith(1, '/contacts/members/3');
    expect(http.get).toHaveBeenNthCalledWith(2, '/contacts/external/4');
    expect(http.get).toHaveBeenNthCalledWith(3, '/contacts', { params: { limit: 20 } });
  });

  it('getChannelMessages 는 limit 을 params 로 보내고 items 를 추출한다', async () => {
    const { http, client } = mockHttp();
    http.get.mockResolvedValueOnce({ data: { items: [{ id: 1 }], nextCursor: null } });
    expect(await client.getChannelMessages(7, 50)).toEqual([{ id: 1 }]);
    expect(http.get).toHaveBeenCalledWith('/messaging/channels/7/messages', { params: { limit: 50 } });
    http.get.mockResolvedValueOnce({ data: null });
    expect(await client.getChannelMessages(7, 50)).toEqual([]);
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

  it('searchDrive 는 q 를 params 로 보낸다', async () => {
    const { http, client } = mockHttp();
    await client.searchDrive(3, '보고서');
    expect(http.get).toHaveBeenCalledWith('/drive/spaces/3/search', { params: { q: '보고서' } });
  });

  it('목록형 조회는 data 가 없으면 빈 배열로 대체한다', async () => {
    const { client } = mockHttp();
    expect(await client.listWikiSpaces()).toEqual([]);
    expect(await client.listMailAccounts()).toEqual([]);
    expect(await client.listChannels()).toEqual([]);
    expect(await client.listDriveSpaces()).toEqual([]);
    expect(await client.getProjectTypes('WP')).toEqual([]);
  });
});
