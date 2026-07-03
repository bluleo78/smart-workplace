// 7: messaging.message.posted → respondAsAgentId 로 토큰·대화 준비 → 인-프로세스 MCP(messaging) + SDK 실행.
// 슬라이스 3: runSdkStream + buildInProcessWorkplaceMcpServer 로 전환(stdio MCP 서브프로세스 제거).
import { randomUUID } from 'node:crypto';

import { MESSAGING_SYSTEM_PROMPT } from './messaging-system-prompt.js';
import { buildMessagingUserMessage } from './messaging-user-message.js';
import { runnerFor } from './agent-runner.js';
import { fromRunnerEvent } from './chat-progress-parser.js';
import { ProgressTracker } from './progress-tracker.js';
import { DEFAULT_MODEL } from './model-defaults.js';
import type { RunAgentDeps } from './run-agent.js';
import type { MessagingEventEnvelope } from '../types/messaging-events.js';
import type { ProviderCredential } from './agent-runner.js';

const DEFAULT_MAX_TURNS = 30;
const DEFAULT_TIMEOUT_MS = 300_000;
const PREFETCH = 20;

export async function runMessagingAgent(
  envelope: MessagingEventEnvelope,
  deps: RunAgentDeps,
): Promise<void> {
  const p = envelope.payload;
  const agentId = p.respondAsAgentId;

  let credential: ProviderCredential;
  try {
    credential = await deps.client.getProviderCredential(agentId);
  } catch (e) {
    console.error('[run-messaging-agent] provider credential fetch 실패 — spawn 생략', {
      channelId: p.channelId,
      agentId,
      error: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  // 인-프로세스 MCP 서버(messaging 프로필)는 러너 내부에서 구성. 첨부 없음 → workDir/cwd 불필요(SDK 기본 tmpdir).
  // 위임(L3): 트리거 actor=위임자, channelId 항상; 스레드 안(parent 비-null)이면 thread 바인딩.
  const threadBinding =
    p.triggerParentMessageId != null
      ? { channelId: p.channelId, parentMessageId: p.triggerParentMessageId }
      : undefined;
  const mcp = {
    client: deps.client,
    onBehalfOfId: agentId,
    profile: 'messaging' as const,
    threadBinding,
    delegationContext: {
      actorId: p.actor.id,
      channelId: p.channelId,
      parentMessageId: p.triggerParentMessageId ?? undefined,
    },
  };

  // 최근 채널 메시지 PREFETCH 개 조회 → 대화 컨텍스트 구성
  const recent = await deps.client.getChannelMessages(agentId, p.channelId, PREFETCH);
  // L3 위임 후보 프로젝트 — AI 가 이슈 라우팅을 맥락으로 추측할 소스(실패해도 빈 배열로 진행).
  let candidates: { key: string; name: string }[] = [];
  try {
    candidates = await deps.client.listDelegationCandidates(agentId, p.actor.id);
  } catch (e) {
    console.error('[run-messaging-agent] 위임 후보 조회 실패', {
      channelId: p.channelId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  const userMessage = buildMessagingUserMessage(p, recent, candidates);

  // 모델 결정 이원화 해소: 이벤트 경로는 요청 body 가 없어 redeem 응답을 env/기본값보다 우선한다.
  const model = credential.model ?? process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
  const maxTurns = Number(process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS);
  const timeoutMs = Number(process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  // 스트리밍 진행 발행 — 단일 streamId 로 started→tool→done/error 를 API 에 POST.
  // progress POST 실패는 본 흐름을 막지 않는다(표시용). 에러는 로깅만.
  const streamId = randomUUID();
  const tracker = new ProgressTracker();
  const emit = (phase: 'started' | 'tool' | 'done' | 'error') => {
    const snap = tracker.snapshot(phase);
    deps.client
      .postMessagingProgress(agentId, p.channelId, { streamId, phase, steps: snap.steps })
      .catch((e: unknown) =>
        console.error('[run-messaging-agent] progress 발행 실패', { channelId: p.channelId, error: e }),
      );
  };
  emit('started');
  const logTag = `messaging-agent:channel${p.channelId}:${agentId}`;
  const handle = runnerFor(credential).stream(
    {
      userMessage,
      systemPrompt: MESSAGING_SYSTEM_PROMPT,
      model,
      maxTurns,
      credential,
      agentId,
      timeoutMs,
      logTag,
      allowFileRead: false, // messaging 은 첨부 없음
      includePartialMessages: false, // CLI 가 partial 미전달이었음 — 파서 입력 계약 동일 유지
      mcp,
    },
    (e) => {
      const sig = fromRunnerEvent(e);
      if (tracker.apply(sig)) emit('tool');
    },
  );
  try {
    await handle.done;
    emit('done');
  } catch (e) {
    console.error('[run-messaging-agent] 스트림 실패', { channelId: p.channelId, error: e });
    emit('error');
  }
}
