// 7b: 홈 컴포즈 러너 — 비서(assistant) agentId 토큰 fetch → 인-프로세스 MCP 서버 구성 → SDK query → 파서.
// #333: Task 7 — allowSubagents + Agent 위임 시 onProgress 라벨 발행.
// #381: 라우터 구조화 출력-라우팅 — 라우터의 자유 prose 는 사용자에게 절대 도달하지 않는다.
//   사용자가 보는 텍스트 = submit_response(서브에이전트) HostBridge OR 결정적 fallback.
// #462 슬라이스4: CLI + 파일 IPC(workDir / sidecar / ToolUseTailer) → 인-프로세스 SDK 전환.
//   runClaudeCliStream → runSdkStream, MCP stdio child → buildInProcessWorkplaceMcpServer,
//   사이드카 파일 읽기 → HostBridge 인메모리 콜백.
import { log } from '../logger.js';
import { ASSISTANT_SYSTEM_PROMPT, dateContextDirective, delegationLabel } from './assistant-system-prompt.js';
import type { ToolUseLine } from './sdk-mcp-server.js';
import { transcriptRequest, transcriptStreamLine, transcriptResult } from './ai-transcript-log.js';
import { runnerFor } from './agent-runner.js';
import type { RunnerEvent } from './runner-events.js';
import { parseChatEvents } from './chat-parser.js';
import { thinkingDirective } from './thinking.js';
import { DEFAULT_MODEL } from './model-defaults.js';
import type { RunAgentDeps } from './run-agent.js';
import type { ProviderCredential } from './agent-runner.js';
import type { HostBridge } from '../mcp/tools.js';
import { formatScreenContext, type ScreenContext } from './screen-context.js';
import { opencodeVisionFor } from './opencode-vision.js';
import { DEFAULT_ATTACHMENT_QUERY, formatHomeAttachmentsBlock, type HomeChatAttachment } from './home-attachments.js';

export interface ContextMessage {
  // 'USER' | 'ASSISTANT' | 'ACTION_DONE' | 'ACTION_FAILED' | 'ACTION_REJECTED'(#843 확인카드 처리 결과)
  role: string;
  content: string;
}

// #843: 확인카드 처리 결과 행(ACTION_*) 판별 — 사용자 발화도 AI 발화도 아닌 시스템 기록이라 따로 라벨링한다.
function isActionResult(m: ContextMessage): boolean {
  return m.role.startsWith('ACTION_');
}
export interface ChatInput {
  query: string;
  recentContext?: ContextMessage[];
  // WP-232: 토큰 예산을 넘친 앞부분 대화의 누적 요약(nullable). 원문 이력(recentContext) 앞에 싣는다.
  contextSummary?: string | null;
  // 비서 설정 — workplace-api 가 요청별로 해석해 전달(env 미사용).
  assistantAgentId: number;
  // #376: 요청 사용자 ID — MCP 도구(드라이브·캘린더 등)를 assistantAgentId 아닌 실제 요청자 컨텍스트로 실행.
  userId: number;
  // #719: 요청자의 active-tenant(nullable). workplace-api 대리 호출에 X-On-Behalf-Of-Tenant 로
  // 되돌려 보내, 다중/무 멤버십 요청자에서 AgentTenantResolver 가 fail-closed 되는 것을 막는다.
  tenantId?: number | null;
  model: string;
  thinkingDepth: 'NONE' | 'NORMAL' | 'DEEP';
  maxTurns: number;
  timeoutMs: number;
  // 요청 단위 추적 ID — 로그를 한 요청으로 묶는다(home.ts 가 생성·전달).
  requestId?: string;
  // WP-54: 사용자가 보고 있는 화면(대상·목록 상태). user 메시지 prefix 로 임베드(시스템 프롬프트 규칙과 짝).
  screenContext?: ScreenContext | null;
  // WP-234: 메인 AI 채팅 세션 — read_chat_attachment 를 이 세션 첨부에 묶는다(구 API 는 없음).
  sessionId?: string | null;
  // WP-234: 세션 전체 첨부(요약 경계 이전 포함, current=이번 메시지). 매 턴 "## 이 대화의 첨부" 블록으로 싣는다.
  attachments?: HomeChatAttachment[];
}

