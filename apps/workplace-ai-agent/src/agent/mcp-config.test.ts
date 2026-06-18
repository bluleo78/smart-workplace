import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  writeTempMcpConfig,
  cleanupTempMcpConfig,
  resolveMcpServerCommand,
} from './mcp-config.js';

// #277: MCP 도구 서버는 dev(소스)/prod(dist) 를 자동 감지해 띄워야 한다.
// 기존엔 dist 경로를 하드코딩해 dev 에서 stale dist 를 spawn → 메시징 AI 무응답.
describe('resolveMcpServerCommand (dev/prod 자동 감지)', () => {
  it('prod: 컴파일된 .js 가 있으면 node 로 dist/mcp 서버를 띄운다', () => {
    // here = dist/agent, 컴파일본 존재(stub: 항상 true)
    const { command, args } = resolveMcpServerCommand('/app/dist/agent', () => true);
    expect(command).toBe('node');
    expect(args).toHaveLength(1);
    expect(args[0].replace(/\\/g, '/')).toBe('/app/dist/mcp/workplace-mcp-server.js');
  });

  it('dev: 컴파일본이 없으면 tsx 로 src/mcp 의 .ts 를 직접 실행한다', () => {
    // here = src/agent, 컴파일본 없음(stub: 항상 false)
    const { command, args } = resolveMcpServerCommand('/app/src/agent', () => false);
    expect(command.replace(/\\/g, '/')).toBe('/app/node_modules/.bin/tsx');
    expect(args).toHaveLength(1);
    expect(args[0].replace(/\\/g, '/')).toBe('/app/src/mcp/workplace-mcp-server.ts');
  });
});

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

  it('pendingActionPath 설정 시 env.WORKPLACE_PENDING_ACTION_PATH 로 주입', () => {
    p = writeTempMcpConfig({ agentId: 7, baseURL: 'http://x', internalToken: 't', profile: 'assistant', pendingActionPath: '/tmp/wd/pending-action.json' });
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    expect(cfg.mcpServers.workplace.env.WORKPLACE_PENDING_ACTION_PATH).toBe('/tmp/wd/pending-action.json');
    cleanupTempMcpConfig(p);
    p = ''; // afterEach 중복 정리 방지
  });
});
