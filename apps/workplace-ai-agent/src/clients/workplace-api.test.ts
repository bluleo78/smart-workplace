// workplace-api client — Internal + X-On-Behalf-Of 패턴 (#34). 매 메서드에 agentId 명시.
import { afterEach, describe, expect, it } from 'vitest';
import nock from 'nock';

import { createWorkplaceApiClient, parseIssueKey } from './workplace-api.js';

afterEach(() => {
  nock.cleanAll();
});

describe('parseIssueKey', () => {
  it('WP-42 → projectKey=WP, number=42', () => {
    expect(parseIssueKey('WP-42')).toEqual({ projectKey: 'WP', number: 42 });
  });

  it('A-B-7 → projectKey=A-B, number=7 (lastIndexOf 정책)', () => {
    expect(parseIssueKey('A-B-7')).toEqual({ projectKey: 'A-B', number: 7 });
  });
});

describe('createWorkplaceApiClient (Internal + X-On-Behalf-Of)', () => {
  const BASE = 'http://api.test';
  const PREFIX = '/api/v1';
  const AGENT_ID = 201;

  function newClient() {
    return createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      internalToken: 'tk-internal',
    });
  }

  it('addIssueComment → GET 상세로 issueId 추출 후 POST /issues/{id}/comments', async () => {
    nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/projects/WP/issues/42`)
      .reply(200, { summary: { id: 999, title: 't' }, body: 'b' });
    const post = nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .post(`${PREFIX}/issues/999/comments`, { body: '안녕' })
      .reply(201, {});
    await newClient().addIssueComment(AGENT_ID, 'WP-42', '안녕');
    expect(post.isDone()).toBe(true);
  });

  it('updateIssueStatus → PATCH + 헤더', async () => {
    const scope = nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .patch(`${PREFIX}/projects/WP/issues/1/status`, { status: 'DONE' })
      .reply(200, {});
    await newClient().updateIssueStatus(AGENT_ID, 'WP-1', 'DONE');
    expect(scope.isDone()).toBe(true);
  });

  it('getIssueDetail → GET + 헤더 + 응답 파싱', async () => {
    nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/projects/WP/issues/42`)
      .reply(200, {
        key: 'WP-42',
        title: '분석',
        body: '본문',
        status: 'TODO',
        priority: 'MID',
        assignees: [{ id: 201, username: 'ai-bot', name: 'AI', kind: 'AGENT' }],
        comments: [],
      });
    const d = await newClient().getIssueDetail(AGENT_ID, 'WP-42');
    expect(d.issueKey).toBe('WP-42');
    expect(d.title).toBe('분석');
  });

  it('unassignSelf → /me 호출 없이 assignees PUT (agentId 본인 제외)', async () => {
    nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/projects/WP/issues/42/assignees`)
      .reply(200, [
        { id: 7, username: 'alice', kind: 'HUMAN' },
        { id: AGENT_ID, username: 'ai-bot', kind: 'AGENT' },
      ]);
    const putScope = nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .put(`${PREFIX}/projects/WP/issues/42/assignees`, { userIds: [7] })
      .reply(200, []);
    await newClient().unassignSelf(AGENT_ID, 'WP-42');
    expect(putScope.isDone()).toBe(true);
  });

  it('getOAuthToken → GET /users/me/oauth-token + 헤더', async () => {
    nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/users/me/oauth-token`)
      .reply(200, { token: 'tk-plain', label: 'main' });
    const r = await newClient().getOAuthToken(AGENT_ID);
    expect(r).toEqual({ token: 'tk-plain', label: 'main' });
  });

  it('getOAuthToken → 404 면 throw', async () => {
    nock(BASE)
      .get(`${PREFIX}/users/me/oauth-token`)
      .reply(404, { error: 'not_found' });
    await expect(newClient().getOAuthToken(AGENT_ID)).rejects.toThrow();
  });

  // --- 6c: chat ---

  it('getChatMessages → GET /chat/threads/{id}/messages?limit + 헤더', async () => {
    nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/chat/threads/5/messages`)
      .query({ limit: '20' })
      .reply(200, {
        items: [
          { id: 1, authorName: 'A', authorKind: 'HUMAN', body: 'hi', createdAt: 't', deleted: false },
        ],
        nextCursor: null,
        hasMore: false,
      });
    const items = await newClient().getChatMessages(AGENT_ID, 5, 20);
    expect(items).toHaveLength(1);
    expect(items[0].body).toBe('hi');
  });

  it('addChatMessage → POST /chat/threads/{id}/messages {body} + 헤더', async () => {
    const scope = nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .post(`${PREFIX}/chat/threads/5/messages`, { body: '답변' })
      .reply(201, {});
    await newClient().addChatMessage(AGENT_ID, 5, '답변');
    expect(scope.isDone()).toBe(true);
  });

  // --- 6c: 이슈 첨부 ---

  it('listIssueAttachments → GET /projects/{key}/issues/{n}/attachments', async () => {
    nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/projects/WP/issues/1/attachments`)
      .reply(200, [
        { fileId: 3, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 100 },
      ]);
    const list = await newClient().listIssueAttachments(AGENT_ID, 'WP-1');
    expect(list[0]).toMatchObject({ fileId: 3, originalName: 'a.png', mimeType: 'image/png' });
  });

  it('downloadIssueAttachment → GET .../content (바이트 + mimeType)', async () => {
    nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/projects/WP/issues/1/attachments/3/content`)
      .reply(200, Buffer.from('PNGDATA'), { 'Content-Type': 'image/png' });
    const res = await newClient().downloadIssueAttachment(AGENT_ID, 'WP-1', 3);
    expect(Buffer.isBuffer(res.data)).toBe(true);
    expect(res.data.toString()).toBe('PNGDATA');
    expect(res.mimeType).toBe('image/png');
  });

  // --- S2: 위키 읽기 그라운딩 ---

  it('searchWikiPages → GET /wiki/search?q= with on-behalf-of', async () => {
    const scope = nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/wiki/search`)
      .query({ q: '배포' })
      .reply(200, [
        { id: 7, spaceId: 2, spaceName: '팀', title: '릴리스', snippet: '배포 절차', updatedAt: '2026-06-14T00:00:00Z' },
      ]);
    const out = await newClient().searchWikiPages(AGENT_ID, '배포');
    expect(scope.isDone()).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 7, title: '릴리스' });
  });

  it('getWikiPage → GET /wiki/pages/{id} with on-behalf-of', async () => {
    const scope = nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/wiki/pages/7`)
      .reply(200, { id: 7, spaceId: 2, parentId: null, title: '릴리스', body: '본문', version: 3, updatedAt: '2026-06-14T00:00:00Z' });
    const out = await newClient().getWikiPage(AGENT_ID, 7);
    expect(scope.isDone()).toBe(true);
    expect(out).toMatchObject({ id: 7, body: '본문', version: 3 });
  });

  // --- #333 M2: 캘린더 읽기 ---

  it('listEvents → GET /calendar/events?from&to with Internal+X-On-Behalf-Of, 배열 반환', async () => {
    const scope = nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/calendar/events`)
      .query({ from: '2026-06-19T00:00:00Z', to: '2026-06-26T00:00:00Z' })
      .reply(200, [
        {
          id: 1, title: '회의', description: null,
          startsAt: '2026-06-20T01:00:00Z', endsAt: '2026-06-20T02:00:00Z',
          allDay: false, location: null, recurrenceRule: null,
        },
      ]);
    const out = await newClient().listEvents(AGENT_ID, '2026-06-19T00:00:00Z', '2026-06-26T00:00:00Z');
    expect(scope.isDone()).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('회의');
  });

  it('getEvent → GET /calendar/events/{id} with X-On-Behalf-Of, 단건 반환', async () => {
    const scope = nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/calendar/events/42`)
      .reply(200, {
        id: 42, title: '단건', description: '본문',
        startsAt: '2026-06-20T01:00:00Z', endsAt: '2026-06-20T02:00:00Z',
        allDay: false, location: '회의실', recurrenceRule: null,
      });
    const out = await newClient().getEvent(AGENT_ID, 42);
    expect(scope.isDone()).toBe(true);
    expect(out.id).toBe(42);
    expect(out.location).toBe('회의실');
  });

  // --- #333 M3: 메일 읽기 ---

  describe('listMail', () => {
    it('GET /mail/accounts/{id}/messages?folder&query&limit 로 목록 반환', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': '7' } })
        .get(`${PREFIX}/mail/accounts/5/messages`)
        .query({ folder: 'INBOX', query: '청구서', limit: '20' })
        .reply(200, [{ id: 1, subject: '청구서', fromAddress: 'a@x.com', snippet: '...', receivedAt: '2026-06-19T00:00:00Z', seen: false }]);
      const out = await newClient().listMail(7, 5, 'INBOX', '청구서', 20);
      expect(out[0].subject).toBe('청구서');
      scope.done();
    });
  });

  describe('getMail', () => {
    it('GET /mail/messages/{id} 로 본문 포함 단건 반환', async () => {
      nock(BASE, { reqheaders: { 'x-on-behalf-of': '7' } })
        .get(`${PREFIX}/mail/messages/42`)
        .reply(200, { id: 42, subject: '제목', fromAddress: 'a@x.com', snippet: 's', receivedAt: '2026-06-19T00:00:00Z', seen: true, bodyText: '본문', bodyHtml: null, toAddresses: ['me@x.com'] });
      const out = await newClient().getMail(7, 42);
      expect(out.bodyText).toBe('본문');
    });
  });

  // --- #333 M3: 연락처 조회/생성/수정 ---

  describe('listContacts', () => {
    it('GET /contacts?search&limit 로 통합 목록 반환', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': '7' } })
        .get(`${PREFIX}/contacts`).query({ search: '김', limit: '20' })
        .reply(200, [{ id: 1, kind: 'EXTERNAL', name: '김거래', email: 'k@x.com', organization: 'X사' }]);
      const out = await newClient().listContacts(7, '김', undefined, 20);
      expect(out[0].name).toBe('김거래');
      scope.done();
    });
  });

  describe('createExternalContact', () => {
    it('POST /contacts/external 로 생성하고 반환', async () => {
      nock(BASE, { reqheaders: { 'x-on-behalf-of': '7' } })
        .post(`${PREFIX}/contacts/external`, { name: '신규', email: 'n@x.com', visibility: 'SHARED' })
        .reply(201, { id: 9, kind: 'EXTERNAL', name: '신규', email: 'n@x.com', organization: null });
      const out = await newClient().createExternalContact(7, { name: '신규', email: 'n@x.com', visibility: 'SHARED' });
      expect(out.id).toBe(9);
    });
  });

  // --- #333 M3: 프로젝트 읽기 ---

  describe('listProjects', () => {
    it('GET /projects?page&size 로 목록 반환', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': '7' } })
        .get(`${PREFIX}/projects`).query({ page: '0', size: '20' })
        .reply(200, [{ key: 'ABC', name: '프로젝트', description: null, type: 'TEAM' }]);
      const out = await newClient().listProjects(7, 0, 20);
      expect(out[0].key).toBe('ABC');
      scope.done();
    });
  });

  describe('getProject', () => {
    it('GET /projects/{key} 로 단건 반환', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': '7' } })
        .get(`${PREFIX}/projects/ABC`)
        .reply(200, { key: 'ABC', name: '프로젝트', description: '설명', type: 'TEAM' });
      const out = await newClient().getProject(7, 'ABC');
      expect(out.key).toBe('ABC');
      expect(out.name).toBe('프로젝트');
      scope.done();
    });
  });

  describe('listProjectMembers', () => {
    it('GET /projects/{key}/members 로 멤버 반환', async () => {
      nock(BASE, { reqheaders: { 'x-on-behalf-of': '7' } })
        .get(`${PREFIX}/projects/ABC/members`)
        .reply(200, [{ userId: 1, name: '홍길동', role: 'OWNER' }]);
      const out = await newClient().listProjectMembers(7, 'ABC');
      expect(out[0].role).toBe('OWNER');
    });
  });

  // --- #333 M3: 위키 페이지 생성/수정 ---

  it('createWikiPage → POST /wiki/spaces/{id}/pages 로 생성하고 본문 반환', async () => {
    const scope = nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', '7')
      .post(`${PREFIX}/wiki/spaces/3/pages`, { parentId: null, title: '새 페이지' })
      .reply(201, { id: 9, spaceId: 3, parentId: null, title: '새 페이지', body: '', version: 1, updatedAt: '2026-06-19T00:00:00Z' });
    const out = await newClient().createWikiPage(7, 3, '새 페이지');
    expect(scope.isDone()).toBe(true);
    expect(out.id).toBe(9);
    expect(out.title).toBe('새 페이지');
  });

  it('createWikiPage → parentId 지정 시 body 에 포함', async () => {
    const scope = nock(BASE)
      .matchHeader('x-on-behalf-of', '7')
      .post(`${PREFIX}/wiki/spaces/3/pages`, { parentId: 5, title: '하위 페이지' })
      .reply(201, { id: 10, spaceId: 3, parentId: 5, title: '하위 페이지', body: '', version: 1, updatedAt: '2026-06-19T00:00:00Z' });
    const out = await newClient().createWikiPage(7, 3, '하위 페이지', 5);
    expect(scope.isDone()).toBe(true);
    expect(out.parentId).toBe(5);
  });

  it('updateWikiPage → PUT /wiki/pages/{id} 로 version 동반 저장하고 본문 반환', async () => {
    const scope = nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', '7')
      .put(`${PREFIX}/wiki/pages/9`, { title: '수정 제목', body: '본문', version: 1, snapshot: false })
      .reply(200, { id: 9, spaceId: 3, parentId: null, title: '수정 제목', body: '본문', version: 2, updatedAt: '2026-06-19T01:00:00Z' });
    const out = await newClient().updateWikiPage(7, 9, 1, '수정 제목', '본문');
    expect(scope.isDone()).toBe(true);
    expect(out.version).toBe(2);
    expect(out.title).toBe('수정 제목');
  });

  // --- #333 M3: 드라이브 읽기 전용 ---

  describe('listMySpaces', () => {
    it('GET /drive/spaces 로 내 스페이스 목록 반환', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': '7' } })
        .get(`${PREFIX}/drive/spaces`)
        .reply(200, [{ id: 1, name: '팀 드라이브', role: 'EDITOR' }]);
      const out = await newClient().listMySpaces(7);
      expect(out[0].name).toBe('팀 드라이브');
      scope.done();
    });
  });

  describe('searchDrive', () => {
    it('GET /drive/spaces/{id}/search?q 로 검색 결과 반환', async () => {
      nock(BASE, { reqheaders: { 'x-on-behalf-of': '7' } })
        .get(`${PREFIX}/drive/spaces/1/search`).query({ q: '보고서' })
        .reply(200, [{ id: 5, kind: 'FILE', name: '보고서.pdf', updatedAt: '2026-06-19T00:00:00Z' }]);
      const out = await newClient().searchDrive(7, 1, '보고서');
      expect(out[0].name).toBe('보고서.pdf');
    });
  });

  // --- #333 M4: 드라이브 폴더/파일 쓰기 ---

  describe('createFolder', () => {
    it('POST /drive/spaces/{id}/folders 로 폴더 생성하고 DriveFolderItem 반환', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': String(AGENT_ID) } })
        .post(`${PREFIX}/drive/spaces/1/folders`, { parentId: null, name: '새 폴더' })
        .reply(201, { id: 10, parentId: null, name: '새 폴더', createdAt: '2026-06-19T00:00:00Z' });
      const out = await newClient().createFolder(AGENT_ID, 1, null, '새 폴더');
      expect(scope.isDone()).toBe(true);
      expect(out.id).toBe(10);
      expect(out.parentId).toBeNull();
      expect(out.name).toBe('새 폴더');
    });

    it('parentId 지정 시 body 에 포함', async () => {
      const scope = nock(BASE, { reqheaders: { 'x-on-behalf-of': String(AGENT_ID) } })
        .post(`${PREFIX}/drive/spaces/1/folders`, { parentId: 5, name: '하위 폴더' })
        .reply(201, { id: 11, parentId: 5, name: '하위 폴더', createdAt: '2026-06-19T00:00:00Z' });
      const out = await newClient().createFolder(AGENT_ID, 1, 5, '하위 폴더');
      expect(scope.isDone()).toBe(true);
      expect(out.parentId).toBe(5);
    });
  });

  describe('renameFolder', () => {
    it('PATCH /drive/folders/{id} 로 이름 변경하고 DriveFolderItem 반환', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': String(AGENT_ID) } })
        .patch(`${PREFIX}/drive/folders/10`, { name: '변경 폴더' })
        .reply(200, { id: 10, parentId: null, name: '변경 폴더', createdAt: '2026-06-19T00:00:00Z' });
      const out = await newClient().renameFolder(AGENT_ID, 10, '변경 폴더');
      expect(scope.isDone()).toBe(true);
      expect(out.name).toBe('변경 폴더');
    });
  });

  describe('moveFolder', () => {
    it('PATCH /drive/folders/{id}/move 로 폴더 이동(void)', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': String(AGENT_ID) } })
        .patch(`${PREFIX}/drive/folders/10/move`, { targetParentId: 3 })
        .reply(204);
      await newClient().moveFolder(AGENT_ID, 10, 3);
      expect(scope.isDone()).toBe(true);
    });

    it('targetParentId null 로 루트 이동(void)', async () => {
      const scope = nock(BASE, { reqheaders: { 'x-on-behalf-of': String(AGENT_ID) } })
        .patch(`${PREFIX}/drive/folders/10/move`, { targetParentId: null })
        .reply(204);
      await newClient().moveFolder(AGENT_ID, 10, null);
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('moveFile', () => {
    it('PATCH /drive/files/{id}/move 로 파일 이동(void)', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': String(AGENT_ID) } })
        .patch(`${PREFIX}/drive/files/5/move`, { targetFolderId: 10 })
        .reply(204);
      await newClient().moveFile(AGENT_ID, 5, 10);
      expect(scope.isDone()).toBe(true);
    });

    it('targetFolderId null 로 루트 이동(void)', async () => {
      const scope = nock(BASE, { reqheaders: { 'x-on-behalf-of': String(AGENT_ID) } })
        .patch(`${PREFIX}/drive/files/5/move`, { targetFolderId: null })
        .reply(204);
      await newClient().moveFile(AGENT_ID, 5, null);
      expect(scope.isDone()).toBe(true);
    });
  });

  // --- #350: 채널 목록/탐색 ---

  describe('listChannels', () => {
    it('GET /messaging/channels 로 ChannelItem[] 반환', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': String(AGENT_ID) } })
        .get(`${PREFIX}/messaging/channels`)
        .reply(200, [
          { id: 1, kind: 'PUBLIC', name: '일반', visibility: 'PUBLIC', member: true, role: 'MEMBER', archived: false, memberCount: 10, unreadCount: 3 },
        ]);
      const out = await newClient().listChannels(AGENT_ID);
      expect(scope.isDone()).toBe(true);
      expect(out).toHaveLength(1);
      expect(out[0].name).toBe('일반');
      expect(out[0].id).toBe(1);
    });

    it('응답이 배열이 아니면 빈 배열 반환', async () => {
      nock(BASE, { reqheaders: { 'x-on-behalf-of': String(AGENT_ID) } })
        .get(`${PREFIX}/messaging/channels`)
        .reply(200, {});
      const out = await newClient().listChannels(AGENT_ID);
      expect(out).toEqual([]);
    });
  });

  describe('discoverChannels', () => {
    it('GET /messaging/channels/discover?q= 로 ChannelItem[] 반환', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': String(AGENT_ID) } })
        .get(`${PREFIX}/messaging/channels/discover`)
        .query({ q: '개발팀' })
        .reply(200, [
          { id: 2, kind: 'PUBLIC', name: '개발팀', visibility: 'PUBLIC', member: false, role: null, archived: false, memberCount: 5, unreadCount: 0 },
        ]);
      const out = await newClient().discoverChannels(AGENT_ID, '개발팀');
      expect(scope.isDone()).toBe(true);
      expect(out[0].name).toBe('개발팀');
    });

    it('특수문자 q 는 encodeURIComponent 처리', async () => {
      nock(BASE, { reqheaders: { 'x-on-behalf-of': String(AGENT_ID) } })
        .get(`${PREFIX}/messaging/channels/discover`)
        .query({ q: '팀 채널' })
        .reply(200, []);
      const out = await newClient().discoverChannels(AGENT_ID, '팀 채널');
      expect(out).toEqual([]);
    });
  });
});
