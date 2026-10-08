// src/issue-detail.ts — get_issue_detail 응답을 LLM 노출용 flat 뷰로 정규화.
// 백엔드 IssueDetailResponse = { summary: IssueResponse, body, comments[], history[], attachments[], reporter, ... }.
// WP-307: 예전엔 zod 파싱이 스키마 밖 필드를 조용히 지워 날짜·라벨·마일스톤 등이 빠졌다. 이제 필드를 명시적으로 골라 만들고,
// AI 가 판단에 쓰는 정보(날짜·분류·계층·작성자·커스텀 필드·첨부·변경 이력)를 모두 싣는다.
import {
  labelNames,
  toAuthorView,
  toChildrenView,
  toParentView,
  toPersonView,
  toSeoulIso,
  typeName,
  type PersonView,
} from './issue-view.js';

type Raw = Record<string, unknown>;

/** 변경 이력은 최근 것만 싣는다 — 오래된 이슈의 이력이 응답을 키우지 않게. */
export const ISSUE_DETAIL_HISTORY_LIMIT = 30;

/** 의존성 링크 요약 — 백엔드 IssueLinkSummary(number,title,status,type) 중 LLM 필요분만. */
export interface IssueLinkView {
  number: number;
  title: string;
  status: string;
}

export interface IssueDetail {
  issueKey: string;
  title: string;
  body: string | null;
  status: string;
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
  parent: { issueKey: string; title: string; status: string | null } | null;
  /** 하위 이슈 진행률(없으면 null). 목록은 list_issues(projectKey, q 등)로. */
  children: { total: number; done: number } | null;
  blockedBy: IssueLinkView[];
  blocks: IssueLinkView[];
  blocked: boolean;
  customFields: { name: string; type: string; value: unknown }[];
  attachments: { fileId: number; name: string; mimeType: string | null; sizeBytes: number | null; attachedBy: PersonView; attachedAt: string | null }[];
  comments: { id: number; body: string; author: PersonView; createdAt: string | null; updatedAt: string | null }[];
  /** 최근 변경 이력(오래된→최신). from/to 는 상태값 같은 문자열이거나, 집합 변경이면 객체(숫자 id·색 토큰 제외). */
  history: { at: string | null; actor: PersonView; event: string; from: unknown; to: unknown }[];
}

/** 정규화 보조 정보 — 응답만으로는 알 수 없는 이름을 채운다. */
export interface IssueDetailContext {
  /** 프로젝트 멤버 userId → username. 코멘트·이력 작성자는 표시 이름만 와서 이것으로 username 을 찾는다. */
  usernameById?: ReadonlyMap<number, string>;
  /** 마일스톤 id → 이름. 응답엔 milestoneId 만 있고 update_issue 는 이름을 받는다. */
  milestoneNameById?: ReadonlyMap<number, string>;
}

/** 이력 payload 에서 뺄 키 — 숫자 id 는 쓰기 도구로 흘려보내지 않고(#833), 색·아이콘은 LLM 에 쓸모없는 토큰이다. */
const HISTORY_DROP_KEYS = new Set(['id', 'defId', 'colorToken', 'icon']);

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

/** 이력 값 — 집합 변경(라벨·담당자 등)은 JSON 문자열로 저장돼 있어 객체로 풀어 이중 이스케이프를 없애고 id 류를 뺀다. */
function historyValue(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null;
  const t = v.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return v;
  try {
    return stripHistoryKeys(JSON.parse(t));
  } catch {
    return v;
  }
}

const links = (arr: unknown): IssueLinkView[] =>
  ((arr ?? []) as Raw[]).map((l) => ({ number: l.number as number, title: l.title as string, status: l.status as string }));

/** summary 중첩을 풀고, 사람은 사람 뷰로, 시각은 KST 로, 이름이 필요한 id(마일스톤·작성자)는 context 로 바꾼다. */
export function normalizeIssueDetail(raw: unknown, ctx: IssueDetailContext = {}): IssueDetail {
  const r = (raw ?? {}) as Raw;
  const s = (r.summary ?? {}) as Raw;
  const usernameById = ctx.usernameById ?? new Map<number, string>();
  const milestoneId = s.milestoneId;
  const history = ((r.history ?? []) as Raw[]).slice(-ISSUE_DETAIL_HISTORY_LIMIT);
  return {
    issueKey: String(r.issueKey ?? r.key ?? (s.projectKey && `${s.projectKey}-${s.number}`) ?? ''),
    title: String(s.title ?? r.title ?? ''),
    body: (r.body ?? s.body ?? null) as string | null,
    status: String(s.status ?? r.status ?? ''),
    priority: String(s.priority ?? r.priority ?? ''),
    type: typeName(s.type),
    assignees: ((s.assignees ?? r.assignees ?? []) as Raw[]).map((a) => toPersonView(a)!),
    reporter: toPersonView(r.reporter as Raw | null),
    dueDate: (s.dueDate as string | null) ?? null,
    startDate: (s.startDate as string | null) ?? null,
    createdAt: toSeoulIso(s.createdAt),
    updatedAt: toSeoulIso(s.updatedAt),
    closedAt: toSeoulIso(s.closedAt),
    labels: labelNames(s.labels),
    milestone: typeof milestoneId === 'number' ? (ctx.milestoneNameById?.get(milestoneId) ?? null) : null,
    parent: toParentView(s.parent, s.projectKey),
    children: toChildrenView(s.childCount, s.childDoneCount),
    blockedBy: links(s.blockedBy),
    blocks: links(s.blocks),
    blocked: Boolean(s.blocked),
    customFields: ((s.customFields ?? []) as Raw[]).map((f) => ({
      name: String(f.name ?? ''),
      type: String(f.type ?? ''),
      value: f.value ?? null,
    })),
    attachments: ((r.attachments ?? []) as Raw[]).map((a) => ({
      fileId: a.fileId as number,
      name: String(a.originalName ?? ''),
      mimeType: (a.mimeType as string | null) ?? null,
      sizeBytes: (a.sizeBytes as number | null) ?? null,
      attachedBy: toAuthorView(a.attachedById, a.attachedByName, undefined, usernameById),
      attachedAt: toSeoulIso(a.attachedAt),
    })),
    comments: ((r.comments ?? []) as Raw[]).map((c) => ({
      id: c.id as number,
      body: String(c.body ?? ''),
      author: toAuthorView(c.authorId, c.authorName, c.authorKind, usernameById),
      createdAt: toSeoulIso(c.createdAt),
      updatedAt: toSeoulIso(c.updatedAt),
    })),
    history: history.map((h) => ({
      at: toSeoulIso(h.createdAt),
      actor: toAuthorView(h.actorId, h.actorName, h.actorKind, usernameById),
      event: String(h.eventType ?? ''),
      from: historyValue(h.fromValue),
      to: historyValue(h.toValue),
    })),
  };
}
