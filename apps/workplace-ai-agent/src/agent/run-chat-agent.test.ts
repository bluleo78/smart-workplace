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
  fetchIssueAttachments: vi.fn(async () => ({ attachments: [], failed: false })),
  mergeAttachments: vi.fn(() => ({ attachments: [], issueListFailed: false })),
}));
vi.mock('./attachment-presenter.js', async (orig) => ({
  // readsLocally 는 실제 구현을 써서 추출 대기 판단까지 함께 검증한다.
  ...(await orig<typeof import('./attachment-presenter.js')>()),
  presentAttachments: vi.fn(async () => ({ section: '첨부 없음', guidance: '' })),
}));

import { runChatAgent, TRIGGER_POLL_INTERVAL_MS, TRIGGER_POLL_TIMEOUT_MS } from './run-chat-agent.js';
import { attachmentRootDir } from './attachment-prep.js';
import { fetchIssueAttachments, mergeAttachments } from './attachment-source.js';
import { presentAttachments } from './attachment-presenter.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';
import type { ExtractionInfo, WorkplaceApiClient } from '../clients/workplace-api.js';
import type { AgentAttachment, CollectedAttachments } from './attachment-source.js';

// Claude 는 항상 이미지·PDF·텍스트를 로컬로 본다(presenter 에 넘기는 reader).
const CLAUDE_READER = { runner: 'anthropic', imageVision: true };
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
      postChatProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorkplaceApiClient,
  };
}

// 모든 테스트 공통 초기화 — mock 호출 기록 리셋 후 기본 stream·첨부 결과(첨부 없음)를 깐다.
beforeEach(() => {
  vi.clearAllMocks();
  streamSpy.mockImplementation(defaultStreamImpl);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(fetchIssueAttachments).mockResolvedValue({ attachments: [], failed: false });
  vi.mocked(mergeAttachments).mockReturnValue(NONE);
  vi.mocked(presentAttachments).mockResolvedValue({ section: '첨부 없음', guidance: '' });
});

