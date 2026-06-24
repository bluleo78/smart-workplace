import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, unlinkSync } from 'node:fs';

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

  it('toolUseLogPath 를 주면 WORKPLACE_TOOL_USE_LOG_PATH env 를 주입한다', () => {
    p = writeTempMcpConfig({
      agentId: 7, baseURL: 'http://x', internalToken: 't',
      profile: 'assistant', toolUseLogPath: '/tmp/wd/tool-use.log',
    });
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    expect(cfg.mcpServers.workplace.env.WORKPLACE_TOOL_USE_LOG_PATH).toBe('/tmp/wd/tool-use.log');
    cleanupTempMcpConfig(p);
    p = ''; // afterEach 중복 정리 방지
  });
});

function readEnv(opts: Parameters<typeof writeTempMcpConfig>[0]) {
  const p = writeTempMcpConfig(opts);
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  cleanupTempMcpConfig(p);
  return cfg.mcpServers.workplace.env as Record<string, string>;
}

describe('writeTempMcpConfig 트리거 바인딩 env', () => {
  const base = { agentId: 2, baseURL: 'http://x', internalToken: 't', profile: 'messaging' as const };

  it('triggerChannelId+triggerThreadParentId 를 주면 두 env 키를 주입한다', () => {
    const env = readEnv({ ...base, triggerChannelId: 9, triggerThreadParentId: 210 });
    expect(env.WORKPLACE_TRIGGER_CHANNEL_ID).toBe('9');
    expect(env.WORKPLACE_TRIGGER_THREAD_PARENT_ID).toBe('210');
  });

  it('트리거 바인딩을 안 주면 두 env 키가 없다(인라인)', () => {
    const env = readEnv(base);
    expect(env.WORKPLACE_TRIGGER_CHANNEL_ID).toBeUndefined();
    expect(env.WORKPLACE_TRIGGER_THREAD_PARENT_ID).toBeUndefined();
  });

  // L3 위임: triggerActorId/triggerChannelId 독립 주입 검증.
  it('triggerActorId/triggerChannelId 를 주면 위임 env 를 주입한다', () => {
    const p = writeTempMcpConfig({
      agentId: 2, baseURL: 'http://x', internalToken: 't', profile: 'messaging',
      triggerActorId: 7, triggerChannelId: 9,
    });
    const env = JSON.parse(readFileSync(p, 'utf8')).mcpServers.workplace.env;
    expect(env.WORKPLACE_TRIGGER_ACTOR_ID).toBe('7');
    expect(env.WORKPLACE_TRIGGER_CHANNEL_ID).toBe('9');
    expect(env.WORKPLACE_TRIGGER_THREAD_PARENT_ID).toBeUndefined();
    unlinkSync(p);
  });

  it('thread parent 가 있으면 thread mirror env 도 함께 주입', () => {
    const p = writeTempMcpConfig({
      agentId: 2, baseURL: 'http://x', internalToken: 't', profile: 'messaging',
      triggerActorId: 7, triggerChannelId: 9, triggerThreadParentId: 100,
    });
    const env = JSON.parse(readFileSync(p, 'utf8')).mcpServers.workplace.env;
    expect(env.WORKPLACE_TRIGGER_THREAD_PARENT_ID).toBe('100');
    unlinkSync(p);
  });
});
