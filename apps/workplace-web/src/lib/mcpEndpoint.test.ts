import { describe, expect, it } from 'vitest';

import { resolveMcpBaseUrl } from './mcpEndpoint';

// MCP 주소 우선순위(WP-387): 명시 VITE_MCP_URL > 개발 모드 로컬 포트 > 접속한 웹 origin.
describe('resolveMcpBaseUrl', () => {
  const origin = 'https://genia-works.iacloud.kr';

  it('명시한 VITE_MCP_URL 이 개발 여부와 관계없이 최우선', () => {
    expect(resolveMcpBaseUrl({ explicit: 'https://mcp.example.com', dev: false, origin })).toBe('https://mcp.example.com');
    expect(resolveMcpBaseUrl({ explicit: 'https://mcp.example.com', dev: true, origin })).toBe('https://mcp.example.com');
  });
  it('명시값이 없고 개발 모드면 로컬 MCP 포트', () => {
    expect(resolveMcpBaseUrl({ explicit: undefined, dev: true, origin })).toBe('http://localhost:6090');
  });
  it('명시값이 없는 운영 빌드는 접속한 웹 origin', () => {
    expect(resolveMcpBaseUrl({ explicit: undefined, dev: false, origin })).toBe(origin);
  });
  it('빈 문자열은 없는 것으로 본다(빌드 인자를 비워 넘긴 경우)', () => {
    expect(resolveMcpBaseUrl({ explicit: '', dev: false, origin })).toBe(origin);
    expect(resolveMcpBaseUrl({ explicit: '', dev: true, origin })).toBe('http://localhost:6090');
  });
});
