import { describe, expect, it } from 'vitest';

import { agentToolFromUserAgent } from './agent-tool.js';

describe('agentToolFromUserAgent', () => {
  it('Claude Code UA 의 첫 제품 토큰', () => expect(agentToolFromUserAgent('claude-code/2.1.296 (sdk-cli)')).toBe('claude-code'));
  it('대문자는 소문자로', () => expect(agentToolFromUserAgent('Cursor/1.2')).toBe('cursor'));
  it('없거나 이상하면 mcp', () => {
    expect(agentToolFromUserAgent(undefined)).toBe('mcp');
    expect(agentToolFromUserAgent('')).toBe('mcp');
    expect(agentToolFromUserAgent('weird_name!/1')).toBe('mcp');
  });
  it('배열이면 첫 값', () => expect(agentToolFromUserAgent(['claude-code/1', 'x'])).toBe('claude-code'));
  it('범용 HTTP 라이브러리·브라우저 UA 는 에이전트를 알려 주지 않으므로 mcp', () => {
    for (const ua of [
      'node',
      'undici',
      'axios/1.7.2',
      'python-httpx/0.27.0',
      'python-requests/2.31.0',
      'Python-urllib/3.12',
      'httpx/0.27',
      'curl/8.7.1',
      'Wget/1.21.4',
      'Go-http-client/1.1',
      'okhttp/4.12.0',
      'Java/17.0.2',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'got (https://github.com/sindresorhus/got)',
      'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
    ]) {
      expect(agentToolFromUserAgent(ua), ua).toBe('mcp');
    }
  });
  it('라이브러리 이름을 접두로 가진 도구 이름은 그대로 둔다(정확히 일치할 때만 대체)', () => {
    expect(agentToolFromUserAgent('nodebot/1.0')).toBe('nodebot');
    expect(agentToolFromUserAgent('curl-agent/2')).toBe('curl-agent');
  });
});
