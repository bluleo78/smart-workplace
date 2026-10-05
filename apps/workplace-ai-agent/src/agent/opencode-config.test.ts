import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./subagent-loader.js', () => ({
  loadSubagents: vi.fn(() => ({
    'issue-agent': { description: 'd', tools: ['mcp__workplace__get_issue_detail'], prompt: 'p', maxTurns: 12 },
  })),
}));

import {
  splitOpencodeModel,
  buildOpencodeConfig,
  toOpencodeSubagents,
  isDev,
  resolveStdioEntryCmd,
  NO_VISION_PROMPT_RULE,
} from './opencode-config.js';

const VISION_ON = { vision: true };
const VISION_OFF = { vision: false };
const VISION_UNKNOWN = { vision: undefined };
import { loadSubagents } from './subagent-loader.js';
import type { RunnerInput } from './agent-runner.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

function baseInput(over: Partial<RunnerInput> = {}): RunnerInput {
  return {
    userMessage: 'hello',
    systemPrompt: 'sys-prompt',
    model: 'openai/gpt-5',
    maxTurns: 10,
    credential: { provider: 'opencode', payload: { providerId: 'openai', options: { apiKey: 'sk-abc' } }, model: null },
    agentId: 7,
    timeoutMs: 60_000,
    logTag: 'test:7',
    ...over,
  };
}

describe('splitOpencodeModel', () => {
  it('첫 / 기준으로 providerID/modelID 분해', () => {
    expect(splitOpencodeModel('openai/gpt-5')).toEqual({ providerID: 'openai', modelID: 'gpt-5' });
  });

  it('providerID 안에 / 없어도 modelID 에 남은 / 는 보존(첫 / 기준)', () => {
    expect(splitOpencodeModel('openrouter/anthropic/claude-3')).toEqual({
      providerID: 'openrouter',
      modelID: 'anthropic/claude-3',
    });
  });

  it('/ 없으면 throw', () => {
    expect(() => splitOpencodeModel('gpt-5')).toThrow();
  });
});

describe('resolveStdioEntryCmd / isDev', () => {
  it('테스트(.ts) 환경에서는 dev 로 판별', () => {
    expect(isDev()).toBe(true);
  });

  it('dev 커맨드는 tsx 로 stdio-entry.ts 를 실행', () => {
    const cmd = resolveStdioEntryCmd();
    expect(cmd[0]).toBe('npx');
    expect(cmd[1]).toBe('tsx');
    expect(cmd[2]).toContain('stdio-entry.ts');
  });
});

describe('toOpencodeSubagents', () => {
  it('mode:subagent + frontmatter allowlist 만 opencode 도구명으로 허용, model 미지정(상속)', () => {
    const out = toOpencodeSubagents({
      'issue-agent': {
        description: 'd',
        tools: ['mcp__workplace__list_issues', 'mcp__workplace__submit_response'],
        prompt: 'p',
        maxTurns: 12,
      },
    });
    expect(out['issue-agent']).toEqual({
      mode: 'subagent',
      description: 'd',
      prompt: 'p',
      tools: { '*': false, workplace_list_issues: true, workplace_submit_response: true },
      maxSteps: 12,
    });
  });

  it('maxTurns 없으면 maxSteps 미포함', () => {
    const out = toOpencodeSubagents({ a: { description: 'd', tools: [], prompt: 'p' } });
    expect(out.a).not.toHaveProperty('maxSteps');
  });
});

