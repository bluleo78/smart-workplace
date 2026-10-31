// src/schemas.ts — 이슈 도구 입력 zod 스키마. 두 앱 공유(기존 중복 제거).
import { z } from 'zod';
import { AGENT_WORK_STATE_INPUTS } from './tool-client.js';
import { nullAsOmitted } from './tool-definitions.js';

/**
 * 이슈 본문·코멘트 본문 최대 길이(WP-885) — API IssueTextLimits.BODY_MAX·웹 ISSUE_BODY_MAX_LENGTH 와 같은 값.
 * Jira 이전 데이터(본문 2.5만자·코멘트 3.1만자)를 담으려 1만에서 5만으로 올렸다. 이슈 본문이 되는 메일 승격·채팅 제안 도구도 같이 쓴다.
 */
export const ISSUE_BODY_MAX_LENGTH = 50000;

/**
 * 이슈 우선순위 5단계(WP-886) — 표시 순서(매우 높음 → 매우 낮음). API IssuePriorities.ORDER·웹 ISSUE_PRIORITIES·DB CHECK(V211) 와 같다.
 * 모든 프로젝트 공통 고정 값. 이슈 생성·수정·목록 필터·메일 승격·채팅 제안 도구가 이 한 목록을 쓴다(따로 적던 4곳이 어긋나지 않게).
 */
export const ISSUE_PRIORITIES = ['HIGHEST', 'HIGH', 'MID', 'LOW', 'LOWEST'] as const;
/** 우선순위 입력 스키마 — 영어 대문자 열거값만(#403: 한국어 「높음」 입력 차단). */
export const issuePriorityInput = z.enum(ISSUE_PRIORITIES);

/** upload_file 로 스테이징한 파일 id 목록(WP-422) — 이슈·메시지 쓰기 도구가 첨부 입력(fileIds)으로 같이 쓴다. 한 요청 10개는 서버 상한과 같다. */
export const stagedFileIdsInput = z.array(z.number().int().positive()).max(10).describe('Staged files from upload_file to attach');

/** issueKey 만 받는 최소 입력. */
export const issueKeyInput = z.object({ issueKey: z.string().min(1) });

/**
 * watch_issue 입력(WP-421) — 구독·해제를 한 도구로 합쳤다. watching 은 최종 상태라 필수다(빠뜨리면 어느 쪽인지 모호해 거절,
 * 같은 값을 다시 보내도 결과가 같아 멱등).
 */
export const watchIssueInput = issueKeyInput.extend({
  watching: z.boolean().describe('true watches, false stops watching'),
});

/**
 * claim_issue 입력(WP-800) — 가져갈 이슈와 대기열 라벨 이름. 라벨 이름은 프로젝트마다 다를 수 있어 코드에 박지 않고 호출자가 넘긴다
 * (work-loop 기본값 "AI 개발팀"). max 40 은 서버 ClaimIssueRequest·라벨 이름 컬럼(VARCHAR(40))과 같다.
 */
export const claimIssueInput = issueKeyInput.extend({
  queueLabel: z.string().min(1).max(40).describe('Queue label name on the issue, e.g. "AI 개발팀"'),
});

/** get_issue_detail 입력 — issueKey 에 코멘트 전체 읽기(allComments)를 더했다(WP-353: 기본은 최근 30건, allComments 는 최근 200건까지). */
export const getIssueDetailInput = issueKeyInput.extend({
  allComments: z.boolean().optional(),
});

