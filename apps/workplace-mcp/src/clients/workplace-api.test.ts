import nock from 'nock';
import { describe, expect, it } from 'vitest';
import { createPatApiClient } from './workplace-api.js';

const BASE = 'http://api.test';

describe('createPatApiClient', () => {
  it('모든 요청에 Authorization: Bearer <PAT> 를 부착한다', async () => {
    const scope = nock(BASE, { reqheaders: { authorization: 'Bearer swp_abc' } })
      .get('/auth/me')
      .reply(200, { id: 1, username: 'u', kind: 'HUMAN' });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    await client.getMe();
    expect(scope.isDone()).toBe(true);
  });

  it('listProjects 는 GET /projects 를 호출하고 content 를 추출한다', async () => {
    const scope = nock(BASE)
      .get('/projects')
      .query({ page: '0', size: '50' })
      .reply(200, { content: [{ key: 'WP' }] });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.listProjects();
    expect(res).toEqual([{ key: 'WP' }]);
    expect(scope.isDone()).toBe(true);
  });

  it('getProject 는 키를 인코딩해 GET /projects/{key} 를 호출한다', async () => {
    const scope = nock(BASE).get('/projects/W%20P').reply(200, { key: 'W P' });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.getProject('W P');
    expect(res).toEqual({ key: 'W P' });
    expect(scope.isDone()).toBe(true);
  });

  it('listMyIssues 는 GET /me/issues 에 파라미터를 그대로 전달하고 items 를 추출한다', async () => {
    const scope = nock(BASE)
      .get('/me/issues')
      .query({ status: 'TODO', size: '30' })
      .reply(200, { items: [{ number: 1 }] });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.listMyIssues({ status: 'TODO', size: 30 });
    expect(res).toEqual([{ number: 1 }]);
    expect(scope.isDone()).toBe(true);
  });

  it('getIssueDetail 은 GET /projects/{key}/issues/{number} 를 호출한다', async () => {
    const scope = nock(BASE)
      .get('/projects/WP/issues/12')
      .reply(200, { summary: { id: 99 }, body: 'b', comments: [] });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.getIssueDetail('WP', 12);
    expect(res.summary.id).toBe(99);
    expect(scope.isDone()).toBe(true);
  });

  it('createIssue 는 POST /projects/{key}/issues 를 호출한다', async () => {
    const scope = nock(BASE)
      .post('/projects/WP/issues', { title: '제목' })
      .reply(200, { issueKey: 'WP-1', number: 1, title: '제목', status: 'TODO' });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.createIssue('WP', { title: '제목' });
    expect(res.number).toBe(1);
    expect(scope.isDone()).toBe(true);
  });

  it('addIssueComment 는 POST /issues/{issueId}/comments 를 호출한다', async () => {
    const scope = nock(BASE).post('/issues/99/comments', { body: '코멘트' }).reply(200, {});
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    await client.addIssueComment(99, '코멘트');
    expect(scope.isDone()).toBe(true);
  });

  it('updateIssueStatus 는 PATCH /projects/{key}/issues/{number}/status 를 호출한다', async () => {
    const scope = nock(BASE)
      .patch('/projects/WP/issues/12/status', { status: 'DONE' })
      .reply(200, {});
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    await client.updateIssueStatus('WP', 12, 'DONE');
    expect(scope.isDone()).toBe(true);
  });

  it('searchWikiPages 는 GET /wiki/search 에 q 를 전달한다', async () => {
    const scope = nock(BASE)
      .get('/wiki/search')
      .query({ q: '가이드' })
      .reply(200, [{ pageId: 1 }]);
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.searchWikiPages('가이드');
    expect(res).toEqual([{ pageId: 1 }]);
    expect(scope.isDone()).toBe(true);
  });

  it('getWikiPage 는 GET /wiki/pages/{pageId} 를 호출한다', async () => {
    const scope = nock(BASE).get('/wiki/pages/1').reply(200, { pageId: 1, version: 3 });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.getWikiPage(1);
    expect(res).toEqual({ pageId: 1, version: 3 });
    expect(scope.isDone()).toBe(true);
  });

  it('createWikiPage 는 POST /wiki/spaces/{spaceId}/pages 를 호출한다', async () => {
    const scope = nock(BASE)
      .post('/wiki/spaces/5/pages', { parentId: null, title: '새 페이지' })
      .reply(200, { pageId: 2 });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.createWikiPage(5, { parentId: null, title: '새 페이지' });
    expect(res).toEqual({ pageId: 2 });
    expect(scope.isDone()).toBe(true);
  });

  it('updateWikiPage 는 PUT /wiki/pages/{pageId} 에 snapshot:false 를 포함해 호출한다', async () => {
    const scope = nock(BASE)
      .put('/wiki/pages/1', { title: '가이드', body: '수정본', version: 3, snapshot: false })
      .reply(200, { pageId: 1, version: 4 });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.updateWikiPage(1, { title: '가이드', body: '수정본', version: 3 });
    expect(res).toEqual({ pageId: 1, version: 4 });
    expect(scope.isDone()).toBe(true);
  });

  it('updateWikiPage 는 409(버전 충돌) 응답을 에러로 전파한다', async () => {
    nock(BASE).put('/wiki/pages/1').reply(409, { message: 'conflict' });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    await expect(
      client.updateWikiPage(1, { title: '가이드', body: '수정본', version: 1 }),
    ).rejects.toThrow();
  });

  it('listChannels 는 GET /messaging/channels 를 호출한다', async () => {
    const scope = nock(BASE).get('/messaging/channels').reply(200, [{ id: 1 }]);
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.listChannels();
    expect(res).toEqual([{ id: 1 }]);
    expect(scope.isDone()).toBe(true);
  });

  it('getChannelMessages 는 GET /messaging/channels/{id}/messages 를 호출하고 items 를 추출한다', async () => {
    const scope = nock(BASE)
      .get('/messaging/channels/7/messages')
      .query({ limit: '30' })
      .reply(200, { items: [{ id: 1 }] });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.getChannelMessages(7, 30);
    expect(res).toEqual([{ id: 1 }]);
    expect(scope.isDone()).toBe(true);
  });

  it('addChannelMessage 는 POST /messaging/channels/{id}/messages 를 호출한다', async () => {
    const scope = nock(BASE)
      .post('/messaging/channels/7/messages', { body: '안녕하세요' })
      .reply(200, {});
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    await client.addChannelMessage(7, '안녕하세요');
    expect(scope.isDone()).toBe(true);
  });

  it('listEvents 는 GET /calendar/events 에 from/to 를 전달한다', async () => {
    const scope = nock(BASE)
      .get('/calendar/events')
      .query({ from: '2026-07-01', to: '2026-07-31' })
      .reply(200, [{ id: 1 }]);
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.listEvents('2026-07-01', '2026-07-31');
    expect(res).toEqual([{ id: 1 }]);
    expect(scope.isDone()).toBe(true);
  });

  it('getEvent 는 GET /calendar/events/{id} 를 호출한다', async () => {
    const scope = nock(BASE).get('/calendar/events/1').reply(200, { id: 1 });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.getEvent(1);
    expect(res).toEqual({ id: 1 });
    expect(scope.isDone()).toBe(true);
  });

  it('listDriveSpaces 는 GET /drive/spaces 를 호출한다', async () => {
    const scope = nock(BASE).get('/drive/spaces').reply(200, [{ id: 1 }]);
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.listDriveSpaces();
    expect(res).toEqual([{ id: 1 }]);
    expect(scope.isDone()).toBe(true);
  });

  it('listDriveItems 는 parentId 생략 시 쿼리 없이 GET /drive/spaces/{id}/items 를 호출한다', async () => {
    const scope = nock(BASE).get('/drive/spaces/3/items').reply(200, { folders: [], files: [] });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.listDriveItems(3);
    expect(res).toEqual({ folders: [], files: [] });
    expect(scope.isDone()).toBe(true);
  });

  it('listDriveItems 는 parentId 지정 시 쿼리로 전달한다', async () => {
    const scope = nock(BASE)
      .get('/drive/spaces/3/items')
      .query({ parentId: '8' })
      .reply(200, { folders: [], files: [] });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    await client.listDriveItems(3, 8);
    expect(scope.isDone()).toBe(true);
  });

  it('searchDrive 는 GET /drive/spaces/{id}/search 에 q 를 전달한다', async () => {
    const scope = nock(BASE)
      .get('/drive/spaces/3/search')
      .query({ q: '보고서' })
      .reply(200, { folders: [], files: [] });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.searchDrive(3, '보고서');
    expect(res).toEqual({ folders: [], files: [] });
    expect(scope.isDone()).toBe(true);
  });

  it('listMailAccounts 는 GET /mail/accounts 를 호출한다', async () => {
    const scope = nock(BASE).get('/mail/accounts').reply(200, [{ id: 1 }]);
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.listMailAccounts();
    expect(res).toEqual([{ id: 1 }]);
    expect(scope.isDone()).toBe(true);
  });

  it('listMail 은 GET /mail/accounts/{id}/messages 에 folder/limit 을 전달한다', async () => {
    const scope = nock(BASE)
      .get('/mail/accounts/2/messages')
      .query({ folder: 'INBOX', limit: '20' })
      .reply(200, [{ id: 1 }]);
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.listMail(2, { folder: 'INBOX', limit: 20 });
    expect(res).toEqual([{ id: 1 }]);
    expect(scope.isDone()).toBe(true);
  });

  it('listMail 은 query/unread 가 있으면 쿼리에 추가한다', async () => {
    const scope = nock(BASE)
      .get('/mail/accounts/2/messages')
      .query({ folder: 'INBOX', limit: '20', query: '검토', unread: 'true' })
      .reply(200, []);
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    await client.listMail(2, { folder: 'INBOX', limit: 20, query: '검토', unread: true });
    expect(scope.isDone()).toBe(true);
  });

  it('getMail 은 GET /mail/messages/{id} 를 호출한다', async () => {
    const scope = nock(BASE).get('/mail/messages/9').reply(200, { id: 9, body: '본문' });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const res = await client.getMail(9);
    expect(res).toEqual({ id: 9, body: '본문' });
    expect(scope.isDone()).toBe(true);
  });
});
