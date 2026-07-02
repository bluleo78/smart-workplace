// src/mcp/integration.test.ts — 실 MCP 클라이언트 ↔ /mcp 왕복. PAT 패스스루가 핵심 검증 대상.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Express } from 'express';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.js';

const API = 'http://api.test';
let server: ReturnType<Express['listen']>;
let baseUrl: string;

beforeEach(() => {
  const app = createApp({ apiBaseUrl: API });
  server = app.listen(0);
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}/mcp`;
});
afterEach(() => {
  server.close();
  nock.cleanAll();
});

function connect(token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'test', version: '0.0.0' });
  return client.connect(transport).then(() => client);
}

describe('/mcp', () => {
  it('유효 토큰으로 initialize + tools/list 에 create_issue 가 보인다', async () => {
    nock(API).get('/auth/me').reply(200, { id: 1, username: 'u', kind: 'HUMAN' });
    const client = await connect('swp_valid');
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('create_issue');
  });

  it('tools/call create_issue 가 같은 Bearer 로 workplace-api 를 호출한다', async () => {
    nock(API).get('/auth/me').reply(200, { id: 1, username: 'u', kind: 'HUMAN' });
    const scope = nock(API, { reqheaders: { authorization: 'Bearer swp_valid' } })
      .post('/projects/WP/issues')
      .reply(200, { issueKey: 'WP-1', number: 1, title: 't', status: 'TODO' });
    const client = await connect('swp_valid');
    const res = await client.callTool({ name: 'create_issue', arguments: { projectKey: 'WP', title: 't' } });
    expect(res.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it('api 401 이면 initialize 가 401 로 거부된다', async () => {
    nock(API).get('/auth/me').reply(401);
    await expect(connect('swp_revoked')).rejects.toThrow();
  });

  it('Authorization 헤더 없으면 401', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
    const client = new Client({ name: 'test', version: '0.0.0' });
    await expect(client.connect(transport)).rejects.toThrow();
  });

  it('api 에러가 도구 isError 로 전파된다', async () => {
    nock(API).get('/auth/me').reply(200, { id: 1, username: 'u', kind: 'HUMAN' });
    nock(API).get('/projects/WP/issues/99').reply(403, { message: '권한 없음' });
    const client = await connect('swp_valid');
    const res = await client.callTool({ name: 'get_issue_detail', arguments: { issueKey: 'WP-99' } });
    expect(res.isError).toBe(true);
  });
});
