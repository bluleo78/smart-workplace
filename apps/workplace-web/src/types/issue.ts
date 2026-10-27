// 이슈/댓글/이력 관련 타입 — 백엔드 DTO 와 1:1 매칭.

import type { IssueAttachment } from './attachment';
import type { ComponentSummary } from './component';
import type { IssueFieldEntry } from './customField';
import type { IssueTypeSummary } from './issueType';
import type { LabelSummary } from './label';
import type { ReactionResponse } from './messaging';
import type { UserSummary } from './user';
import type { VersionSummary } from './version';

export type IssueStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
/**
 * 이슈 우선순위 값 — 표시 순서(매우 높음 → 매우 낮음)로 둔다(WP-886). 모든 프로젝트 공통 고정 5단계이고 서버 IssuePriorities.ORDER·DB CHECK(V211) 와 같다.
 * Jira 이전(Highest·Lowest)과 긴급 결함을 「높음」과 따로 거르려 3단계에서 HIGHEST·LOWEST 를 더했다. 선택지·필터·정렬 순위는 이 배열에서 파생한다.
 */
export const ISSUE_PRIORITIES = ['HIGHEST', 'HIGH', 'MID', 'LOW', 'LOWEST'] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

// 자식 이슈가 응답에 포함하는 부모 요약 (Phase 4a).
export interface ParentRef {
  number: number;
  title: string;
  type: IssueTypeSummary;
  // 부모 이슈의 현재 상태 — 필터로 부모(에픽) 행이 응답에 없어도 취소 여부를 알 수 있게 서버가 싣는다(WP-247).
  // 이력 등 다른 payload 에는 없을 수 있어 선택.
  status?: IssueStatus;
  // 부모의 프로젝트 상태 id·이름·색(WP-869) — 구 서버 응답엔 없어 선택.
  statusId?: number;
  statusName?: string;
  statusColor?: string | null;
  // 부모의 프로젝트 키(WP-1038) — 에픽 부모는 다른 프로젝트에 있을 수 있다. 구 응답·같은 프로젝트면 없을 수 있어 자식 키로 대신한다.
  projectKey?: string | null;
  // 조회자가 읽을 수 없는 프로젝트의 부모(WP-1038) — 번호 0·제목 없음으로 존재만 알린다. 링크·키를 만들지 않는다.
  hidden?: boolean;
}

// 이슈(주로 에픽)의 활성 하위 목록 응답(WP-1038) — 다른 프로젝트 하위는 각자 projectKey 를 싣는다.
// 조회자가 읽을 수 없는 프로젝트의 하위는 items 에서 빠지고 hiddenCount 로만 센다(진행률 childCount 는 모두 센다).
export interface EpicChildrenResponse {
  items: IssueResponse[];
  hiddenCount: number;
}

// 의존성 응답에 임베드되는 이슈 요약 (Phase 4b).
// blockedBy/blocks 양쪽에서 동일 모양으로 사용된다.
export interface IssueLinkSummary {
  number: number;
  title: string;
  status: string;
  type: IssueTypeSummary;
  // 선행 이슈의 마감일 — 후행 이슈 날짜 선택 시 모순(선행보다 이른 날짜) 판정용 (#669, soft 경고 정책).
  dueDate: string | null;
  // 링크된 이슈의 프로젝트 상태 id·이름·색(WP-869) — 구 서버 응답엔 없어 선택.
  statusId?: number;
  statusName?: string;
  statusColor?: string | null;
}

// AI 에이전트 작업 상태 — 서버 AgentWorkState 와 1:1, A2A 1.0 어휘 + 플랫폼 확장(REVIEW·BLOCKED·PAUSED·WAITING·SCHEDULED) (WP-377·WP-450·WP-1024).
// 진행 상태 9종은 어디서나 내려오고, 종료 상태(COMPLETED·FAILED·CANCELED·REJECTED)는 AI 위임 작업 「완료」 보기의
// 대표 작업(진행 중 작업이 없는 이슈의 가장 최근 종료 1건)으로만 내려온다(WP-396).
export type AgentWorkState =
  | 'SUBMITTED'
  | 'WORKING'
  | 'INPUT_REQUIRED'
  | 'AUTH_REQUIRED'
  | 'REVIEW'
  | 'BLOCKED'
  | 'PAUSED'
  | 'WAITING'
  | 'SCHEDULED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'REJECTED';