// #404: show_issue_detail 위젯에서 존재하지 않는 이슈 번호를 결정론적으로 차단한다.
// haiku가 이슈 존재 여부 확인 없이 show_issue_detail을 호출하는 비결정적 동작을
// 서버 검증으로 이중 방어한다. projectKey 가 없으면 검증 불가이므로 통과(pass-through).
async function filterIssueDetailWidgets(
  widgets: import('./chat-parser.js').Widget[],
  client: import('../clients/workplace-api.js').WorkplaceApiClient,
  agentId: number,
): Promise<import('./chat-parser.js').Widget[]> {
  const result: import('./chat-parser.js').Widget[] = [];
  for (const w of widgets) {
    if (w.type !== 'issue_detail') {
      result.push(w);
      continue;
    }
    const params = w.params as Record<string, unknown>;
    const num = params.number;
    const projectKey = params.projectKey;
    // projectKey 가 없으면 이슈키 구성 불가 — 통과(미검증).
    if (typeof projectKey !== 'string' || typeof num !== 'number') {
      result.push(w);
      continue;
    }
    const issueKey = `${projectKey}-${num}`;
    try {
      await client.toolClient(agentId).getIssueDetail(issueKey);
      result.push(w); // 존재하면 위젯 포함
    } catch {
      // 존재하지 않으면 위젯 드롭(not-found 시 에러 throw 하는 verifyEventExists 패턴 동일)
      console.log(`[run-ai-chat] #404 show_issue_detail 차단: ${issueKey} 없음`);
    }
  }
  return result;
}

// unassign_self 도구 결과(HostBridge.onUnassignResult 페이로드).
type UnassignResult = { ok: boolean; canonical?: string };

// 이전 대화 줄 라벨 — ACTION_* 는 사용자 발화로 오인되지 않게 [승인 결과] 로 표시(시스템 프롬프트 규칙 7 과 짝).
// WP-232: 요약 러너도 같은 라벨을 쓰도록 export.
export function contextLabel(m: ContextMessage): string {
  if (m.role === 'ASSISTANT') return 'AI';
  if (isActionResult(m)) return '[승인 결과]';
  return '사용자';
}

// recentContext·화면 컨텍스트·첨부를 단발 프롬프트에 임베드(CLI 는 멀티턴 배열을 받지 않음).
// 순서: 이전 대화 요약(WP-232) → 이전 대화 → 현재 화면 → 이 대화의 첨부(WP-234) → (미확인 승인 결과) → 현재 요청.
// 모두 없으면 query 원문. imageVision 은 실행당 1회 판단한 값(러너 config 와 같은 값)이다.
function buildChatUserMessage(input: ChatInput, imageVision: boolean): string {
  const ctx = input.recentContext ?? [];
  const summary = input.contextSummary ? `이전 대화 요약:\n${input.contextSummary}\n\n` : '';
  const screen = input.screenContext ? `${formatScreenContext(input.screenContext)}\n\n` : '';
  const attachments = formatHomeAttachmentsBlock(input.attachments ?? [], imageVision);
  // WP-234: 첨부만 보낸 메시지(빈 query)는 기본 문구로 — 스키마가 이번 메시지 첨부가 있을 때만 빈 query 를 허용한다.
  const query = input.query.trim() ? input.query : DEFAULT_ATTACHMENT_QUERY;
  if (ctx.length === 0 && !screen && !summary && !attachments) return query;
  const history = ctx.length ? `이전 대화:\n${ctx.map((m) => `${contextLabel(m)}: ${m.content}`).join('\n')}\n\n` : '';
  return `${summary}${history}${screen}${attachments}${unseenResultsBlock(ctx)}현재 요청: ${query}`;
}

// #849: AI 가 아직 언급하지 않은 승인 결과(마지막 AI 답 이후의 ACTION_* 행)를 현재 요청 바로 앞에 다시 둔다.
// 이력 중간의 [승인 결과] 줄만으로는 소형 모델이 이를 무시하고 도구로 재조회해, "잘 됐어?" 에
// 실패 사실 없이 조회 결과만 답했다(라이브 검증). 결과가 없으면 빈 문자열.
function unseenResultsBlock(ctx: ContextMessage[]): string {
  const lastAi = ctx.map((m) => m.role).lastIndexOf('ASSISTANT');
  const unseen = ctx.slice(lastAi + 1).filter(isActionResult);
  if (unseen.length === 0) return '';
  const items = unseen.map((m) => `- ${m.content}`).join('\n');
  return `방금 사용자가 처리한 확인 카드 결과(규칙 7):\n${items}\n\n`;
}

