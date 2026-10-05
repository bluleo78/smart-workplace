// 6c: chat.message.posted → AGENT 결정 → 토큰·thread·첨부 준비 → 인-프로세스 MCP(chat) + SDK 실행.
// 슬라이스 3: runSdkStream + buildInProcessWorkplaceMcpServer 로 전환(stdio MCP 서브프로세스 제거).
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { CHAT_SYSTEM_PROMPT } from './chat-system-prompt.js';
import { buildChatUserMessage } from './chat-user-message.js';
import { createAttachmentWorkDir } from './attachment-prep.js';
import { fetchIssueAttachments, mergeAttachments, type CollectedAttachments } from './attachment-source.js';
import { presentAttachments, readsLocally } from './attachment-presenter.js';
import { runnerFor } from './agent-runner.js';
import { fromRunnerEvent } from './chat-progress-parser.js';
import { ProgressTracker } from './progress-tracker.js';
import { pickMentionedAgentId } from './chat-agent-resolver.js';
import { DEFAULT_MODEL } from './model-defaults.js';
import type { RunAgentDeps } from './run-agent.js';
import type { AgentAttachment } from './attachment-source.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';
import type { ChatMessageItem } from '../clients/workplace-api.js';
import type { ProviderCredential } from './agent-runner.js';

const DEFAULT_MAX_TURNS = 30;
const DEFAULT_TIMEOUT_MS = 300_000;
const THREAD_PREFETCH = 20;

// WP-244: 트리거 메시지 첨부는 추출이 비동기라 에이전트가 돌 때 거의 항상 PENDING 이다. 짧게 기다리며 상태를 다시 본다.
// 최대 12초(1.5초 간격 8회) — 그 이상은 응답 지연이 더 큰 손해라 PENDING 그대로 진행한다.
export const TRIGGER_POLL_INTERVAL_MS = 1_500;
export const TRIGGER_POLL_TIMEOUT_MS = 12_000;

/**
 * 도구 이름이 add_chat_message 인지 — 러너마다 접두사가 달라(Claude `mcp__workplace__`, opencode `workplace_`) 끝부분으로 본다.
 */
function isAddChatMessage(name: string): boolean {
  return name === 'add_chat_message' || name.endsWith('_add_chat_message');
}

// 대체 답변 전 확인용으로 다시 받는 최근 메시지 수 — 트리거 이후 에이전트 답변만 찾으면 되므로 작게.
const REPLY_CHECK_LIMIT = 10;

/**
 * 트리거 메시지 이후 이 에이전트가 쓴 메시지가 이미 있는지. opencode 는 도구 이벤트가 완료 상태로만 와 tool_use 가
 * 누락될 수 있어, 이벤트만 보고 대체 답변을 올리면 중복 답변이 된다 — 실제 스레드로 한 번 더 확인한다.
 * 확인 자체가 실패하면 false(답변 누락이 중복보다 더 큰 손해라 대체 답변을 진행).
 */
