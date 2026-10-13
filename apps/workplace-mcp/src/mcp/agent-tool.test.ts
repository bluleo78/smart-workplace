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
});