// 이슈에 걸린 AI 작업 한 건 — 서버가 급한 순(대표 먼저)으로 내려준다. 종료 작업은 /me/ai-tasks 완료 보기의 대표 1건뿐(WP-396).
export interface AgentWorkView {
  worker: UserSummary;
  // 시작 전(SUBMITTED) 행은 아직 도구를 몰라 null.
  tool: string | null;
  state: AgentWorkState;
  note: string | null;
  progress: number | null;
  stepsDone: number | null;
  stepsTotal: number | null;
  startedAt: string;
  updatedAt: string;
  // 작업 중(WORKING)인데 2시간 넘게 보고가 없으면 true.
  stale: boolean;
  // 다음 회차 대기(SCHEDULED)인데 예정 시각이 2시간 넘게 지나도록 시작하지 않았으면 true(WP-450).
  overdue?: boolean;
  // 다음 회차 시작 예정 시각(ISO) — SCHEDULED 에서만 의미가 있다. 없으면 「다른 작업 뒤 이어서」(WP-450).
  nextRunAt?: string | null;
  // 종료 시각 — 종료 작업(완료 보기의 대표)만, 진행 중이면 서버가 생략한다(WP-396).
  endedAt?: string;
}

/** AI 위임 작업 행의 에픽 묶음(WP-375) — /me/ai-tasks 만 싣는다. size 2 이상이면 화면이 묶음 머리를 그린다. */
export interface AiTaskGroup {
  epicNumber: number
  size: number
  epicChildCount: number
  epicChildDoneCount: number
}

/** AI 위임 작업 행의 프로젝트 정보(WP-426) — /me/ai-tasks 만 싣는다. size 는 필터 적용 후 그 프로젝트의 전체 행 수(불러온 수가 아님). */
export interface AiTaskProject {
  name: string
  size: number
}

