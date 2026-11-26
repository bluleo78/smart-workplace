// src/workflow-tools.ts — 이슈 워크플로우 도구(WP-1988). 이슈 앱의 실행 3종(get/start/move_issue_workflow)과
// 프로젝트 앱의 정의 3종(get/validate/update_workflow)을 한 배열로 둔다. 입력은 사람이 읽는 키(issueKey·워크플로우 이름·username)이고 서버 id 는 도구가 푼다.
// 응답에 숫자 사용자 id 를 싣지 않는다(no-user-ids, #833) — 사람은 {username, name} 으로만.
// 정의 도구의 YAML 문제(WorkflowProblem)는 「줄:열 [SEVERITY CODE] 메시지」 줄로 펴서 모델이 고칠 자리를 바로 찾게 한다.
// 서버 오류(409 STALE·422 OUTPUT_MISSING 등)는 잡지 않고 그대로 던진다 — 공유 레이어가 describeApiError 로 「errors.code + 문장 + 칸」 한 줄을 만든다.
// 서버 errors 칸(MoveViolation: currentNode·revision·keys·role·candidates)에는 숫자 사용자 id 가 없다(candidates 는 username 쉼표 목록) — 가공할 칸이 없다.
import { z } from 'zod';
import type { SharedTool } from './mcp-tool.js';
import { linkMentions, resolveMentionTokens } from './messaging-tools.js';
import { describeApiError, parseIssueKey } from './parse.js';
import { type AssigneeResolverClient, resolveAssigneeIds } from './resolve.js';
import { questionOptionsInput, stagedFileIdsInput } from './schemas.js';
import { nullAsOmitted } from './tool-definitions.js';
import type {
  IssueWorkflowViewRow,
  MemberToolClient,
  MoveWorkflowBody,
  WorkflowProblemRow,
  WorkflowSummaryRow,
  WorkflowToolClient,
  WorkflowUserRow,
} from './tool-client.js';

export const issueWorkflowInput = z.object({ issueKey: z.string().min(1) });
export const startIssueWorkflowInput = z.object({
  issueKey: z.string().min(1),
  // 생략하면 켜진 게시본이 하나일 때 그것을 쓴다(여럿이면 이름 목록과 함께 거절).
  workflowName: nullAsOmitted(z.string().trim().min(1)),
});
export const moveIssueWorkflowInput = z.object({
  issueKey: z.string().min(1),
  fromNode: z.string().min(1),
  outcome: z.string().min(1),
  outputs: nullAsOmitted(z.record(z.string(), z.unknown())),
  // 다음 단계 담당 — username 으로 받아 도구가 id 로 푼다(LLM 이 숫자 id 를 만지지 않게).
  assignees: nullAsOmitted(z.array(z.string().min(1))),
  // 공백뿐인 글은 아래 핸들러에서 뺀다(빈 문자열이 서버로 가 오류가 덜 구체적이 되는 것을 막는다).
  comment: nullAsOmitted(z.string()),
  expectedRevision: z.number().int().min(0),
  // 겨눈 실행(get_issue_workflow 의 runId) — 주면 서버가 멱등 조회를 그 실행으로 좁혀, 실행이 바뀐 뒤 옛 key 가 새 이동을 막지 않게 한다.
  runId: nullAsOmitted(z.number().int().positive()),
  // WP-2147: 질문 이동(ask)의 질문 글에 붙일 시안 첨부·답 칩 — report_agent_work 의 fileIds·options 와 같은 규칙. 질문 글(의견)이 있어야 한다.
  fileIds: nullAsOmitted(stagedFileIdsInput),
  options: nullAsOmitted(questionOptionsInput),
});
export const getWorkflowInput = z.object({
  projectKey: z.string().min(1),
  // 생략하면 목록, 주면 그 워크플로우 한 건(초안 YAML·문제·게시본).
  name: nullAsOmitted(z.string().trim().min(1)),
});
export const validateWorkflowInput = z.object({ projectKey: z.string().min(1), yaml: z.string() });
export const updateWorkflowInput = z.object({
  projectKey: z.string().min(1),
  name: z.string().trim().min(1),
  yaml: z.string(),
  publish: nullAsOmitted(z.boolean()),
  // get_workflow 가 준 draftUpdatedAt — 주면 그사이 남이 초안을 바꿨을 때 서버가 409 WORKFLOW_DRAFT_CONFLICT 로 덮어쓰기를 막는다.
  expectedDraftUpdatedAt: nullAsOmitted(z.string().min(1)),
});

