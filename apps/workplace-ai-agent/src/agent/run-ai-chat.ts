// 7b: 홈 컴포즈 러너 — 비서(assistant) agentId 토큰 fetch → 인-프로세스 MCP 서버 구성 → SDK query → 파서.
// #333: Task 7 — allowSubagents + Agent 위임 시 onProgress 라벨 발행.
// #381: 라우터 구조화 출력-라우팅 — 라우터의 자유 prose 는 사용자에게 절대 도달하지 않는다.
//   사용자가 보는 텍스트 = submit_response(서브에이전트) HostBridge OR 결정적 fallback.
// #462 슬라이스4: CLI + 파일 IPC(workDir / sidecar / ToolUseTailer) → 인-프로세스 SDK 전환.
//   runClaudeCliStream → runSdkStream, MCP stdio child → buildInProcessWorkplaceMcpServer,
//   사이드카 파일 읽기 → HostBridge 인메모리 콜백.
import { log } from '../logger.js';
import { ASSISTANT_SYSTEM_PROMPT, delegationLabel } from './assistant-system-prompt.js';
import type { ToolUseLine } from './sdk-mcp-server.js';
import { buildInProcessWorkplaceMcpServer } from './sdk-mcp-server.js';
import { transcriptRequest, transcriptStreamLine, transcriptResult } from './ai-transcript-log.js';
import { loadSubagents, toAgentDefinitions } from './subagent-loader.js';
import { runSdkStream } from './sdk-runner.js';
import { parseChatLines, extractRouterTextDelta } from './chat-parser.js';
import { thinkingDirective } from './thinking.js';
import type { RunAgentDeps } from './run-agent.js';
import type { HostBridge } from '../mcp/tools.js';

export interface ContextMessage {
  role: string; // 'USER' | 'ASSISTANT'
  content: string;
}
export interface ChatInput {
  query: string;
  recentContext?: ContextMessage[];
  // 비서 설정 — workplace-api 가 요청별로 해석해 전달(env 미사용).
  assistantAgentId: number;
  // #376: 요청 사용자 ID — MCP 도구(드라이브·캘린더 등)를 assistantAgentId 아닌 실제 요청자 컨텍스트로 실행.
  userId: number;
  model: string;
  thinkingDepth: 'NONE' | 'NORMAL' | 'DEEP';
  maxTurns: number;
  timeoutMs: number;
  // 요청 단위 추적 ID — 로그를 한 요청으로 묶는다(home.ts 가 생성·전달).
  requestId?: string;
}

// #405: 생성일 필터 쿼리 감지 — "이번 주 생성된 이슈" 처럼 생성일 범위로 이슈를 조회하는 요청.
// show_issue_list 는 dueFrom/dueTo(마감일)만 지원하고 생성일 필터는 없으므로,
// haiku 가 dueFrom 으로 오해석하는 비결정적 동작을 런타임에서 차단한다.
// "이슈 생성해줘" 처럼 이슈를 새로 만드는 요청은 제외(오탐 방지).
function isCreatedDateFilterQuery(query: string): boolean {
  // 이슈 생성(create) 요청은 제외
  if (/이슈.*(만들|생성|추가|등록)해|새.*이슈|이슈.*새로/i.test(query)) return false;
  // 생성 관련 키워드 + 기간/시간 범위 키워드가 함께 있을 때만 감지
  const hasCreated = /생성|만들어진|만들어졌|created/i.test(query);
  const hasTimeRange = /이번\s*주|지난\s*주|오늘|어제|이번\s*달|지난\s*달|최근|last\s*week|this\s*week|\d+일\s*(이내|전|내)|이후|전/i.test(query);
  return hasCreated && hasTimeRange;
}

// #406/#415: 쿼리에 담당 해제 의도가 있는지 감지하는 공통 헬퍼.
// isUnassignCompoundQuery / isSimpleUnassignQuery 양쪽에서 재사용해 정규식 중복을 방지한다.
function hasUnassignIntent(query: string): boolean {
  return /담당.*(해제|빼줘|제외|빼)|나.*담당.*빼|unassign|담당자.*나|나.*빼줘/i.test(query);
}

