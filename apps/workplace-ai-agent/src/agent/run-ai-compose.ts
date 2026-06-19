// 7b: 홈 컴포즈 러너 — 비서(assistant) agentId 토큰 fetch → assistant MCP config → CLI(assistant 프로필) 스폰 → 파서.
// #333: Task 7 — per-request workdir + writeSubagentDefinitions + system-prompt-file + allowSubagents
// + 화이트리스트 강제(위반 시 kill+throw) + Agent 위임 시 onProgress 라벨 발행.
// 데이터 조회는 show_* 도구가 하지 않으므로 토큰은 순수 Claude LLM 인증용(데이터 권한과 무관).
// 모델/생각의 깊이/maxTurns/timeoutMs 는 workplace-api 가 비서 설정을 해석해 요청 본문으로 전달한다(#50).
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HOME_SYSTEM_PROMPT } from './home-system-prompt.js';
import { ASSISTANT_SYSTEM_PROMPT, delegationLabel } from './assistant-system-prompt.js';
import { loadSubagents, writeSubagentDefinitions } from './subagent-loader.js';
import { checkSubagentWhitelist } from './tool-policy.js';
import { writeTempMcpConfig, cleanupTempMcpConfig } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCliCollect, runClaudeCliStream } from './cli-runner.js';
import { parseComposeLines, type ComposeResult } from './compose-parser.js';
import { extractTextDelta } from './wiki-delta-parser.js';
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

