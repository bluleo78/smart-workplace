import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import type { RunnerEvent } from './runner-events.js';

// agent-runner mock — runnerFor().stream: onEvent 으로 가짜 RunnerEvent 3개 즉시 주입 후 done resolve.
// (진행 신호: tool_use → 'tool', tool_done → tool_result, result → 종료)
const { streamSpy } = vi.hoisted(() => ({ streamSpy: vi.fn() }));
vi.mock('./agent-runner.js', () => ({
  runnerFor: vi.fn(() => ({ stream: streamSpy, collect: vi.fn() })),
}));
vi.mock('./attachment-source.js', () => ({
  collectAttachments: vi.fn(async () => ({ attachments: [], issueListFailed: false })),
}));
vi.mock('./attachment-presenter.js', () => ({
  presentAttachments: vi.fn(async () => ({ section: '첨부 없음', guidance: '' })),
}));

import { runChatAgent, TRIGGER_POLL_INTERVAL_MS, TRIGGER_POLL_TIMEOUT_MS } from './run-chat-agent.js';
import { attachmentRootDir } from './attachment-prep.js';
import { collectAttachments } from './attachment-source.js';
import { presentAttachments } from './attachment-presenter.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';
import type { ExtractionInfo, WorkplaceApiClient } from '../clients/workplace-api.js';
import type { AgentAttachment, CollectedAttachments } from './attachment-source.js';

const NONE: CollectedAttachments = { attachments: [], issueListFailed: false };

// 기본 stream 구현 — search_wiki tool_use → tool_done → result 순으로 발행.
function defaultStreamImpl(_i: unknown, onEvent: (e: RunnerEvent) => void) {
  onEvent({ type: 'tool_use', name: 'mcp__workplace__search_wiki', input: {}, parentToolUseId: null });
  onEvent({ type: 'tool_done' });
  onEvent({ type: 'result', ok: true, text: null, usage: null });
  return { done: Promise.resolve(), kill: vi.fn() };
}

const env: ChatEventEnvelope = {
  type: 'chat.message.posted',
  payload: {
    projectKey: 'WP',
    issueKey: 'WP-1',
    issueId: 1,
    threadId: 5,
    messageId: 9,
    actor: { id: 7, username: 'a', name: 'A', kind: 'HUMAN' },
    body: '@AI',
    mentions: [{ id: 99, username: 'ai', name: 'AI', kind: 'AGENT' }],
    occurredAt: 't',
  },
};