/** 질문 결과 이름 — 서버가 이 결과의 의견을 이슈 챗 질문으로 올린다(WP-2093). */
const ASK_OUTCOME = 'ask';

/** 질문 의견 상한 — 서버 이슈 챗 본문 상한(IssueChatPoster.BODY_MAX)과 같은 값. */
const QUESTION_MAX_CHARS = 4000;

/**
 * 멘션 토큰으로 바꾼 질문 의견이 상한을 넘으면 몇 자인지 담아 던진다 — 도구 설명의 「바뀐 뒤 글자로 잰다」와 서버 판정(코드포인트)이 같은 기준이 되게.
 * 서버를 부르기 전에 던져 이동이 일어나지 않는다.
 */
function assertQuestionLength(linked: string): void {
  const length = [...linked].length;
  if (length > QUESTION_MAX_CHARS) {
    throw new Error(
      `질문 의견이 ${length}자입니다(@username 을 <@id> 멘션 토큰으로 바꾼 뒤 기준) — ${QUESTION_MAX_CHARS}자 이하로 줄여 다시 보내세요.`,
    );
  }
}

/** 실행이 없을 때의 안내 — 다음 행동(start_issue_workflow)을 이름으로 알려 준다. */
const NO_RUN_HINT = '진행 중인 워크플로우가 없습니다 — start_issue_workflow 로 시작하세요.';

/** 응답에 싣는 사람 — {username, name} 하나뿐(숫자 id·kind 는 뺀다). */
type UserRef = { username: string; name: string | undefined };

/** UserRef 를 만드는 유일한 곳 — 서버 사람(toUserRef)과 _qa 풀이가 같은 모양을 쓰게 한다. */
const userRef = (username: string, name: string | undefined): UserRef => ({ username, name });

/** 워크플로우 사람(서버 UserSummary) → UserRef. */
const toUserRef = (u: WorkflowUserRow): UserRef => userRef(u.username, u.name);

/**
 * 서버 IssueWorkflowView → 모델용 뷰. 키 이름을 짧게(roleKey→role·candidateAssignees→candidates·remainingNodeKeys→remaining) 하고
 * 사람의 숫자 id 를 뺀다. workflowId 는 도구 입력이 이름이라 싣지 않는다. 실행이 없으면(runId null) 시작 안내만 돌려준다.
 */
export function toIssueWorkflowView(v: IssueWorkflowViewRow) {
  if (v.runId == null) return { status: null, hint: NO_RUN_HINT };
  const n = v.currentNode;
  return {
    runId: v.runId,
    status: v.status,
    revision: v.revision,
    versionNo: v.versionNo,
    currentNode: n && {
      key: n.key,
      name: n.name,
      type: n.type,
      role: n.roleKey,
      assignees: (n.assignees ?? []).map(toUserRef),
      enteredAt: n.enteredAt,
      nodeRunStatus: n.nodeRunStatus,
      instructions: n.instructions,
    },
    outcomes: (v.outcomes ?? []).map((o) => ({
      key: o.key,
      toNode: o.toNode,
      requiredOutputs: o.requiredOutputs,
      requireComment: o.requireComment,
      assignTo: o.assignTo,
      candidates: (o.candidateAssignees ?? []).map(toUserRef),
      assigneeRequired: o.assigneeRequired,
    })),
    path: (v.path ?? []).map((p) => ({
      key: p.key,
      name: p.name,
      outcome: p.outcome,
      actor: p.actor ? toUserRef(p.actor) : null,
      enteredAt: p.enteredAt,
      leftAt: p.leftAt,
    })),
    remaining: v.remainingNodeKeys ?? [],
    context: v.context ?? {},
  };
}

