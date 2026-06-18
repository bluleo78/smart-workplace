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
});
