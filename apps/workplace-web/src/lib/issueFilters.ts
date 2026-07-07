// URL SearchParams 와 IssueFilters / IssueView 사이의 양방향 직렬화.
// 모든 필터 동작은 이 두 함수만 통과한다 — 화면/상태/URL 의 단일 진입점.

import type { IssueFilters, IssueGroupBy, IssueView } from '../types/issue';

const STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED'] as const;
const PRIORITIES = ['LOW', 'MID', 'HIGH'] as const;
const GROUP_BYS = ['status', 'assignee', 'priority'] as const;

// 알려진 토큰만 통과시켜 잘못된 URL 입력에 대해 안전하게 동작.
export function parseFilters(params: URLSearchParams): IssueFilters {
  const assigneeRaw = csv(params.get('assignee'));
  const assigneeIds: number[] = [];
  let includeUnassigned = false;
  for (const tok of assigneeRaw) {
    if (tok.toLowerCase() === 'null') {
      includeUnassigned = true;
    } else {
      const n = Number(tok);
      if (Number.isFinite(n) && n > 0) assigneeIds.push(n);
    }
  }
  // label 토큰은 양의 정수만 허용; 그 외(빈문자, 비숫자, 음수, 0) 는 폐기.
  const labelIds = csv(params.get('label'))
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
  // cycle 토큰도 동일 규칙 — 양의 정수만 통과.
  const cycleIds = csv(params.get('cycle'))
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
  // milestone 토큰도 동일 규칙 — 양의 정수만 통과.
  const milestoneIds = csv(params.get('milestone'))
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
  // type 토큰도 동일 규칙 — 양의 정수만 통과.
  const typeIds = csv(params.get('type'))
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
  // parent 는 단일 양의 정수만 허용.
  const parentRaw = params.get('parent');
  const parentNum = parentRaw == null ? NaN : Number(parentRaw);
  const parentNumber = Number.isFinite(parentNum) && parentNum > 0 ? parentNum : null;
  // 보드/목록 기본은 상위 이슈만(서브태스크는 부모 상세에서 관리). 'false' 일 때만 끔 → 기본 true.
  const topLevel = params.get('topLevel') !== 'false';
  // Phase 4b — blocked 도 'true' 만 통과. UI 노출은 deferred.
  const blocked = params.get('blocked') === 'true';
  // 목록 뷰 전용 — SUBTASK 제외. 'true' 만 통과(기본 false). 목록 진입 시 뷰가 기본값을 주입.
  const excludeSubtasks = params.get('excludeSubtasks') === 'true';
  return {
    q: params.get('q') ?? '',
    statuses: csv(params.get('status')).filter((s) =>
      (STATUSES as readonly string[]).includes(s),
    ),
    priorities: csv(params.get('priority')).filter((p) =>
      (PRIORITIES as readonly string[]).includes(p),
    ),
    assigneeIds,
    includeUnassigned,
    dueFrom: params.get('dueFrom'),
    dueTo: params.get('dueTo'),
    labelIds,
    cycleIds,
    milestoneIds,
    typeIds,
    parentNumber,
    topLevel,
    blocked,
    excludeSubtasks,
  };
}

// view 파라미터가 'board' 일 때만 board, 그 외에는 기본 list.
export function parseView(params: URLSearchParams): IssueView {
  return params.get('view') === 'board' ? 'board' : 'list';
}

// group 파라미터가 알려진 값일 때만 통과, 그 외(부재 포함)는 null(그룹 없음). (#58)
export function parseGroupBy(params: URLSearchParams): IssueGroupBy | null {
  const g = params.get('group');
  return (GROUP_BYS as readonly string[]).includes(g ?? '')
    ? (g as IssueGroupBy)
    : null;
}

// IssueFilters + view + groupBy → URLSearchParams. 기본값(list, 빈 필터, 그룹 없음)은 키 생략.
// groupBy 는 필수 인자 — 컴파일러가 모든 호출처에서 group 영속을 강제(저장 뷰 라운드트립 누락 방지).
export function filtersToParams(
  f: IssueFilters,
  view: IssueView,
  groupBy: IssueGroupBy | null,
): URLSearchParams {
  const p = new URLSearchParams();
  if (view !== 'list') p.set('view', view);
  if (groupBy) p.set('group', groupBy);
  if (f.q) p.set('q', f.q);
  if (f.statuses.length) p.set('status', f.statuses.join(','));
  if (f.priorities.length) p.set('priority', f.priorities.join(','));
  const assigneeTokens: string[] = [...f.assigneeIds.map(String)];
  if (f.includeUnassigned) assigneeTokens.push('null');
  if (assigneeTokens.length) p.set('assignee', assigneeTokens.join(','));
  if (f.dueFrom) p.set('dueFrom', f.dueFrom);
  if (f.dueTo) p.set('dueTo', f.dueTo);
  if (f.labelIds.length) p.set('label', f.labelIds.join(','));
  if (f.cycleIds.length) p.set('cycle', f.cycleIds.join(','));
  if (f.milestoneIds.length) p.set('milestone', f.milestoneIds.join(','));
  if (f.typeIds.length) p.set('type', f.typeIds.join(','));
  // Phase 4a — parent / topLevel 직렬화. UI 노출은 deferred.
  if (f.parentNumber != null && f.parentNumber > 0) p.set('parent', String(f.parentNumber));
  // 기본(상위 이슈만)은 빈 정규형 유지 — false(전체 표시)일 때만 URL 에 명시. (#168)
  if (!f.topLevel) p.set('topLevel', 'false');
  // Phase 4b — blocked 직렬화. UI 노출은 deferred.
  if (f.blocked) p.set('blocked', 'true');
  // 목록 뷰 SUBTASK 제외 직렬화 — true 일 때만 명시(기본 false 는 빈 정규형).
  if (f.excludeSubtasks) p.set('excludeSubtasks', 'true');
  return p;
}

function csv(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
