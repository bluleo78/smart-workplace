// 7: messaging.message.posted → respondAsAgentId 로 토큰·대화 준비 → 인-프로세스 MCP(messaging) + SDK 실행.
// 슬라이스 3: runSdkStream + buildInProcessWorkplaceMcpServer 로 전환(stdio MCP 서브프로세스 제거).
import { randomUUID } from 'node:crypto';

import { MESSAGING_SYSTEM_PROMPT } from './messaging-system-prompt.js';
import { fetchAgentInstructions, withAgentInstructions } from './agent-instructions.js';
import { buildMessagingUserMessage } from './messaging-user-message.js';
import { runnerFor } from './agent-runner.js';
import { fromRunnerEvent } from './chat-progress-parser.js';
import { ProgressTracker } from './progress-tracker.js';
import { DEFAULT_MODEL } from './model-defaults.js';
import { fallbackReplyText, MessagingReplyTracker } from './messaging-reply.js';
import { RunTraceRecorder } from './run-trace.js';
import { buildTools } from '../mcp/tools.js';
import { log } from '../logger.js';
import type { RunAgentDeps } from './run-agent.js';
import type { ChannelMessageItem } from '../clients/workplace-api.js';
import type { MessagingEventEnvelope } from '../types/messaging-events.js';
import type { ProviderCredential } from './agent-runner.js';

