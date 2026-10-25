// src/issue-detail.ts — get_issue_detail 응답을 LLM 노출용 flat 뷰로 정규화.
// 백엔드 IssueDetailResponse = { summary: IssueResponse, body, comments[], history[], attachments[], reporter, ... }.
// WP-307: 예전엔 zod 파싱이 스키마 밖 필드를 조용히 지워 날짜·라벨·마일스톤 등이 빠졌다. 이제 필드를 명시적으로 골라 만들고,
// AI 가 판단에 쓰는 정보(날짜·분류·계층·작성자·커스텀 필드·첨부·변경 이력)를 모두 싣는다.
import { toAgentWorkView, type AgentWorkOut } from './agent-work-view.js';
import { reactionSummary } from './compact.js';
import { formatIssueKey } from './parse.js';
import {
  labelNames,
  toAuthorView,
  toChildrenView,
  statusNameOf,
  toParentView,
  toPeopleView,
  toPersonView,
  toSeoulIso,
  typeName,
  type PersonView,
} from './issue-view.js';

type Raw = Record<string, unknown>;

/** 변경 이력은 최근 것만 싣는다 — 오래된 이슈의 이력이 응답을 키우지 않게. */
export const ISSUE_DETAIL_HISTORY_LIMIT = 30;

/**
 * 코멘트도 최근 것만 싣는다(WP-353). 상한은 이력과 같은 30 — 한 곳의 규칙으로 기억하게 하고, 코멘트는 본문이 길어 이력(짧은 이벤트)보다 상한을 키우면
 * 토큰이 빠르게 불어난다. 이슈 논의는 대개 이보다 짧고, 길어져도 판단에 쓰는 것은 최근 흐름이다. 더 읽으려면 allComments 로 호출한다.
 */
export const ISSUE_DETAIL_COMMENT_LIMIT = 30;

/**
 * allComments:true 의 하드 상한(WP-353). 상한을 아주 풀어도 무제한은 아니다 — 코멘트가 수백 건인 이슈에서 토큰 폭주가 되살아나지 않게
 * 최근 200건까지만 싣고, 더 오래된 것은 commentsOmitted 로 알린다.
 */
export const ISSUE_DETAIL_COMMENT_HARD_LIMIT = 200;

/** 의존성 링크 요약 — 백엔드 IssueLinkSummary(number,title,status,type) 중 LLM 필요분만. 이슈는 어디서나 issueKey 로 가리킨다(WP-353). */
interface IssueLinkView {
  issueKey: string;
  title: string;
  status: string;
  /** 프로젝트 상태 이름(WP-869) — 구 API 면 키가 없다. */
  statusName?: string;
}

/** 이슈 사이 관계 한 줄(WP-887, 차단 제외) — 「이 이슈는 {label} · {issueKey}」. relationId 는 remove_issue_relation 이 쓴다. */
export interface IssueRelationOut {
  relationId: number;
  /** 유형 코드(기본 유형) — 사용자 정의 유형이면 유형 이름(이름을 못 얻으면 label 로 대신해 표시용일 뿐 add_issue_relation 의 type 으로는 못 쓴다). */
  type: string;
  /** 이 이슈 쪽 말(서술어) — 방향 있는 유형은 이 이슈가 A 쪽이면 A 쪽 말, B 쪽이면 B 쪽 말. */
  label: string;
  issueKey: string;
  title: string;
  status: string;
}

/** 외부 링크 한 줄(WP-887) — 다른 시스템(Jira 등)의 이슈. externalLinkId 는 remove_issue_relation 이 쓴다. */
export interface IssueExternalLinkOut {
  externalLinkId: number;
  type: string;
  label: string;
  key: string | null;
  title: string;
  url: string;
}

