// URL SearchParams 와 IssueFilters / IssueView 사이의 양방향 직렬화.
// 모든 필터 동작은 이 두 함수만 통과한다 — 화면/상태/URL 의 단일 진입점.

import type { IssueFilters, IssueView } from '../types/issue';

const STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED'] as const;
const PRIORITIES = ['LOW', 'MID', 'HIGH'] as const;

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
  };
}

// view 파라미터가 'board' 일 때만 board, 그 외에는 기본 list.
export function parseView(params: URLSearchParams): IssueView {
  return params.get('view') === 'board' ? 'board' : 'list';
}

// IssueFilters + view → URLSearchParams. 기본값(list, 빈 필터)은 키 자체를 생략한다.
export function filtersToParams(f: IssueFilters, view: IssueView): URLSearchParams {
  const p = new URLSearchParams();
  if (view !== 'list') p.set('view', view);
  if (f.q) p.set('q', f.q);
  if (f.statuses.length) p.set('status', f.statuses.join(','));
  if (f.priorities.length) p.set('priority', f.priorities.join(','));
  const assigneeTokens: string[] = [...f.assigneeIds.map(String)];
  if (f.includeUnassigned) assigneeTokens.push('null');
  if (assigneeTokens.length) p.set('assignee', assigneeTokens.join(','));
  if (f.dueFrom) p.set('dueFrom', f.dueFrom);
  if (f.dueTo) p.set('dueTo', f.dueTo);
  return p;
}

function csv(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