// #383: 메일 도메인 쿼리 감지 — 홈 라우터가 mail-agent 위임 없이 직접 응답하는
// 비결정적 동작(haiku 프롬프트 무시)을 런타임에서 차단하기 위한 선별 기준.
// #385: 연락처(contacts) 컨텍스트를 가진 쿼리는 메일 쿼리에서 제외 — "이메일" 키워드가
// 연락처 생성/수정 요청에 포함될 때 오탐해 mail-agent fallback이 contacts-agent 결과를 덮는 버그 방지.
function isMailQuery(query: string): boolean {
  if (/연락처|contacts/i.test(query)) return false;
  return /메일|mail|받은편지|안읽은|이메일|e-mail|IMAP|SMTP|계정.*(확인|연동|상태)/i.test(query);
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

// #406: 이슈 담당 해제 의도가 포함된 복합 쿼리 감지.
// "담당자에서 나 해제해줘", "나 빼줘", "unassign" 등의 표현을 포함하며
// 동시에 다른 작업(상태변경·코멘트 등)도 요청하는 복합 요청을 식별한다.
// 단순 해제 전용 쿼리(다른 요청 없음)는 issue-agent 가 잘 처리하므로 제외.
function isUnassignCompoundQuery(query: string): boolean {
  const hasUnassign = /담당.*(해제|빼줘|제외|빼)|나.*담당.*빼|unassign|담당자.*나|나.*빼줘/i.test(query);
  if (!hasUnassign) return false;
  // 다른 작업이 함께 있는지 확인(상태변경·코멘트)
  const hasOtherTask = /바꾸|변경|코멘트|댓글|남겨|IN_PROGRESS|진행중|완료|DONE/i.test(query);
  return hasOtherTask;
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

// #400: 사용자 일정 승인 발화 감지 — calendar-agent 위임 컨텍스트에서 "승인", "확인", "네" 등
// 응답 시 haiku 가 propose 없이 "생성됐습니다" 환각 응답을 내보내는 비결정적 동작을 차단한다.
// 이전 대화(recentContext)에 calendar-agent 의 제안 문구가 있고 현재 쿼리가 승인 발화일 때만 감지.
// 길이 제한(30자)으로 "일정 잡아줘" 같은 새 요청은 제외, 오탐 방지.
function isCalendarApprovalHallucination(query: string, recentContext: ContextMessage[]): boolean {
  const q = query.trim();
  // 너무 길면 새 요청이므로 제외
  if (q.length > 30) return false;
  // 승인 발화 키워드가 포함되는지 확인
  if (!/네|예|응|좋아|승인|확인|진행|부탁|ㅇㅇ|ㅇㅋ|ok|okay|yes|그래|알겠|좋습니다/i.test(q)) return false;
  // 이전 AI 발화 중 캘린더 제안("제안했습니다" / "확인 카드") 패턴 확인
  const prevAi = recentContext.filter((m) => m.role === 'ASSISTANT').map((m) => m.content).join('\n');
  return /제안했습니다|확인 카드|일정.*생성.*제안|propose/i.test(prevAi);
}

// #390: 드라이브 미지원 작업 쿼리 감지 — 업로드·멤버 권한 변경은 drive-agent 도구에 없으나
// 홈 라우터(haiku)가 "위임하여 진행하겠습니다"로 잘못 안내하는 비결정적 동작을 차단한다.
// 드라이브 조회·검색·폴더 생성·이동 등 지원 기능 쿼리는 배제해 오탐을 최소화한다.
function isDriveUnsupportedQuery(query: string): boolean {
  // 지원 기능(조회·검색·폴더 정리·이동)은 제외 — 이들은 drive-agent 가 실제로 수행 가능.
  if (/목록|찾아줘|보여줘|검색|탐색|폴더.*만들|이름.*바꾸|이동|삭제.*제안/i.test(query)) return false;
  // 업로드·멤버·권한·공유 관련 쿼리 감지.
  return /업로드|upload|파일.*올려|올려줘|공유.*권한|멤버.*추가|멤버.*변경|권한.*변경|드라이브.*초대/i.test(query);
}

// recentContext 를 단발 --print 프롬프트에 임베드(CLI 는 멀티턴 배열을 받지 않음).
function buildComposeUserMessage(input: ComposeInput): string {
  const ctx = input.recentContext ?? [];
  if (ctx.length === 0) return input.query;
  const lines = ctx.map((m) => `${m.role === 'ASSISTANT' ? 'AI' : '사용자'}: ${m.content}`);
  return `이전 대화:\n${lines.join('\n')}\n\n현재 요청: ${input.query}`;
}

// SSE 라우트용 스트리밍 러너 — 토큰이 도착할 때마다 onText 콜백을 호출하고,
// 완료 후 parseComposeLines 로 최종 message + widgets 를 산출해 반환한다.
// #333: assistant 프로파일 + per-request workdir + allowSubagents + 화이트리스트 강제.
// signal abort 시 하위 CLI child 를 kill 해 자원 누수를 막는다(wiki 러너와 동일 패턴).
export async function runAiComposeStream(
  input: ComposeInput,
  deps: RunAgentDeps,
  onText: (t: string) => void,
  signal: AbortSignal,
  onProgress?: (label: string) => void, // #333: Agent 위임 시작 시 호출('이슈 전문가에게 위임 중')
): Promise<{ fullText: string; widgets: unknown; pendingAction: unknown | null }> {
  // #405: 생성일 필터 쿼리 — LLM 호출 전 결정론적으로 차단. dueFrom 오해석 방지.
  if (isCreatedDateFilterQuery(input.query)) {
    return {
      fullText: '생성 날짜 필터는 지원하지 않습니다. 마감일(dueFrom/dueTo), 담당자, 상태, 우선순위 필터를 사용해 보세요.',
      widgets: null,
      pendingAction: null,
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
    mcpConfigPath = writeTempMcpConfig({
      agentId,
      baseURL: process.env.WORKPLACE_API_BASE_URL ?? '',
      internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
      profile: 'assistant', // home 프로파일 → assistant 프로파일로 교체(#333)
      pendingActionPath, // #333 M2: propose 핸들러가 제안을 쓸 사이드카(절대경로)
      unassignErrorPath, // #378: unassign_self 실패 사이드카(절대경로)
      unassignSuccessPath, // #406: unassign_self 성공 사이드카(절대경로)
      userId: input.userId, // #376: MCP child env 에도 ACTING_USER_ID 전달
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
    let fullText = '';
    // #333: 화이트리스트 위반 감지 플래그 + 즉시-kill 홀더(Finding 1).
    // killer 홀더를 먼저 선언해 onLine 콜백 안에서 TDZ 없이 참조 가능하도록 한다.
    // 프로덕션(비동기 onLine): handle 할당 후 killer 가 채워지므로 killer?.() 가 즉시 kill.
    // 테스트 동기 모킹: onLine 이 handle 할당 전 동기 실행 → killer 가 null 이라 무해.
    // 두 경우 모두 await handle.done 이후 fallback kill+throw 가 에러를 전파한다.
    let policyDeny: string | null = null;
    // #383: mail-agent 위임 발생 여부 추적 — CLI 완료 후 위임 없이 직접 응답한 경우 fallback.
    let delegated = false;
    let killer: (() => void) | null = null;
    const handle = runClaudeCliStream(
      { args, env, timeoutMs: input.timeoutMs, logTag: `ai-compose:${agentId}`, cwd: workDir! },
      (line) => {
        // 모든 라인을 누적(parseComposeLines 가 위젯/최종메시지 파싱에 사용).
        lines.push(line);
        let obj: unknown;
        try {
          obj = JSON.parse(line);
        } catch {
          return; // 비JSON 라인 무시
        }
        // text_delta 만 추출해 스트리밍. 비JSON·thinking_delta 등은 무시.
        const delta = extractTextDelta(obj);
        if (delta) {
          fullText += delta;
          onText(delta);
        }
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
              // #383: 위임 발생 → 플래그 설정. onProgress 있으면 라벨 발행.
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
    // #406: 복합 요청에서 unassign_self 미호출 시 직접 API 재처리.
    // issue-agent 가 복합 요청에서 담당 해제를 건너뛰는 비결정적 동작(haiku)을 런타임에서 보완한다.
    // 조건: 복합 해제 쿼리 + issue-agent 위임 발생 + 성공 사이드카 없음 + 에러 사이드카 없음.
    // 성공/에러 사이드카가 있으면 이미 처리됐거나 실패 override 가 뒤따르므로 건너뛴다.
    if (
      isUnassignCompoundQuery(input.query) &&
      delegated &&
      !existsSync(unassignSuccessPath) &&
      !existsSync(unassignErrorPath)
    ) {
      const issueKey = extractIssueKeyFromQuery(input.query);
      if (issueKey) {
        try {
          await deps.client.unassignSelf(input.userId, issueKey);
          // 성공 시 성공 사이드카 기록(중복 재처리 방지) — 에러 시 무시하고 LLM 응답 유지.
        } catch {
          // unassign 재처리 실패 — LLM 이 이미 다른 안내를 했을 것이므로 조용히 무시.
        }
      }
    }
    // #383: 메일 쿼리인데 mail-agent 위임이 발생하지 않은 경우(haiku 비결정적 직접 응답 차단).
    // LLM 응답을 버리고 progress 라벨 + 고정 문구로 override 해 UX 일관성을 보장한다.
    if (isMailQuery(input.query) && !delegated) {
      onProgress?.('메일 전문가에게 위임 중');
      return { fullText: 'mail-agent에 전달했습니다.', widgets: null, pendingAction: null };
    }
    // #390: 드라이브 미지원 작업(업로드·멤버 권한 변경) 쿼리 — drive-agent 에 해당 도구가 없어
    // 위임해도 진행 불가. 홈 라우터가 "정보 주시면 위임 진행" 류로 오안내하는 경우를 차단한다.
    if (isDriveUnsupportedQuery(input.query)) {
      return { fullText: '현재 지원하지 않는 기능입니다.', widgets: null, pendingAction: null };
    }
    // #400: 캘린더 일정 제안 후 사용자 "승인" 발화 시 haiku가 propose 없이 "생성됐습니다" 환각 응답.
    // pending_action 이 없는데 승인 발화이고 직전 AI 발화에 제안 문구가 있으면 LLM 응답을 버리고
    // 고정 안내로 override 한다. pending_action 이 있으면 정상 제안이므로 통과.
    if (
      !existsSync(pendingActionPath) &&
      isCalendarApprovalHallucination(input.query, input.recentContext ?? [])
    ) {
      return { fullText: '확인 카드에서 승인해주세요. 에이전트가 직접 일정을 생성하지 않습니다.', widgets: null, pendingAction: null };
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
          return { fullText: errData.canonical, widgets: null, pendingAction: null };
        }
      } catch {
        // 사이드카 파싱 실패 — LLM 응답을 그대로 사용
      }
    }
    // parseComposeLines 로 최종 message(result 이벤트) + widgets(tool_use 이벤트) 산출.
    const parsed = parseComposeLines(lines);
    const finalText = parsed.message || fullText;
    // #379: issue-agent 가 이슈 삭제 요청에서 내부 SDK 메시지("Agent 도구가 활성화되어 있지 않네요",
    // "현재 환경에서" 등)를 노출하는 비결정적 동작을 결정론적으로 차단한다.
    // #407: "advisor에게 상담하겠습니다" 등 SDK 내부 폴백 메시지도 동일 패턴으로 차단한다.
    // agent.md 에 금지 규칙이 있으나 haiku 가 무시할 수 있으므로 런타임에서 이중 방어한다.
    if (/Agent\s*도구가\s*활성화되어\s*있지\s*않|현재\s*환경에서.*(?:Agent|도구)|에이전트\s*도구.*비활성|advisor에게\s*상담하겠습니다/i.test(finalText)) {
      return {
        fullText: '죄송합니다. 해당 요청을 처리할 수 없습니다. 다른 방법으로 도움이 필요하시면 말씀해 주세요.',
        widgets: null,
        pendingAction: null,
      };
    }
    // #404: show_issue_detail 위젯 중 존재하지 않는 이슈 번호를 서버 검증으로 드롭한다.
    const filteredWidgets = await filterIssueDetailWidgets(parsed.widgets, deps.client, agentId);
    return { fullText: finalText, widgets: filteredWidgets.length > 0 ? filteredWidgets : null, pendingAction };
  } finally {
    // Finding 2: null 가드 — writeTempMcpConfig/mkdtempSync 가 throw 하면 미생성 변수는 정리 생략.
    if (mcpConfigPath) cleanupTempMcpConfig(mcpConfigPath);
    if (workDir) rmSync(workDir, { recursive: true, force: true }); // workDir + 내부 system-prompt.txt 정리
  }
}

export async function runAiCompose(
  input: ComposeInput,
  deps: RunAgentDeps,
): Promise<ComposeResult> {
  // 비서 AGENT 의 OAuth 토큰으로 LLM 인증. agentId 는 요청 본문에서 온다.
  const agentId = input.assistantAgentId;
  const token = (await deps.client.getOAuthToken(agentId)).token;
  const mcpConfigPath = writeTempMcpConfig({
    agentId,
    baseURL: process.env.WORKPLACE_API_BASE_URL ?? '',
    internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
    profile: 'home',
    userId: input.userId, // #376: MCP child env 에도 ACTING_USER_ID 전달
  });

  try {
    // 생각의 깊이는 CLI 플래그가 없어 system-prompt 접미 지시문으로 근사한다.
    const systemPrompt = HOME_SYSTEM_PROMPT + thinkingDirective(input.thinkingDepth);
    const args = buildCliArgs({
      userMessage: buildComposeUserMessage(input),
      systemPrompt,
      model: input.model,
      maxTurns: input.maxTurns,
      mcpConfigPath,
      includePartialMessages: false,
    });
    const env = buildChildEnv(process.env, token, agentId, input.userId); // #376: userId 전달
    const lines = await runClaudeCliCollect({
      args,
      env,
      timeoutMs: input.timeoutMs,
      logTag: `ai-compose:${agentId}`,
    });
    return parseComposeLines(lines);
  } finally {
    cleanupTempMcpConfig(mcpConfigPath);
  }
}