export interface IssueDetail {
  issueKey: string;
  title: string;
  body: string | null;
  /** 상태 범주(TODO·IN_PROGRESS·DONE·CANCELED). */
  status: string;
  /** 프로젝트 상태 이름(WP-807) — 범주 안의 개별 상태. 서버가 안 주면 null. */
  statusName: string | null;
  priority: string;
  type: string | null;
  assignees: PersonView[];
  reporter: PersonView | null;
  /** 마감일·시작일(yyyy-MM-dd). */
  dueDate: string | null;
  startDate: string | null;
  /** 시각은 Asia/Seoul 오프셋 ISO. closedAt 은 DONE·CANCELED 진입 시각(재오픈 시 null) — 완료/취소 구분은 status. */
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  labels: string[];
  milestone: string | null;
  parent: { issueKey: string; title: string; status: string | null; statusName?: string } | null;
  /** 하위 이슈 진행률(없으면 null). 목록은 list_issues(projectKey, q 등)로. */
  children: { total: number; done: number } | null;
  blockedBy: IssueLinkView[];
  blocks: IssueLinkView[];
  blocked: boolean;
  /** 차단이 아닌 관계(관련·중복·복제·원인 등) — 서버가 읽을 수 없는 상대를 이미 걸러 보낸다(WP-887). 차단은 blockedBy/blocks 에 그대로. */
  relations: IssueRelationOut[];
  /** 다른 시스템 이슈 링크(WP-887). */
  externalLinks: IssueExternalLinkOut[];
  customFields: { name: string; type: string; value: unknown }[];
  attachments: { attachmentId: number; name: string; mimeType: string | null; sizeBytes: number | null; attachedBy: PersonView; attachedAt: string | null }[];
  comments: { id: number; body: string; author: PersonView; createdAt: string | null; updatedAt: string | null; reactions?: Record<string, number> }[];
  /** 코멘트가 상한에 걸려 잘렸을 때만: 빠진 오래된 코멘트 수. 없으면 전부 담긴 것(allComments 로도 200건이 넘으면 생긴다). */
  commentsOmitted?: number;
  /** AI 가 이 이슈에서 하는 작업(WP-377) — 없으면 키가 없다. */
  agentWork?: AgentWorkOut[];
  /** 최근 변경 이력(오래된→최신). from/to 는 상태값 같은 문자열이거나, 집합 변경이면 객체(숫자 id·색 토큰 제외). */
  history: { at: string | null; actor: PersonView; event: string; from: unknown; to: unknown }[];
  /** 이력이 상한에 걸려 잘렸을 때만: 빠진 오래된 이력 수. */
  historyOmitted?: number;
}

/** 이력 payload 에서 뺄 키 — 숫자 id 는 쓰기 도구로 흘려보내지 않고(#833), 색·아이콘은 LLM 에 쓸모없는 토큰이다. */
const HISTORY_DROP_KEYS = new Set(['id', 'defId', 'fileId', 'typeId', 'colorToken', 'icon']);

/** payload 를 JSON 으로 저장하는 이력 이벤트(IssueHistoryRecorder). 그 밖(제목·상태 등)의 값은 '{'·'[' 로 시작해도 평문이다. */
const JSON_PAYLOAD_EVENTS = new Set([
  'LABELS_CHANGED',
  'ASSIGNEES_CHANGED',
  'ATTACHMENTS_CHANGED',
  'TYPE_CHANGED',
  'PARENT_CHANGED',
  'DEPENDENCY_ADDED',
  'DEPENDENCY_REMOVED',
  // WP-887: 관계·외부 링크 이력도 JSON — 서버가 읽을 수 없는 상대는 이미 {hidden:true} 로 가려 보낸다.
  'RELATION_ADDED',
  'RELATION_REMOVED',
  'EXTERNAL_LINK_ADDED',
  'EXTERNAL_LINK_UPDATED',
  'EXTERNAL_LINK_REMOVED',
  'CUSTOM_FIELD_CHANGED',
]);

function stripHistoryKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripHistoryKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Raw)
        .filter(([k]) => !HISTORY_DROP_KEYS.has(k))
        .map(([k, x]) => [k, stripHistoryKeys(x)]),
    );
  }
  return v;
}