// #406: 이슈 담당 해제 의도가 포함된 복합 쿼리 감지.
// "담당자에서 나 해제해줘", "나 빼줘", "unassign" 등의 표현을 포함하며
// 동시에 다른 작업(상태변경·코멘트 등)도 요청하는 복합 요청을 식별한다.
// 단순 해제 전용 쿼리(다른 요청 없음)는 issue-agent 가 잘 처리하므로 제외.
function isUnassignCompoundQuery(query: string): boolean {
  if (!hasUnassignIntent(query)) return false;
  // 다른 작업이 함께 있는지 확인(상태변경·코멘트)
  const hasOtherTask = /바꾸|변경|코멘트|댓글|남겨|IN_PROGRESS|진행중|완료|DONE/i.test(query);
  return hasOtherTask;
}

// #415: 단순 담당 해제 쿼리 감지 — 다른 작업(상태변경·코멘트)이 없는 순수 해제 요청.
// isUnassignCompoundQuery 가 복합 요청만 처리하므로, 단순 해제 쿼리에서
// issue-agent 가 unassign_self 없이 허위 성공을 환각하는 경우를 별도로 방어한다.
function isSimpleUnassignQuery(query: string): boolean {
  if (!hasUnassignIntent(query)) return false;
  const hasOtherTask = /바꾸|변경|코멘트|댓글|남겨|IN_PROGRESS|진행중|완료|DONE/i.test(query);
  return !hasOtherTask;
}

// #406: 쿼리 텍스트에서 이슈 키(예: "EX-2", "SW-123") 추출.
// 패턴: 대문자 영문자(2~10자) + 하이픈 + 숫자(1~6자리).
function extractIssueKeyFromQuery(query: string): string | null {
  const m = query.match(/\b([A-Z]{2,10})-(\d{1,6})\b/);
  return m ? m[0] : null;
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
      await client.getIssueDetail(agentId, issueKey);
      result.push(w); // 존재하면 위젯 포함
    } catch {
      // 존재하지 않으면 위젯 드롭(not-found 시 에러 throw 하는 verifyEventExists 패턴 동일)
      console.log(`[run-ai-chat] #404 show_issue_detail 차단: ${issueKey} 없음`);
    }
  }
  return result;
}

// #400 #409: 비가역 작업 제안 후 승인 발화 시 haiku 가 propose 없이 완료 환각 응답을 내보내는
// 비결정적 동작을 차단한다. 이전 AI 발화에 캘린더·연락처·드라이브 등 임의 도메인의 제안 문구가 있고
// 현재 쿼리가 짧은 승인 발화일 때만 감지. 길이 제한(30자)으로 "일정 잡아줘" 같은 새 요청 오탐 방지.
function isProposalApprovalHallucination(query: string, recentContext: ContextMessage[]): boolean {
  const q = query.trim();
  // 너무 길면 새 요청이므로 제외
  if (q.length > 30) return false;
  // 승인 발화 키워드가 포함되는지 확인
  if (!/네|예|응|좋아|승인|확인|진행|부탁|ㅇㅇ|ㅇㅋ|ok|okay|yes|그래|알겠|좋습니다/i.test(q)) return false;
  // 이전 AI 발화 중 제안 패턴 확인 — 캘린더(제안했습니다/확인 카드) + 일반 비가역 작업(하겠습니다+확인해주세요)
  const prevAi = recentContext.filter((m) => m.role === 'ASSISTANT').map((m) => m.content).join('\n');
  return /제안했습니다|확인 카드|일정.*생성.*제안|propose|(삭제|추가|생성|수정|변경)하겠습니다.*확인해주세요|확인.*부탁드립니다/i.test(prevAi);
}

// recentContext 를 단발 --print 프롬프트에 임베드(CLI 는 멀티턴 배열을 받지 않음).
function buildChatUserMessage(input: ChatInput): string {
  const ctx = input.recentContext ?? [];
  if (ctx.length === 0) return input.query;
  const lines = ctx.map((m) => `${m.role === 'ASSISTANT' ? 'AI' : '사용자'}: ${m.content}`);
  return `이전 대화:\n${lines.join('\n')}\n\n현재 요청: ${input.query}`;
}

