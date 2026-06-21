// 7b: 홈 컴포즈 러너 — 비서(assistant) agentId 토큰 fetch → assistant MCP config → CLI(assistant 프로필) 스폰 → 파서.
// #333: Task 7 — per-request workdir + writeSubagentDefinitions + system-prompt-file + allowSubagents
// + 화이트리스트 강제(위반 시 kill+throw) + Agent 위임 시 onProgress 라벨 발행.
// #381: 라우터 구조화 출력-라우팅 — 라우터의 자유 prose 는 사용자에게 절대 도달하지 않는다.
//   사용자가 보는 텍스트 = respond_chat(라우터) / submit_response(서브에이전트) 사이드카 OR 결정적 fallback.
//   기존 도메인별 정규식·버퍼·preamble sanitize 밴드에이드는 이 불변식으로 대체되어 전부 제거됐다.
// 데이터 조회는 show_* 도구가 하지 않으므로 토큰은 순수 Claude LLM 인증용(데이터 권한과 무관).
// 모델/생각의 깊이/maxTurns/timeoutMs 는 workplace-api 가 비서 설정을 해석해 요청 본문으로 전달한다(#50).
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ASSISTANT_SYSTEM_PROMPT, delegationLabel } from './assistant-system-prompt.js';
import { loadSubagents, writeSubagentDefinitions } from './subagent-loader.js';
import { checkSubagentWhitelist } from './tool-policy.js';
import { writeTempMcpConfig, cleanupTempMcpConfig } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCliStream } from './cli-runner.js';
import { parseComposeLines } from './compose-parser.js';
import { thinkingDirective } from './thinking.js';
import type { RunAgentDeps } from './run-agent.js';

export interface ContextMessage {
  role: string; // 'USER' | 'ASSISTANT'
  content: string;
}
export interface ComposeInput {
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
  widgets: import('./compose-parser.js').Widget[],
  client: import('../clients/workplace-api.js').WorkplaceApiClient,
  agentId: number,
): Promise<import('./compose-parser.js').Widget[]> {
  const result: import('./compose-parser.js').Widget[] = [];
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
      console.log(`[run-ai-compose] #404 show_issue_detail 차단: ${issueKey} 없음`);
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
function buildComposeUserMessage(input: ComposeInput): string {
  const ctx = input.recentContext ?? [];
  if (ctx.length === 0) return input.query;
  const lines = ctx.map((m) => `${m.role === 'ASSISTANT' ? 'AI' : '사용자'}: ${m.content}`);
  return `이전 대화:\n${lines.join('\n')}\n\n현재 요청: ${input.query}`;
}

// #381: 라우터/서브에이전트가 자유 prose 대신 도구로 답을 제출하지 못한 극단 케이스의 결정적 fallback.
const ROUTER_FALLBACK_TEXT = '요청을 처리하지 못했어요. 다시 시도해 주세요.';

// #381: 사이드카에서 {text} 를 안전하게 읽어 반환한다. 파일 없음/파싱 실패/빈 문자열은 null.
function readResponseSidecar(p: string): string | null {
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8')) as { text?: unknown };
    return typeof data.text === 'string' && data.text.length > 0 ? data.text : null;
  } catch {
    return null;
  }
}