export interface IssueResponse {
  id: number;
  projectKey: string;
  number: number;
  title: string;
  // 상태 범주 — 종료 판정·아이콘·통계는 범주로 한다.
  status: IssueStatus;
  // 프로젝트 상태 id·이름(WP-808) — 화면에 보이는 상태는 이름이고, 보드 컬럼·필터는 id 로 나눈다.
  statusId: number;
  statusName: string;
  // 상태 색 토큰(WP-809) — 아이콘 색. 구 서버 응답엔 없어 선택(없으면 범주 색).
  statusColor?: string | null;
  priority: IssuePriority;
  dueDate: string | null;
  // 타임라인 간트 뷰 시작일 (#620).
  startDate: string | null;
  // 연결된 마일스톤 id — 없으면 null (#620).
  milestoneId: number | null;
  // 마일스톤 이름 — 없으면 null (WP-307, AI 도구용).
  milestoneName?: string | null;
  reporterId: number;
  // 보고자 요약 — 목록 응답이 싣는다(WP-270 보고자 열). 모르는 사용자면 서버가 생략하고, 롤링 배포 중 구버전 응답에도 없어 optional.
  reporter?: UserSummary | null;
  // 이슈가 속한 사이클 요약 — 목록 응답이 싣는다(WP-270 사이클 열). 구버전 응답엔 없어 optional.
  cycles?: { id: number; name: string; status: string }[];
  createdAt: string;
  updatedAt: string;
  // 종료(DONE·CANCELED) 진입 시각 — 재오픈 시 null (WP-307).
  // 목록·카드·상세의 완료 표기(WP-873)와 완료일 열·필터가 쓴다. 구버전 응답엔 없을 수 있어 optional.
  closedAt?: string | null;
  // #611 낙관적 동시성 토큰 — 수정 요청에 실어 보내면 그 사이 다른 편집이 있었을 때 서버가 409 로 알린다.
  version?: number;
  // 부착된 라벨 — 백엔드가 항상 배열로 내려준다 (없으면 빈 배열).
  labels: LabelSummary[];
  // 붙은 구성요소(WP-933, 목록 순서) — 구버전 서버(롤링 배포 중) 응답엔 없어 optional(읽을 때 `?? []`).
  components?: ComponentSummary[];
  // 붙은 수정 버전·영향 버전(WP-888, 목록 순서) — 구버전 서버 응답엔 없어 optional(읽을 때 `?? []`).
  fixVersions?: VersionSummary[];
  affectsVersions?: VersionSummary[];
  // 에픽 색 토큰(WP-1017, 라벨과 같은 12색) — 에픽에 쓴다. 에픽에서 다른 유형으로 바뀐 이슈도 옛 색을 실을 수 있어 읽는 쪽은 유형이 EPIC 일 때만 쓴다.
  // 색을 정하기 전 에픽·구버전 응답엔 없어 optional(없으면 유형 색).
  epicColor?: string | null;
  // 이슈에 부착된 첨부 개수 — N+1 회피용 카운트 (목록 카드 표시).
  attachmentCount: number;
  // 이슈 유형 요약 — 검색·상세 응답에는 항상 채워지지만,
  // POST /issues 응답(생성 직후) 은 null 일 수 있다. list 재조회 시 채워진다.
  type: IssueTypeSummary | null;
  // 다중 담당자 — Phase 3c. 항상 배열 (없으면 빈 배열).
  assignees: UserSummary[];
  // SUBTASK 일 때만 채워지는 부모 요약 (Phase 4a).
  parent: ParentRef | null;
  // 이 이슈를 부모로 가진 자식 SUBTASK 수 (비SUBTASK 만 0 초과 가능).
  childCount: number;
  // 자식 중 DONE 인 SUBTASK 수 — 진행률 표시용.
  childDoneCount: number;
  // 이 이슈를 차단(blocking) 하는 의존성 — 선행 완료 필요 (Phase 4b).
  blockedBy: IssueLinkSummary[];
  // 이 이슈가 차단(blocking) 중인 이슈들 (Phase 4b).
  blocks: IssueLinkSummary[];
  // blockedBy 중 미완료 이슈 존재 여부 — 헤더 ⛔ 배지/카드 마커 분기 (Phase 4b).
  blocked: boolean;
  // 프로젝트 커스텀 필드의 현재 값 목록 (Phase 4c). 정의는 있는데 값이 없는 필드는 빠진다.
  customFields: IssueFieldEntry[];
  // AI 진행 중인 작업 목록(WP-377) — 없으면 생략.
  agentWork?: AgentWorkView[];
  // AI 위임 작업(WP-375) — 에픽 묶음 정보. 묶이지 않은 단독 행은 생략.
  aiGroup?: AiTaskGroup | null;
  // AI 위임 작업(WP-426) — 프로젝트 이름·건수. 이 목록 밖에서는 생략.
  aiProject?: AiTaskProject | null;
  // 내 작업 묶음(WP-915) — 이 목록 밖에서는 생략.
  projectGroup?: AiTaskProject | null;
}

export interface IssueCommentResponse {
  id: number;
  issueId: number;
  authorId: number;
  authorName: string;
  // HUMAN (사람) | AGENT (AI). 백엔드 user.kind 와 1:1 (V14). AGENT 코멘트는 UI 에서 시각 구분.
  authorKind: 'HUMAN' | 'AGENT';
  body: string;
  createdAt: string;
  updatedAt: string;
  // 이모지별 반응 집계(WP-504) — 채팅 메시지와 같은 모양. 구버전 서버(롤링 배포 중)는 빠뜨릴 수 있어 읽을 때 `?? []`.
  reactions: ReactionResponse[];
}

