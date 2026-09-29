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
  // 최상위 이슈만 — 'true' 로 명시될 때만 켠다(에픽 패널 「에픽 미할당」). 기본 범위는 withDefaultIssueScope 가 결정.
  // (구 URL 의 topLevel=false 는 기본값과 같아져 자연히 흡수된다.)
  const topLevel = params.get('topLevel') === 'true';
  // Phase 4b — blocked 도 'true' 만 통과. UI 노출은 deferred.
  const blocked = params.get('blocked') === 'true';
  // 목록 뷰 전용 — SUBTASK 제외. 'true' 만 통과(기본 false). 목록 진입 시 뷰가 기본값을 주입.
  const excludeSubtasks = params.get('excludeSubtasks') === 'true';
  // 「완료 모두 보기」 — 'all' 만 통과(기본 false = 활성 사이클 밖 종료 이슈 숨김).
  const showAllClosed = params.get('closed') === 'all';
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
    showAllClosed,
  };
}

// 보드·목록 공통 기본 범위(Jira 관례) — 에픽은 작업 카드가 아닌 묶음이라 카드/행으로 보여주지 않고
// (에픽 패널·타임라인·이슈 상세가 담당), 에픽 하위 이슈는 노출하며, SUBTASK 는 부모 상세에서만 본다.
// - 유형 필터를 명시하면 그 선택이 우선한다(EPIC·SUBTASK 유형을 직접 고르면 해당 이슈도 조회 가능).
// - topLevel=true(에픽 미할당)는 "부모 없는 비에픽" 의미라 유형 필터와 무관하게 에픽을 제외하고,
//   루트만 보므로 SUBTASK 제외는 URL 값 그대로 둔다.
// 타임라인은 에픽이 그룹 행이라 이 헬퍼를 쓰지 않는다.
export function withDefaultIssueScope(f: IssueFilters): IssueFilters {
  const explicitTypes = f.typeIds.length > 0;
  return {
    ...f,
    excludeSubtasks: f.topLevel || explicitTypes ? f.excludeSubtasks : true,
    excludeEpics: f.topLevel || !explicitTypes,
    // 종료(완료·취소) 이슈는 활성 사이클 소속만 남긴다(#876). 「완료 모두 보기」를 켜거나 묶음 필터를 명시하면 해제.
    hideInactiveClosed: !f.showAllClosed && !overridesClosedHiding(f),
  };
}

// 종료 이슈 숨김(#876)을 무력화하는 명시 필터 — 완료 상태 선택, 지난 사이클·마일스톤 선택, 특정 부모의 자식 보기는
// 그 묶음 전체가 대상이라 숨기지 않는다. 묶음을 고르는 필터 필드를 새로 추가하면 여기 포함 여부를 결정할 것.
// (검색어 q 는 의도적으로 제외 — 검색도 기본 범위 안에서 동작하고, 지난 이슈는 「완료 모두 보기」로 찾는다.)
export function overridesClosedHiding(f: IssueFilters): boolean {
  return (
    f.statuses.length > 0 ||
    f.cycleIds.length > 0 ||
    !!f.cycleUnassigned ||
    f.milestoneIds.length > 0 ||
    f.parentNumber != null
  );
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
  // 기본(false)은 빈 정규형 유지 — 최상위만 보기(true)일 때만 URL 에 명시. 다른 필터 변경에도 보존된다.
  if (f.topLevel) p.set('topLevel', 'true');
  // Phase 4b — blocked 직렬화. UI 노출은 deferred.
  if (f.blocked) p.set('blocked', 'true');
  // 목록 뷰 SUBTASK 제외 직렬화 — true 일 때만 명시(기본 false 는 빈 정규형).
  if (f.excludeSubtasks) p.set('excludeSubtasks', 'true');
  // 「완료 모두 보기」 직렬화 — 켰을 때만 명시(기본 숨김은 빈 정규형).
  if (f.showAllClosed) p.set('closed', 'all');
  return p;
}

function csv(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