// #381: 라우터/서브에이전트가 자유 prose 대신 도구로 답을 제출하지 못한 극단 케이스의 결정적 fallback.
const ROUTER_FALLBACK_TEXT = '요청을 처리하지 못했어요. 다시 시도해 주세요.';

// SSE 라우트용 스트리밍 러너 — 라우터 자유 prose 를 onDelta 로 라이브 emit 하고,
// 서브에이전트 위임 답은 HostBridge.onSubmitResponse 콜백으로 수신한다.
// parseChatEvents 로 위젯을 산출해 반환한다.
// #333: assistant 프로파일 + allowSubagents + Agent 위임 라벨 발행.
// #462 슬라이스4: runSdkStream + buildInProcessWorkplaceMcpServer + HostBridge 인메모리 콜백.
//   workDir / 사이드카 파일 / ToolUseTailer 완전 제거.
// signal abort 시 SDK query 를 kill 해 자원 누수를 막는다.
export async function runAiChatStream(
  input: ChatInput,
  deps: RunAgentDeps,
  onText: (t: string) => void,
  signal: AbortSignal,
  onProgress?: (label: string) => void, // #333: Agent 위임 시작 시 호출('이슈 전문가에게 위임 중')
  onTool?: (line: ToolUseLine) => void, // 도구 호출 라이브 발행(인-프로세스 어댑터에서 직접 emit)
  onDelta?: (text: string) => void, // #463: 라우터 자유 prose 라이브 스트리밍(text_delta 단위)
): Promise<{ fullText: string; widgets: unknown; pendingActions: unknown[]; usage: import('./chat-parser.js').Usage | null }> {
  const agentId = input.assistantAgentId;
  let credential: ProviderCredential;
  const tokenStart = Date.now();
  try {
    credential = await deps.client.getProviderCredential(agentId);
    log.info('ai-chat', 'token_fetch_ok', {
      requestId: input.requestId,
      agentId,
      durationMs: Date.now() - tokenStart,
    });
  } catch (e) {
    log.error('ai-chat', 'token_fetch_fail', {
      requestId: input.requestId,
      agentId,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  // #462 슬라이스4: 인메모리 누산자 — 파일 사이드카 IPC 대체.
  // HostBridge 콜백이 SDK query 실행 중 이 변수에 비동기로 쓴다.
  // 타입 어노테이션 명시 필수: 클로저 전용 할당이면 TS 가 never 로 좁힘(#462 유의사항).
  const proposals: unknown[] = [];
  // #467: 한 턴에 ≥2 서브에이전트로 위임될 수 있다(예: 채널 공지 + 이슈 코멘트). 과거엔 첫 답만
  // 보존하는 first-write-guard 로 두 번째 이후 답이 조용히 누락됐다 — 배열로 전부 누적해 결합한다.
  const subagentTexts: string[] = [];
  // 클로저(onUnassignResult)에서만 할당돼 TS 가 never 로 좁히므로 as 캐스트로 타입을 고정한다.
  let unassign = null as UnassignResult | null;

  // HostBridge: MCP 도구(propose/submit_response/unassign_self)가 파일 대신 이 콜백으로 결과를 전달.
  const hostBridge: HostBridge = {
    onProposal: (action) => {
      proposals.push(action);
    },
    // #467: 위임 답은 호출 순서대로 전부 누적(더 이상 첫 답만 보존하지 않는다).
    onSubmitResponse: (text: string) => {
      subagentTexts.push(text);
    },
    onUnassignResult: (result: UnassignResult) => {
      unassign = result;
    },
  };

  // 우선순위: 요청 body(input.model) > redeem 응답(credential.model) > env/기본값.
  const model = input.model ?? credential.model ?? process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
  // WP-234: 비전 판단은 실행당 1회 — 첨부 블록 문구와 러너 config(RunnerInput.opencodeVision)가 같은 값을 쓴다(WP-244 패턴).
  // Claude 는 항상 이미지를 본다. opencode 는 지원이 확인된 경우만(알 수 없음은 못 보는 것으로 안내 — 재첨부 요청 방지).
  const opencodeVision = await opencodeVisionFor(credential, model);
  const imageVision = credential.provider === 'anthropic' || opencodeVision?.value === true;

  // 요청 시점 Seoul 기준 오늘 날짜를 계산해 상대 날짜 필터 앵커로 주입한다.
  const seoulToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const systemPrompt = ASSISTANT_SYSTEM_PROMPT + dateContextDirective(seoulToday) + thinkingDirective(input.thinkingDepth);
  const userMessage = buildChatUserMessage(input, imageVision);

  const events: RunnerEvent[] = [];
  // #463: 라우터 자유 prose 를 onDelta 로 라이브 emit 하면서 동시에 누적. 완료 후 답 결정에 사용.
  let streamedText = '';

  log.info('ai-chat', 'cli_spawn', {
    requestId: input.requestId,
    model,
    maxTurns: input.maxTurns,
    allowSubagents: true,
  });
  // #458: 전체 트랜스크립트 — 보낸 요청 본문(쿼리·맥락·예산·CLI로 넘긴 실제 userMessage·시스템프롬프트 길이) 기록.
  transcriptRequest(input.requestId, {
    query: input.query,
    recentContext: input.recentContext ?? [],
    userMessage,
    model,
    thinkingDepth: input.thinkingDepth,
    maxTurns: input.maxTurns,
    timeoutMs: input.timeoutMs,
    systemPromptChars: systemPrompt.length,
  });

  // 인-프로세스 MCP 서버(assistant 프로파일 + hostBridge + onTool)·서브에이전트 정의는 러너 내부에서 구성.
  // #376: MCP 도구(드라이브·캘린더·메일 등) 실행 주체(X-On-Behalf-Of)는 요청자(userId).
  //   stdio 서버(workplace-mcp-server.ts:36)와 동일 우선순위: userId ?? agentId.
  //   LLM 인증 자격(credential)은 여전히 getProviderCredential(agentId) — 비서 에이전트 자격 유지.
  // #719: tenantId 가 있으면 X-On-Behalf-Of-Tenant 를 실어 보내는 스코프 클라이언트로 교체.
  //   서브에이전트도 이 인-프로세스 MCP 서버(같은 클라이언트 인스턴스)를 공유하므로 위임 도구
  //   호출까지 한 번에 커버된다 — 요청자가 다중/무 멤버십일 때 AgentTenantResolver 가
  //   fail-closed 되어 이슈/캘린더/연락처 등 권한 도구가 전부 403 나는 문제를 막는다.
  const mcpClient = input.tenantId != null ? deps.client.withOnBehalfOfTenant(input.tenantId) : deps.client;
  const handle = runnerFor(credential).stream(
    {
      userMessage,
      systemPrompt,
      model,
      maxTurns: input.maxTurns,
      credential,
      agentId,
      userId: input.userId,
      timeoutMs: input.timeoutMs,
      logTag: `ai-chat:${agentId}`,
      requestId: input.requestId,
      includePartialMessages: true, // partial text_delta 수신(스트리밍)
      allowSubagents: true, // #333: Agent 도구 허용(라우터 위임에 필요) — 러너가 subagent 정의를 구성
      allowFileRead: false, // 홈 컴포즈는 파일 읽기 불필요 — 보안 최소권한
      opencodeVision, // WP-234: 첨부 블록 문구에 쓴 판단을 러너 config 에도 그대로
      mcp: {
        client: mcpClient,
        onBehalfOfId: input.userId ?? agentId,
        profile: 'assistant',
        hostBridge,
        onTool,
        homeSessionId: input.sessionId ?? undefined, // WP-234: read_chat_attachment 세션 바인딩
      },
    },
    (ev) => {
      // 모든 이벤트를 누적(parseChatEvents 가 위젯 파싱에 사용).
      events.push(ev);
      // #458: 수신 즉시 트랜스크립트에 기록 — 이벤트 간 ts 간격이 곧 단계별 지연(LLM/도구) 분해 근거.
      transcriptStreamLine(input.requestId, JSON.stringify(ev));
      // #463: 라우터 자기 text_delta 를 라이브 emit(parentToolUseId null 필터 — 서브에이전트 누수 방지).
      //   누적한 streamedText 를 완료 후 답 결정 우선순위 2위로 사용한다.
      if (ev.type === 'text_delta' && ev.parentToolUseId == null && ev.text) {
        streamedText += ev.text;
        onDelta?.(ev.text);
      }
      // #333: assistant tool_use 중 Agent 위임을 검사·라벨링한다.
      // #462 슬라이스4: 화이트리스트(checkSubagentWhitelist) 제거 — Options.agents 로 정의된 에이전트만
      // SDK 가 호출하므로 미정의 에이전트 이름을 kill+throw 로 차단할 필요 없음.
      if (ev.type === 'tool_use' && ev.name === 'Agent') {
        const rawSub = (ev.input as { subagent_type?: unknown })?.subagent_type;
        const subType = typeof rawSub === 'string' ? rawSub : '';
        const label = delegationLabel(subType);
        if (label && onProgress) onProgress(label);
      }
    },
  );

  // 상위 연결 종료 시 SDK query 중단(자원 누수 방지). 이미 abort 된 신호면 즉시 kill.
  if (signal.aborted) handle.kill();
  else signal.addEventListener('abort', () => handle.kill(), { once: true });

  await handle.done;

  // #351: HostBridge.onProposal 콜백이 누산한 제안 배열(proposals).
  const pendingActions: unknown[] = proposals;
  // #378: unassign_self 실패 시 HostBridge.onUnassignResult 가 {ok:false,canonical} 를 전달.
  // LLM 응답을 버리고 canonical 고정 문구로 override 한다.
  if (unassign && !unassign.ok && unassign.canonical) {
    log.warn('ai-chat', 'fallback', {
      requestId: input.requestId,
      reason: 'unassign_error',
    });
    return { fullText: unassign.canonical, widgets: null, pendingActions: [], usage: null };
  }
  // #463: parseChatEvents 로 위젯(tool_use 이벤트)만 산출. 텍스트는 아래 우선순위로 결정한다.
  const parsed = parseChatEvents(events);
  // #404: show_issue_detail 위젯 중 존재하지 않는 이슈 번호를 서버 검증으로 드롭한다.
  const filteredWidgets = await filterIssueDetailWidgets(parsed.widgets, deps.client, agentId);
  const widgets = filteredWidgets.length > 0 ? filteredWidgets : null;
  // #463/#467: 답 텍스트 결정(우선순위)
  //   1) subagentTexts — HostBridge.onSubmitResponse 로 수신한 서브에이전트 텍스트(들). 한 턴에
  //      ≥2 위임이 있으면 순서대로 결합한다(첫 답만 남기던 first-write-guard 버그 수정, #467).
  //   2) streamedText — onDelta 로 이미 라이브 emit 된 라우터 prose(별도 onText 불필요)
  //   3) pendingActions 있으면 제안 안내(서브에이전트가 propose 만 하고 submit_response 누락 시)
  //   4) 위젯만 있으면 빈 텍스트(show_* 단독 호출 — fallback 문구 오노출 방지)
  //   5) 결정적 fallback
  let answerText: string;
  if (subagentTexts.length > 0) {
    // 위임 답(들)은 onText 로 1회 emit(onDelta 미경유 — 최종 완성 텍스트). 여러 건이면 순서대로 결합.
    answerText = subagentTexts.join('\n\n');
    onText(answerText);
  } else if (streamedText.trim()) {
    // 라우터 prose 는 이미 onDelta 로 라이브 emit 됨 — onText 재호출 불필요.
    answerText = streamedText;
  } else if (pendingActions.length > 0) {
    // #381 후속: propose 도구 호출됐으나 submit_response 누락. 확인 카드와 모순되지 않는 결정적 안내.
    answerText = '요청하신 작업을 준비했어요. 확인 카드에서 확인해주세요.';
    onText(answerText);
  } else if (widgets) {
    answerText = ''; // 위젯만 표시 — 빈 버블 emit 안 함
  } else {
    answerText = ROUTER_FALLBACK_TEXT;
    onText(answerText);
    log.warn('ai-chat', 'fallback', { requestId: input.requestId, reason: 'no_output' });
  }
  // #432: 라우터 result 이벤트의 토큰 사용량을 done 이벤트로 전달(LLM 인증 비용 가시화).
  log.info('ai-chat', 'cli_done', {
    requestId: input.requestId,
    subagentSidecar: subagentTexts.length > 0,
    streamedChars: streamedText.length,
    widgetCount: widgets ? widgets.length : 0,
  });
  // #458: 트랜스크립트 종료 레코드 — 최종 답·위젯·사용량·답 출처. 라인별 ts 와 합쳐 전체 분석.
  transcriptResult(input.requestId, {
    answerText,
    widgetCount: widgets ? widgets.length : 0,
    pendingActionCount: pendingActions.length,
    usage: parsed.usage,
    source: subagentTexts.length > 0 ? 'subagent' : streamedText.trim() ? 'router_prose' : widgets ? 'widget' : 'fallback',
  });
  return { fullText: answerText, widgets, pendingActions, usage: parsed.usage };
}