export type IssueHistoryEventType =
  | 'TITLE_CHANGED'
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'ASSIGNEE_CHANGED'
  | 'ASSIGNEES_CHANGED'
  | 'DUE_DATE_CHANGED'
  | 'LABELS_CHANGED'
  | 'ATTACHMENTS_CHANGED'
  | 'TYPE_CHANGED'
  // 부모 변경/해제 (Phase 4a).
  | 'PARENT_CHANGED'
  // 의존성 추가/제거 (Phase 4b).
  | 'DEPENDENCY_ADDED'
  | 'DEPENDENCY_REMOVED'
  // 커스텀 필드 값 변경 (Phase 4c).
  | 'CUSTOM_FIELD_CHANGED'
  // 타임라인 간트 뷰 시작일/마일스톤 변경 (#620).
  | 'START_DATE_CHANGED'
  | 'MILESTONE_CHANGED'
  // 상태 삭제로 이슈가 다른 상태로 옮겨짐(WP-809) — 이름 전후는 from/toValue.
  | 'STATUS_MIGRATED'
  // 보고자 변경(WP-944) — from/to 는 이전·새 보고자 이름.
  | 'REPORTER_CHANGED'
  // 이슈 사이 관계 추가·삭제(WP-887) — 두 이슈 모두에 남는다. toValue = {typeId, label, other:{projectKey,number,title}|{hidden:true}}.
  | 'RELATION_ADDED'
  | 'RELATION_REMOVED'
  // 외부 링크 추가·수정·삭제(WP-887). toValue = {label, key, title, url}, 수정이면 fromValue 에 이전 값.
  | 'EXTERNAL_LINK_ADDED'
  | 'EXTERNAL_LINK_UPDATED'
  | 'EXTERNAL_LINK_REMOVED'
  // 구성요소 추가·제거(WP-933). toValue = {added:[{id,name}], removed:[{id,name}]} — 당시 이름.
  | 'COMPONENTS_CHANGED'
  // 수정 버전·영향 버전 추가·제거(WP-888). toValue = {added:[{id,name}], removed:[{id,name}]} — 당시 이름.
  | 'FIX_VERSIONS_CHANGED'
  | 'AFFECTS_VERSIONS_CHANGED';