function deps() {
  return {
    client: {
      getProviderCredential: vi.fn(async () => ({ provider: 'anthropic', token: 'TK', model: null })),
      getChatMessages: vi.fn(async () => []),
      listIssueAttachments: vi.fn(async () => []),
      downloadIssueAttachment: vi.fn(),
      postChatProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorkplaceApiClient,
  };
}

describe('runChatAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamSpy.mockImplementation(defaultStreamImpl);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(collectAttachments).mockResolvedValue(NONE);
    vi.mocked(presentAttachments).mockResolvedValue({ section: '첨부 없음', guidance: '' });
  });

  it('mentions AGENT → 토큰 fetch + 첨부 준비 + SDK spawn(allowFileRead, cwd, mcp, partial=false)', async () => {
    await runChatAgent(env, deps());
    expect(collectAttachments).toHaveBeenCalledWith(expect.anything(), 99, 'WP-1', 5, []);
    expect(presentAttachments).toHaveBeenCalledWith('anthropic', NONE, expect.objectContaining({ agentId: 99 }));
    expect(streamSpy).toHaveBeenCalledOnce();
    const runCall = vi.mocked(streamSpy).mock.calls[0][0] as {
      allowFileRead?: boolean; cwd?: string; includePartialMessages?: boolean; agentId?: number;
      mcp?: { workplaceClient?: unknown; profile?: string; onBehalfOfId?: number };
    };
    expect(runCall.allowFileRead).toBe(true);
    expect(typeof runCall.cwd).toBe('string');
    // WP-236: opencode 가 인스턴스 디렉터리로 쓰는 첨부 루트 아래여야 첨부를 읽을 수 있다(실행 후 폴더는 삭제됨)
    expect(path.dirname(runCall.cwd!)).toBe(attachmentRootDir(runCall.agentId!));
    expect(runCall.includePartialMessages).toBe(false);
    // 러너가 인-프로세스 서버를 chat 프로필 + 멘션된 agentId(99)로 구성하도록 mcp 설정 전달
    expect(runCall.mcp).toMatchObject({ profile: 'chat', onBehalfOfId: 99 });
  });

  it('mentions 에 AGENT 없으면 spawn 생략', async () => {
    const noAgent: ChatEventEnvelope = {
      ...env,
      payload: {
        ...env.payload,
        mentions: [{ id: 7, username: 'a', name: 'A', kind: 'HUMAN' }],
      },
    };
    await runChatAgent(noAgent, deps());
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('모델 결정 이원화 해소: credential.model(redeem 응답)이 env/기본값보다 우선한다', async () => {
    const d = deps();
    vi.mocked(d.client.getProviderCredential).mockResolvedValue({
      provider: 'anthropic',
      token: 'TK',
      model: 'claude-opus-4-1',
    });
    await runChatAgent(env, d);
    const runCall = vi.mocked(streamSpy).mock.calls[0][0] as { model?: string };
    expect(runCall.model).toBe('claude-opus-4-1');
  });

  it('credential.model 이 null 이면 env/기본값으로 폴백한다', async () => {
    const d = deps();
    vi.mocked(d.client.getProviderCredential).mockResolvedValue({
      provider: 'anthropic',
      token: 'TK',
      model: null,
    });
    await runChatAgent(env, d);
    const runCall = vi.mocked(streamSpy).mock.calls[0][0] as { model?: string };
    expect(runCall.model).toBe('claude-sonnet-5-5');
  });
});

describe('runChatAgent 러너 분기', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamSpy.mockImplementation(defaultStreamImpl);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(collectAttachments).mockResolvedValue(NONE);
    vi.mocked(presentAttachments).mockResolvedValue({ section: '첨부 없음', guidance: '' });
  });

  it('opencode credential → presenter 에 opencode 전달', async () => {
    const d = deps();
    vi.mocked(d.client.getProviderCredential).mockResolvedValue({ provider: 'opencode', payload: {} as never, model: null } as never);
    await runChatAgent(env, d);
    expect(presentAttachments).toHaveBeenCalledWith('opencode', NONE, expect.anything());
  });
});

describe('runChatAgent 진행 발행', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamSpy.mockImplementation(defaultStreamImpl);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(collectAttachments).mockResolvedValue(NONE);
    vi.mocked(presentAttachments).mockResolvedValue({ section: '첨부 없음', guidance: '' });
  });

  it('started → tool → done 순으로 postChatProgress 를 호출한다', async () => {
    const postChatProgress = vi.fn().mockResolvedValue(undefined);
    const testDeps = {
      client: {
        getProviderCredential: vi.fn().mockResolvedValue({ provider: 'anthropic', token: 't', model: null }),
        getChatMessages: vi.fn().mockResolvedValue([]),
        listIssueAttachments: vi.fn().mockResolvedValue([]),
        downloadIssueAttachment: vi.fn(),
        postChatProgress,
      },
    } as never;
    const envelope = {
      type: 'chat.message.posted',
      payload: {
        projectKey: 'P', issueKey: 'P-1', issueId: 1, threadId: 7, messageId: 9,
        actor: { id: 1, username: 'u', name: 'U', kind: 'HUMAN' },
        body: '@AI 도와줘', mentions: [{ id: 9, username: 'ai', name: 'AI', kind: 'AGENT' }],
        occurredAt: '2026-06-18T00:00:00Z',
      },
    } as never;
    await runChatAgent(envelope, testDeps);
    const phases = postChatProgress.mock.calls.map((c: unknown[]) => (c[2] as { phase: string }).phase);
    expect(phases[0]).toBe('started');
    expect(phases).toContain('tool');
    expect(phases[phases.length - 1]).toBe('done');
    // 모든 호출이 동일 streamId
    const ids = new Set(postChatProgress.mock.calls.map((c: unknown[]) => (c[2] as { streamId: string }).streamId));
    expect(ids.size).toBe(1);
  });
});

