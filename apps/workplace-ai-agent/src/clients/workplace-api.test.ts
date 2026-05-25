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

  it('updateIssueStatus 는 5c-1 에서 여전히 throw', async () => {
    const c = createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      apiKey: 'k',
    });
    await expect(c.updateIssueStatus('WP-1', 'DONE')).rejects.toThrow(
      /not implemented|미구현/,
    );
  });
});
