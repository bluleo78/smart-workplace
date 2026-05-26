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
});