describe('runChatAgent 트리거 첨부 추출 대기(WP-244)', () => {
  const ex = (status: ExtractionInfo['status']): ExtractionInfo => ({
    status, totalChars: status === 'READY' ? 10 : null, truncated: false, reasonCode: null, reason: null,
  });
  // 트리거 메시지(env.payload.messageId=9)의 챗 첨부
  const onMessage = (messageId: number, status: ExtractionInfo['status']): CollectedAttachments => ({
    attachments: [{
      origin: { kind: 'chat', threadId: 5, messageId }, fileId: 3, originalName: 'a.pdf',
      mimeType: 'application/pdf', sizeBytes: 1, extraction: ex(status),
    } satisfies AgentAttachment],
    issueListFailed: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    streamSpy.mockImplementation(defaultStreamImpl);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(presentAttachments).mockResolvedValue({ section: 'x', guidance: '' });
  });

  it('트리거 첨부 PENDING → 재조회에서 READY 가 되면 READY 로 표시', async () => {
    const d = { ...deps(), sleep: vi.fn(async () => {}) };
    vi.mocked(collectAttachments)
      .mockResolvedValueOnce(onMessage(9, 'PENDING'))
      .mockResolvedValueOnce(onMessage(9, 'READY'));
    await runChatAgent(env, d);
    expect(d.sleep).toHaveBeenCalledTimes(1);
    expect(d.sleep).toHaveBeenCalledWith(TRIGGER_POLL_INTERVAL_MS);
    expect(d.client.getChatMessages).toHaveBeenCalledTimes(2);
    expect(presentAttachments).toHaveBeenCalledWith('anthropic', onMessage(9, 'READY'), expect.anything());
  });

  it('제한 시간까지 PENDING 이면 PENDING 그대로 진행', async () => {
    const d = { ...deps(), sleep: vi.fn(async () => {}) };
    vi.mocked(collectAttachments).mockResolvedValue(onMessage(9, 'PENDING'));
    await runChatAgent(env, d);
    const polls = Math.ceil(TRIGGER_POLL_TIMEOUT_MS / TRIGGER_POLL_INTERVAL_MS);
    expect(d.sleep).toHaveBeenCalledTimes(polls);
    expect(d.client.getChatMessages).toHaveBeenCalledTimes(1 + polls);
    expect(presentAttachments).toHaveBeenCalledWith('anthropic', onMessage(9, 'PENDING'), expect.anything());
    expect(streamSpy).toHaveBeenCalledOnce();
  });

  it('트리거 메시지에 PENDING 첨부가 없으면 기다리지 않는다(다른 메시지의 PENDING 은 무시)', async () => {
    const d = { ...deps(), sleep: vi.fn(async () => {}) };
    vi.mocked(collectAttachments).mockResolvedValue(onMessage(8, 'PENDING'));
    await runChatAgent(env, d);
    expect(d.sleep).not.toHaveBeenCalled();
    expect(d.client.getChatMessages).toHaveBeenCalledTimes(1);
  });

  it('재조회 실패 → 기다림을 멈추고 마지막 상태로 진행', async () => {
    const d = { ...deps(), sleep: vi.fn(async () => {}) };
    vi.mocked(d.client.getChatMessages).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('boom'));
    vi.mocked(collectAttachments).mockResolvedValue(onMessage(9, 'PENDING'));
    await runChatAgent(env, d);
    expect(d.sleep).toHaveBeenCalledTimes(1);
    expect(presentAttachments).toHaveBeenCalledWith('anthropic', onMessage(9, 'PENDING'), expect.anything());
    expect(streamSpy).toHaveBeenCalledOnce();
  });
});