/** 서버가 context 에 남기는 질문·답 기록의 예약 키(WorkflowRunService.QA_KEY). */
const QA_KEY = '_qa';
/** 질문·답 기록에서 숫자 사용자 id 를 담는 칸(서버 withQa 의 askedBy·answeredBy). */
const QA_USER_KEYS = ['askedBy', 'answeredBy'] as const;
/** 질문·답 기록에서 멘션 토큰 `<@id>` 이 들 수 있는 본문 칸(댓글 본문 그대로). */
const QA_TEXT_KEYS = ['question', 'answer'] as const;
/** 본문의 멘션 토큰 `<@123>` — 풀 id 를 모을 때 쓴다(바꾸기는 resolveMentionTokens 가 한다). */
const MENTION_ID = /<@(\d+)>/g;

/** 숫자(또는 숫자 문자열) 사용자 id 만 읽는다 — 그 밖의 값은 풀 수 없다. */
function userIdOf(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return undefined;
}

/**
 * context._qa 의 숫자 사용자 id 를 사람으로 푼다(no-user-ids, #833). 서버 withQa 는 askedBy·answeredBy 에 숫자 id 를 넣고
 * question·answer 에는 댓글 본문(멘션 토큰 `<@id>` 포함)을 그대로 둔다 — 그대로 내보내면 모델이 숫자 id 를 보게 된다.
 * - 나오는 id 를 모두 모아 한 호출 안에서 id 마다 한 번만 getMember 로 찾는다(같은 사람이 여러 번 묻고 답해도 조회는 한 번).
 * - askedBy·answeredBy 는 {username, name} 으로 바꾸고, 못 찾은 id(탈퇴·조회 실패)는 숫자를 흘리지 않도록 칸을 뺀다.
 * - 본문 토큰은 resolveMentionTokens 로 `@이름(username)` 으로 바꾸고, 못 찾은 것은 「@(알 수 없는 사용자)」로 둔다.
 * _qa 가 없거나 비었으면 조회 없이 그대로 돌려준다.
 */
async function resolveQaUsers(
  context: Record<string, unknown>,
  client: Pick<MemberToolClient, 'getMember'>,
): Promise<Record<string, unknown>> {
  const qa = context[QA_KEY];
  if (!Array.isArray(qa) || qa.length === 0) return context;
  const isRecord = (e: unknown): e is Record<string, unknown> => !!e && typeof e === 'object';
  // 1) 풀어야 할 id 모으기 — 칸의 id 와 본문 토큰의 id 를 한 번에 훑는다.
  const ids = new Set<number>();
  for (const e of qa) {
    if (!isRecord(e)) continue;
    for (const k of QA_USER_KEYS) {
      const id = userIdOf(e[k]);
      if (id !== undefined) ids.add(id);
    }
    for (const k of QA_TEXT_KEYS) {
      const text = e[k];
      if (typeof text === 'string') for (const m of text.matchAll(MENTION_ID)) ids.add(Number(m[1]));
    }
  }
  // 2) id 마다 한 번 조회 — 실패(404 등)는 「못 찾음」으로 두고 응답 전체를 실패시키지 않는다.
  const people = new Map<number, UserRef>();
  await Promise.all(
    [...ids].map(async (id) => {
      try {
        const m = await client.getMember(id);
        if (m?.username) people.set(id, userRef(m.username, m.name ?? undefined));
      } catch {
        // 못 찾은 사람은 아래에서 칸을 빼거나 「알 수 없는 사용자」로 바꾼다.
      }
    }),
  );
  const mentions = [...people].map(([id, p]) => ({ id, ...p }));
  // 3) 기록마다 사본을 만들어 바꾼다(서버 응답 객체는 건드리지 않는다).
  const resolved = qa.map((e) => {
    if (!isRecord(e)) return e;
    const copy: Record<string, unknown> = { ...e };
    for (const k of QA_USER_KEYS) {
      if (!(k in copy)) continue;
      const id = userIdOf(copy[k]);
      const person = id === undefined ? undefined : people.get(id);
      if (person) copy[k] = person;
      else delete copy[k];
    }
    for (const k of QA_TEXT_KEYS) {
      const text = copy[k];
      if (typeof text === 'string') copy[k] = resolveMentionTokens(text, mentions);
    }
    return copy;
  });
  return { ...context, [QA_KEY]: resolved };
}

