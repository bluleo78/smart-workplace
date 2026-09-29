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
  channelId?: number;
  spaceId?: number;
  accountId?: number;
  messageId?: number;
  pageId?: number;
}

export interface InvalidationTarget {
  queryKey: QueryKey;
  exact?: boolean;
}

type Rule = (p: ResourceChangedPayload) => InvalidationTarget[];

/** issue 리소스 무효화 대상 — projectKey(pk) 기준. 다른 리소스 규칙(예: 프로젝트 변경)도 재사용한다. */
export function issueTargets(pk: string): InvalidationTarget[] {
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
}

// 설정 삭제·수정은 이슈 값을 간접적으로 바꾼다(라벨·사이클 cascade, 마일스톤 SET NULL, 필드값 cascade, 표시명) — 생성만 이슈를 건드리지 않는다.
const configRule =
  (own: (pk: string) => InvalidationTarget[]): Rule =>
  (p) => {
    const pk = p.projectKey;
    if (!pk) return [];
    return p.op === 'created' ? own(pk) : [...own(pk), ...issueTargets(pk)];
  };

// 내 이슈·홈 계열 — 프로젝트 삭제 시 다른 프로젝트 화면의 내 이슈 목록에서도 빠져야 한다.
const MY_ISSUE_TARGETS: InvalidationTarget[] = [
  { queryKey: ['me-issues'] },
  { queryKey: ['watched-issues'] },
  { queryKey: ['my-issue-dues'] },
  { queryKey: ['home', 'myIssues'] },
  { queryKey: ['home', 'watched'] },
];

// 리소스 → 무효화 대상. 슬라이스 4~6 에서 drive… 규칙을 여기에 추가한다.
const RULES: Record<string, Rule> = {
  issue: (p) => (p.projectKey ? issueTargets(p.projectKey) : []),
  project: (p) => [
    { queryKey: ['projects'] }, // 목록·상세·멤버(['projects','detail',pk,'members'])
    { queryKey: ['pinnedViews'] },
    ...(p.op === 'deleted' ? MY_ISSUE_TARGETS : []),
  ],
  // 멤버 추가·제거는 사이드바 프로젝트 목록(본인 추가/제거)과 담당자 선택기, 제거 시 담당자 해제된 이슈에 영향
  'project-member': (p) =>
    p.projectKey ? [{ queryKey: ['projects'] }, ...issueTargets(p.projectKey)] : [{ queryKey: ['projects'] }],
  label: configRule((pk) => [{ queryKey: ['labels', pk] }]),
  milestone: configRule((pk) => [{ queryKey: ['milestones', pk] }]),
  cycle: configRule((pk) => [{ queryKey: ['cycles', pk] }, { queryKey: ['cycleProgress', pk] }]),
  'field-def': configRule((pk) => [{ queryKey: ['customFields', pk] }]),
  'issue-type': configRule((pk) => [{ queryKey: ['issueTypes', pk] }]),
  'saved-view': (p) => [
    ...(p.projectKey ? [{ queryKey: ['savedViews', p.projectKey] }] : []),
    { queryKey: ['pinnedViews'] },
  ],
  // 범위 목록·상세(['calendar','events',…]·['calendar','event',id])·캘린더 목록·홈 위젯이 모두 ['calendar'] 아래에 있다.
  'calendar-event': () => [{ queryKey: ['calendar'] }],
  calendar: () => [{ queryKey: ['calendar'] }],
  // 메시지 캐시(['messaging','messages'|'thread'…])는 기존 messaging.* 핸들러가 패치하므로 건드리지 않는다 — 목록·상세·멤버만.
  // 채널 멤버십은 연결된 드라이브 채널 스페이스 멤버도 바꾼다(ChannelDriveListener) → 드라이브 스페이스 목록도 무효화.
  channel: (p) => [
    { queryKey: ['messaging', 'channels'] },
    { queryKey: ['messaging', 'discover'] },
    ...(p.channelId != null
      ? [{ queryKey: ['messaging', 'detail', p.channelId] }, { queryKey: ['messaging', 'members', p.channelId] }]
      : []),
    { queryKey: ['messaging-summary'] },
    { queryKey: ['drive', 'spaces'] },
  ],
  // 콘텐츠(의미) 검색·파일 요약·썸네일은 재계산 비용이 커서 제외 — 목록·휴지통·이름 검색·용량·첨부 뷰만. spaceId 로만 무효화(ids 비의존).
  drive: (p) => [
    ...(p.spaceId != null
      ? [
          { queryKey: ['drive', 'items', p.spaceId] },
          { queryKey: ['drive', 'trash', p.spaceId] },
          { queryKey: ['drive', 'search', p.spaceId] },
        ]
      : []),
    { queryKey: ['drive', 'quota'] },
    { queryKey: ['drive-attachments'] },
    { queryKey: ['drive-file-backlinks'] },
  ],
  'drive-space': (p) => [
    { queryKey: ['drive', 'spaces'] },
    ...(p.spaceId != null ? [{ queryKey: ['drive', 'space', p.spaceId] }, { queryKey: ['drive', 'items', p.spaceId] }] : []),
  ],
  dm: () => [{ queryKey: ['messaging', 'dms'] }, { queryKey: ['messaging-summary'] }],
};

export function invalidationTargets(p: ResourceChangedPayload): InvalidationTarget[] {
  // RULES 는 plain object 라 'toString'/'constructor' 같은 상속 키가 함수로 풀린다 — 자기 키만 인정.
  if (!p || !Object.hasOwn(RULES, p.resource)) return [];
  return RULES[p.resource](p);
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
  return a === 'drive-file-summary' || a === 'drive-thumbnail' || a === 'priority-items' || a === 'chat' || a === 'api-blob'; // api-blob: 이미지/첨부 blob 재다운로드 방지
}

/**
 * 짧은 간격의 연속 이벤트를 모아 한 번만 invalidate 하는 배처. MCP update_issue 처럼 한 번의 AI 작업이 여러 엔드포인트를 호출하면
 * 이벤트가 연달아 오는데, 건마다 invalidate 하면 같은 목록을 여러 번 재조회한다.
 */
export function createInvalidationBatcher(qc: QueryClient, delayMs = 100, maxWaitMs = 500) {
  const pending = new Map<string, InvalidationTarget>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstAt = 0; // 대기 중인 첫 이벤트 시각 — maxWait 기준
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const targets = [...pending.values()];
    pending.clear();
    for (const t of targets) void qc.invalidateQueries({ queryKey: t.queryKey, exact: t.exact ?? false });
  };
  return {
    enqueue(targets: InvalidationTarget[]) {
      if (targets.length === 0) return;
      for (const t of targets) pending.set(`${t.exact ? 'x' : 'p'}:${JSON.stringify(t.queryKey)}`, t);
      // 트레일링 디바운스 — 요청 지연으로 벌어진 연속 이벤트도 한 번에 모으되, 첫 이벤트 후 maxWaitMs 를 넘기지 않는다.
      const now = Date.now();
      if (!timer) firstAt = now;
      else clearTimeout(timer);
      timer = setTimeout(flush, Math.max(0, Math.min(delayMs, firstAt + maxWaitMs - now)));
    },
  };
}