// #381: 라우터/서브에이전트가 자유 prose 대신 도구로 답을 제출하지 못한 극단 케이스의 결정적 fallback.
const ROUTER_FALLBACK_TEXT = '요청을 처리하지 못했어요. 다시 시도해 주세요.';

// SSE 라우트용 스트리밍 러너 — 라우터 자유 prose 를 onDelta 로 라이브 emit 하고,
// 서브에이전트 위임 답은 HostBridge.onSubmitResponse 콜백으로 수신한다.
// parseChatLines 로 위젯을 산출해 반환한다.
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
  // #405: 생성일 필터 쿼리 — LLM 호출 전 결정론적으로 차단. dueFrom 오해석 방지.
  if (isCreatedDateFilterQuery(input.query)) {
    log.warn('ai-chat', 'fallback', {
      requestId: input.requestId,
      reason: 'created_date_filter_blocked',
    });
    return {
      fullText: '생성 날짜 필터는 지원하지 않습니다. 마감일(dueFrom/dueTo), 담당자, 상태, 우선순위 필터를 사용해 보세요.',
      widgets: null,
      pendingActions: [],
      usage: null, // #432: LLM 미호출 — 사용량 없음
    };
  }
  const agentId = input.assistantAgentId;
  let token: string;
  const tokenStart = Date.now();
  try {
    token = (await deps.client.getOAuthToken(agentId)).token;
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
  let subagentText: string | null = null;
  // unassign 타입 명시: 클로저 내 할당(onUnassignResult)만으로는 TS 가 never 로 좁히므로 명시 필수.
  // unassign 은 onUnassignResult 콜백 + 복합재처리 두 곳에서 재할당되므로 let 이 정확하다.
  // as 캐스트는 TS 제어 흐름 좁힘(never 추론) 우회에 필수 — 삭제 시 line 323 타입 에러.
  let unassign: { ok: boolean; canonical?: string } | null = null as { ok: boolean; canonical?: string } | null;

  // HostBridge: MCP 도구(propose/submit_response/unassign_self)가 파일 대신 이 콜백으로 결과를 전달.
  const hostBridge: HostBridge = {
    onProposal: (action) => {
      proposals.push(action);
    },
    // first-write-guard: 위임 답은 최초 1회만 기록. 재진입(다중 submit_response) 시 첫 답을 보존.
    onSubmitResponse: (text: string) => {
      if (subagentText === null) subagentText = text;
    },
    onUnassignResult: (result: { ok: boolean; canonical?: string }) => {
      unassign = result;
    },
  };

  // 인-프로세스 MCP 서버 생성(assistant 프로파일 + hostBridge + onTool 라이브 발행).
  // #376: MCP 도구(드라이브·캘린더·메일 등) 실행 주체(X-On-Behalf-Of)는 요청자(userId).
  //   stdio 서버(workplace-mcp-server.ts:36)와 동일 우선순위: userId ?? agentId.
  //   OAuth 토큰(LLM 인증)은 여전히 getOAuthToken(agentId) — 비서 에이전트 자격 유지.
  const mcpServer = buildInProcessWorkplaceMcpServer({
    client: deps.client,
    onBehalfOfId: input.userId ?? agentId,
    profile: 'assistant',
    hostBridge,
    onTool,
  });

  // 서브에이전트 정의 — 파일(.claude/agents/*.md) 대신 Options.agents 로 코드 전달.
  const subagentDefs = loadSubagents();
  const agents = toAgentDefinitions(subagentDefs);

  const systemPrompt = ASSISTANT_SYSTEM_PROMPT + thinkingDirective(input.thinkingDepth);
  const userMessage = buildChatUserMessage(input);

  const lines: string[] = [];
  // #463: 라우터 자유 prose 를 onDelta 로 라이브 emit 하면서 동시에 누적. CLI 완료 후 답 결정에 사용.
  let streamedText = '';
  // #381: Agent 위임 발생 여부 추적 — #406/#415 의 unassign 재처리 가드에서 사용한다.
  let delegated = false;

  log.info('ai-chat', 'cli_spawn', {
    requestId: input.requestId,
    model: input.model,
    maxTurns: input.maxTurns,
    allowSubagents: true,
  });
  // #458: 전체 트랜스크립트 — 보낸 요청 본문(쿼리·맥락·예산·CLI로 넘긴 실제 userMessage·시스템프롬프트 길이) 기록.
  transcriptRequest(input.requestId, {
    query: input.query,
    recentContext: input.recentContext ?? [],
    userMessage,
    model: input.model,
    thinkingDepth: input.thinkingDepth,
    maxTurns: input.maxTurns,
    timeoutMs: input.timeoutMs,
    systemPromptChars: systemPrompt.length,
  });

  const handle = runSdkStream(
    {
      userMessage,
      systemPrompt,
      model: input.model,
      maxTurns: input.maxTurns,
      token,
      agentId,
      userId: input.userId,
      timeoutMs: input.timeoutMs,
      logTag: `ai-chat:${agentId}`,
      requestId: input.requestId,
      includePartialMessages: true, // partial text_delta 수신(스트리밍)
      allowSubagents: true, // #333: Agent 도구 허용(라우터 위임에 필요)
      allowFileRead: false, // 홈 컴포즈는 파일 읽기 불필요 — 보안 최소권한
      mcpServers: { workplace: mcpServer },
      agents,
    },
    (line) => {
      // 모든 라인을 누적(parseChatLines 가 위젯 파싱에 사용).
      lines.push(line);
      // #458: 수신 즉시 트랜스크립트에 기록 — 라인 간 ts 간격이 곧 단계별 지연(LLM/도구) 분해 근거.
      transcriptStreamLine(input.requestId, line);
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        return; // 비JSON 라인 무시
      }
      // #463: 라우터 자기 text_delta 를 라이브 emit(parent_tool_use_id null 필터 — 서브에이전트 누수 방지).
      //   누적한 streamedText 를 SDK 완료 후 답 결정 우선순위 2위로 사용한다.
      const delta = extractRouterTextDelta(obj);
      if (delta) {
        streamedText += delta;
        onDelta?.(delta);
      }
      // #333: assistant tool_use 중 Agent 위임을 검사·라벨링한다.
      // #462 슬라이스4: 화이트리스트(checkSubagentWhitelist) 제거 — Options.agents 로 정의된 에이전트만
      // SDK 가 호출하므로 미정의 에이전트 이름을 kill+throw 로 차단할 필요 없음.
      const o = obj as {
        type?: string;
        message?: { content?: Array<{ type?: string; name?: string; input?: Record<string, unknown> }> };
      };
      if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
        for (const b of o.message!.content!) {
          if (b.type !== 'tool_use' || b.name !== 'Agent') continue;
          const subType = typeof b.input?.subagent_type === 'string' ? b.input.subagent_type : '';
          const label = delegationLabel(subType);
          if (label) {
            // 위임 발생 → 플래그 설정. onProgress 있으면 라벨 발행.
            delegated = true;
            if (onProgress) onProgress(label);
          }
        }
      }
    },
  );

  // 상위 연결 종료 시 SDK query 중단(자원 누수 방지). 이미 abort 된 신호면 즉시 kill.
  if (signal.aborted) handle.kill();
  else signal.addEventListener('abort', () => handle.kill(), { once: true });

  await handle.done;

  // #406: 복합 요청에서 unassign_self 미처리 시 userId 로 직접 API 재처리.
  // 배경: MCP unassign_self 는 agentId 로 호출되므로 실제 사용자(userId) 해제 불가.
  // unassign?.ok 가 아닌 경우 = HostBridge 콜백이 성공을 받지 못함(미호출 포함).
  if (isUnassignCompoundQuery(input.query) && delegated && !unassign?.ok) {
    const issueKey = extractIssueKeyFromQuery(input.query);
    if (issueKey) {
      try {
        await deps.client.unassignSelf(input.userId, issueKey);
        // userId 직접 재처리 성공 — unassign 상태를 성공으로 갱신해 아래 에러 override 차단.
        unassign = { ok: true };
      } catch {
        // userId 재처리도 실패 — 기존 unassign 상태 유지(canonical override 허용).
      }
    }
  }
  // #415: 단순 담당 해제 쿼리 + 위임 시도 + unassign_self 미처리 → 허위 성공 응답 차단.
  // delegated=true 이나 성공/에러 콜백 모두 없으면 issue-agent 가 도구 없이 성공을
  // 환각한 케이스. 에러 콜백이 있으면 아래 canonical override 가 처리하므로 통과.
  // 성공 콜백이 있으면 실제 해제됐으므로 통과.
  if (isSimpleUnassignQuery(input.query) && delegated && unassign === null) {
    log.warn('ai-chat', 'fallback', {
      requestId: input.requestId,
      reason: 'unassign_not_executed',
    });
    return {
      fullText: '담당 해제 요청을 처리하지 못했습니다. 이슈 화면에서 직접 변경해주세요.',
      widgets: null,
      pendingActions: [],
      usage: null, // #432: override 응답 — 사용량 보고 생략
    };
  }
  // #400 #409: 비가역 작업 제안 후 사용자 "승인" 발화 시 haiku가 propose 없이 완료 환각 응답.
  // proposals 가 비어있는데 승인 발화이고 직전 AI 발화에 제안 문구가 있으면 LLM 응답을 버리고
  // 고정 안내로 override 한다. proposals 가 있으면 정상 제안이므로 통과.
  if (proposals.length === 0 && isProposalApprovalHallucination(input.query, input.recentContext ?? [])) {
    log.warn('ai-chat', 'fallback', {
      requestId: input.requestId,
      reason: 'hallucination_guard',
    });
    return { fullText: '확인 카드에서 승인해주세요. 에이전트가 직접 작업을 수행하지 않습니다.', widgets: null, pendingActions: [], usage: null };
  }
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
  // #463: parseChatLines 로 위젯(tool_use 이벤트)만 산출. 텍스트는 아래 우선순위로 결정한다.
  const parsed = parseChatLines(lines);
  // #404: show_issue_detail 위젯 중 존재하지 않는 이슈 번호를 서버 검증으로 드롭한다.
  const filteredWidgets = await filterIssueDetailWidgets(parsed.widgets, deps.client, agentId);
  const widgets = filteredWidgets.length > 0 ? filteredWidgets : null;
  // #463: 답 텍스트 결정(우선순위)
  //   1) subagentText — HostBridge.onSubmitResponse 로 수신한 서브에이전트 텍스트
  //   2) streamedText — onDelta 로 이미 라이브 emit 된 라우터 prose(별도 onText 불필요)
  //   3) pendingActions 있으면 제안 안내(서브에이전트가 propose 만 하고 submit_response 누락 시)
  //   4) 위젯만 있으면 빈 텍스트(show_* 단독 호출 — fallback 문구 오노출 방지)
  //   5) 결정적 fallback
  let answerText: string;
  if (subagentText) {
    // 위임 답은 onText 로 1회 emit(onDelta 미경유 — 최종 완성 텍스트).
    answerText = subagentText;
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
    subagentSidecar: !!subagentText,
    streamedChars: streamedText.length,
    widgetCount: widgets ? widgets.length : 0,
  });
  // #458: 트랜스크립트 종료 레코드 — 최종 답·위젯·사용량·답 출처. 라인별 ts 와 합쳐 전체 분석.
  transcriptResult(input.requestId, {
    answerText,
    widgetCount: widgets ? widgets.length : 0,
    pendingActionCount: pendingActions.length,
    usage: parsed.usage,
    source: subagentText ? 'subagent' : streamedText.trim() ? 'router_prose' : widgets ? 'widget' : 'fallback',
  });
  return { fullText: answerText, widgets, pendingActions, usage: parsed.usage };
}
