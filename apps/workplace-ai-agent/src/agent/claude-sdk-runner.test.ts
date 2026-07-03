import { describe, expect, it, vi, beforeEach } from 'vitest';

// sdk-runner.ts(runSdkStream/runSdkCollect)를 모킹해 ClaudeSdkRunner 가 이를 올바른 인자로
// 호출하고, 반환/전달되는 라인을 mapSdkMessage 로 RunnerEvent 변환하는지만 검증한다.
vi.mock('./sdk-runner.js', () => ({
  runSdkStream: vi.fn(),
  runSdkCollect: vi.fn(),
}));
const MCP_SENTINEL = { __sentinel: 'workplace-mcp' };
vi.mock('./sdk-mcp-server.js', () => ({
  buildInProcessWorkplaceMcpServer: vi.fn(() => MCP_SENTINEL),
}));
vi.mock('./subagent-loader.js', () => ({
  loadSubagents: vi.fn(() => ({ 'issue-agent': { description: 'd', tools: [], prompt: 'p' } })),
  toAgentDefinitions: vi.fn((defs: Record<string, unknown>) => ({
    ...Object.fromEntries(Object.keys(defs).map((k) => [k, { __agentDef: k }])),
  })),
}));

import { ClaudeSdkRunner } from './claude-sdk-runner.js';
import { runSdkCollect, runSdkStream } from './sdk-runner.js';
import { buildInProcessWorkplaceMcpServer } from './sdk-mcp-server.js';
import { loadSubagents, toAgentDefinitions } from './subagent-loader.js';
import type { RunnerInput } from './agent-runner.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

function baseInput(over: Partial<RunnerInput> = {}): RunnerInput {
  return {
    userMessage: 'hello',
    systemPrompt: 'sys',
    model: 'claude-sonnet-4-6',
    maxTurns: 8,
    credential: { provider: 'anthropic', token: 'tok-abc', model: null },
    agentId: 7,
    timeoutMs: 60_000,
    logTag: 'test:7',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClaudeSdkRunner.collect', () => {
  it('runSdkCollect 라인을 mapSdkMessage 로 변환한 RunnerEvent[] 반환', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '중간' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', result: '최종' }),
    ]);
    const runner = new ClaudeSdkRunner();
    const events = await runner.collect(baseInput());
    expect(events).toEqual([
      { type: 'assistant_text', text: '중간' },
      { type: 'result', ok: true, text: '최종', usage: null },
    ]);
  });

  it('token·agentId·model·maxTurns 를 SdkRunInput 으로 위임', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([]);
    const runner = new ClaudeSdkRunner();
    await runner.collect(baseInput({ agentId: 42 }));
    const arg = vi.mocked(runSdkCollect).mock.calls[0][0];
    expect(arg.token).toBe('tok-abc');
    expect(arg.agentId).toBe(42);
    expect(arg.model).toBe('claude-sonnet-4-6');
    expect(arg.maxTurns).toBe(8);
  });

  it('비JSON 라인은 무시', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue(['not-json{{', JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' })]);
    const runner = new ClaudeSdkRunner();
    const events = await runner.collect(baseInput());
    expect(events).toEqual([{ type: 'result', ok: true, text: 'ok', usage: null }]);
  });

  it('opencode credential 전달 시 throw', async () => {
    const runner = new ClaudeSdkRunner();
    await expect(
      runner.collect(baseInput({ credential: { provider: 'opencode', payload: { providerId: 'x', options: {} }, model: null } })),
    ).rejects.toThrow();
  });

  it('mcp 지정 시 buildInProcessWorkplaceMcpServer 호출 인자 검증 + mcpServers.workplace 주입', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([]);
    const client = { getOAuthToken: vi.fn() } as unknown as WorkplaceApiClient;
    const runner = new ClaudeSdkRunner();
    await runner.collect(
      baseInput({
        mcp: {
          client,
          profile: 'issue',
          onBehalfOfId: 201,
          threadBinding: { channelId: 1, parentMessageId: 2 },
        },
      }),
    );
    expect(buildInProcessWorkplaceMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ client, onBehalfOfId: 201, profile: 'issue', threadBinding: { channelId: 1, parentMessageId: 2 } }),
    );
    const arg = vi.mocked(runSdkCollect).mock.calls[0][0];
    expect(arg.mcpServers?.workplace).toBe(MCP_SENTINEL);
  });

  it('mcp 미지정 시 mcpServers 미전달', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([]);
    const runner = new ClaudeSdkRunner();
    await runner.collect(baseInput());
    expect(buildInProcessWorkplaceMcpServer).not.toHaveBeenCalled();
    const arg = vi.mocked(runSdkCollect).mock.calls[0][0];
    expect(arg.mcpServers).toBeUndefined();
  });

  it('allowSubagents=true 시 loadSubagents/toAgentDefinitions 로 agents 구성', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([]);
    const runner = new ClaudeSdkRunner();
    await runner.collect(baseInput({ allowSubagents: true }));
    expect(loadSubagents).toHaveBeenCalled();
    expect(toAgentDefinitions).toHaveBeenCalled();
    const arg = vi.mocked(runSdkCollect).mock.calls[0][0];
    expect(arg.agents).toEqual({ 'issue-agent': { __agentDef: 'issue-agent' } });
  });

  it('allowSubagents 미지정 시 agents 미전달', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([]);
    const runner = new ClaudeSdkRunner();
    await runner.collect(baseInput());
    expect(loadSubagents).not.toHaveBeenCalled();
    const arg = vi.mocked(runSdkCollect).mock.calls[0][0];
    expect(arg.agents).toBeUndefined();
  });
});

describe('ClaudeSdkRunner.stream', () => {
  it('onLine 라인을 mapSdkMessage 로 변환해 onEvent 로 emit', () => {
    let onLine: ((line: string) => void) | undefined;
    vi.mocked(runSdkStream).mockImplementation((_i, cb) => {
      onLine = cb;
      return { done: Promise.resolve(), kill: vi.fn() };
    });
    const runner = new ClaudeSdkRunner();
    const events: unknown[] = [];
    runner.stream(baseInput(), (e) => events.push(e));
    expect(onLine).toBeDefined();
    onLine!(JSON.stringify({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ab' } } }));
    onLine!('garbage-not-json');
    expect(events).toEqual([{ type: 'text_delta', text: 'ab', parentToolUseId: null }]);
  });

  it('done/kill 을 그대로 위임', async () => {
    const kill = vi.fn();
    vi.mocked(runSdkStream).mockReturnValue({ done: Promise.resolve(), kill });
    const runner = new ClaudeSdkRunner();
    const handle = runner.stream(baseInput(), () => {});
    handle.kill();
    expect(kill).toHaveBeenCalledOnce();
    await expect(handle.done).resolves.toBeUndefined();
  });
});
