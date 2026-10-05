// 6c: chat.message.posted → AGENT 결정 → 토큰·thread·첨부 준비 → 인-프로세스 MCP(chat) + SDK 실행.
// 슬라이스 3: runSdkStream + buildInProcessWorkplaceMcpServer 로 전환(stdio MCP 서브프로세스 제거).
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { CHAT_SYSTEM_PROMPT } from './chat-system-prompt.js';
import { buildChatUserMessage } from './chat-user-message.js';
import { createAttachmentWorkDir } from './attachment-prep.js';
import { collectAttachments } from './attachment-source.js';
import { presentAttachments } from './attachment-presenter.js';
import { runnerFor } from './agent-runner.js';
import { fromRunnerEvent } from './chat-progress-parser.js';
import { ProgressTracker } from './progress-tracker.js';
import { pickMentionedAgentId } from './chat-agent-resolver.js';
import { DEFAULT_MODEL } from './model-defaults.js';
import type { RunAgentDeps } from './run-agent.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';
import type { ProviderCredential } from './agent-runner.js';

const DEFAULT_MAX_TURNS = 30;
const DEFAULT_TIMEOUT_MS = 300_000;
const THREAD_PREFETCH = 20;

export async function runChatAgent(
  envelope: ChatEventEnvelope,
  deps: RunAgentDeps,
): Promise<void> {
  const p = envelope.payload;
  const agentId = pickMentionedAgentId(p);
  if (agentId == null) {
    console.warn('[run-chat-agent] mentions 에 AGENT 없음 — spawn 생략', { threadId: p.threadId });
    return;
  }

  let credential: ProviderCredential;
  try {
    credential = await deps.client.getProviderCredential(agentId);
  } catch (e) {
    console.error('[run-chat-agent] provider credential fetch 실패 — spawn 생략', {
      threadId: p.threadId,
      agentId,
      error: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  // per-run 임시폴더 — 첨부 다운로드 + Read cwd(opencode 허용 범위는 opencode-config 참고).
  const workDir = createAttachmentWorkDir(agentId, p.threadId);

  try {
    const recent = await deps.client.getChatMessages(agentId, p.threadId, THREAD_PREFETCH);
    // WP-244: 공통 첨부 목록(이슈+챗) → 러너별 표현. Claude 만 이미지·PDF 원본을 workDir 에 받는다.
    const attachments = await collectAttachments(deps.client, agentId, p.issueKey, p.threadId, recent);
    const presented = await presentAttachments(credential.provider, attachments, {
      client: deps.client,
      agentId,
      workDir,
    });
    const userMessage = buildChatUserMessage(p, recent, presented);

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
      return deps.client
        .postChatProgress(agentId, p.threadId, { streamId, phase, steps: snap.steps })
        .catch((e: unknown) =>
          console.error('[run-chat-agent] progress 발행 실패', { threadId: p.threadId, error: e }),
        );
    };

    void emit('started');
    const logTag = `chat-agent:${p.issueKey}:thread${p.threadId}:${agentId}`;
    // 인-프로세스 MCP 서버(chat 프로필)는 러너 내부에서 구성 — onBehalfOf = 멘션된 agentId(ACTING_USER_ID 없음).
    const handle = runnerFor(credential).stream(
      {
        userMessage,
        systemPrompt: CHAT_SYSTEM_PROMPT,
        model,
        maxTurns,
        credential,
        agentId,
        timeoutMs,
        logTag,
        cwd: workDir, // 첨부 Read 스코프 — 누락 시 tmpdir 로 새 스코프(첨부 읽기 조용히 실패)
        allowFileRead: true,
        includePartialMessages: false, // CLI 가 partial 미전달이었음 — 파서 입력 계약 동일 유지
        mcp: { client: deps.client, onBehalfOfId: agentId, profile: 'chat' },
      },
      (e) => {
        const sig = fromRunnerEvent(e);
        if (tracker.apply(sig)) void emit('tool');
      },
    );
    try {
      await handle.done;
      await emit('done'); // 마지막 알림은 기다린다 — 종료 대기(WP-167)가 실행 promise 만 보고도 완료 알림까지 보장되게
    } catch (e) {
      console.error('[run-chat-agent] SDK 스트림 실패', { threadId: p.threadId, error: e });
      await emit('error');
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