/** 응답 문자열 — get·start·move 가 같은 모양을 쓴다. context._qa 의 사람 id 는 이름으로 푼 뒤 싣는다. */
async function viewJson(v: IssueWorkflowViewRow, client: Pick<MemberToolClient, 'getMember'>): Promise<string> {
  // 실행이 없으면(runId null) 시작 안내만 있고 context 가 없다.
  if (v.runId == null) return JSON.stringify(toIssueWorkflowView(v));
  return JSON.stringify({ ...toIssueWorkflowView(v), context: await resolveQaUsers(v.context ?? {}, client) });
}

/** 오류 안내에 붙일 이름 목록. */
const namesOf = (rows: WorkflowSummaryRow[]) => (rows.length ? rows.map((w) => w.name).join(', ') : '없음');

/** 이름이 대소문자만 다른 워크플로우가 여럿일 때의 거절 문장 — 시작·조회(pickWorkflow)와 저장(update_workflow)이 같이 쓴다. */
const ambiguousNameError = (rows: WorkflowSummaryRow[], name: string) =>
  new Error(`이름이 대소문자만 다른 워크플로우가 여럿입니다: ${name} (있는 것: ${namesOf(rows)}) — 정확한 이름을 주세요.`);

/**
 * 이름으로 워크플로우 찾기 — 정확히 같은 것 → 없으면 대소문자 무시로 딱 하나. 대소문자만 다른 것이 여럿이면 'ambiguous',
 * 없으면 null. update_workflow 는 null 일 때만 새로 만든다(모호한데 만들면 비슷한 이름이 하나 더 생긴다).
 */
function findWorkflowByName(rows: WorkflowSummaryRow[], name: string): WorkflowSummaryRow | 'ambiguous' | null {
  const exact = rows.find((w) => w.name === name);
  if (exact) return exact;
  const folded = rows.filter((w) => w.name.toLowerCase() === name.toLowerCase());
  if (folded.length === 1) return folded[0];
  return folded.length > 1 ? 'ambiguous' : null;
}

/**
 * YAML 문제 → 한 줄씩 `줄:열 [SEVERITY CODE] 메시지`(노드가 있으면 ` (노드 key)`). 모델이 고칠 자리를 줄 번호로 바로 찾게 한다.
 */
export function formatProblems(problems: WorkflowProblemRow[]): string[] {
  return problems.map(
    (p) => `${p.line}:${p.column} [${p.severity} ${p.code}] ${p.message}${p.nodeKey ? ` (노드 ${p.nodeKey})` : ''}`,
  );
}

/** 오류(ERROR)가 하나라도 있는지 — 경고(WARNING)만 있으면 게시할 수 있다. */
const hasError = (problems: WorkflowProblemRow[]) => problems.some((p) => p.severity === 'ERROR');

/**
 * 게시 거절 중 422 WORKFLOW_INVALID 는 본문 problems 를 줄로 펴서 오류 문장 뒤에 붙여 다시 던진다 — 기본 요약(describeApiError)은
 * errors 칸만 보여 문제 목록이 사라지기 때문이다. 다른 오류(403 권한 등)는 그대로 던진다.
 */
function rethrowPublishError(e: unknown): never {
  const r = (e as { response?: { status?: number; data?: { errors?: { code?: string }; problems?: WorkflowProblemRow[] } } }).response;
  if (r?.status === 422 && r.data?.errors?.code === 'WORKFLOW_INVALID' && r.data.problems?.length) {
    throw new Error([describeApiError(r.status, r.data), ...formatProblems(r.data.problems)].join('\n'));
  }
  throw e;
}

/**
 * 시작할 워크플로우 고르기. 이름이 있으면 정확히 같은 것 → 없으면 대소문자 무시로 딱 하나 → 없으면 있는 이름과 함께 거절.
 * 이름이 없으면 켜졌고 게시 버전이 있는 것이 하나일 때만 그것을 쓴다 — 여럿을 아무거나 고르면 엉뚱한 절차가 돈다.
 * 켜짐·게시 여부는 이름으로 고를 때 보지 않는다 — 서버가 DISABLED·NOT_PUBLISHED 로 사유를 알려 준다.
 */