describe('buildOpencodeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKPLACE_API_BASE_URL = 'http://api.local/api/v1';
    process.env.INTERNAL_SERVICE_TOKEN = 'tok-internal';
    delete process.env.PORT;
  });
  afterEach(() => {
    delete process.env.WORKPLACE_API_BASE_URL;
    delete process.env.INTERNAL_SERVICE_TOKEN;
  });

  it('provider 블록: payload.providerId 로 등록 + npm 기본값 + 비전 모델은 이미지 입력 선언(WP-241)', () => {
    const cfg = buildOpencodeConfig(baseInput(), 'run-1', ['npx', 'tsx', 'entry.ts'], VISION_ON);
    expect(cfg.provider).toEqual({
      openai: {
        npm: '@ai-sdk/openai-compatible',
        options: { apiKey: 'sk-abc' },
        models: { 'gpt-5': { modalities: { input: ['text', 'image'], output: ['text'] } } },
      },
    });
  });

  it('비전 미지원: modalities 미선언 + 프롬프트 규칙 + MCP_VISION=0 + 서브에이전트 프롬프트에도 규칙(WP-241)', () => {
    const client = {} as unknown as WorkplaceApiClient;
    const cfg = buildOpencodeConfig(
      baseInput({ allowSubagents: true, mcp: { client, profile: 'assistant', onBehalfOfId: 1 } }),
      'run-1',
      ['cmd'],
      VISION_OFF,
    );
    expect(cfg.provider?.openai?.models).toEqual({ 'gpt-5': {} });
    expect(cfg.agent?.primary?.prompt).toBe('sys-prompt' + NO_VISION_PROMPT_RULE);
    expect(cfg.agent?.['issue-agent']?.prompt).toBe('p' + NO_VISION_PROMPT_RULE);
    const env = (cfg.mcp?.workplace as { environment?: Record<string, string> }).environment;
    expect(env?.MCP_VISION).toBe('0');
  });

  it('비전 알 수 없음: modalities 미선언(opencode 자체 판단) + 프롬프트 규칙 + 이미지는 그대로(MCP_VISION=1)', () => {
    const client = {} as unknown as WorkplaceApiClient;
    const cfg = buildOpencodeConfig(
      baseInput({ mcp: { client, profile: 'assistant', onBehalfOfId: 1 } }),
      'run-1',
      ['cmd'],
      VISION_UNKNOWN,
    );
    expect(cfg.provider?.openai?.models).toEqual({ 'gpt-5': {} });
    expect(cfg.agent?.primary?.prompt).toBe('sys-prompt' + NO_VISION_PROMPT_RULE);
    const env = (cfg.mcp?.workplace as { environment?: Record<string, string> }).environment;
    expect(env?.MCP_VISION).toBe('1');
  });

  it('provider npm 지정 시 그대로 사용', () => {
    const cfg = buildOpencodeConfig(
      baseInput({ credential: { provider: 'opencode', payload: { providerId: 'openai', npm: '@ai-sdk/openai', options: {} }, model: null } }),
      'run-1',
      ['cmd'], VISION_ON,
    );
    expect(cfg.provider?.openai?.npm).toBe('@ai-sdk/openai');
  });

  it('primary agent: systemPrompt/maxTurns→maxSteps/MCP-only tools/permission deny', () => {
    const cfg = buildOpencodeConfig(baseInput(), 'run-1', ['cmd'], VISION_ON);
    expect(cfg.agent?.primary).toEqual({
      mode: 'primary',
      prompt: 'sys-prompt',
      maxSteps: 10,
      tools: { '*': false, 'workplace*': true },
      permission: { edit: 'deny', bash: 'deny', webfetch: 'deny' },
    });
  });

  // WP-236: 이슈 챗 첨부 — read 를 열고 바깥 경로는 external_directory 로 막는다(인스턴스 디렉터리는 러너가 첨부 루트로 지정).
  it('allowFileRead=true 면 primary 에 read 허용 + external_directory deny', () => {
    const cfg = buildOpencodeConfig(baseInput({ allowFileRead: true }), 'run-1', ['cmd'], VISION_ON);
    expect(cfg.agent?.primary?.tools).toEqual({ '*': false, 'workplace*': true, read: true });
    expect(cfg.agent?.primary?.permission).toEqual({
      edit: 'deny',
      bash: 'deny',
      webfetch: 'deny',
      external_directory: 'deny',
    });
  });

  it('allowFileRead=true 여도 서브에이전트에는 read 를 열지 않는다', () => {
    const cfg = buildOpencodeConfig(
      baseInput({ allowFileRead: true, allowSubagents: true }), 'run-1', ['cmd'], VISION_ON,
    );
    expect(cfg.agent?.['issue-agent']?.tools?.read).toBeUndefined();
  });

  it('allowSubagents=true 면 loadSubagents 변환분이 agent 블록에 포함', () => {
    const cfg = buildOpencodeConfig(baseInput({ allowSubagents: true }), 'run-1', ['cmd'], VISION_ON);
    expect(loadSubagents).toHaveBeenCalled();
    expect(cfg.agent?.['issue-agent']).toMatchObject({ mode: 'subagent', prompt: 'p' });
  });

  it('allowSubagents 미지정 시 서브에이전트 미포함', () => {
    const cfg = buildOpencodeConfig(baseInput(), 'run-1', ['cmd'], VISION_ON);
    expect(loadSubagents).not.toHaveBeenCalled();
    expect(cfg.agent?.['issue-agent']).toBeUndefined();
  });

  it('mcp 미지정 시 mcp 블록 빈 객체', () => {
    const cfg = buildOpencodeConfig(baseInput(), 'run-1', ['cmd'], VISION_ON);
    expect(cfg.mcp).toEqual({});
  });

  it('mcp 지정 시 workplace local MCP 항목 + 컨텍스트 env 채움', () => {
    const client = {} as unknown as WorkplaceApiClient;
    const cfg = buildOpencodeConfig(
      baseInput({
        mcp: {
          client,
          profile: 'issue',
          onBehalfOfId: 55,
          threadBinding: { channelId: 1, parentMessageId: 2 },
          delegationContext: { actorId: 3, channelId: 1, parentMessageId: 2 },
        },
      }),
      'run-42',
      ['npx', 'tsx', 'entry.ts'], VISION_ON,
    );
    expect(cfg.mcp?.workplace).toEqual({
      type: 'local',
      command: ['npx', 'tsx', 'entry.ts'],
      environment: {
        WORKPLACE_API_BASE_URL: 'http://api.local/api/v1',
        INTERNAL_SERVICE_TOKEN: 'tok-internal',
        MCP_PROFILE: 'issue',
        MCP_ON_BEHALF_OF: '55',
        MCP_VISION: '1',
        MCP_THREAD_BINDING: JSON.stringify({ channelId: 1, parentMessageId: 2 }),
        MCP_DELEGATION_CONTEXT: JSON.stringify({ actorId: 3, channelId: 1, parentMessageId: 2 }),
      },
    });
  });

  // WP-244: chat 도구의 실행 스레드 바인딩이 stdio MCP env 로 전달된다.
  it('mcp.chatThreadId 있으면 MCP_CHAT_THREAD_ID 추가', () => {
    const client = {} as unknown as WorkplaceApiClient;
    const cfg = buildOpencodeConfig(
      baseInput({ mcp: { client, profile: 'chat', onBehalfOfId: 1, chatThreadId: 17 } }),
      'run-1',
      ['cmd'],
    );
    const env = (cfg.mcp?.workplace as { environment?: Record<string, string> }).environment;
    expect(env?.MCP_CHAT_THREAD_ID).toBe('17');
  });

  it('mcp.hostBridge 있으면 MCP_BRIDGE_URL/MCP_BRIDGE_RUN_ID 추가', () => {
    const client = {} as unknown as WorkplaceApiClient;
    const cfg = buildOpencodeConfig(
      baseInput({
        mcp: {
          client,
          profile: 'messaging',
          onBehalfOfId: 1,
          hostBridge: { onProposal: vi.fn(), onSubmitResponse: vi.fn(), onUnassignResult: vi.fn() },
        },
      }),
      'run-99',
      ['cmd'], VISION_ON,
    );
    expect(cfg.mcp?.workplace?.type).toBe('local');
    const env = (cfg.mcp?.workplace as { environment?: Record<string, string> }).environment;
    expect(env?.MCP_BRIDGE_URL).toBe('http://localhost:6070/internal/bridge');
    expect(env?.MCP_BRIDGE_RUN_ID).toBe('run-99');
  });

  it('mcp.onTool 만 있어도 브리지 좌표 추가', () => {
    const client = {} as unknown as WorkplaceApiClient;
    const cfg = buildOpencodeConfig(
      baseInput({ mcp: { client, profile: 'home', onBehalfOfId: 1, onTool: vi.fn() } }),
      'run-7',
      ['cmd'], VISION_ON,
    );
    const env = (cfg.mcp?.workplace as { environment?: Record<string, string> }).environment;
    expect(env?.MCP_BRIDGE_URL).toBeDefined();
    expect(env?.MCP_BRIDGE_RUN_ID).toBe('run-7');
  });

  it('anthropic credential 로 호출하면 throw', () => {
    expect(() =>
      buildOpencodeConfig(baseInput({ credential: { provider: 'anthropic', token: 't', model: null } }), 'run-1', ['cmd'], VISION_ON),
    ).toThrow();
  });

  it('model providerID 가 payload.providerId 와 다르면 throw', () => {
    expect(() => buildOpencodeConfig(baseInput({ model: 'anthropic/claude' }), 'run-1', ['cmd'], VISION_ON)).toThrow();
  });
});