async function agentAlreadyReplied(
  deps: RunChatAgentDeps,
  agentId: number,
  threadId: number,
  triggerMessageId: number,
): Promise<boolean> {
  try {
    const recent = await deps.client.getChatMessages(agentId, threadId, REPLY_CHECK_LIMIT);
    return recent.some((m) => m.id > triggerMessageId && m.authorId === agentId && !m.deleted);
  } catch (e) {
    console.warn('[run-chat-agent] 답변 여부 확인 실패 — 대체 답변 진행', {
      threadId,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/** runChatAgent 의존성 — sleep 은 테스트에서 실제로 기다리지 않게 주입할 수 있다. */
export type RunChatAgentDeps = RunAgentDeps & { sleep?: (ms: number) => Promise<void> };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 트리거 메시지(방금 올라온 메시지)의 첨부 중 아직 추출 중이고, 이 러너가 로컬로 읽지 못하는 것이 있는지.
 * Claude 가 Read 로 직접 보는 이미지·PDF·텍스트는 추출을 기다릴 이유가 없다(opencode 는 모두 대기 대상).
 */
function triggerPending(
  runner: ProviderCredential['provider'],
  c: CollectedAttachments,
  messageId: number,
): boolean {
  return c.attachments.some(
    (a) =>
      a.origin.kind === 'chat' &&
      a.origin.messageId === messageId &&
      a.extraction.status === 'PENDING' &&
      !readsLocally(runner, a.mimeType),
  );
}

/**
 * 트리거 메시지 첨부가 PENDING 이면 최근 메시지만 다시 받아 챗 첨부 상태를 갱신한다(최대 TRIGGER_POLL_TIMEOUT_MS).
 * 이슈 첨부 목록은 한 번 받은 것을 그대로 쓴다(재호출 없음). 시간 대신 횟수로 묶는다 — 주입된 sleep 이 즉시 끝나도
 * 무한 루프가 되지 않게. 재조회 실패는 마지막 결과로 진행(답변을 막지 않음).
 * 갱신된 recent 도 돌려줘 프롬프트의 메시지 목록과 첨부 상태가 같은 시점을 가리키게 한다.
 */
async function awaitTriggerExtraction(
  deps: RunChatAgentDeps,
  ctx: {
    agentId: number;
    threadId: number;
    messageId: number;
    runner: ProviderCredential['provider'];
    issue: { attachments: AgentAttachment[]; failed: boolean };
    recent: ChatMessageItem[];
  },
): Promise<{ recent: ChatMessageItem[]; collected: CollectedAttachments }> {
  const { agentId, threadId, messageId, runner, issue } = ctx;
  let recent = ctx.recent;
  let collected = mergeAttachments(issue, threadId, recent);
  const sleep = deps.sleep ?? defaultSleep;
  const maxPolls = Math.ceil(TRIGGER_POLL_TIMEOUT_MS / TRIGGER_POLL_INTERVAL_MS);
  for (let i = 0; i < maxPolls && triggerPending(runner, collected, messageId); i++) {
    await sleep(TRIGGER_POLL_INTERVAL_MS);
    try {
      recent = await deps.client.getChatMessages(agentId, threadId, THREAD_PREFETCH);
    } catch (e) {
      console.warn('[run-chat-agent] 첨부 추출 대기 중 메시지 재조회 실패 — 현재 상태로 진행', {
        threadId,
        error: e instanceof Error ? e.message : String(e),
      });
      break;
    }
    collected = mergeAttachments(issue, threadId, recent);
  }
  return { recent, collected };
}

export async function runChatAgent(
  envelope: ChatEventEnvelope,
  deps: RunChatAgentDeps,
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
    // 첨부 수집·추출 대기(최대 ~12초) 전에 'started' 를 내보내 채팅이 곧바로 진행 중으로 보이게 한다.
    // 이후 러너 실행 전 단계에서 예외가 나면 아래 catch 가 'error' 를 발행해 started 만 남고 끝나는 일을 막는다.
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
    try {
      // 이슈 첨부 목록은 메시지 조회와 병렬로 1회만 받는다(대기 루프에서는 메시지만 다시 받음).
      const [firstRecent, issue] = await Promise.all([
        deps.client.getChatMessages(agentId, p.threadId, THREAD_PREFETCH),
        fetchIssueAttachments(deps.client, agentId, p.threadId),
      ]);
      // WP-244: 공통 첨부 목록(이슈+챗) → 러너별 표현. Claude 만 이미지·PDF 원본을 workDir 에 받는다.
      // 트리거 메시지 첨부가 추출 중이면 잠시 기다려 상태를 갱신한다.
      const { recent, collected } = await awaitTriggerExtraction(deps, {
        agentId,
        threadId: p.threadId,
        messageId: p.messageId,
        runner: credential.provider,
        issue,
        recent: firstRecent,
      });
      const presented = await presentAttachments(credential.provider, collected, {
        client: deps.client,
        agentId,
        workDir,
      });
      const userMessage = buildChatUserMessage(p, recent, presented);

      // 모델 결정 이원화 해소: 이벤트 경로는 요청 body 가 없어 redeem 응답을 env/기본값보다 우선한다.
      const model = credential.model ?? process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
      const maxTurns = Number(process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS);
      const timeoutMs = Number(process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

      const logTag = `chat-agent:${p.issueKey}:thread${p.threadId}:${agentId}`;
      // WP-244: 모델(특히 opencode)이 답을 다 써 놓고 add_chat_message 없이 평문으로 끝내면 사용자는 아무것도 못 받는다.
      // 도구 호출 여부와 마지막 result 를 기억해 두었다가, 정상 종료인데 답변 등록이 없으면 그 평문을 대신 올린다.
      let replied = false;
      let finalResult: { ok: boolean; text: string | null } | undefined;
      // 마지막 도구 호출 이후의 텍스트 구간. opencode 의 result.text 는 실행 중 모든 텍스트를 구분자 없이 이어 붙여
      // "확인해 보겠습니다.요약: …" 처럼 중간 문장이 섞이므로, 텍스트 이벤트를 받아 tool_use 마다 비우고 마지막 구간만 쓴다.
      // (opencode 는 text_delta, partial 이 꺼진 Claude 는 assistant_text 로 텍스트가 온다.)
      let sawText = false;
      let lastSegment = '';
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
          // WP-244: chat 도구를 이 실행의 스레드에 묶는다(다른 스레드 읽기·쓰기 거부).
          mcp: { client: deps.client, onBehalfOfId: agentId, profile: 'chat', chatThreadId: p.threadId },
        },
        (e) => {
          if (e.type === 'tool_use') {
            if (isAddChatMessage(e.name)) replied = true;
            lastSegment = '';
          } else if (e.type === 'text_delta') {
            sawText = true;
            lastSegment += e.text;
          } else if (e.type === 'assistant_text') {
            sawText = true;
            lastSegment += (lastSegment ? '\n\n' : '') + e.text;
          }
          if (e.type === 'result') finalResult = { ok: e.ok, text: e.text };
          const sig = fromRunnerEvent(e);
          if (tracker.apply(sig)) void emit('tool');
        },
      );
      let runOk = false;
      try {
        await handle.done;
        runOk = true;
      } catch (e) {
        console.error('[run-chat-agent] SDK 스트림 실패', { threadId: p.threadId, error: e });
        await emit('error');
      }
      if (runOk) {
        // 텍스트 이벤트를 받았으면 마지막 구간만(비어 있으면 올리지 않음), 텍스트 이벤트가 전혀 없었으면 result.text 로 대신한다.
        const fallbackText = finalResult?.ok
          ? (sawText ? lastSegment : (finalResult.text ?? '')).trim()
          : undefined;
        if (!replied && fallbackText && !(await agentAlreadyReplied(deps, agentId, p.threadId, p.messageId))) {
          // 실패해도 진행 표시는 done 으로 닫는다 — 러너 자체는 성공했으므로 스트림 실패로 기록하지 않는다.
          console.warn('[run-chat-agent] add_chat_message 없이 끝남 — 최종 텍스트로 대신 답변 등록', {
            threadId: p.threadId,
            agentId,
          });
          try {
            await deps.client.addChatMessage(agentId, p.threadId, fallbackText);
          } catch (e) {
            console.error('[run-chat-agent] 대체 답변 등록 실패', { threadId: p.threadId, error: e });
          }
        }
        await emit('done'); // 마지막 알림은 기다린다 — 종료 대기(WP-167)가 실행 promise 만 보고도 완료 알림까지 보장되게
      }
    } catch (e) {
      // 러너 실행 전(첨부 수집·프롬프트 구성) 실패 — 'started' 만 남지 않게 error 를 알리고, 기존처럼 호출자에 전파한다.
      await emit('error');
      throw e;
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