/** 이슈 생성 입력 — projectKey 필수(위임 컨텍스트 없이 대상 프로젝트 명시). */
export const createIssueInput = z.object({
  projectKey: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().max(ISSUE_BODY_MAX_LENGTH).optional(),
  priority: issuePriorityInput.optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.string().optional(), // 유형 이름(예: BUG) → typeId 리졸브
  assignees: z.array(z.string()).optional(), // username[] → assigneeIds 리졸브
  parent: z.string().min(1).describe('Parent issue key (same project, or an EPIC in another project)').optional(), // 부모 이슈 키(WP-12) — 같은 프로젝트면 번호로, 다른 프로젝트 에픽이면 키로 서버에 보낸다(#833, WP-353, WP-1038)
  // WP-356: 라벨·마일스톤·사이클 이름 → id. 서버가 생성과 같은 트랜잭션에서 붙인다(생성 후 update_issue 를 따로 부를 필요 없음).
  labels: z.array(z.string()).optional(),
  components: z.array(z.string()).optional(), // WP-933: 구성요소 이름[] → componentIds (없는 이름은 만들지 않고 실패)
  fixVersions: z.array(z.string()).optional(), // WP-888: 수정 버전 이름[] — 생성 뒤 PUT versions 로 붙인다(없는·보관 이름은 만들기 전에 실패)
  affectsVersions: z.array(z.string()).optional(), // WP-888: 영향 버전 이름[]
  milestone: z.string().min(1).optional(),
  cycles: z.array(z.string()).optional(),
  fileIds: stagedFileIdsInput.optional(), // WP-422: 생성은 같은 트랜잭션, 수정은 클레임 API 로 붙는다
});

