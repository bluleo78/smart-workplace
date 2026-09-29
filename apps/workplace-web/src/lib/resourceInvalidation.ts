// resource.changed SSE → TanStack Query 무효화 규칙 (WP-36/WP-59).
// 서버의 모든 C/U/D(AI Chat 의 MCP·확인카드, 다른 탭/사용자)가 이 한 경로로 열린 화면을 갱신한다.
// 쿼리 키가 리소스마다 루트가 흩어져 있어(me-issues, attachments …) 리소스별로 prefix 목록을 둔다.

import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** 서버 ResourceSseDispatcher payload — attrs 는 평탄화되어 온다. */
export interface ResourceChangedPayload {
  resource: string;
  op: 'created' | 'updated' | 'deleted';
  scopeType?: string;
  scopeId?: number;
  ids?: number[];
  actorId?: number | null;
  projectKey?: string;
  issueNumber?: number;
}

export interface InvalidationTarget {
  queryKey: QueryKey;
  exact?: boolean;
}

type Rule = (p: ResourceChangedPayload) => InvalidationTarget[];

// 리소스 → 무효화 대상. 슬라이스 2~6 에서 project·calendar·drive… 규칙을 여기에 추가한다.
const RULES: Record<string, Rule> = {
  issue: (p) => {
    const pk = p.projectKey;
    if (!pk) return [];
    return [
      { queryKey: ['issues', 'search', pk] }, // 목록·보드·타임라인·하위 이슈
      { queryKey: ['issues', pk] }, // 상세(detail) 전체
      { queryKey: ['me-issues'] },
      { queryKey: ['watched-issues'] },
      { queryKey: ['my-issue-dues'] },
      { queryKey: ['home', 'myIssues'] },
      { queryKey: ['home', 'watched'] },
      { queryKey: ['home', 'activity'] },
      { queryKey: ['issue-dependencies', pk] },
      { queryKey: ['attachments', pk] },
      { queryKey: ['watchers', pk] },
      { queryKey: ['issue-drive-links', pk] },
      { queryKey: ['issueCycles', pk] },
      { queryKey: ['cycleProgress', pk] },
    ];
  },
};

export function invalidationTargets(p: ResourceChangedPayload): InvalidationTarget[] {
  const rule = p && RULES[p.resource];
  return rule ? rule(p) : [];
}

/**
 * 무효화하면 안 되는 키 — AI 요약(재생성 비용)·배치 결과·세션 상태. 재연결 catch-up(전체 무효화)에서 제외 판정에 쓴다.
 * ['mail-summary'] 단독(홈 위젯)은 일반 키지만 ['mail-summary', id](메시지별 AI 요약)는 보호.
 */
export function isProtectedKey(key: QueryKey): boolean {
  const [a, b] = key as unknown[];
  if (a === 'mail-summary') return key.length > 1;
  if (a === 'messaging' && b === 'catchup') return true;
  if (a === 'home' && b === 'sessions') return true;
  return a === 'drive-file-summary' || a === 'drive-thumbnail' || a === 'priority-items' || a === 'chat';
}

/**
 * 짧은 간격의 연속 이벤트를 모아 한 번만 invalidate 하는 배처. MCP update_issue 처럼 한 번의 AI 작업이 여러 엔드포인트를 호출하면
 * 이벤트가 연달아 오는데, 건마다 invalidate 하면 같은 목록을 여러 번 재조회한다.
 */
export function createInvalidationBatcher(qc: QueryClient, delayMs = 100) {
  const pending = new Map<string, InvalidationTarget>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const targets = [...pending.values()];
    pending.clear();
    for (const t of targets) void qc.invalidateQueries({ queryKey: t.queryKey, exact: t.exact ?? false });
  };
  return {
    enqueue(targets: InvalidationTarget[]) {
      for (const t of targets) pending.set(`${t.exact ? 'x' : 'p'}:${JSON.stringify(t.queryKey)}`, t);
      if (!timer && pending.size > 0) timer = setTimeout(flush, delayMs);
    },
  };
}
