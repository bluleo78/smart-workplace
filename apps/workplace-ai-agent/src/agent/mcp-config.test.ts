import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

import { writeTempMcpConfig, cleanupTempMcpConfig } from './mcp-config.js';

describe('writeTempMcpConfig profile', () => {
  let p = '';
  afterEach(() => {
    if (p) cleanupTempMcpConfig(p);
  });

  it('profile=chat → env.WORKPLACE_MCP_PROFILE=chat', () => {
    p = writeTempMcpConfig({ agentId: 99, baseURL: 'http://x', internalToken: 't', profile: 'chat' });
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    expect(cfg.mcpServers.workplace.env.WORKPLACE_MCP_PROFILE).toBe('chat');
  });

  it('profile 생략 → issue 기본', () => {
    p = writeTempMcpConfig({ agentId: 99, baseURL: 'http://x', internalToken: 't' });
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    expect(cfg.mcpServers.workplace.env.WORKPLACE_MCP_PROFILE).toBe('issue');
  });
});