/** 이슈 부분 수정 입력 — 전달 필드만 변경. */
export const updateIssueInput = z.object({
  issueKey: z.string().min(1),
  title: z.string().max(200).optional(),
  body: z.string().max(ISSUE_BODY_MAX_LENGTH).optional(),
  priority: issuePriorityInput.optional(),
  // WP-807·WP-870: 범주 또는 프로젝트 상태 이름 — 핸들러가 범주는 status, 이름은 statusName 으로 보내 서버가 해석한다. 설명은 크기 상한 때문에 영어 짧은 문구.
  status: z.string().min(1).optional().describe('TODO/IN_PROGRESS/DONE/CANCELED or a status name'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  clearDueDate: z.boolean().optional(),
  clearStartDate: z.boolean().optional(),
  type: z.string().optional(), // 유형 이름 → typeId
  parent: z.string().min(1).nullable().describe('Parent issue key (same project, or an EPIC in another project); null clears').optional(), // 이슈 키(WP-12)=설정, null=해제, 생략=변경없음. 다른 프로젝트는 에픽만(WP-1038)
  assignees: z.array(z.string()).optional(), // username[] → 집합 교체
  // WP-944: 보고자 username(me=호출자) → PUT .../reporter. 프로젝트 OWNER·ADMIN·지금 보고자만, 사람만 — 서버가 거절하면 results.reporter 실패.
  reporter: z.string().min(1).optional(),
  labels: z.array(z.string()).optional(), // 라벨명[] → 집합 교체
  components: z.array(z.string()).optional(), // WP-933: 구성요소명[] → 집합 교체([] = 전부 해제)
  fixVersions: z.array(z.string()).optional(), // WP-888: 수정 버전명[] → 그 종류만 집합 교체([] = 전부 해제), 생략 = 유지
  affectsVersions: z.array(z.string()).optional(), // WP-888: 영향 버전명[] → 그 종류만 집합 교체
  milestone: z.string().min(1).nullable().describe('null clears').optional(), // 마일스톤 이름 → milestoneId, null=해제(#854)
  cycles: z.array(z.string()).optional(), // 사이클명[] → 집합 교체, []=전부 해제(#854)
  // WP-356: 커스텀 필드 값(필드 이름 → 값, null=비우기). 준 필드만 바뀐다(PUT .../fields 는 incoming 만 처리).
  fields: z
    .record(z.string(), z.unknown())
    .describe('Custom field values by name (string[] for MULTI_SELECT, null clears)')
    .optional(),
  // WP-356: 드라이브 파일 연결(POST .../drive-links). 이미 연결돼 있으면 서버가 무시한다.
  driveFileId: z.number().int().positive().describe('Drive (드라이브) file to link').optional(),
  fileIds: stagedFileIdsInput.optional(), // WP-422: 생성은 같은 트랜잭션, 수정은 클레임 API 로 붙는다
});

/** 코멘트 작성 입력. */
export const addCommentInput = z.object({ issueKey: z.string().min(1), body: z.string().min(1).max(ISSUE_BODY_MAX_LENGTH) });

/**
 * AI 작업 보고 입력(WP-377). steps 두 값은 짝으로만 받는다 — 하나만 오면 "3/?" 처럼 의미 없는 진행이 되기 때문.
 * 서버도 같은 규칙으로 검증하지만 MCP 에서 먼저 명확한 메시지로 거절한다.
 */
export const reportAgentWorkInput = z
  .object({
    issueKey: z.string().min(1),
    state: z.enum(AGENT_WORK_STATE_INPUTS).optional(),
    note: z.string().max(120).optional().describe('one-line status; "" clears'), // 한 줄 상태(최대 120자는 스키마가 알린다). 빈 문자열이면 지운다
    progress: z.number().int().min(0).max(100).optional(),
    stepsDone: z.number().int().min(0).optional(),
    stepsTotal: z.number().int().min(1).optional(),
    // 길이(4000자)는 여기서 보지 않는다 — 서버 @Size 는 도구가 @username 을 멘션 토큰(<@id>)으로 바꿔 쓴 뒤의 글에 걸리므로(WP-1009)
    // 판정은 서버에 맡긴다(add_channel_message 와 같은 이유). 한도는 work-on 스킬이 알린다.
    message: z.string().min(1).optional(),
    // 다음 실행 시각(WP-450) — z.iso.datetime 은 긴 pattern 을 JSON Schema 에 싣는 탓에 문자열 + refine. 오프셋 생략 허용(핸들러가 +09:00 보정).
    nextRunAt: z
      .string()
      .refine((v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.test(v) && !Number.isNaN(Date.parse(v)), {
        message: 'nextRunAt must be ISO 8601 date-time (offset optional, default +09:00)',
      })
      .optional()
      .describe('SCHEDULED only; ISO 8601, offset optional (KST). Resend on every SCHEDULED report; omitted = no time'),
    fileIds: stagedFileIdsInput.optional(), // WP-515: message 챗 글에 붙인다 — 시안·검증 스크린샷을 질문·보고와 함께 보이게
  })
  .refine((v) => (v.stepsDone === undefined) === (v.stepsTotal === undefined), { message: 'stepsDone and stepsTotal go together' })
  .refine((v) => v.stepsDone === undefined || v.stepsDone <= (v.stepsTotal ?? 0), { message: 'stepsDone must not exceed stepsTotal' })
  // 서버(ReportAgentWorkRequest)와 같은 규칙 — 시각은 SCHEDULED 일 때만.
  .refine((v) => v.nextRunAt === undefined || v.state === 'SCHEDULED', { message: 'nextRunAt is only allowed with state SCHEDULED' })
  // 서버와 같은 규칙 — 첨부는 message 글에 붙으므로 message 가 있을 때만(없으면 붙일 글이 없다).
  .refine((v) => !v.fileIds?.length || Boolean(v.message?.trim()), { message: 'fileIds need a message to attach to' });

/** 코멘트 수정 입력. */
export const editCommentInput = z.object({
  issueKey: z.string().min(1),
  commentId: z.number().int().positive(),
  body: z.string().min(1).max(ISSUE_BODY_MAX_LENGTH),
});

/** link_issues 입력(WP-812) — 의존성 추가·제거를 한 도구로 합쳤다. linked 는 최종 상태라 필수(빠뜨리면 추가인지 제거인지 모호해 거절, 같은 값을 다시 보내도 결과가 같아 멱등). */
export const linkIssuesInput = z.object({
  issueKey: z.string().min(1),
  otherIssueKey: z.string().min(1),
  direction: z.enum(['blocks', 'blockedBy']),
  linked: z.boolean().describe('true adds the link, false removes it'),
});

/**
 * 관계·외부 링크 추가 입력(WP-887). type 은 관계 유형의 코드(RELATES 등) 또는 이름(관련 등) — get_project 의 relationTypes 가 보여 주는 값이다.
 * otherIssueKey(이슈 사이 관계)와 externalLink(다른 시스템 이슈) 중 정확히 하나만 받는다 — 둘 다/둘 다 없음은 핸들러가 거부한다
 * (최상위가 z.object 여야 해서 유니온 대신 평평한 선택 필드로 두고 핸들러에서 검사한다, createProjectMetaInput 과 같은 이유).
 * 입력 길이는 서버(@Size)가 검증하므로 정의 크기를 아끼려 되풀이하지 않는다.
 */
export const addIssueRelationInput = z.object({
  issueKey: z.string().min(1),
  type: z.string().min(1).describe('Code or name from get_project relationTypes'),
  side: z.enum(['source', 'target']).optional().describe('Directed types: this issue says outwardLabel (source, default) or inwardLabel (target)'),
  otherIssueKey: nullAsOmitted(z.string().min(1)),
  externalLink: nullAsOmitted(z.object({ url: z.string().min(1), key: z.string().optional(), title: z.string().min(1) })),
});

/** 관계·외부 링크 삭제 입력(WP-887) — relationId 와 externalLinkId 중 정확히 하나(get_issue_detail 의 relations[]·externalLinks[]). */
export const removeIssueRelationInput = z.object({
  issueKey: z.string().min(1),
  relationId: nullAsOmitted(z.number().int().positive()),
  externalLinkId: nullAsOmitted(z.number().int().positive()),
});

/**
 * 이슈 목록 필터 shape — list_issues(데이터 조회, 두 앱 공유)와 ai-agent 의 show_issue_list(화면 표시 지시)가 같은 필터 집합을 쓴다(#371).
 * #403: priority 는 영어 대문자 열거값만 — 한국어("높음") 입력 차단.
 * #841: label·type 은 이름, assignee·reporter 는 username 으로 받는다(서버가 해석). 모르는 값은 서버가 400 + 사용 가능 목록을
 * 돌려주므로 LLM 이 그 목록으로 자가교정할 수 있다.
 */
/** assignee 설명 — 공유 필터와 list_issues 확장(any)이 같은 문구를 쓰도록 한 곳에서 만든다(WP-176). */
const assigneeDescription = (extra: string) =>
  `CSV: "me", "null" (unassigned), usernames${extra}. Defaults to "me" when assignee and reporter are both omitted`;

export const issueListFilterShape = {
  projectKey: z.string().optional().describe('Omit for all my projects'),
  // WP-807: 공유 필터(show_issue_list)의 status 는 웹·서버 status 로 그대로 가 범주만 받는다 — 상태 이름 안내는 list_issues 덮어쓰기에만 둔다.
  status: z.string().optional().describe('CSV: TODO,IN_PROGRESS,DONE,CANCELED'),
  priority: z.array(issuePriorityInput).optional(),
  label: z.string().optional().describe('Label names CSV; all must match'),
  component: z.string().optional().describe('Component names CSV; any matches, "none" = no component'),
  fixVersion: z.string().optional().describe('Names CSV; "none"'),
  affectsVersion: z.string().optional().describe('Names CSV; "none"'),
  type: z.string().optional().describe('Type names CSV; any matches'),
  dueFrom: z.string().optional().describe('Due date range, yyyy-MM-dd'),
  dueTo: z.string().optional(),
  // WP-307: 종료일·생성일 범위 — 서버가 Asia/Seoul 하루 경계로 자른다. 값을 그대로 서버에 넘기므로 show_issue_list 도 공유한다.
  closedFrom: z.string().optional().describe('Closed (DONE/CANCELED) date range, yyyy-MM-dd KST, inclusive'),
  closedTo: z.string().optional(),
  createdFrom: z.string().optional().describe('Created date range, yyyy-MM-dd KST, inclusive'),
  createdTo: z.string().optional(),
  q: z.string().optional().describe('Substring of title or body'),
  blocked: z.boolean().optional().describe('Only issues with an unfinished blocker'),
  topLevel: z.boolean().optional().describe('Only issues without a parent'),
  assignee: z.string().optional().describe(assigneeDescription('')),
  reporter: z.string().optional().describe('CSV: "me" or usernames'),
  size: z.number().int().min(1).max(100).optional(),
};

/**
 * list_issues 입력 — 필터를 직접 받는 데이터 조회 도구. 공유 필터에 assignee="any"·cycle 을 더한다(WP-176).
 * 두 값은 도구 핸들러가 서버 쿼리로 바꿔 보내므로, params 를 웹이 그대로 서버에 넘기는 show_issue_list 의 shape 에는 넣지 않는다.
 */
export const listIssuesInput = z.object({
  ...issueListFilterShape,
  // WP-352: 이전 호출이 돌려준 nextCursor 를 그대로 넘기면 다음 페이지다. 웹이 params 를 서버에 직접 넘기는 show_issue_list 의 shape 에는 넣지 않는다.
  // 쓰는 법(같은 필터로 nextCursor 를 넘김)은 도구 설명에 있어 여기서 되풀이하지 않는다(WP-356 크기 정리).
  cursor: z.string().optional(),
  // WP-356 크기 정리: 날짜 범위(…From/…To, yyyy-MM-dd·양끝 포함·종료/생성은 KST)는 list_issues 도구 설명에 한 번만 적고 파라미터 설명은 뺀다.
  // 공유 필터(show_issue_list)의 설명은 그대로 두고 여기서만 덮어쓴다 — 그쪽은 크기 상한 대상이 아니다.
  // WP-807: 상태 설명도 크기 상한 때문에 영어 짧은 문구로 덮는다(뜻은 공유 필터의 한국어 설명과 같다 — 범주는 그 범주 전체, 그 밖은 상태 이름).
  status: z
    .string()
    .optional()
    .describe('CSV: TODO,IN_PROGRESS,DONE,CANCELED or status names, not both'),
  dueFrom: z.string().optional(),
  closedFrom: z.string().optional(),
  createdFrom: z.string().optional(),
  assignee: z
    .string()
    .optional()
    .describe(
      'CSV: me, null (unassigned), any, usernames; default me unless reporter/watching/parent/mentionsMe/sourceKey',
    ),
  cycle: z
    .string()
    .optional()
    .describe(
      'CSV, any match: cycle (사이클) names, active, none, backlog (no active/planned); names/active need projectKey',
    ),
  // WP-356: 아래 넷은 핸들러가 서버 쿼리로 바꾼다(마일스톤 이름→id, 부모 키→번호+projectKey, 필드 이름→fieldId+JSON 값, 워치=호출자).
  milestone: z.string().optional().describe('Milestone names CSV, any match; needs projectKey'),
  parent: z.string().optional().describe('Only children of this issue key'),
  field: z.string().optional().describe('"name=value" custom field match (not MULTI_SELECT); needs projectKey'),
  watching: z.boolean().optional().describe('Only issues I watch'),
  // WP-373·WP-719: 서버 pendingForMe 필터로 바꿔 보낸다 — 내 마지막 글(이슈 챗 글·댓글) 뒤에 남의 글·댓글이 온 이슈.
  pendingForMe: z.boolean().optional().describe('Others posted or commented since my last post'),
  // WP-719: 담당과 무관하게 내 마지막 글 뒤에 나를 멘션한 남의 글이 있는 이슈 — 담당이 아닌 이슈에서 받은 지시를 찾는다.
  mentionsMe: z.boolean().optional().describe('Others @mentioned me since my last post'),
  // WP-1239: 가져올 때 받은 원본 키(예: Jira INFRA-123)와 정확히 같은 이슈 — 서버 sourceKey 필터로 그대로 보낸다. 담당과 무관한 조회라 기본 "me" 를 끈다.
  sourceKey: z.string().optional().describe('Exact import key'),
});

/** get_issue_chat 입력(WP-373). after 는 이전 응답의 next(메시지 id). 생략하면 내 마지막 글 이후 새 글 + 직전 맥락. */
export const getIssueChatInput = z.object({
  issueKey: z.string().min(1),
  after: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/**
 * add_issue_chat 입력(WP-719) — 담당이 아니어도 이슈 챗에 글을 남긴다(멘션받은 질문에 물은 곳에서 답하기). 길이 상한은 두지 않는다 —
 * @username 이 <@id> 로 바뀌며 길이가 달라지므로 변환 뒤 본문을 서버(@Size 4000)가 검증한다(report_agent_work message 와 같다).
 */
export const addIssueChatInput = z.object({ issueKey: z.string().min(1), body: z.string().min(1) });
