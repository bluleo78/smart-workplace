// 보호 리소스 메타데이터(RFC 9728, WP-1685) — Claude 앱 커넥터가 401 의 resource_metadata 를 따라 읽는 문서.
// resource 는 사용자가 입력한 MCP 주소와 정확히 같아야 하므로(완료 기준 1) 앞단 프록시의 X-Forwarded-* 로 공개 원점을 만든다.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../index.js';

const ISSUER = 'https://genia-works.iacloud.kr';
const FORWARDED = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'genia-works.iacloud.kr' };
const app = () => createApp({ apiBaseUrl: 'http://api.test' });
const get = (path: string, headers: Record<string, string> = FORWARDED) => request(app()).get(path).set(headers);

describe('GET /.well-known/oauth-protected-resource/<MCP 경로> (WP-1685)', () => {
  beforeEach(() => {
    vi.stubEnv('WORKPLACE_OAUTH_ISSUER', `${ISSUER}/`);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('/mcp — resource 는 forwarded 공개 원점 + 경로, 인가 서버는 WORKPLACE_OAUTH_ISSUER(끝 / 제거)', async () => {
    const res = await get('/.well-known/oauth-protected-resource/mcp');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      resource: 'https://genia-works.iacloud.kr/mcp',
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
    });
  });

  it.each(['/mcp/readonly', '/mcp/x/issue', '/mcp/x/issue,wiki', '/mcp/x/issue/readonly'])(
    '%s 도 그 경로가 resource 다',
    async (mcpPath) => {
      const res = await get(`/.well-known/oauth-protected-resource${mcpPath}`);
      expect(res.status).toBe(200);
      expect(res.body.resource).toBe(`https://genia-works.iacloud.kr${mcpPath}`);
      expect(res.body.authorization_servers).toEqual([ISSUER]);
    },
  );

  it.each(['/mcp/x/foo', '/mcp/x/issue,foo/readonly', '/mcp/x/readonly'])('잘못된 앱 이름(%s)은 404', async (mcpPath) => {
    const res = await get(`/.well-known/oauth-protected-resource${mcpPath}`);
    expect(res.status).toBe(404);
  });

  it('mcpHost 로 들어오면 resource 는 그 호스트, 인가 서버는 여전히 issuer', async () => {
    const res = await get('/.well-known/oauth-protected-resource/mcp', {
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'genia-works-mcp.192.168.100.72.nip.io',
    });
    expect(res.body.resource).toBe('https://genia-works-mcp.192.168.100.72.nip.io/mcp');
    expect(res.body.authorization_servers).toEqual([ISSUER]);
  });

  it('WORKPLACE_OAUTH_ISSUER 가 없으면 인가 서버는 공개 원점', async () => {
    vi.stubEnv('WORKPLACE_OAUTH_ISSUER', '');
    const res = await get('/.well-known/oauth-protected-resource/mcp');
    expect(res.body.authorization_servers).toEqual(['https://genia-works.iacloud.kr']);
  });

  it('forwarded 헤더가 없으면 Host(포트 포함)로 공개 원점을 만든다', async () => {
    const res = await get('/.well-known/oauth-protected-resource/mcp', { Host: 'localhost:6090' });
    expect(res.body.resource).toBe('http://localhost:6090/mcp');
  });
});

// 리뷰 D7.1 — 공개 원점의 호스트는 WWW-Authenticate quoted-string·URL 에 그대로 들어가므로 허용 글자(영문·숫자·.-:[])만 받는다.
describe('잘못된 forwarded 호스트 (WP-1685 리뷰 D7.1)', () => {
  const BAD_HOST = 'evil.example", error="x';
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const postMcp = (host: string) =>
    request(app())
      .post('/mcp')
      .set({ 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': host, 'Content-Type': 'application/json' })
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

  it('메타데이터 경로는 400', async () => {
    vi.stubEnv('WORKPLACE_OAUTH_ISSUER', ISSUER);
    const res = await get('/.well-known/oauth-protected-resource/mcp', {
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': BAD_HOST,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('evil.example');
  });

  it('401 안내는 WORKPLACE_OAUTH_ISSUER 의 원점으로 바꿔 단다', async () => {
    vi.stubEnv('WORKPLACE_OAUTH_ISSUER', `${ISSUER}/`);
    const res = await postMcp(BAD_HOST);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(
      `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it('WORKPLACE_OAUTH_ISSUER 도 없으면 resource_metadata 없이 Bearer 만', async () => {
    vi.stubEnv('WORKPLACE_OAUTH_ISSUER', '');
    const res = await postMcp(BAD_HOST);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('올바른 호스트(포트·IPv6 포함)는 그대로 쓴다', async () => {
    vi.stubEnv('WORKPLACE_OAUTH_ISSUER', ISSUER);
    for (const host of ['localhost:6090', '[::1]:6090', 'genia-works-mcp.192.168.100.72.nip.io']) {
      const res = await postMcp(host);
      expect(res.headers['www-authenticate']).toBe(
        `Bearer resource_metadata="https://${host}/.well-known/oauth-protected-resource/mcp"`,
      );
    }
  });
});
