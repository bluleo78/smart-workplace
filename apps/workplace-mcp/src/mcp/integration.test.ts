// src/mcp/integration.test.ts — 실 MCP 클라이언트 ↔ /mcp 왕복. PAT 패스스루가 핵심 검증 대상.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Express } from 'express';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSharedTools, TOOL_APPS, type SharedToolClient } from '@smart-workplace/mcp-tools-shared';

import { createApp } from '../index.js';
import { exposableTools } from '../tools/index.js';
import { INSTRUCTIONS_MAX_LENGTH } from './instructions.js';

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
    // WP-334: 연결 안내 명령의 서버 이름(genia-works)과 같은 이름·브랜드 표기를 알린다.
    expect(client.getServerVersion()).toMatchObject({ name: 'genia-works', title: 'Gen:iA Works' });
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('create_issue');
    // #853·WP-342: 연산 성격이 MCP 표준 힌트로 나가야 클라이언트가 읽기 자동승인·덮어쓰기 확인·추가 허용을 구분한다.
    const byName = new Map(tools.tools.map((t) => [t.name, t]));
    // 읽기 도구는 destructive·idempotent 힌트를 싣지 않는다(읽기 전용이라 의미가 없다).
    expect(byName.get('get_issue_detail')?.annotations).toEqual({
      title: '이슈 상세 조회',
      readOnlyHint: true,
      openWorldHint: false,
    });
    // 추가만 하는 쓰기 — destructive 아님.
    expect(byName.get('create_issue')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    // 덮어쓰기(집합 교체 포함)는 write 여도 destructive 로 알린다 — kind 와 분리된 hint (WP-342).
    expect(byName.get('update_issue')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    // 표시 이름은 top-level title 과 annotations.title 양쪽에 나간다.
    expect(byName.get('update_issue')?.title).toBe('이슈 수정');
    expect(byName.get('update_issue')?.annotations?.title).toBe('이슈 수정');
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

  it('get_member·get_member_contact 는 없는 구성원을 성공 문자열이 아닌 isError 로 돌려준다 (WP-344)', async () => {
    nock(API).get('/auth/me').reply(200, { id: 1, username: 'u', kind: 'HUMAN' });
    // 검색 결과에 정확일치 username 이 없다 — 두 도구 호출 모두 같은 조회를 한다.
    nock(API).get('/members').query(true).times(2).reply(200, { content: [] });
    const client = await connect('swp_valid');
    for (const name of ['get_member', 'get_member_contact']) {
      const res = await client.callTool({ name, arguments: { username: 'ghost' } });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain('구성원을 찾을 수 없습니다: ghost');
    }
  });

  // WP-346: 실제 axios(arraybuffer)·MCP 왕복으로 read_attachment 를 확인한다 — 텍스트는 JSON, 이미지는 image 블록, source 별 필수 필드 누락은 isError.
  describe('read_attachment', () => {
    it('드라이브 문서는 추출 텍스트 구간을 JSON 으로(core fileId 대신 driveFileId)', async () => {
      nock(API).get('/auth/me').reply(200, { id: 1, username: 'u', kind: 'HUMAN' });
      nock(API, { reqheaders: { authorization: 'Bearer swp_valid' } })
        .get('/drive/files/9/text')
        .query({ offset: 6, limit: 100 })
        .reply(200, { fileId: 55, status: 'READY', offset: 6, totalChars: 11, truncated: false, nextOffset: null, text: '바사', reasonCode: null, reason: null });
      const client = await connect('swp_valid');
      const res = await client.callTool({ name: 'read_attachment', arguments: { source: 'drive', driveFileId: 9, offset: 6, limit: 100 } });
      expect(res.isError).toBeFalsy();
      const [block] = res.content as { type: string; text: string }[];
      expect(JSON.parse(block.text)).toMatchObject({ driveFileId: 9, status: 'READY', text: '바사' });
      expect(JSON.parse(block.text)).not.toHaveProperty('fileId');
    });

    it('이슈 첨부 이미지는 원본을 받아 image 블록으로', async () => {
      nock(API).get('/auth/me').reply(200, { id: 1, username: 'u', kind: 'HUMAN' });
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      nock(API)
        .get('/projects/WP/issues/12/attachments/3/text')
        .query({ limit: 12000 })
        .reply(200, { fileId: 3, status: 'SKIPPED', offset: 0, totalChars: null, truncated: null, nextOffset: null, text: null, reasonCode: 'IMAGE', reason: '이미지 파일은 글자를 추출하지 않습니다.' })
        .get('/projects/WP/issues/12/attachments')
        .reply(200, [{ fileId: 3, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 4 }])
        .get('/projects/WP/issues/12/attachments/3/content')
        .reply(200, png, { 'Content-Type': 'image/png' });
      const client = await connect('swp_valid');
      const res = await client.callTool({ name: 'read_attachment', arguments: { source: 'issue', issueKey: 'WP-12', attachmentId: 3 } });
      expect(res.isError).toBeFalsy();
      expect(res.content).toEqual([
        { type: 'text', text: '이슈 WP-12 첨부 이미지 "a.png" (image/png, 4B)' },
        { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
      ]);
    });

    it('source 에 맞는 식별자가 없으면 API 를 부르지 않고 isError', async () => {
      nock(API).get('/auth/me').reply(200, { id: 1, username: 'u', kind: 'HUMAN' });
      const client = await connect('swp_valid');
      const res = await client.callTool({ name: 'read_attachment', arguments: { source: 'drive' } });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain('driveFileId 가 필요');
    });
  });
});

// WP-350: 연결 범위(앱 선택·읽기 전용). 같은 서버·같은 인증 위에서 URL 경로·헤더만 달라진다.
describe('/mcp 연결 범위 (WP-350)', () => {
  const origin = () => baseUrl.replace(/\/mcp$/, '');
  const meOk = () => nock(API).get('/auth/me').reply(200, { id: 1, username: 'u', kind: 'HUMAN' });
  /** 경로·헤더를 지정해 연결하고 도구 목록·instructions 를 돌려준다. */
  async function open(path: string, headers: Record<string, string> = {}) {
    meOk();
    const transport = new StreamableHTTPClientTransport(new URL(origin() + path), {
      requestInit: { headers: { Authorization: 'Bearer swp_valid', ...headers } },
    });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    const instructions = client.getInstructions() ?? '';
    await client.close();
    return { tools, names: tools.map((t) => t.name), instructions };
  }
  const allNames = exposableTools(buildSharedTools({} as unknown as SharedToolClient)).map((t) => t.name);

  it('기본 /mcp 는 지금처럼 노출 가능한 도구 전부를 싣고, instructions 는 앱별 안내가 앞에 온다', async () => {
    const r = await open('/mcp');
    expect([...r.names].sort()).toEqual([...allNames].sort());
    expect(r.instructions.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
    expect(r.instructions.split('\n')[1]).toBe('앱별 안내:');
    expect(r.instructions).not.toContain('읽기 전용 연결');
  });

  it('/mcp/x/issue,wiki 는 두 앱 도구만 싣고 instructions 도 두 앱만 설명한다', async () => {
    const r = await open('/mcp/x/issue,wiki');
    expect(r.names).toEqual(expect.arrayContaining(['create_issue', 'update_wiki_page', 'read_attachment']));
    expect(r.names).not.toContain('list_mail');
    expect(r.names).not.toContain('list_events');
    expect(r.instructions).toContain('- 이슈:');
    expect(r.instructions).toContain('- 위키(노트):');
    expect(r.instructions).not.toContain('- 메일:');
  });

  it('/mcp/readonly 는 읽기 도구만 싣고 모두 readOnlyHint 다', async () => {
    const r = await open('/mcp/readonly');
    expect(r.names).toContain('list_issues');
    expect(r.names).not.toContain('create_issue');
    expect(r.tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(r.instructions).toContain('읽기 전용 연결');
  });

  it('/mcp/x/{apps}/readonly 는 앱 선택과 읽기 전용의 교집합', async () => {
    const r = await open('/mcp/x/calendar/readonly');
    expect([...r.names].sort()).toEqual(['get_event', 'list_events', 'search_members']); // search_members: 참석자 username 확인용으로 calendar 에도 실린다
  });

  it('X-MCP-Toolsets 헤더는 경로에 앱 선택이 없을 때 앱 선택으로 쓰이고, /readonly 와도 합쳐진다', async () => {
    expect([...(await open('/mcp', { 'X-MCP-Toolsets': 'notify' })).names].sort()).toEqual([
      'list_notifications',
      'mark_all_notifications_read',
      'mark_notification_read',
    ]);
    expect((await open('/mcp/readonly', { 'X-MCP-Toolsets': 'notify' })).names).toEqual(['list_notifications']);
  });

  it('경로에 앱 선택이 있으면 헤더는 무시한다', async () => {
    const r = await open('/mcp/x/notify', { 'X-MCP-Toolsets': 'issue' });
    expect(r.names).not.toContain('create_issue');
    expect(r.names).toContain('list_notifications');
  });

  it('읽기 전용 연결은 쓰기 도구 호출을 받아 주지 않는다(도구 자체가 없다)', async () => {
    meOk();
    const transport = new StreamableHTTPClientTransport(new URL(origin() + '/mcp/readonly'), {
      requestInit: { headers: { Authorization: 'Bearer swp_valid' } },
    });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(transport);
    const res = await client.callTool({ name: 'create_issue', arguments: { projectKey: 'WP', title: 't' } }).catch((e: unknown) => e);
    await client.close();
    // SDK 는 모르는 도구를 isError 결과 또는 예외로 돌려준다 — 어느 쪽이든 API 호출은 일어나지 않았다(nock 에 POST 를 등록하지 않았다).
    expect(res instanceof Error || (res as { isError?: boolean }).isError === true).toBe(true);
  });

  describe('잘못된 앱 이름', () => {
    const initBody = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } };
    const post = (path: string, headers: Record<string, string> = {}) =>
      fetch(origin() + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer swp_valid', ...headers },
        body: JSON.stringify(initBody),
      });

    it('경로의 모르는 앱은 400 + JSON-RPC 오류 + 사용 가능한 앱 목록이고 /auth/me 는 부르지 않는다', async () => {
      const res = await post('/mcp/x/issue,foo');
      expect(res.status).toBe(400);
      const body = (await res.json()) as { jsonrpc: string; error: { code: number; message: string; data: { availableApps: string[] } }; id: null };
      expect(body.jsonrpc).toBe('2.0');
      expect(body.error.message).toContain("'foo'");
      expect(body.error.message).toContain(TOOL_APPS.join(', '));
      expect(body.error.data.availableApps).toEqual([...TOOL_APPS]);
    });

    it('헤더의 모르는 앱도 400', async () => {
      const res = await post('/mcp', { 'X-MCP-Toolsets': 'nope' });
      expect(res.status).toBe(400);
    });

    it('/mcp/x/readonly 처럼 앱 자리에 readonly 를 쓰면 400 — 앱 이름이 아니다', async () => {
      expect((await post('/mcp/x/readonly')).status).toBe(400);
    });

    it('인증이 없으면 앱 이름이 틀려도 401 이 먼저다', async () => {
      const res = await post('/mcp/x/foo', { Authorization: '' });
      expect(res.status).toBe(401);
    });
  });

  it('범위 경로의 GET·DELETE 는 기본 /mcp 처럼 405(stateless)', async () => {
    for (const path of ['/mcp/readonly', '/mcp/x/issue', '/mcp/x/issue/readonly']) {
      for (const method of ['GET', 'DELETE']) {
        const res = await fetch(origin() + path, { method });
        expect(res.status, `${method} ${path}`).toBe(405);
        expect(res.headers.get('allow')).toBe('POST');
      }
    }
  });
});