/** 이력 값 — JSON payload 이벤트만 객체로 풀어 이중 이스케이프를 없애고 id 류를 뺀다. 평문 이벤트 값은 그대로 둔다. */
function historyValue(event: unknown, v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null;
  if (!JSON_PAYLOAD_EVENTS.has(String(event))) return v;
  try {
    return stripHistoryKeys(JSON.parse(v));
  } catch {
    return v;
  }
}

/** 링크는 같은 프로젝트 이슈(의존성은 프로젝트 안에서만 건다)라 projectKey 를 빌려 issueKey 를 만든다. 키를 못 만들면 번호만 둔다. */
const links = (arr: unknown, projectKey: unknown): IssueLinkView[] =>
  ((arr ?? []) as Raw[]).map((l) => ({
    issueKey: formatIssueKey(projectKey as string | undefined, l.number as number | undefined) ?? String(l.number ?? ''),
    title: l.title as string,
    status: l.status as string,
    ...statusNameOf(l),
  }));

/**
 * 관계·외부 링크의 type — 기본 유형은 코드, 사용자 정의 유형은 이름(typeNames 에서 typeId 로 찾는다, 못 찾으면 이 이슈 쪽 말로 대신한다).
 * 서버 view 에는 유형 이름이 없어 typeId 로 이름을 풀어야 하는데, 그 id 자체는 출력하지 않는다.
 */
const relationTypeOf = (v: Raw, typeNames: ReadonlyMap<number, string> | undefined): string =>
  (v.typeCode as string | null) ?? typeNames?.get(v.typeId as number) ?? String(v.label ?? '');

/** 뒤에서 limit 개만(최근 것) 남기고 빠진 개수를 함께 돌려준다. */
function keepRecent<T>(list: T[], limit: number): { kept: T[]; omitted: number } {
  if (list.length <= limit) return { kept: list, omitted: 0 };
  return { kept: list.slice(-limit), omitted: list.length - limit };
}

/** 정규화 옵션 — allComments 는 코멘트 상한을 30 에서 하드 상한 200 으로 늘린다(get_issue_detail 의 allComments). */
export interface NormalizeIssueDetailOptions {
  allComments?: boolean;
  /** 관계 유형 id → 이름(WP-887) — 사용자 정의 유형(코드 없음)의 type 을 이름으로 채운다. 없으면 이 이슈 쪽 말로 대신한다. */
  relationTypeNames?: ReadonlyMap<number, string>;
}