export function pickWorkflow(rows: WorkflowSummaryRow[], name: string | null | undefined): WorkflowSummaryRow {
  if (name) {
    const found = findWorkflowByName(rows, name);
    // 대소문자만 다른 여럿이면 「없음」이 아니라 정확한 이름을 달라고 알린다 — 있는 이름을 없다고 하면 모델이 새로 만들려 든다.
    if (found === 'ambiguous') throw ambiguousNameError(rows, name);
    if (found) return found;
    throw new Error(`워크플로우를 찾을 수 없습니다: ${name} (있는 것: ${namesOf(rows)})`);
  }
  const ready = rows.filter((w) => w.enabled && w.activeVersionNo != null);
  if (ready.length === 1) return ready[0];
  if (ready.length > 1) throw new Error(`워크플로우가 여럿입니다 — workflowName 을 주세요 (있는 것: ${ready.map((w) => w.name).join(', ')})`);
  throw new Error('켜진(게시된) 워크플로우가 없습니다.');
}

/**
 * update_workflow 의 저장 — 있으면 초안을 덮어 저장하고(오류가 있어도 저장된다), 없으면 새로 만든다.
 * 본 초안 시각(expected)은 준 때만 넘겨 그사이 바뀌었으면 서버 409 WORKFLOW_DRAFT_CONFLICT 를 그대로 던진다(잡지 않는다).
 */
async function saveOrCreate(
  client: WorkflowToolClient,
  found: WorkflowSummaryRow | null,
  projectKey: string,
  name: string,
  yaml: string,
  expected: string | undefined,
): Promise<{ id: number; created: boolean; problems: WorkflowProblemRow[]; draftUpdatedAt: string }> {
  if (found) {
    const saved = await client.saveWorkflowDraft(found.id, yaml, expected);
    return { id: found.id, created: false, problems: saved.problems ?? [], draftUpdatedAt: saved.draftUpdatedAt };
  }
  const created = await client.createWorkflow(projectKey, name, yaml);
  return { id: created.id, created: true, problems: created.draftProblems ?? [], draftUpdatedAt: created.draftUpdatedAt };
}