describe('runChatAgent', () => {
  it('mentions AGENT → 토큰 fetch + 첨부 준비 + SDK spawn(allowFileRead, cwd, mcp, partial=false)', async () => {
    await runChatAgent(env, deps());
    // 이슈 첨부는 스레드 경유로 조회한다(WP-244 — 비멤버 에이전트의 이슈 첨부 API 403 회피).
    expect(fetchIssueAttachments).toHaveBeenCalledWith(expect.anything(), 99, 5);
    expect(mergeAttachments).toHaveBeenCalledWith({ attachments: [], failed: false }, 5, []);
    expect(presentAttachments).toHaveBeenCalledWith(CLAUDE_READER, NONE, expect.objectContaining({ agentId: 99 }));
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
    // WP-244: chat 도구는 이 실행의 스레드(5)에 묶인다.
    expect(runCall.mcp).toMatchObject({ chatThreadId: 5 });
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
  it('opencode credential → presenter 에 opencode 전달', async () => {
    const d = deps();
    vi.mocked(d.client.getProviderCredential).mockResolvedValue({ provider: 'opencode', payload: {} as never, model: null } as never);
    await runChatAgent(env, d);
    expect(presentAttachments).toHaveBeenCalledWith({ runner: 'opencode', imageVision: false }, NONE, expect.anything());
  });

  // WP-241·244 통합: 비전 지원 opencode 모델이면 presenter 가 이미지를 로컬로 보게 한다.
  it('opencode 비전 모델 → presenter 에 imageVision true 전달', async () => {
    const d = deps();
    vi.mocked(d.client.getProviderCredential).mockResolvedValue({
      provider: 'opencode',
      payload: { vision: true },
      model: 'neuralwatt/qwen',
    } as never);
    await runChatAgent(env, d);
    expect(presentAttachments).toHaveBeenCalledWith({ runner: 'opencode', imageVision: true }, NONE, expect.anything());
    // 첨부 표현에 쓴 판단을 러너에도 그대로 넘긴다(러너가 다시 판단하지 않음).
    expect(vi.mocked(streamSpy).mock.calls[0][0]).toMatchObject({ opencodeVision: { value: true } });
  });

  it('opencode 모델 형식이 잘못돼도 비전 판단은 실패하지 않고 이미지 미지원으로 진행', async () => {
    const d = deps();
    vi.mocked(d.client.getProviderCredential).mockResolvedValue({ provider: 'opencode', payload: { vision: true }, model: 'no-slash' } as never);
    await runChatAgent(env, d);
    expect(presentAttachments).toHaveBeenCalledWith({ runner: 'opencode', imageVision: false }, NONE, expect.anything());
  });
});

describe('runChatAgent 진행 발행', () => {
  it('started → tool → done 순으로 postChatProgress 를 호출한다', async () => {
    const postChatProgress = vi.fn().mockResolvedValue(undefined);
    const testDeps = {
      client: {
        getProviderCredential: vi.fn().mockResolvedValue({ provider: 'anthropic', token: 't', model: null }),
        getChatMessages: vi.fn().mockResolvedValue([]),
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
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  // 기본 mime 은 Claude 가 로컬로 못 읽는 docx — 추출을 기다려야 하는 대표 사례.
  const onMessage = (messageId: number, status: ExtractionInfo['status'], mimeType = DOCX): CollectedAttachments => ({
    attachments: [{
      origin: { kind: 'chat', threadId: 5, messageId }, fileId: 3, originalName: 'a.bin',
      mimeType, sizeBytes: 1, extraction: ex(status),
    } satisfies AgentAttachment],
    issueListFailed: false,
  });

  // 공통 beforeEach 가 기본값을 깔고, 여기선 첨부 섹션만 바꾼다.
  beforeEach(() => {
    vi.mocked(presentAttachments).mockResolvedValue({ section: 'x', guidance: '' });
  });

  it('트리거 첨부 PENDING → 재조회에서 READY 가 되면 READY 로 표시', async () => {
    const d = { ...deps(), sleep: vi.fn(async () => {}) };
    vi.mocked(mergeAttachments)
      .mockReturnValueOnce(onMessage(9, 'PENDING'))
      .mockReturnValueOnce(onMessage(9, 'READY'));
    await runChatAgent(env, d);
    expect(d.sleep).toHaveBeenCalledTimes(1);
    expect(d.sleep).toHaveBeenCalledWith(TRIGGER_POLL_INTERVAL_MS);
    expect(d.client.getChatMessages).toHaveBeenCalledTimes(2);
    expect(presentAttachments).toHaveBeenCalledWith(CLAUDE_READER, onMessage(9, 'READY'), expect.anything());
  });

  it('제한 시간까지 PENDING 이면 PENDING 그대로 진행', async () => {
    const d = { ...deps(), sleep: vi.fn(async () => {}) };
    vi.mocked(mergeAttachments).mockReturnValue(onMessage(9, 'PENDING'));
    await runChatAgent(env, d);
    const polls = Math.ceil(TRIGGER_POLL_TIMEOUT_MS / TRIGGER_POLL_INTERVAL_MS);
    expect(d.sleep).toHaveBeenCalledTimes(polls);
    expect(d.client.getChatMessages).toHaveBeenCalledTimes(1 + polls);
    expect(presentAttachments).toHaveBeenCalledWith(CLAUDE_READER, onMessage(9, 'PENDING'), expect.anything());
    expect(streamSpy).toHaveBeenCalledOnce();
  });

  it('트리거 메시지에 PENDING 첨부가 없으면 기다리지 않는다(다른 메시지의 PENDING 은 무시)', async () => {
    const d = { ...deps(), sleep: vi.fn(async () => {}) };
    vi.mocked(mergeAttachments).mockReturnValue(onMessage(8, 'PENDING'));
    await runChatAgent(env, d);
    expect(d.sleep).not.toHaveBeenCalled();
    expect(d.client.getChatMessages).toHaveBeenCalledTimes(1);
  });

  it('재조회 실패 → 기다림을 멈추고 마지막 상태로 진행', async () => {
    const d = { ...deps(), sleep: vi.fn(async () => {}) };
    vi.mocked(d.client.getChatMessages).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('boom'));
    vi.mocked(mergeAttachments).mockReturnValue(onMessage(9, 'PENDING'));
    await runChatAgent(env, d);
    expect(d.sleep).toHaveBeenCalledTimes(1);
    expect(presentAttachments).toHaveBeenCalledWith(CLAUDE_READER, onMessage(9, 'PENDING'), expect.anything());
    expect(streamSpy).toHaveBeenCalledOnce();
  });

  it('Claude + 트리거 PENDING PDF → 로컬 Read 가능하므로 기다리지 않는다', async () => {
    const d = { ...deps(), sleep: vi.fn(async () => {}) };
    vi.mocked(mergeAttachments).mockReturnValue(onMessage(9, 'PENDING', 'application/pdf'));
    await runChatAgent(env, d);
    expect(d.sleep).not.toHaveBeenCalled();
    expect(d.client.getChatMessages).toHaveBeenCalledTimes(1);
  });

  it('opencode + 트리거 PENDING PDF → 로컬로 못 읽으므로 기다린다', async () => {
    const { runnerFor } = await import('./agent-runner.js');
    void runnerFor;
    const d = { ...deps(), sleep: vi.fn(async () => {}) };
    vi.mocked(d.client.getProviderCredential).mockResolvedValue({ provider: 'opencode' } as never);
    vi.mocked(mergeAttachments).mockReturnValue(onMessage(9, 'PENDING', 'application/pdf'));
    await runChatAgent(env, d);
    expect(d.sleep).toHaveBeenCalled();
  });

  it('추출 대기 전에 started 를 먼저 발행한다', async () => {
    const order: string[] = [];
    const d = { ...deps(), sleep: vi.fn(async () => { order.push('sleep'); }) };
    vi.mocked(d.client.postChatProgress).mockImplementation(async (_a, _t, b: { phase: string }) => { order.push(b.phase); });
    vi.mocked(mergeAttachments).mockReturnValue(onMessage(9, 'PENDING'));
    await runChatAgent(env, d);
    expect(order[0]).toBe('started');
    expect(order.indexOf('started')).toBeLessThan(order.indexOf('sleep'));
  });

  it('러너 실행 전 단계가 실패하면 error 를 발행하고 예외를 전파한다', async () => {
    const d = deps();
    const phases: string[] = [];
    vi.mocked(d.client.postChatProgress).mockImplementation(async (_a, _t, b: { phase: string }) => { phases.push(b.phase); });
    vi.mocked(fetchIssueAttachments).mockRejectedValue(new Error('boom'));
    await expect(runChatAgent(env, d)).rejects.toThrow('boom');
    expect(phases).toEqual(['started', 'error']);
  });
});

// WP-244: 모델이 add_chat_message 없이 평문으로 끝내면 그 평문을 대신 올린다(사용자가 아무것도 못 받는 일 방지).
describe('runChatAgent add_chat_message 누락 대체 답변(WP-244)', () => {
  // 주어진 이벤트들을 발행하고 done 을 resolve(또는 reject)하는 stream 구현.
  function streamWith(events: RunnerEvent[], fail = false) {
    return (_i: unknown, onEvent: (e: RunnerEvent) => void) => {
      for (const e of events) onEvent(e);
      return { done: fail ? Promise.reject(new Error('boom')) : Promise.resolve(), kill: vi.fn() };
    };
  }
  function depsWithAdd() {
    const d = deps();
    (d.client as unknown as { addChatMessage: unknown }).addChatMessage = vi.fn().mockResolvedValue(undefined);
    return d;
  }

  it('도구 호출 없이 정상 종료 + 최종 텍스트 → 그 텍스트(trim)를 대신 등록하고 경고를 남긴다', async () => {
    streamSpy.mockImplementation(streamWith([{ type: 'result', ok: true, text: '  답변입니다  ', usage: null }]));
    const d = depsWithAdd();
    await runChatAgent(env, d);
    expect(d.client.addChatMessage).toHaveBeenCalledWith(99, 5, '답변입니다');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('대신 답변 등록'), expect.anything());
    // 진행 표시는 done 으로 닫힌다.
    const phases = vi.mocked(d.client.postChatProgress).mock.calls.map((c) => (c[2] as { phase: string }).phase);
    expect(phases.at(-1)).toBe('done');
  });

  it('opencode: 도구 호출 전 중간 텍스트는 빼고 마지막 도구 호출 이후 텍스트만 올린다', async () => {
    streamSpy.mockImplementation(
      streamWith([
        { type: 'text_delta', text: '첨부를 확인해 ', parentToolUseId: null },
        { type: 'text_delta', text: '보겠습니다.', parentToolUseId: null },
        { type: 'tool_use', name: 'workplace_read_attachment_text', input: {}, parentToolUseId: null },
        { type: 'tool_done' },
        { type: 'text_delta', text: '요약: ', parentToolUseId: null },
        { type: 'text_delta', text: '핵심 내용', parentToolUseId: null },
        // opencode result.text 는 모든 델타를 이어 붙인 값
        { type: 'result', ok: true, text: '첨부를 확인해 보겠습니다.요약: 핵심 내용', usage: null },
      ]),
    );
    const d = depsWithAdd();
    await runChatAgent(env, d);
    expect(d.client.addChatMessage).toHaveBeenCalledWith(99, 5, '요약: 핵심 내용');
  });

  it('Claude: assistant_text 도 마지막 도구 호출 이후 구간만 쓴다', async () => {
    streamSpy.mockImplementation(
      streamWith([
        { type: 'assistant_text', text: '확인해 보겠습니다.' },
        { type: 'tool_use', name: 'mcp__workplace__read_attachment_text', input: {}, parentToolUseId: null },
        { type: 'tool_done' },
        { type: 'assistant_text', text: '최종 답변' },
        { type: 'result', ok: true, text: '최종 답변', usage: null },
      ]),
    );
    const d = depsWithAdd();
    await runChatAgent(env, d);
    expect(d.client.addChatMessage).toHaveBeenCalledWith(99, 5, '최종 답변');
  });

  it('마지막 도구 호출 이후 텍스트가 없으면 중간 텍스트로 대신하지 않는다', async () => {
    streamSpy.mockImplementation(
      streamWith([
        { type: 'text_delta', text: '확인해 보겠습니다.', parentToolUseId: null },
        { type: 'tool_use', name: 'workplace_read_attachment_text', input: {}, parentToolUseId: null },
        { type: 'tool_done' },
        { type: 'result', ok: true, text: '확인해 보겠습니다.', usage: null },
      ]),
    );
    const d = depsWithAdd();
    await runChatAgent(env, d);
    expect(d.client.addChatMessage).not.toHaveBeenCalled();
  });

  it.each(['mcp__workplace__add_chat_message', 'workplace_add_chat_message'])(
    '%s 를 호출했으면 대체 답변을 올리지 않는다',
    async (name) => {
      streamSpy.mockImplementation(
        streamWith([
          { type: 'tool_use', name, input: {}, parentToolUseId: null },
          { type: 'tool_done' },
          { type: 'result', ok: true, text: '등록했습니다', usage: null },
        ]),
      );
      const d = depsWithAdd();
      await runChatAgent(env, d);
      expect(d.client.addChatMessage).not.toHaveBeenCalled();
    },
  );

  it.each([null, '   '])('최종 텍스트가 비어 있으면(%j) 올리지 않는다', async (text) => {
    streamSpy.mockImplementation(streamWith([{ type: 'result', ok: true, text, usage: null }]));
    const d = depsWithAdd();
    await runChatAgent(env, d);
    expect(d.client.addChatMessage).not.toHaveBeenCalled();
  });

  // tool_use 이벤트가 누락돼도(opencode 가 완료 상태로만 보낸 경우) 스레드에 이미 답이 있으면 중복으로 올리지 않는다.
  it('트리거 이후 이 에이전트 메시지가 이미 있으면 올리지 않는다', async () => {
    streamSpy.mockImplementation(streamWith([{ type: 'result', ok: true, text: '답변', usage: null }]));
    const d = depsWithAdd();
    vi.mocked(d.client.getChatMessages).mockResolvedValue([
      { id: 9, authorId: 7, authorName: 'A', authorKind: 'HUMAN', body: '@AI', createdAt: 't', deleted: false },
      { id: 10, authorId: 99, authorName: 'AI', authorKind: 'AGENT', body: '답변', createdAt: 't', deleted: false },
    ]);
    await runChatAgent(env, d);
    expect(d.client.addChatMessage).not.toHaveBeenCalled();
  });

  it('트리거 이전의 에이전트 메시지·다른 사용자 메시지는 답변으로 보지 않는다', async () => {
    streamSpy.mockImplementation(streamWith([{ type: 'result', ok: true, text: '답변', usage: null }]));
    const d = depsWithAdd();
    vi.mocked(d.client.getChatMessages).mockResolvedValue([
      { id: 8, authorId: 99, authorName: 'AI', authorKind: 'AGENT', body: '예전 답변', createdAt: 't', deleted: false },
      { id: 11, authorId: 7, authorName: 'A', authorKind: 'HUMAN', body: '추가 질문', createdAt: 't', deleted: false },
    ]);
    await runChatAgent(env, d);
    expect(d.client.addChatMessage).toHaveBeenCalledWith(99, 5, '답변');
  });

  it('답변 여부 확인이 실패하면 대체 답변을 진행한다', async () => {
    streamSpy.mockImplementation(streamWith([{ type: 'result', ok: true, text: '답변', usage: null }]));
    const d = depsWithAdd();
    vi.mocked(d.client.getChatMessages)
      .mockResolvedValueOnce([]) // 프롬프트 준비용 조회
      .mockRejectedValueOnce(new Error('500')); // 답변 여부 확인
    await runChatAgent(env, d);
    expect(d.client.addChatMessage).toHaveBeenCalledWith(99, 5, '답변');
  });

  it('result ok:false 이면 올리지 않는다', async () => {
    streamSpy.mockImplementation(streamWith([{ type: 'result', ok: false, text: '중간 텍스트', usage: null }]));
    const d = depsWithAdd();
    await runChatAgent(env, d);
    expect(d.client.addChatMessage).not.toHaveBeenCalled();
  });

  it('러너가 실패(done reject)하면 올리지 않고 error 를 발행한다', async () => {
    streamSpy.mockImplementation(streamWith([{ type: 'result', ok: true, text: '답변', usage: null }], true));
    const d = depsWithAdd();
    await runChatAgent(env, d);
    expect(d.client.addChatMessage).not.toHaveBeenCalled();
    const phases = vi.mocked(d.client.postChatProgress).mock.calls.map((c) => (c[2] as { phase: string }).phase);
    expect(phases.at(-1)).toBe('error');
  });

  it('대체 답변 등록이 실패해도 던지지 않고 done 으로 닫는다', async () => {
    streamSpy.mockImplementation(streamWith([{ type: 'result', ok: true, text: '답변', usage: null }]));
    const d = depsWithAdd();
    vi.mocked(d.client.addChatMessage).mockRejectedValue(new Error('403'));
    await expect(runChatAgent(env, d)).resolves.toBeUndefined();
    const phases = vi.mocked(d.client.postChatProgress).mock.calls.map((c) => (c[2] as { phase: string }).phase);
    expect(phases.at(-1)).toBe('done');
  });
});
