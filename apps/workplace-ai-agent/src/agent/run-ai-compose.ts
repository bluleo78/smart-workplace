// 7b: 홈 컴포즈 러너 — 비서(assistant) agentId 토큰 fetch → assistant MCP config → CLI(assistant 프로필) 스폰 → 파서.
// #333: Task 7 — per-request workdir + writeSubagentDefinitions + system-prompt-file + allowSubagents
// + 화이트리스트 강제(위반 시 kill+throw) + Agent 위임 시 onProgress 라벨 발행.
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
// #439: "미읽은"·"unread" 키워드를 명시적으로 추가 — "메일" 없이 해당 키워드만 있는 쿼리도 감지.
function isMailQuery(query: string): boolean {
  if (/연락처|contacts/i.test(query)) return false;
  return /메일|mail|받은편지|안읽은|미읽은|unread|이메일|e-mail|IMAP|SMTP|계정.*(확인|연동|상태)/i.test(query);
}

// #408: 연락처 쿼리 감지 — "연락처 찾아줘" 같은 모호한 요청에서 홈 라우터가
// contacts-agent 위임 없이 직접 되묻는 비결정적 동작을 차단한다.
// isMailQuery 가 연락처 컨텍스트를 제외하므로 두 감지기는 상호 배타적이다.
function isContactsQuery(query: string): boolean {
  return /연락처|contacts/i.test(query);
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

// #436: 위키 삭제 쿼리 감지 — wiki-agent에 삭제 도구가 없으나
// 홈 라우터(haiku)가 "전달하겠습니다"로 잘못 안내하는 비결정적 동작을 차단한다.
// 검색·열람·생성·수정 등 지원 기능 쿼리는 배제해 오탐을 최소화한다.
function isWikiDeleteQuery(query: string): boolean {
  // 지원 기능(검색·열람·생성·수정) 쿼리는 제외.
  if (/검색|찾아줘|보여줘|열어줘|읽어줘|만들|생성|작성|수정|편집|업데이트/i.test(query)) return false;
  // 위키 + 삭제 키워드 조합 감지.
  return /위키.*(?:삭제|지워|없애|제거)|(?:삭제|지워|없애|제거).*위키/i.test(query);
}

// #390: 드라이브 미지원 작업 쿼리 감지 — 업로드·멤버 권한 변경은 drive-agent 도구에 없으나
// 홈 라우터(haiku)가 "위임하여 진행하겠습니다"로 잘못 안내하는 비결정적 동작을 차단한다.
// 드라이브 조회·검색·폴더 생성·이동 등 지원 기능 쿼리는 배제해 오탐을 최소화한다.
function isDriveUnsupportedQuery(query: string): boolean {
  // 지원 기능(조회·검색·폴더 정리·이동·삭제)은 제외 — 이들은 drive-agent 가 실제로 수행 가능.
  // #419: 파일명에 'upload'가 포함된 삭제 쿼리("test-upload.txt 삭제해줘")가 오탐되지 않도록
  // 삭제 키워드를 allow-list 에 포함. propose_delete_file/folder 가 #333 M4에서 지원된다.
  if (/목록|찾아줘|보여줘|검색|탐색|폴더.*만들|이름.*바꾸|이동|삭제/i.test(query)) return false;
  // 업로드·권한·공유 관련 쿼리 감지.
  // #438: 멤버.*추가|멤버.*변경 → 드라이브.*멤버.*(?:추가|변경) 으로 좁혀 프로젝트 멤버 추가 오탐 방지.
  return /업로드|upload|파일.*올려|올려줘|공유.*권한|드라이브.*멤버.*(?:추가|변경)|권한.*변경|드라이브.*초대/i.test(query);
}

// recentContext 를 단발 --print 프롬프트에 임베드(CLI 는 멀티턴 배열을 받지 않음).
function buildComposeUserMessage(input: ComposeInput): string {
  const ctx = input.recentContext ?? [];
  if (ctx.length === 0) return input.query;
  const lines = ctx.map((m) => `${m.role === 'ASSISTANT' ? 'AI' : '사용자'}: ${m.content}`);
  return `이전 대화:\n${lines.join('\n')}\n\n현재 요청: ${input.query}`;
}

// #410 #421: 내부 서브에이전트 식별자 sanitize 정규식 — done.fullText 및 delta 스트림 양쪽에 적용.
// String.prototype.replace 는 gi 플래그 정규식의 lastIndex 를 갱신하지 않으므로 모듈 상수 재사용 안전.
const SUBAGENT_ID_RE = /\b(?:issue|calendar|messaging|wiki|mail|contacts|project|drive)-agent(?:에게?|가|이|를|을|로|으로|은|는|도|만|와|과|의)?\s*/gi;

// #426: 한국어 서브에이전트 식별자 sanitize — "메일 조회 에이전트" 등 도메인 접두어를 가진
// 한국어 에이전트 명칭이 노출되는 경우를 제거한다.
// SUBAGENT_ID_RE 가 영문 X-agent 패턴만 처리하므로 한국어 패턴을 별도로 보완한다.
// 예: "메일 조회 에이전트에 연결할 수 없습니다." → "에 연결할 수 없습니다."
const KOREAN_AGENT_ID_RE = /(?:메일|이슈|캘린더|연락처|메시지|드라이브|위키|프로젝트)\s*(?:조회\s*)?에이전트(?:에게?|가|이|를|을|로|으로|은|는|도|만|와|과|의)?\s*/gi;

// #429: 서브에이전트 직접 호출 불가 내부 구현 메시지 sanitize.
// "서브에이전트를 직접 호출하지 못하는 환경입니다. 직접 처리하겠습니다." 및
// "제가 직접 처리하겠습니다." 패턴이 delta/최종 텍스트에 노출되는 경우를 제거한다.
// SUBAGENT_ID_RE 가 에이전트 이름을 제거하는 것에 더해 메시지 자체를 sanitize 한다.
const SUBAGENT_DIRECT_MSG_RE =
  /(?:죄송합니다\.\s*)?서브에이전트를\s*직접\s*호출하지\s*못하는\s*환경입니다\.\s*직접\s*처리하겠습니다\.|제가\s*직접\s*처리하겠습니다\./gi;

// #440: 홈 라우터 위임 preamble 텍스트 sanitize — drive-agent 위임 시 delta 스트림에
// 노출되는 내부 추론 문장을 제거한다. SUBAGENT_ID_RE 가 "drive-agent에게" 같은 식별자를
// 제거하지만 라우팅 preamble 문장 자체는 제거하지 않으므로 별도 패턴으로 보완한다.
// 매칭 대상 (회귀 재처리 #440 round2로 확장):
//   ① "위임하겠습니다." / "위임하여 ... 합니다/됩니다/겠습니다."
//   ② "[domain]에서 ... 직접 찾아(보겠습니다|처리하겠습니다)"
//   ③ "[domain]에서 ... 찾아 ... 진행|제안|처리(하겠습니다|합니다)"
//   ④ "[object]를 찾았습니다. [action]을 제안|진행|처리합니다." (preamble 연속 2문장)
// 오탐 방지: ①은 "위임" 키워드 고정. ②③은 도메인 목록 제한. ④는 present-tense 동사만
//           (최종 응답은 "제안했습니다/등록했습니다" 등 past-tense 사용).
const HOME_ROUTER_PREAMBLE_RE =
  /위임(?:하겠습니다|하여[^.。\n]*?(?:합니다|됩니다|겠습니다))\.|(?:드라이브|메일|캘린더|이슈|연락처|채널|위키|프로젝트)에서\s*[^.。\n]*?(?:직접\s*[^.。\n]*?(?:찾아보겠습니다|찾아\s*처리하겠습니다)|[^.。\n]*?찾아\s*[^.。\n]*?(?:진행하겠습니다|진행합니다|제안합니다|처리합니다))\.|[^.。\n]*?찾았습니다\.\s*[^.。\n]*?(?:제안합니다|진행합니다|처리합니다)\./gi;

// #423: 이슈 상태·우선순위 영어 enum 괄호 병기 sanitize.
// issue-agent 가 "완료(DONE)", "진행 중 (IN_PROGRESS)", "높음 (HIGH)" 처럼
// 영어 enum 값을 괄호 안에 병기하는 비결정적 동작을 결정론적으로 차단한다.
// 프롬프트 규칙만으로는 비결정적이므로 후처리 sanitize 로 영어 병기를 제거한다.
// 예: "완료(DONE)" → "완료", "진행 중 (IN_PROGRESS)" → "진행 중"
const ENUM_PARENTHETICAL_RE = /\s*\((DONE|IN_PROGRESS|TODO|CANCELED|HIGH|MEDIUM|LOW)\)/gi;

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
    // #439 회귀: mail 쿼리 판별 — 위임 미확정 구간의 haiku 직접 응답을 버퍼링해 frontend 노출 차단.
    // 위임 확정 시 버퍼 flush, !delegated이면 done 후 override 문구를 onText로 전달.
    const isMailQueryRequest = isMailQuery(input.query);
    let mailQueryBuffer = '';
    // #421: 청크 경계에 걸친 서브에이전트 식별자("wiki" + "-agent에 위임하겠습니다.")를
    // sanitize 하기 위한 carry buffer. 최대 30자를 보유하며 handle.done 후 플러시한다.
    let deltaCarry = '';
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
          if (isMailQueryRequest && !delegated) {
            // #439 회귀: mail 쿼리 + 위임 미확정 → delta 버퍼링.
            // haiku가 mail-agent 위임 없이 직접 응답하는 경우(환각 포함) frontend에 노출되지 않도록 차단.
            // 위임 확정(delegated=true) 시 버퍼를 sanitize 후 flush. !delegated이면 done 후 override 전달.
            mailQueryBuffer += delta;
          } else {
            // #421: carry buffer 로 청크 경계에 걸친 식별자 패턴을 sanitize.
            // 예: "wiki"(청크1) + "-agent에 위임하겠습니다."(청크2) → 합쳐서 매칭 후 제거.
            // 최대 30자를 carry 로 보류해 다음 청크와 합쳐 검사 후 플러시한다.
            const combined = deltaCarry + delta;
            const sanitizedDelta = combined.replace(SUBAGENT_ID_RE, '').replace(KOREAN_AGENT_ID_RE, '').replace(SUBAGENT_DIRECT_MSG_RE, '').replace(HOME_ROUTER_PREAMBLE_RE, '').replace(ENUM_PARENTHETICAL_RE, '');
            const CARRY = 30;
            if (sanitizedDelta.length > CARRY) {
              onText(sanitizedDelta.slice(0, sanitizedDelta.length - CARRY));
              deltaCarry = sanitizedDelta.slice(sanitizedDelta.length - CARRY);
            } else {
              deltaCarry = sanitizedDelta; // 다음 청크와 합쳐서 검사
            }
          }
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
              // #439 회귀: 위임 확정 — 버퍼된 mail delta(haiku preamble)를 sanitize 후 flush.
              // HOME_ROUTER_PREAMBLE_RE 등으로 라우팅 안내 문구를 제거하고 남은 텍스트만 전송.
              if (isMailQueryRequest && mailQueryBuffer) {
                const sanitizedBuffer = mailQueryBuffer
                  .replace(SUBAGENT_ID_RE, '')
                  .replace(KOREAN_AGENT_ID_RE, '')
                  .replace(SUBAGENT_DIRECT_MSG_RE, '')
                  .replace(HOME_ROUTER_PREAMBLE_RE, '')
                  .replace(ENUM_PARENTHETICAL_RE, '')
                  .trim();
                if (sanitizedBuffer) onText(sanitizedBuffer);
                mailQueryBuffer = '';
              }
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
    // #421: carry buffer 잔여 플러시 — 청크 경계 sanitize 후 보류된 델타 텍스트를 전송한다.
    // onText 내부에서 aborted 확인하므로 연결이 끊겼으면 no-op.
    if (deltaCarry) {
      onText(deltaCarry);
      deltaCarry = '';
    }
    // #333: 위반 감지 시 fallback kill(프로덕션=이미 killed, 동기 모킹=여기서 kill) + throw.
    if (policyDeny) {
      handle.kill();
      throw new Error(policyDeny);
    }
    // #406: 복합 요청에서 unassign_self 미처리 시 userId 로 직접 API 재처리.
    // 배경: MCP unassign_self 는 agentId 로 호출되므로 실제 사용자(userId) 해제 불가.
    // 성공 사이드카 없음 = 아직 처리 안 됨. 에러 사이드카 있어도 userId 재시도 가능.
    // userId 재처리 성공 시 에러 사이드카 삭제 → delta 누적 fullText 살리기.
    if (isUnassignCompoundQuery(input.query) && delegated && !existsSync(unassignSuccessPath)) {
      const issueKey = extractIssueKeyFromQuery(input.query);
      if (issueKey) {
        try {
          await deps.client.unassignSelf(input.userId, issueKey);
          // userId 직접 재처리 성공 — 에러 사이드카가 있으면 삭제(delta fullText 보존).
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
      };
    }
    // #383: 메일 쿼리인데 mail-agent 위임이 발생하지 않은 경우(haiku 비결정적 직접 응답 차단).
    // #422: haiku 가 직접 응답한 경우(list_mail 도구 직접 호출 혹은 환각) delta 이벤트에 이미
    // 내용이 스트리밍됐으므로 done.fullText 도 delta 누적 텍스트와 일치시킨다.
    // onProgress 는 실제 위임이 없으므로 발행하지 않는다.
    // fullText 가 비어 있는 극단적 edge case(delta 없이 done 만 온 경우)는 fallback 문구를 사용한다.
    // #439: "없습니다" 류 메일 유무 환각 응답 감지 — 도구 없이 메일 상태를 단정하는 경우
    // done.fullText 를 중립 안내로 override 한다(delta는 이미 스트리밍됐지만 done으로 정정).
    if (isMailQuery(input.query) && !delegated) {
      const sanitized = (mailQueryBuffer || fullText).replace(SUBAGENT_ID_RE, '').replace(KOREAN_AGENT_ID_RE, '').replace(ENUM_PARENTHETICAL_RE, '').trim();
      const hasMailStatusHallucination = /없습니다|없어요|없군요|없네요|없는\s*(것|것으로|듯)/i.test(sanitized);
      const overrideText = hasMailStatusHallucination
        ? '메일을 직접 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.'
        : (sanitized || '메일 전문가에게 전달했습니다.');
      // #439 회귀: frontend는 delta 누적 텍스트를 표시하므로 done.fullText가 아닌 onText로 override 전달.
      // mailQueryBuffer의 haiku 직접 응답은 버퍼링만 되고 frontend 미도달이므로
      // onText로 override 텍스트를 전송해야 사용자에게 올바른 메시지가 표시된다.
      onText(overrideText);
      return {
        fullText: overrideText,
        widgets: null,
        pendingAction: null,
      };
    }
    // #408: 연락처 쿼리인데 contacts-agent 위임이 발생하지 않은 경우(haiku 비결정적 직접 되묻기 차단).
    // #422: 연락처 직접 응답 시 delta 누적 텍스트를 done.fullText 로 반환 — 라우팅 메시지 노출 방지.
    if (isContactsQuery(input.query) && !delegated) {
      const sanitized = fullText.replace(SUBAGENT_ID_RE, '').replace(KOREAN_AGENT_ID_RE, '').replace(ENUM_PARENTHETICAL_RE, '').trim();
      return { fullText: sanitized || '연락처 전문가에게 전달했습니다.', widgets: null, pendingAction: null };
    }
    // #436: 위키 삭제 쿼리 — wiki-agent 에 삭제 도구가 없어 "전달하겠습니다" 환각을 차단한다.
    if (isWikiDeleteQuery(input.query)) {
      return { fullText: '위키 페이지 삭제 기능은 현재 지원하지 않습니다.', widgets: null, pendingAction: null };
    }
    // #390: 드라이브 미지원 작업(업로드·멤버 권한 변경) 쿼리 — drive-agent 에 해당 도구가 없어
    // 위임해도 진행 불가. 홈 라우터가 "정보 주시면 위임 진행" 류로 오안내하는 경우를 차단한다.
    if (isDriveUnsupportedQuery(input.query)) {
      return { fullText: '현재 지원하지 않는 기능입니다.', widgets: null, pendingAction: null };
    }
    // #400 #409: 비가역 작업 제안 후 사용자 "승인" 발화 시 haiku가 propose 없이 완료 환각 응답.
    // pending_action 이 없는데 승인 발화이고 직전 AI 발화에 제안 문구가 있으면 LLM 응답을 버리고
    // 고정 안내로 override 한다. pending_action 이 있으면 정상 제안이므로 통과.
    if (
      !existsSync(pendingActionPath) &&
      isProposalApprovalHallucination(input.query, input.recentContext ?? [])
    ) {
      return { fullText: '확인 카드에서 승인해주세요. 에이전트가 직접 작업을 수행하지 않습니다.', widgets: null, pendingAction: null };
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
    // #410 #421: haiku 가 응답 본문에 내부 서브에이전트 식별자(issue-agent, calendar-agent 등)를
    // 노출하는 비결정적 동작을 결정론적으로 차단한다. 프롬프트 규칙만으로는 비결정적이므로
    // 후처리 sanitize 로 식별자 + 조사를 제거한다.
    // 예: "calendar-agent에 확인하겠습니다." → "확인하겠습니다."
    const sanitizedText = finalText.replace(SUBAGENT_ID_RE, '').replace(KOREAN_AGENT_ID_RE, '').replace(SUBAGENT_DIRECT_MSG_RE, '').replace(HOME_ROUTER_PREAMBLE_RE, '').replace(ENUM_PARENTHETICAL_RE, '');
    // #379: issue-agent 가 이슈 삭제 요청에서 내부 SDK 메시지("Agent 도구가 활성화되어 있지 않네요",
    // "현재 환경에서" 등)를 노출하는 비결정적 동작을 결정론적으로 차단한다.
    // #407: "advisor에게 상담하겠습니다" 등 SDK 내부 폴백 메시지도 동일 패턴으로 차단한다.
    // #415: "현재 라우터 기능에 제약이 있어 직접 처리하겠습니다" 위임 실패 내부 메시지도 차단(이중 방어).
    // agent.md 에 금지 규칙이 있으나 haiku 가 무시할 수 있으므로 런타임에서 이중 방어한다.
    if (/Agent\s*도구가\s*활성화되어\s*있지\s*않|현재\s*환경에서.*(?:Agent|도구)|에이전트\s*도구.*비활성|advisor에게\s*상담하겠습니다|현재\s*라우터\s*기능에\s*제약|라우터\s*기능.*제약/i.test(sanitizedText)) {
      return {
        fullText: '죄송합니다. 해당 요청을 처리할 수 없습니다. 다른 방법으로 도움이 필요하시면 말씀해 주세요.',
        widgets: null,
        pendingAction: null,
      };
    }
    // #404: show_issue_detail 위젯 중 존재하지 않는 이슈 번호를 서버 검증으로 드롭한다.
    const filteredWidgets = await filterIssueDetailWidgets(parsed.widgets, deps.client, agentId);
    return { fullText: sanitizedText, widgets: filteredWidgets.length > 0 ? filteredWidgets : null, pendingAction };
  } finally {
    // Finding 2: null 가드 — writeTempMcpConfig/mkdtempSync 가 throw 하면 미생성 변수는 정리 생략.
    if (mcpConfigPath) cleanupTempMcpConfig(mcpConfigPath);
    if (workDir) rmSync(workDir, { recursive: true, force: true }); // workDir + 내부 system-prompt.txt 정리
  }
}