/** 워크플로우 도구 — 이슈 실행 3종(issue 앱)과 정의 3종(project 앱). */
export function buildWorkflowTools(
  client: WorkflowToolClient & AssigneeResolverClient & Pick<MemberToolClient, 'getMember' | 'searchMembers'>,
): SharedTool[] {
  return [
    {
      name: 'get_issue_workflow',
      app: 'issue',
      kind: 'read',
      description:
        "Issue's workflow run: current node with instructions and assignees, outcomes you can pick (required outputs, comment, next assignee candidates), " +
        'path so far, remaining nodes, and revision to pass to move_issue_workflow.',
      inputSchema: issueWorkflowInput,
      async handler(args) {
        const { issueKey } = issueWorkflowInput.parse(args);
        return viewJson(await client.getIssueWorkflow(issueKey), client);
      },
    },
    {
      name: 'start_issue_workflow',
      app: 'issue',
      kind: 'write',
      // 같은 이슈에 다시 부르면 ALREADY_ACTIVE 로 거절된다 — 멱등이 아니다. 실행을 새로 만들 뿐 지우지 않아 destructive 도 아니다.
      hints: { destructive: false, idempotent: false },
      description:
        "Starts a project workflow on an issue. workflowName picks one by name; omit it when the project has exactly one enabled, published workflow.",
      inputSchema: startIssueWorkflowInput,
      async handler(args) {
        const { issueKey, workflowName } = startIssueWorkflowInput.parse(args);
        const chosen = pickWorkflow(await client.listWorkflows(parseIssueKey(issueKey).projectKey), workflowName);
        return viewJson(await client.startIssueWorkflow(issueKey, chosen.id), client);
      },
    },
    {
      name: 'move_issue_workflow',
      app: 'issue',
      kind: 'write',
      // idempotencyKey 로 같은 이동의 재시도는 서버가 저장한 응답을 그대로 돌려준다(WorkflowRunService findIdempotent) — 멱등이다.
      // 노드를 앞으로 보낼 뿐 값을 덮거나 지우지 않아 destructive 가 아니다.
      hints: { destructive: false, idempotent: true },
      // 결과(outcome) 출처 「from get_issue_workflow」는 남긴다 — 결과 이름을 지어내지 않게. 도구 정의 토큰 상한(tool-naming.test)을 지키려
      // 같은 출처를 다시 말하는 곳은 「from it」으로 줄였다(WP-2093 리뷰 후속).
      description:
        'Moves the issue from fromNode by an outcome from get_issue_workflow. Give required outputs, comment, next assignees (usernames) when asked, ' +
        'and expectedRevision, runId from it. WORKFLOW_STALE if changed. ' +
        "On ask, the comment becomes an issue chat question (max 4000 chars after @username→<@id>) +fileIds, options (chips, best first); a person's reply returns it via answered (read via get_issue_chat; never move answered yourself).",
      inputSchema: moveIssueWorkflowInput,
      async handler(args) {
        const { issueKey, fromNode, outcome, outputs, assignees, comment, expectedRevision, runId, fileIds, options } =
          moveIssueWorkflowInput.parse(args);
        // 의견의 @username 은 <@id> 멘션 토큰으로 바꿔 보낸다(report_agent_work 의 message 와 같은 linkMentions) — 결과 ask 의 의견은
        // 이슈 챗 질문이 되므로(WP-2093) 토큰이어야 @owner 멘션이 알림으로 간다. 일반 이동의 의견 댓글도 같은 토큰 표기를 쓴다.
        const linkedComment = comment != null && comment.trim() !== '' ? await linkMentions(client, comment) : undefined;
        // 서버는 바뀐 뒤 글자로 질문 상한을 잰다(토큰이 @username 보다 길 수 있다) — 같은 기준으로 먼저 재서, 422 대신 몇 자인지 알려 줄인 뒤
        // 다시 보내게 한다. 서버처럼 코드포인트로 센다.
        if (outcome === ASK_OUTCOME && linkedComment !== undefined) assertQuestionLength(linkedComment);
        // 첨부·선택지는 질문 글에 붙는다(WP-2147) — 붙일 글이 없으면 서버를 부르기 전에 고칠 곳을 알린다(질문 이동인지는 서버가 판정한다).
        if ((fileIds?.length || options) && linkedComment === undefined) {
          throw new Error('fileIds·options 는 질문 이동(ask)의 의견(질문 글)과 함께 보내야 합니다.');
        }
        // 담당을 모두 id 로 푼 뒤에 서버를 부른다(me 별칭·프로젝트 멤버 확인은 다른 이슈 도구와 같은 resolveAssigneeIds).
        // 일부만 풀린 채 이동하면 담당이 조용히 빠지므로, 못 찾으면 서버를 부르기 전에 던진다.
        const assigneeIds = assignees?.length ? await resolveAssigneeIds(client, parseIssueKey(issueKey).projectKey, assignees) : undefined;
        const body: MoveWorkflowBody = {
          fromNode,
          outcome,
          ...(outputs != null && { outputs }),
          ...(assigneeIds && { assigneeIds }),
          ...(linkedComment !== undefined && { comment: linkedComment }),
          expectedRevision,
          // 같은 노드·revision·결과의 재시도를 한 번의 이동으로 만든다(Global Constraints 규칙 그대로).
          idempotencyKey: `${issueKey}:${fromNode}:${expectedRevision}:${outcome}`,
          // 준 때만 싣는다 — 빠지면 서버가 지금 실행을 겨눈 것으로 본다(하위 호환).
          ...(runId != null && { runId }),
          ...(fileIds?.length && { fileIds }),
          ...(options && { options }),
        };
        return viewJson(await client.moveIssueWorkflow(issueKey, body), client);
      },
    },
    {
      name: 'get_workflow',
      app: 'project',
      kind: 'read',
      description: 'Project workflows; with name: draft YAML, its problems, and published YAML if different.',
      inputSchema: getWorkflowInput,
      async handler(args) {
        const { projectKey, name } = getWorkflowInput.parse(args);
        const rows = await client.listWorkflows(projectKey);
        if (!name) {
          return JSON.stringify({
            workflows: rows.map((w) => ({ name: w.name, enabled: w.enabled, activeVersionNo: w.activeVersionNo, draftChanged: w.draftChanged })),
          });
        }
        const summary = pickWorkflow(rows, name);
        const d = await client.getWorkflow(summary.id);
        const active = d.activeVersion;
        // 게시본은 상세의 activeVersion.no 로 읽어 상세 draftYaml 과 다를 때만 싣는다 — 목록 값(activeVersionNo·draftChanged)은
        // 그사이 게시·초안 저장으로 낡을 수 있어 쓰지 않는다. 번호가 상세에 있어 두 호출은 차례로 한다.
        const versionYaml = active != null ? await client.getWorkflowVersionYaml(summary.id, active.no) : undefined;
        const publishedYaml = versionYaml !== d.draftYaml ? versionYaml : undefined;
        return JSON.stringify({
          name: d.name,
          enabled: d.enabled,
          activeVersionNo: active?.no ?? null,
          publishedAt: active?.createdAt ?? null,
          publishedBy: active?.createdBy ? toUserRef(active.createdBy) : null,
          draftYaml: d.draftYaml,
          // update_workflow 의 expectedDraftUpdatedAt 으로 되보낼 값 — 그사이 남이 바꾼 초안을 덮지 않게.
          draftUpdatedAt: d.draftUpdatedAt,
          draftProblems: formatProblems(d.draftProblems ?? []),
          ...(publishedYaml !== undefined && { publishedYaml }),
        });
      },
    },
    {
      name: 'validate_workflow',
      app: 'project',
      kind: 'read',
      description: 'Checks workflow YAML without saving; ok is false on any ERROR.',
      inputSchema: validateWorkflowInput,
      async handler(args) {
        const { projectKey, yaml } = validateWorkflowInput.parse(args);
        const { problems } = await client.validateWorkflow(projectKey, yaml);
        return JSON.stringify({ ok: !hasError(problems), problems: formatProblems(problems) });
      },
    },
    {
      name: 'update_workflow',
      app: 'project',
      kind: 'write',
      // 같은 YAML 을 다시 저장하면 결과가 같지만 publish 는 부를 때마다 새 버전을 만든다 — 멱등이 아니다.
      // 초안을 덮어쓰지만 게시본·지난 버전은 남아 되돌릴 수 있어 destructive 는 아니다.
      hints: { destructive: false, idempotent: false },
      description:
        'Saves workflow YAML as draft by name; creates the workflow if the name is new (not when expectedDraftUpdatedAt is given). publish: true publishes unless errors; ' +
        "publishing needs project manage permission. expectedDraftUpdatedAt (get_workflow's draftUpdatedAt) avoids overwriting others' edits.",
      inputSchema: updateWorkflowInput,
      async handler(args) {
        const { projectKey, name, yaml, publish, expectedDraftUpdatedAt } = updateWorkflowInput.parse(args);
        const rows = await client.listWorkflows(projectKey);
        const found = findWorkflowByName(rows, name);
        if (found === 'ambiguous') throw ambiguousNameError(rows, name);
        // 본 초안 시각을 줬다는 것은 있는 초안을 고친다는 뜻이다 — 이름을 못 찾았는데 새로 만들면 오타 난 이름으로 워크플로우가 하나 더 생긴다.
        if (found === null && expectedDraftUpdatedAt != null) {
          throw new Error(`이름 ${name} 의 워크플로우가 없습니다 — get_workflow 로 이름을 확인하세요 (있는 것: ${namesOf(rows)})`);
        }
        const { id, created, problems, draftUpdatedAt } = await saveOrCreate(client, found, projectKey, name, yaml, expectedDraftUpdatedAt ?? undefined);
        const base = { saved: true, created };
        const lines = formatProblems(problems);
        if (!publish) return JSON.stringify({ ...base, problems: lines });
        // 오류가 있으면 서버가 어차피 422 로 거절한다 — 부르지 않고 이유와 문제 줄만 돌려준다.
        if (hasError(problems)) {
          return JSON.stringify({ ...base, published: false, reason: '오류가 있어 게시하지 않았습니다.', problems: lines });
        }
        // 방금 저장한 초안 시각을 넘겨, 그사이 다른 사람이 초안을 바꿨으면 서버가 409 로 거절하게 한다(남의 초안이 게시되는 것을 막음).
        const result = await client.publishWorkflow(id, draftUpdatedAt).catch(rethrowPublishError);
        return JSON.stringify({
          ...base,
          published: true,
          versionNo: result.versionNo,
          runningRunsOnOlderVersions: result.runningRunsOnOlderVersions,
          problems: lines,
        });
      },
    },
  ];
}