export interface IssueHistoryEntry {
  id: number;
  actorId: number;
  actorName: string;
  // HUMAN | AGENT. 타임라인에서 AGENT 행은 시각 구분.
  actorKind: 'HUMAN' | 'AGENT';
  eventType: IssueHistoryEventType;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

// AI가 탐지한 블로커 배지 — type 별 심각도가 다르다(BLOCKED>OVERDUE>STALE).
export interface IssueBlockerBadge {
  type: 'BLOCKED' | 'OVERDUE' | 'STALE';
  message: string;
}

// 이슈 AI 즉각 컨텍스트 — 백엔드 #517 Task 5/6 완료 후 채워짐. 카드 컴포넌트는 null/undefined 면 미렌더.
export interface IssueAiContext {
  summary: string | null;
  nextAction: string | null;
  generatedAt: string | null;
  blockers: IssueBlockerBadge[];
}

export interface IssueDetailResponse {
  summary: IssueResponse;
  body: string | null;
  comments: IssueCommentResponse[];
  history: IssueHistoryEntry[];
  // 이슈에 부착된 첨부 목록 — 상세 진입 시 함께 응답.
  attachments: IssueAttachment[];
  // AI 즉각 컨텍스트 (#517) — 백엔드 미완료 시 undefined. 카드는 graceful하게 미렌더.
  aiContext?: IssueAiContext | null;
  // 서버가 내려주는 뷰어 권한 플래그 — 클라이언트에서 재파생하지 않는다.
  // OPEN reporter: viewerCanEditContent=true, viewerCanEditWorkflow=false, viewerCanDelete=true(본인 작성)
  viewerCanEditContent: boolean;   // 제목·본문 편집 가능 (멤버 또는 OPEN reporter)
  viewerCanEditWorkflow: boolean;  // 상태·우선순위·유형·담당자 변경 가능 (멤버만)
  viewerCanDelete: boolean;        // 이슈 삭제 가능 (reporter 또는 OWNER)
  // 보고자(만든 사람) 요약 (WP-272) — 사용자 행이 없으면 null. 구버전 서버(롤링 배포 중)는 undefined 일 수 있다.
  reporter?: UserSummary | null;
  // 보고자를 바꿀 수 있는지(WP-944) — 프로젝트 OWNER·ADMIN 또는 지금 보고자. 구버전 서버는 undefined(읽기 전용으로 둔다).
  viewerCanChangeReporter?: boolean;
  // 이슈 사이 관계(차단 제외, WP-887) — 조회자가 상대 프로젝트를 읽을 수 있는 것만. 구버전 서버엔 없어 optional(읽을 때 `?? []`).
  relations?: IssueRelationView[];
  // 다른 시스템 이슈로 가는 외부 링크(WP-887). 구버전 서버엔 없어 optional.
  externalLinks?: IssueExternalLinkView[];
}

// ── 이슈 관계(WP-887) ──────────────────────────────────────────────────────────────────

/**
 * 관계 유형 — 워크스페이스 공통. 기본 유형은 code(BLOCKS·RELATES …)가 있고, 관리자가 만든 유형은 code 가 null.
 * 말(label)은 「이 이슈는 ___」의 서술어 — 방향이 있으면 A 쪽(outward)·B 쪽(inward) 두 개, 없으면 outward 하나.
 */
export interface IssueRelationType {
  id: number;
  code: string | null;
  name: string;
  directed: boolean;
  outwardLabel: string;
  inwardLabel: string | null;
  // 외부 링크에만 쓰는 유형(상위 에픽) — 우리 이슈끼리는 걸 수 없다.
  externalOnly: boolean;
  // 숨긴 유형 — 새로 걸 수 없고 이미 걸린 관계는 그대로 보인다.
  hidden: boolean;
  sortOrder: number;
}

/** 관리 화면용 유형 — 쓰이는 곳 수(내부 관계·외부 링크)를 더한다. */
export interface IssueRelationTypeAdmin extends IssueRelationType {
  relationCount: number;
  externalLinkCount: number;
}

/** 사용자 정의 유형 추가·편집 본문. 방향이 없으면 inwardLabel 은 null. */
export interface SaveIssueRelationTypeRequest {
  name: string;
  directed: boolean;
  outwardLabel: string;
  inwardLabel: string | null;
}

/** 관계에서 이 이슈가 A 쪽(source)인지 B 쪽(target)인지 — 방향 없는 유형은 무시된다. */
export type IssueRelationSide = 'source' | 'target';

/** 관계 상대 이슈 요약 — 다른 프로젝트일 수 있어 projectKey 를 싣는다. */
export interface RelatedIssueSummary {
  projectKey: string;
  number: number;
  title: string;
  status: string;
  type: IssueTypeSummary | null;
}

/** 이슈 상세의 관계 한 줄. label 은 이 이슈 쪽 말, side 는 이 이슈가 어느 쪽인지(방향 없는 유형은 늘 source). */
export interface IssueRelationView {
  id: number;
  typeId: number;
  typeCode: string | null;
  label: string;
  side: IssueRelationSide;
  issue: RelatedIssueSummary;
}

/** 이슈 상세의 외부 링크 한 줄. key 는 선택(Jira 키 등). side 는 이 이슈가 어느 쪽인지(방향 없는 유형은 늘 source). */
export interface IssueExternalLinkView {
  id: number;
  typeId: number;
  typeCode: string | null;
  label: string;
  side: IssueRelationSide;
  url: string;
  key: string | null;
  title: string;
}

/** 관계 대상 찾기 결과 한 건 — 현재 이슈 자신도 섞일 수 있어 화면이 거른다. */
export type IssueLookupItem = RelatedIssueSummary;

/** 관계 추가 본문 — target 은 상대 이슈(다른 프로젝트 가능). */
export interface AddIssueRelationRequest {
  typeId: number;
  side: IssueRelationSide;
  target: { projectKey: string; number: number };
}

/** 외부 링크 추가·수정 본문. 수정 때 side 를 빼면 저장된 방향을 지킨다(URL 은 수정에서 무시). */
export interface SaveIssueExternalLinkRequest {
  typeId: number;
  side?: IssueRelationSide;
  url?: string;
  key?: string | null;
  title: string;
}

export interface CreateIssueRequest {
  title: string;
  body?: string;
  priority?: IssuePriority;
  dueDate?: string;
  // 다중 담당자 — Phase 3c. 생략/빈배열/null 모두 "지정 안함" 의미.
  assigneeIds?: number[] | null;
  // 이슈 유형 id — 생략 시 백엔드가 TASK 로 fallback.
  typeId?: number | null;
  // 같은 프로젝트 부모 number — SUBTASK 의 부모 태스크, 일반 이슈의 상위 에픽(Phase 4a). EPIC 에 동봉하면 400.
  parentNumber?: number | null;
  // 다른 프로젝트 에픽을 상위 에픽으로 둘 때의 부모 키(예: PLAN-3, WP-1038) — 일반 이슈만. parentNumber 와 함께 보내지 않는다.
  parentKey?: string;
  // 타임라인 간트 뷰 시작일 (#620).
  startDate?: string;
  // 처음 상태(WP-464) — 보드 컬럼의 「이슈 추가」가 그 컬럼 상태로 만든다. 생략 시 할 일. 할 일 외 지정은 멤버 전용.
  status?: IssueStatus;
  // 처음 프로젝트 상태 id(WP-808) — status(범주)보다 우선한다.
  statusId?: number;
  // 구성요소 id(WP-933) — 구성원만. 담당자 없이 만들면 서버가 구성요소 담당자를 자동으로 붙인다.
  componentIds?: number[];
}

export interface UpdateIssueRequest {
  title?: string;
  body?: string;
  status?: IssueStatus;
  // 프로젝트 상태 id(WP-808) — status(범주)보다 우선한다.
  statusId?: number;
  priority?: IssuePriority;
  dueDate?: string;
  // dueDate 단독 비우기 플래그 — true 면 dueDate 무시.
  clearDueDate?: boolean;
  // 타임라인 간트 뷰 시작일 (#620).
  startDate?: string;
  // startDate 단독 비우기 플래그 — true 면 startDate 무시.
  clearStartDate?: boolean;
  // 연결할 마일스톤 id.
  milestoneId?: number;
  // milestoneId 단독 비우기(연결 해제) 플래그.
  clearMilestone?: boolean;
  // #611 마지막으로 읽은 이슈 version — 생략하면 서버가 충돌 검사를 하지 않는다.
  version?: number;
}

export interface CreateCommentRequest { body: string }
export interface UpdateCommentRequest { body: string }

// 이슈 검색 응답 — cursor 기반 페이지네이션.
export interface IssueSearchResponse {
  items: IssueResponse[];
  nextCursor: string | null;
  hasMore: boolean;
}

// 필터 상태 — URL 의 SearchParams 와 1:1 매핑되는 정규화된 형태.
export interface IssueFilters {
  q: string;
  // 「상태 범주」 필터 — 범주 값(TODO·IN_PROGRESS·DONE·CANCELED) OR. URL·서버 키는 예전 그대로 status.
  statuses: string[];
  // 「상태」 필터 — 프로젝트 상태 id OR(WP-808). URL·서버 키 statusId. 범주 필터와는 AND 로 묶인다.
  statusIds: number[];
  priorities: string[];
  assigneeIds: number[];
  includeUnassigned: boolean;
  dueFrom: string | null;
  dueTo: string | null;
  // 다중 라벨 AND 필터 — 모든 라벨이 부착된 이슈만 매칭.
  labelIds: number[];
  // 다중 사이클 OR 필터 — 선택된 사이클 중 하나에 속한 이슈 매칭.
  cycleIds: number[];
  // 구성요소 OR 필터(WP-933) — 고른 구성요소 중 하나라도 붙은 이슈. URL·서버 키 component.
  componentIds: number[];
  // 「구성요소 없음」 — component 파라미터의 none 토큰. componentIds 와 OR.
  componentNone: boolean;
  // 수정 버전·영향 버전 OR 필터(WP-888) — URL·서버 키 fixVersion·affectsVersion. 두 필터는 서로 AND, 각 none 토큰은 그 필터의 id 와 OR.
  fixVersionIds: number[];
  fixVersionNone: boolean;
  affectsVersionIds: number[];
  affectsVersionNone: boolean;
  // 다중 마일스톤 OR 필터 — 선택된 마일스톤 중 하나에 연결된 이슈 매칭 (#620).
  milestoneIds: number[];
  // 다중 유형 OR 필터 — 선택된 유형 중 하나에 속한 이슈 매칭.
  typeIds: number[];
  // 특정 부모(번호) 의 자식만 보기 (Phase 4a) — UI 노출은 deferred, URL 직렬화만.
  parentNumber: number | null;
  // 최상위(부모 없는) 이슈만 보기 (Phase 4a) — URL 에 topLevel=true 로 명시될 때만 켜진다(에픽 패널 「에픽 미할당」).
  topLevel: boolean;
  // 차단된(blocked) 이슈만 보기 (Phase 4b) — UI 노출 deferred, URL 직렬화만.
  blocked: boolean;
  // SUBTASK 유형 이슈를 목록에서 제외 — 목록 뷰 기본값(에픽 자식 등 비SUBTASK 는 유지).
  excludeSubtasks: boolean;
  // EPIC 유형 이슈 제외 — URL 로 직렬화하지 않는 파생 필드. 보드·목록 기본 범위(withDefaultIssueScope)만 주입한다.
  excludeEpics?: boolean;
  // 완료일 기간(WP-873) — 프리셋 토큰('last-week' 등) 또는 'YYYY-MM-DD~YYYY-MM-DD'. URL closedIn. 서버엔 closedFrom/closedTo 로 풀어 보낸다.
  closedIn: string | null;
  // 「완료 모두 보기」 토글 — URL closed=all. 끄면(기본) 활성 사이클 밖 종료 이슈를 보드·목록에서 숨긴다(#876).
  showAllClosed: boolean;
  // 활성 사이클 밖 종료(DONE·CANCELED) 이슈 제외 — URL 비직렬화 파생 필드. withDefaultIssueScope 만 주입한다.
  hideInactiveClosed?: boolean;
  // 백로그 이슈 포함 — 진행 중·예정 사이클에 연결되지 않은 이슈(완료 사이클에만 남은 이슈 포함). URL 비직렬화 파생 필드로,
  // 목록 사이클 그룹의 백로그 구간만 주입하며 cycle 파라미터에 'null' 토큰으로 송신한다(#878). 이름은 토큰 도입 당시 그대로 둔다.
  cycleUnassigned?: boolean;
}

// 프로젝트 상세에서 이슈 목록을 표시하는 두 가지 뷰.
export type IssueView = 'list' | 'board';

/** AI 분류 제안 응답 — 폼 채우기 전용, DB 저장 없음 */
export interface IssueAiClassifyResponse {
  /** 제안 유형. 개인 프로젝트면 null */
  type: 'TASK' | 'BUG' | 'STORY' | 'CHORE' | null;
  /** 제안 우선순위 */
  priority: IssuePriority;
  /** 제안 라벨 이름 목록 */
  labels: string[];
  /** 분류 이유 한 문장 */
  reason: string;
}

// 보드/리스트 그룹 기준 (#58). null = 그룹 없음(평탄 리스트 / 상태 보드).
// view 와 동일하게 IssueFilters 와 분리된 URL 쿼리스트링 키('group')로 다룬다.
// 'cycle'(#878)은 팀 목록 전용 — 구간(진행 중·예정·백로그)마다 서버 쿼리를 따로 두므로 클라이언트 그룹핑 대상이 아니다.
export type IssueGroupBy = 'status' | 'assignee' | 'priority' | 'cycle' | 'epic';

// 클라이언트에서 받은 이슈를 묶는 그룹 기준 — 보드·개인 체크리스트·평탄 목록 그룹이 쓴다(cycle 제외).
export type IssueClientGroupBy = Exclude<IssueGroupBy, 'cycle'>;

// 서버가 그룹별 총계를 내는 기준(WP-472) — 에픽 그룹은 「에픽 없음」 필터가 없어 대상이 아니다.
export type IssueCountableGroupBy = Exclude<IssueClientGroupBy, 'epic'>;

// 서버 group-counts 의 groupBy 값 — 프로젝트 목록의 상태 그룹은 statusId 별로 센다(WP-808, 키 = statusId 문자열).
export type IssueGroupCountsBy = IssueCountableGroupBy | 'statusId';

// 목록 그룹별 총계 응답(WP-472). key 는 상태(범주)·statusId·우선순위 값, assignee 면 담당자 user id 문자열(담당자 없음은 null). 0건 그룹은 없다.
export interface IssueGroupCountsResponse {
  groupBy: IssueGroupCountsBy;
  groups: { key: string | null; count: number }[];
}

// URL group 파라미터 원값 — 'none' 은 "그룹 없음" 명시(#878). 부재(null)는 화면별 기본값에 맡긴다.
export type IssueGroupParam = IssueGroupBy | 'none';