const DEFAULT_MAX_TURNS = 30;
const DEFAULT_TIMEOUT_MS = 300_000;
const PREFETCH = 20;
// WP-1489: 러너가 끝났는데 답장 도구 호출의 결과가 아직 오지 않았을 때 기다리는 상한(ms). 시간 초과·중단 직후나 opencode 의 completed part 가
// 세션 종료 뒤 도착하는 경우를 받아 내려는 것이다. 그래도 모르면 대신 답하지 않는다(진짜 답과 안내가 겹치지 않게).
export const REPLY_IN_FLIGHT_WAIT_MS = 5_000;

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

  const logTag = `messaging-agent:channel${p.channelId}:${agentId}`;
  // WP-1368: 이 AI 의 지시 — 실행마다 한 번 읽어 시스템 프롬프트 맨 뒤에 붙인다. 아래 채널 메시지·위임 후보 조회와 서로 기대지 않으므로
  // 여기서 요청만 띄워 두고 그 조회들과 함께 기다린다('started' 앞에 왕복을 하나 더 두지 않는다). 실패해도 throw 하지 않고 null(지시 없이 진행).
  const instructionsPromise = fetchAgentInstructions(deps.client, agentId, logTag);

  // 인-프로세스 MCP 서버(messaging 프로필)는 러너 내부에서 구성. 첨부 없음 → workDir/cwd 불필요(SDK 기본 tmpdir).
  // 위임(L3): 트리거 actor=위임자, channelId 항상; 스레드 안(parent 비-null)이면 thread 바인딩.
  const threadBinding =
    p.triggerParentMessageId != null
      ? { channelId: p.channelId, parentMessageId: p.triggerParentMessageId }
      : undefined;
  // WP-1489: 이 실행에서 답장 도구(add_channel_message·propose_create_issue·propose_create_event)가 이 채널에 하나라도 성공했는지와 진행 중인
  // 답장 호출 수, 마지막 텍스트 조각을 따라간다. 두 러너 모두 도구 시작·결과를 onTool 로 알린다(Claude: 인-프로세스 어댑터, opencode: 세션
  // 이벤트의 도구 part 상태 running→completed/error) — 러너 이벤트의 tool_done 은 이름·오류 여부가 없어 판정에 쓸 수 없다.
  const reply = new MessagingReplyTracker(p.channelId);
  const onTool = reply.onTool.bind(reply);
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
    onTool,
  };

  // 최근 채널 메시지 PREFETCH 개 조회 → 대화 컨텍스트 구성
  // 경로 매핑은 공유 도구 클라이언트(#846) — 응답 항목은 서버 ChannelMessage 경량 형태다.
  const recent = (await deps.client.toolClient(agentId).listChannelMessages(p.channelId, { limit: PREFETCH })).items as ChannelMessageItem[];
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
  // 채널 메시지·위임 후보 조회 동안 함께 진행된 지시 조회를 받는다(대개 이미 끝나 있다).
  const instructions = await instructionsPromise;

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
      .postMessagingProgress(agentId, p.channelId, { streamId, phase, steps: snap.steps })
      .catch((e: unknown) =>
        console.error('[run-messaging-agent] progress 발행 실패', { channelId: p.channelId, error: e }),
      );
  };
  void emit('started');
  // WP-1489: 실행 기록(도구 호출 수·이름, 걸린 시간). 기록기는 숫자·이름만 담는다. 이벤트는 쌓아 두지 않고 받는 대로 반영한다.
  const trace = new RunTraceRecorder();
  trace.start(Date.now());
  const handle = runnerFor(credential).stream(
    {
      userMessage,
      systemPrompt: withAgentInstructions(MESSAGING_SYSTEM_PROMPT, instructions),
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
      reply.onEvent(e);
      trace.on(e, Date.now());
      const sig = fromRunnerEvent(e);
      if (tracker.apply(sig)) void emit('tool');
    },
  );
  let threw = false;
  try {
    await handle.done;
  } catch (e) {
    threw = true;
    console.error('[run-messaging-agent] 스트림 실패', { channelId: p.channelId, error: e });
  }
  // WP-1489: 정상 종료 = 러너가 던지지 않았고 result 가 ok 로 왔을 때뿐. result 가 없거나(시간 초과·중단) ok:false(최대 턴·제공자 오류)면 오류로 본다.
  const outcome: 'ok' | 'error' = !threw && reply.resultOk ? 'ok' : 'error';
  // 답장 도구 호출이 아직 끝나지 않았으면(결과 줄이 늦게 옴) 잠깐 기다린다 — 그 호출이 성공했는지 모른 채 대신 답하면 진짜 답과 겹친다.
  if (!reply.replied && reply.inFlight > 0) await reply.waitForInFlight(REPLY_IN_FLIGHT_WAIT_MS);

  // WP-1489: 답장 도구가 하나도 성공하지 못했으면 그 AI 이름으로 같은 채널(스레드 실행이면 그 스레드)에 대신 답한다 — 모델이 텍스트만 쓰고
  // 끝내면 그 텍스트가 버려져 사용자에게는 사라지는 입력 중 표시만 남았다. 답장이 이미 남았으면 아무것도 더 올리지 않는다(중복 금지).
  // 기다려도 결과를 모르는 답장 호출이 남았으면 대신 답하지 않고 기록만 남긴다(그 호출이 실제로 글을 올렸을 수 있다).
  const replied = reply.replied;
  const fallbackSkipped: 'reply_in_flight' | null = !replied && reply.inFlight > 0 ? 'reply_in_flight' : null;
  const fallbackUsed = !replied && fallbackSkipped == null;
  let fallbackFailed = false;
  if (fallbackUsed) {
    try {
      await postFallbackReply(deps, agentId, p.channelId, threadBinding, fallbackReplyText(outcome, reply.finalText()));
    } catch (e) {
      // 대신 답하기 실패는 로그만 — 실행 흐름(완료 알림)은 이어 간다. 다시 보내지 않는다.
      fallbackFailed = true;
      console.error('[run-messaging-agent] 대신 답하기 실패', {
        channelId: p.channelId,
        agentId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // WP-1489: 실행마다 기록 한 줄 — 반복 회차 기록(recurring_run_trace)과 같은 모양. 메시지 본문·도구 인자·결과는 싣지 않는다(숫자·이름만).
  const snap = trace.snapshot(Date.now());
  const fields = {
    channelId: p.channelId,
    threadParentMessageId: p.triggerParentMessageId ?? null,
    agentId,
    provider: credential.provider,
    model,
    outcome,
    modelCalls: snap.modelCalls,
    toolCalls: snap.toolCalls,
    tools: snap.tools,
    replied,
    fallbackUsed,
    fallbackSkipped,
    fallbackFailed,
    durationMs: snap.elapsedMs,
  };
  if (outcome === 'ok' && replied) log.info('run-messaging-agent', 'messaging_run_trace', fields);
  else log.warn('run-messaging-agent', 'messaging_run_trace', fields);

  // 마지막 알림은 기다린다 — 종료 대기(WP-167)가 실행 promise 만 보고도 완료 알림까지 보장되게. 대신 답한 글이 먼저 올라간 뒤 입력 중 표시를 걷는다.
  await emit(threw ? 'error' : 'done');
}

/**
 * WP-1489: 대신 답하기 — add_channel_message 도구가 API 를 부르는 경로를 그대로 쓴다. 같은 AI 신원(toolClient(agentId)), 같은 스레드 바인딩
 * (트리거 채널이면 그 스레드 parent 로), 같은 @멘션 변환을 거치게 messaging 프로필의 도구 핸들러를 직접 부른다(새 API 없음).
 */
async function postFallbackReply(
  deps: RunAgentDeps,
  agentId: number,
  channelId: number,
  threadBinding: { channelId: number; parentMessageId: number } | undefined,
  body: string,
): Promise<void> {
  const tool = buildTools(deps.client, agentId, 'messaging', threadBinding).find((t) => t.name === 'add_channel_message');
  if (!tool) throw new Error('add_channel_message 도구를 찾지 못했습니다');
  await tool.handler({ channelId, body });
}
