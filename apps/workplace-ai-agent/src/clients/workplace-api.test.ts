// workplace-api client — POST /comments 흐름 + parseIssueKey 정책 검증.
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

describe('createWorkplaceApiClient', () => {
  const BASE = 'http://api.test';
  const PREFIX = '/api/v1';

  it('addIssueComment → POST /projects/{key}/issues/{number}/comments + X-Api-Key 헤더', async () => {
    const scope = nock(BASE)
      .matchHeader('x-api-key', 'test-key')
      .post(`${PREFIX}/projects/WP/issues/42/comments`, { body: '안녕' })
      .reply(201, {});

    const c = createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      apiKey: 'test-key',
    });
    await c.addIssueComment('WP-42', '안녕');

    expect(scope.isDone()).toBe(true);
  });

  it('updateIssueStatus → PATCH /projects/{key}/issues/{number}/status', async () => {
    const scope = nock(BASE)
      .matchHeader('x-api-key', 'k')
      .patch(`${PREFIX}/projects/WP/issues/1/status`, { status: 'DONE' })
      .reply(200, {});

    const c = createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      apiKey: 'k',
    });
    await c.updateIssueStatus('WP-1', 'DONE');

    expect(scope.isDone()).toBe(true);
  });

  it('getIssueDetail → GET /projects/{key}/issues/{number} + 응답 파싱', async () => {
    nock(BASE)
      .matchHeader('x-api-key', 'k')
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

    const c = createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      apiKey: 'k',
    });
    const d = await c.getIssueDetail('WP-42');

    expect(d.issueKey).toBe('WP-42');
    expect(d.title).toBe('분석');
    expect(d.assignees[0].kind).toBe('AGENT');
  });

  it('unassignSelf → /users/me 후 assignees PUT (자기만 제외)', async () => {
    nock(BASE)
      .matchHeader('x-api-key', 'k')
      .get(`${PREFIX}/users/me`)
      .reply(200, { id: 201, username: 'ai-bot', kind: 'AGENT' });
    nock(BASE)
      .matchHeader('x-api-key', 'k')
      .get(`${PREFIX}/projects/WP/issues/42/assignees`)
      .reply(200, [
        { id: 7, username: 'alice', kind: 'HUMAN' },
        { id: 201, username: 'ai-bot', kind: 'AGENT' },
      ]);
    const putScope = nock(BASE)
      .matchHeader('x-api-key', 'k')
      .put(`${PREFIX}/projects/WP/issues/42/assignees`, { userIds: [7] })
      .reply(200, []);

    const c = createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      apiKey: 'k',
    });
    await c.unassignSelf('WP-42');

    expect(putScope.isDone()).toBe(true);
  });

  it('unassignSelf 연속 호출 시 /users/me 는 1회만 (캐시)', async () => {
    nock(BASE).get(`${PREFIX}/users/me`).reply(200, { id: 201, username: 'ai-bot', kind: 'AGENT' });
    nock(BASE)
      .get(`${PREFIX}/projects/WP/issues/1/assignees`)
      .reply(200, [{ id: 201, username: 'ai-bot', kind: 'AGENT' }]);
    nock(BASE).put(`${PREFIX}/projects/WP/issues/1/assignees`, { userIds: [] }).reply(200, []);
    nock(BASE)
      .get(`${PREFIX}/projects/WP/issues/2/assignees`)
      .reply(200, [{ id: 201, username: 'ai-bot', kind: 'AGENT' }]);
    nock(BASE).put(`${PREFIX}/projects/WP/issues/2/assignees`, { userIds: [] }).reply(200, []);

    const c = createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      apiKey: 'k',
    });
    await c.unassignSelf('WP-1');
    await c.unassignSelf('WP-2');

    // /users/me 가 두 번째 호출에서도 발생했다면 nock pending 이 남음
    expect(nock.pendingMocks()).toEqual([]);
  });
});