// SSE 라우트용 스트리밍 러너 — 완료 후 구조화된 답(respond_chat/submit_response 사이드카)을 onText 로 1회 emit하고,
// parseComposeLines 로 위젯을 산출해 반환한다.
// #333: assistant 프로파일 + per-request workdir + allowSubagents + 화이트리스트 강제.
// #381: 라우터 text_delta 는 사용자에게 emit 하지 않는다(자유 prose 차단). 답 텍스트는 사이드카에서만 온다.
// signal abort 시 하위 CLI child 를 kill 해 자원 누수를 막는다(wiki 러너와 동일 패턴).
export async function runAiComposeStream(
  input: ComposeInput,
  deps: RunAgentDeps,
  onText: (t: string) => void,
  signal: AbortSignal,
  onProgress?: (label: string) => void, // #333: Agent 위임 시작 시 호출('이슈 전문가에게 위임 중')
): Promise<{ fullText: string; widgets: unknown; pendingAction: unknown | null; usage: import('./compose-parser.js').Usage | null }> {
  // #405: 생성일 필터 쿼리 — LLM 호출 전 결정론적으로 차단. dueFrom 오해석 방지.
  if (isCreatedDateFilterQuery(input.query)) {
    return {
      fullText: '생성 날짜 필터는 지원하지 않습니다. 마감일(dueFrom/dueTo), 담당자, 상태, 우선순위 필터를 사용해 보세요.',
      widgets: null,
      pendingAction: null,
      usage: null, // #432: LLM 미호출 — 사용량 없음
    };
  }
  const agentId = input.assistantAgentId;
  const token = (await deps.client.getOAuthToken(agentId)).token;
  // #333: workDir·mcpConfigPath 를 try 블록 안에서 생성해 writeTempMcpConfig 실패 시
  // finally 누수가 없도록 한다(Finding 2). let 으로 선언해 finally 에서 조건부 정리.
  let workDir: string | null = null;
  let mcpConfigPath: string | null = null;

  try {
    // #333: 요청마다 임시 작업 디렉토리 생성. .claude/agents/*.md 자동발견 경로.
    // finally 에서 rmSync 로 한 번에 정리해 temp 누수 방지.
    workDir = mkdtempSync(path.join(tmpdir(), `assistant-${agentId}-`));
    const pendingActionPath = path.join(workDir, 'pending-action.json');
    // #378: unassign_self 실패 시 MCP 핸들러가 오류를 기록할 사이드카.
    // 실행 후 이 파일이 존재하면 최종 응답을 결정론적으로 override 한다.
    const unassignErrorPath = path.join(workDir, 'unassign-error.json');
    // #406: unassign_self 성공 시 MCP 핸들러가 기록할 사이드카.
    // CLI 종료 후 이 파일이 없으면(= 도구 미호출) 직접 API 재처리를 시도한다.
    const unassignSuccessPath = path.join(workDir, 'unassign-success.json');
    // #381: 라우터(respond_chat) / 서브에이전트(submit_response) 답 사이드카 경로.
    const routerResponsePath = path.join(workDir, 'router-response.json');
    const subagentResponsePath = path.join(workDir, 'subagent-response.json');
    mcpConfigPath = writeTempMcpConfig({
      agentId,
      baseURL: process.env.WORKPLACE_API_BASE_URL ?? '',
      internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
      profile: 'assistant', // home 프로파일 → assistant 프로파일로 교체(#333)
      pendingActionPath, // #333 M2: propose 핸들러가 제안을 쓸 사이드카(절대경로)
      unassignErrorPath, // #378: unassign_self 실패 사이드카(절대경로)
      unassignSuccessPath, // #406: unassign_self 성공 사이드카(절대경로)
      userId: input.userId, // #376: MCP child env 에도 ACTING_USER_ID 전달
      routerResponsePath, // #381: respond_chat 사이드카(절대경로)
      subagentResponsePath, // #381: submit_response 사이드카(절대경로)
    });
    // #333: 서브에이전트 정의를 workDir 안 .claude/agents/ 에 기록 + 허용 이름 집합 산출.
    const subagents = loadSubagents();
    writeSubagentDefinitions(workDir, subagents);
    const allowedNames = Object.keys(subagents);

    // 시스템 프롬프트는 파일로 전달(ARG_MAX 회피). workDir 안에 써서 finally 시 함께 정리.
    const systemPrompt = ASSISTANT_SYSTEM_PROMPT + thinkingDirective(input.thinkingDepth);
    const systemPromptPath = path.join(workDir, 'system-prompt.txt');
    writeFileSync(systemPromptPath, systemPrompt, 'utf8');

    const args = buildCliArgs({
      userMessage: buildComposeUserMessage(input),
      systemPrompt, // systemPromptPath 가 있으면 buildCliArgs 가 --system-prompt-file 을 우선 사용.
      systemPromptPath,
      model: input.model,
      maxTurns: input.maxTurns,
      mcpConfigPath,
      allowSubagents: true, // #333: Agent 도구 허용(라우터 위임에 필요)
      includePartialMessages: true, // partial text_delta 수신(스트리밍)
    });
    // #376: userId 를 함께 전달 — MCP 서버가 ACTING_USER_ID 를 X-On-Behalf-Of 로 우선 사용해
    // 드라이브·캘린더 등 사용자 귀속 리소스를 assistantAgentId 아닌 실제 요청자 기준으로 조회.
    const env = buildChildEnv(process.env, token, agentId, input.userId);
    const lines: string[] = [];
    // #333: 화이트리스트 위반 감지 플래그 + 즉시-kill 홀더(Finding 1).
    // killer 홀더를 먼저 선언해 onLine 콜백 안에서 TDZ 없이 참조 가능하도록 한다.
    let policyDeny: string | null = null;
    // #381: Agent 위임 발생 여부 추적 — #406/#415 의 unassign 재처리 가드에서 사용한다.
    let delegated = false;
    let killer: (() => void) | null = null;
    const handle = runClaudeCliStream(
      { args, env, timeoutMs: input.timeoutMs, logTag: `ai-compose:${agentId}`, cwd: workDir! },
      (line) => {
        // 모든 라인을 누적(parseComposeLines 가 위젯 파싱에 사용).
        lines.push(line);
        let obj: unknown;
        try {
          obj = JSON.parse(line);
        } catch {
          return; // 비JSON 라인 무시
        }
        // #381: 라우터 text_delta 는 사용자에게 emit 하지 않는다(자유 prose 차단 불변식).
        //   답 텍스트는 done 후 respond_chat/submit_response 사이드카에서만 결정된다.
        // #333: assistant tool_use 중 Agent 위임을 검사·라벨링한다.
        const o = obj as {
          type?: string;
          message?: { content?: Array<{ type?: string; name?: string; input?: Record<string, unknown> }> };
        };
        if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
          for (const b of o.message!.content!) {
            if (b.type !== 'tool_use' || b.name !== 'Agent') continue;
            const deny = checkSubagentWhitelist('Agent', b.input, allowedNames);
            if (deny) {
              // 화이트리스트 위반 — 즉시 kill(프로덕션 비동기 경로). 동기 테스트 모킹에서는 null.
              policyDeny = deny;
              killer?.(); // Finding 1: handle 할당 후면 즉시 kill, 동기 경로면 무해한 no-op
              return;
            }
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
    // killer 홀더를 채워 이후 onLine 콜백이 즉시 kill 할 수 있도록 한다.
    killer = handle.kill;
    // 상위 연결 종료 시 child 종료(자원 누수 방지). 이미 abort 된 신호면 즉시 kill.
    if (signal.aborted) handle.kill();
    else signal.addEventListener('abort', () => handle.kill(), { once: true });
    await handle.done;
    // #333: 위반 감지 시 fallback kill(프로덕션=이미 killed, 동기 모킹=여기서 kill) + throw.
    if (policyDeny) {
      handle.kill();
      throw new Error(policyDeny);
    }
    // #406: 복합 요청에서 unassign_self 미처리 시 userId 로 직접 API 재처리.
    // 배경: MCP unassign_self 는 agentId 로 호출되므로 실제 사용자(userId) 해제 불가.
    // 성공 사이드카 없음 = 아직 처리 안 됨. 에러 사이드카 있어도 userId 재시도 가능.
    // userId 재처리 성공 시 에러 사이드카 삭제.
    if (isUnassignCompoundQuery(input.query) && delegated && !existsSync(unassignSuccessPath)) {
      const issueKey = extractIssueKeyFromQuery(input.query);
      if (issueKey) {
        try {
          await deps.client.unassignSelf(input.userId, issueKey);
          // userId 직접 재처리 성공 — 에러 사이드카가 있으면 삭제.
          rmSync(unassignErrorPath, { force: true });
        } catch {
          // userId 재처리도 실패 — 기존 에러 사이드카 유지(canonical override 허용).
        }
      }
    }
    // #415: 단순 담당 해제 쿼리 + 위임 시도 + unassign_self 미처리 → 허위 성공 응답 차단.
    // delegated=true 이나 성공/에러 사이드카 모두 없으면 issue-agent 가 도구 없이 성공을
    // 환각한 케이스. 에러 사이드카가 있으면 아래 unassignErrorPath override 가 canonical
    // 메시지를 반환하므로 통과. 성공 사이드카가 있으면 실제 해제됐으므로 통과.
    if (
      isSimpleUnassignQuery(input.query) &&
      delegated &&
      !existsSync(unassignSuccessPath) &&
      !existsSync(unassignErrorPath)
    ) {
      return {
        fullText: '담당 해제 요청을 처리하지 못했습니다. 이슈 화면에서 직접 변경해주세요.',
        widgets: null,
        pendingAction: null,
        usage: null, // #432: override 응답 — 사용량 보고 생략
      };
    }
    // #400 #409: 비가역 작업 제안 후 사용자 "승인" 발화 시 haiku가 propose 없이 완료 환각 응답.
    // pending_action 이 없는데 승인 발화이고 직전 AI 발화에 제안 문구가 있으면 LLM 응답을 버리고
    // 고정 안내로 override 한다. pending_action 이 있으면 정상 제안이므로 통과.
    if (
      !existsSync(pendingActionPath) &&
      isProposalApprovalHallucination(input.query, input.recentContext ?? [])
    ) {
      return { fullText: '확인 카드에서 승인해주세요. 에이전트가 직접 작업을 수행하지 않습니다.', widgets: null, pendingAction: null, usage: null };
    }
    // #333 M2: propose 도구가 사이드카에 제안을 썼으면 읽어 pendingAction 으로 싣는다(스트림 파싱 불가 — collapsed Agent tool_result).
    let pendingAction: unknown | null = null;
    if (existsSync(pendingActionPath)) {
      try {
        pendingAction = JSON.parse(readFileSync(pendingActionPath, 'utf8'));
      } catch {
        pendingAction = null; // 파싱 실패는 무시(확인 카드 없이 진행)
      }
    }
    // #378: unassign_self 실패 사이드카가 존재하면 LLM 응답을 버리고 고정 문구로 override.
    // haiku 가 도구 에러를 자의적으로 재해석하는 비결정적 동작을 결정론적으로 차단한다.
    if (existsSync(unassignErrorPath)) {
      try {
        const errData = JSON.parse(readFileSync(unassignErrorPath, 'utf8')) as { canonical: string };
        if (errData.canonical) {
          return { fullText: errData.canonical, widgets: null, pendingAction: null, usage: null };
        }
      } catch {
        // 사이드카 파싱 실패 — LLM 응답을 그대로 사용
      }
    }
    // parseComposeLines 로 위젯(tool_use 이벤트)만 산출한다. 텍스트(result 이벤트)는 라우터 prose 이므로 쓰지 않는다(#381).
    const parsed = parseComposeLines(lines);
    // #404: show_issue_detail 위젯 중 존재하지 않는 이슈 번호를 서버 검증으로 드롭한다.
    const filteredWidgets = await filterIssueDetailWidgets(parsed.widgets, deps.client, agentId);
    const widgets = filteredWidgets.length > 0 ? filteredWidgets : null;
    // #381: 답 텍스트 결정(우선순위) — 라우터 자유 prose 는 절대 사용하지 않는다.
    //   1) submit_response 사이드카(위임 답) → 2) respond_chat 사이드카(pure_chat)
    //   → 3) pending_action 있으면 제안 안내(서브에이전트가 propose 만 하고 submit_response 누락 시)
    //   → 4) 위젯만 있으면 빈 텍스트(plan §3 — show_* 단독 호출 시 fallback 문구 오노출 방지)
    //   → 5) 결정적 fallback
    const subagentText = readResponseSidecar(subagentResponsePath);
    const routerText = readResponseSidecar(routerResponsePath);
    let answerText: string;
    if (subagentText) {
      answerText = subagentText;
    } else if (routerText) {
      answerText = routerText;
    } else if (pendingAction) {
      // #381 후속: propose 도구는 호출돼 확인 카드(pending_action)는 발행됐으나 서브에이전트가
      // submit_response 를 누락한 경우. fallback("처리하지 못했어요")은 확인 카드와 모순되므로,
      // 제안이 준비됐다는 결정적 안내로 대체한다(모델의 submit_response 호출에 비의존).
      answerText = '요청하신 작업을 준비했어요. 확인 카드에서 확인해주세요.';
    } else if (widgets) {
      answerText = ''; // 위젯만 표시 — 빈 텍스트(빈 버블 emit 안 함)
    } else {
      answerText = ROUTER_FALLBACK_TEXT;
    }
    // 빈 텍스트는 onText 로 emit 하지 않는다(빈 버블 방지).
    if (answerText) onText(answerText);
    // #432: 라우터 CLI result 이벤트의 토큰 사용량을 done 이벤트로 전달(LLM 인증 비용 가시화).
    return { fullText: answerText, widgets, pendingAction, usage: parsed.usage };
  } finally {
    // Finding 2: null 가드 — writeTempMcpConfig/mkdtempSync 가 throw 하면 미생성 변수는 정리 생략.
    if (mcpConfigPath) cleanupTempMcpConfig(mcpConfigPath);
    if (workDir) rmSync(workDir, { recursive: true, force: true }); // workDir + 내부 system-prompt.txt 정리
  }
}