/** summary 중첩을 풀고, 사람은 사람 뷰로, 시각은 KST 로 바꾼다. 코멘트·이력은 최근 것만(잘리면 …Omitted 로 알린다). */
export function normalizeIssueDetail(raw: unknown, options: NormalizeIssueDetailOptions = {}): IssueDetail {
  const r = (raw ?? {}) as Raw;
  const s = (r.summary ?? {}) as Raw;
  const { kept: history, omitted: historyOmitted } = keepRecent((r.history ?? []) as Raw[], ISSUE_DETAIL_HISTORY_LIMIT);
  const { kept: comments, omitted: commentsOmitted } = keepRecent(
    (r.comments ?? []) as Raw[],
    options.allComments ? ISSUE_DETAIL_COMMENT_HARD_LIMIT : ISSUE_DETAIL_COMMENT_LIMIT,
  );
  const issueKey = String(r.issueKey ?? r.key ?? (s.projectKey && `${s.projectKey}-${s.number}`) ?? '');
  // 의존성 링크는 같은 프로젝트라 이 이슈의 프로젝트 키로 링크의 issueKey 를 만든다.
  const projectKey = s.projectKey ?? issueKey.replace(/-\d+$/, '');
  return {
    issueKey,
    title: String(s.title ?? r.title ?? ''),
    body: (r.body ?? s.body ?? null) as string | null,
    status: String(s.status ?? r.status ?? ''),
    statusName: (s.statusName ?? r.statusName ?? null) as string | null,
    priority: String(s.priority ?? r.priority ?? ''),
    type: typeName(s.type),
    assignees: toPeopleView(s.assignees ?? r.assignees),
    reporter: r.reporter ? toPersonView(r.reporter as Raw) : null,
    dueDate: (s.dueDate as string | null) ?? null,
    startDate: (s.startDate as string | null) ?? null,
    createdAt: toSeoulIso(s.createdAt),
    updatedAt: toSeoulIso(s.updatedAt),
    closedAt: toSeoulIso(s.closedAt),
    labels: labelNames(s.labels),
    milestone: (s.milestoneName as string | null) ?? null,
    parent: toParentView(s.parent, s.projectKey),
    children: toChildrenView(s.childCount, s.childDoneCount),
    blockedBy: links(s.blockedBy, projectKey),
    blocks: links(s.blocks, projectKey),
    blocked: Boolean(s.blocked),
    // WP-887: 서버가 caller 의 읽기 권한으로 이미 거르고 이력도 가린 top-level relations·externalLinks 만 옮긴다 — 다른 곳(이력·요약)에서 상대를 되짚지 않는다.
    relations: ((r.relations ?? []) as Raw[]).map((v) => {
      const other = (v.issue ?? {}) as Raw;
      return {
        relationId: v.id as number,
        type: relationTypeOf(v, options.relationTypeNames),
        label: String(v.label ?? ''),
        issueKey: formatIssueKey(other.projectKey as string | undefined, other.number as number | undefined) ?? String(other.number ?? ''),
        title: String(other.title ?? ''),
        status: String(other.status ?? ''),
      };
    }),
    externalLinks: ((r.externalLinks ?? []) as Raw[]).map((v) => ({
      externalLinkId: v.id as number,
      type: relationTypeOf(v, options.relationTypeNames),
      label: String(v.label ?? ''),
      key: (v.key as string | null) ?? null,
      title: String(v.title ?? ''),
      url: String(v.url ?? ''),
    })),
    customFields: ((s.customFields ?? []) as Raw[]).map((f) => ({
      name: String(f.name ?? ''),
      type: String(f.type ?? ''),
      value: f.value ?? null,
    })),
    attachments: ((r.attachments ?? []) as Raw[]).map((a) => ({
      // 이슈 첨부의 core file id — read_file 의 attachmentId 입력으로 넘긴다. 드라이브 driveFileId 와 이름이 겹치지 않게 첨부 id 로 부른다(WP-353).
      attachmentId: a.fileId as number,
      name: String(a.originalName ?? ''),
      mimeType: (a.mimeType as string | null) ?? null,
      sizeBytes: (a.sizeBytes as number | null) ?? null,
      attachedBy: toAuthorView(a.attachedByUsername, a.attachedByName, undefined),
      attachedAt: toSeoulIso(a.attachedAt),
    })),
    comments: comments.map((c) => {
      const reactions = reactionSummary(c.reactions);
      return {
        id: c.id as number,
        body: String(c.body ?? ''),
        author: toAuthorView(c.authorUsername, c.authorName, c.authorKind),
        createdAt: toSeoulIso(c.createdAt),
        updatedAt: toSeoulIso(c.updatedAt),
        // WP-812: 반응은 {이모지: 개수} 로만 — 채팅 읽기(list_channel_messages)와 같은 꼴, 없으면 키를 뺀다.
        ...(reactions && { reactions }),
      };
    }),
    ...(commentsOmitted > 0 && { commentsOmitted }),
    ...(Array.isArray(s.agentWork) && s.agentWork.length > 0 && { agentWork: (s.agentWork as Raw[]).map(toAgentWorkView) }),
    history: history.map((h) => ({
      at: toSeoulIso(h.createdAt),
      actor: toAuthorView(h.actorUsername, h.actorName, h.actorKind),
      event: String(h.eventType ?? ''),
      from: historyValue(h.eventType, h.fromValue),
      to: historyValue(h.eventType, h.toValue),
    })),
    ...(historyOmitted > 0 && { historyOmitted }),
  };
}
