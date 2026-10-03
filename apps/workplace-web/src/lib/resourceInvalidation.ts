// resource.changed SSE → TanStack Query 무효화 규칙 (WP-36/WP-59).
// 서버의 모든 C/U/D(AI Chat 의 MCP·확인카드, 다른 탭/사용자)가 이 한 경로로 열린 화면을 갱신한다.
// 쿼리 키가 리소스마다 루트가 흩어져 있어(me-issues, attachments …) 리소스별로 prefix 목록을 둔다.

import type { QueryClient, QueryKey } from '@tanstack/react-query';

// 쿼리 키는 api 모듈을 끌어오지 않는 순수 *Keys 팩토리에서만 가져온다(훅 파일 import 시 api·axios 가 딸려 온다).
import { calendarKeys } from '../hooks/queries/calendarKeys';
import { contactKeys } from '../hooks/queries/contactKeys';
import { driveKeys } from '../hooks/queries/driveKeys';
import { mailMessageKeys } from '../hooks/queries/mailMessageKeys';
import { messagingKeys } from '../hooks/queries/messagingKeys';
import { notificationKeys } from '../hooks/queries/notificationKeys';
import { wikiKeys } from '../hooks/queries/wikiKeys';

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

// 설정 값이 표시되는 이슈 화면 — 목록·보드·상세와 내 이슈·워치 목록. 의존성·첨부·워처·드라이브 링크·홈 위젯은 설정 변경과 무관해 뺀다.
function issueValueTargets(pk: string): InvalidationTarget[] {
  return [
    { queryKey: ['issues', 'search', pk] },
    { queryKey: ['issues', pk] },
    { queryKey: ['me-issues'] },
    { queryKey: ['watched-issues'] },
  ];
}

// 설정 삭제·수정은 이슈 값을 간접적으로 바꾼다(라벨·사이클 cascade, 마일스톤 SET NULL, 필드값 cascade, 표시명) — 생성만 이슈를 건드리지 않는다.
const configRule =
  (own: (pk: string) => InvalidationTarget[]): Rule =>
  (p) => {
    const pk = p.projectKey;
    if (!pk) return [];
    return p.op === 'created' ? own(pk) : [...own(pk), ...issueValueTargets(pk)];
  };

// 내 이슈·홈 계열 — 프로젝트 삭제 시 다른 프로젝트 화면의 내 이슈 목록에서도 빠져야 한다.
const MY_ISSUE_TARGETS: InvalidationTarget[] = [
  { queryKey: ['me-issues'] },
  { queryKey: ['watched-issues'] },
  { queryKey: ['my-issue-dues'] },
  { queryKey: ['home', 'myIssues'] },
  { queryKey: ['home', 'watched'] },
];

// 일정·이슈 삭제는 그 알림 행을 cascade 로 함께 지우지만 notification 이벤트는 따로 발행되지 않는다(WP-83).
// 삭제 이벤트에 알림 목록·안 읽음 배지를 얹어야 열린 화면의 배지가 옛 값으로 남지 않는다.
const notificationsOnDelete = (p: ResourceChangedPayload): InvalidationTarget[] =>
  p.op === 'deleted' ? [{ queryKey: notificationKeys.all }] : [];

// 리소스 → 무효화 대상. 새 리소스는 resource-contract.json 과 함께 여기에 규칙을 추가한다.
const RULES: Record<string, Rule> = {
  issue: (p) => (p.projectKey ? [...issueTargets(p.projectKey), ...notificationsOnDelete(p)] : []),
  project: (p) => [
    { queryKey: ['projects'] }, // 목록·상세·멤버(['projects','detail',pk,'members'])
    { queryKey: ['pinnedViews'] },
    ...(p.op === 'deleted' ? MY_ISSUE_TARGETS : []),
  ],
  // 멤버 추가·역할 변경은 사이드바 프로젝트 목록(본인 추가)과 담당자 선택기(['projects',…] 아래)만 바꾼다.
  // 제거만 담당자 해제로 이슈 값을 바꾸므로 그때만 이슈 대상을 더한다.
  'project-member': (p) =>
    p.op === 'deleted' && p.projectKey
      ? [{ queryKey: ['projects'] }, ...issueTargets(p.projectKey)]
      : [{ queryKey: ['projects'] }],
  label: configRule((pk) => [{ queryKey: ['labels', pk] }]),
  milestone: configRule((pk) => [{ queryKey: ['milestones', pk] }]),
  cycle: configRule((pk) => [
    { queryKey: ['cycles', pk] },
    { queryKey: ['cycleProgress', pk] },
    { queryKey: ['issueCycles', pk] },
  ]),
  'field-def': configRule((pk) => [{ queryKey: ['customFields', pk] }]),
  'issue-type': configRule((pk) => [{ queryKey: ['issueTypes', pk] }]),
  'saved-view': (p) => [
    ...(p.projectKey ? [{ queryKey: ['savedViews', p.projectKey] }] : []),
    { queryKey: ['pinnedViews'] },
  ],
  // 범위 목록·상세(['calendar','events',…]·['calendar','event',id])·캘린더 목록·홈 위젯이 모두 ['calendar'] 아래에 있다.
  'calendar-event': (p) => [{ queryKey: calendarKeys.all }, ...notificationsOnDelete(p)],
  calendar: () => [{ queryKey: calendarKeys.all }],
  // 메시지 캐시(['messaging','messages'|'thread'…])는 기존 messaging.* 핸들러가 패치하므로 건드리지 않는다 — 목록·상세·멤버만.
  // 채널 멤버십은 연결된 드라이브 채널 스페이스 멤버도 바꾼다(ChannelDriveListener) → 드라이브 스페이스 목록도 무효화.
  channel: (p) => [
    { queryKey: messagingKeys.channels() },
    { queryKey: messagingKeys.discoverAll() },
    ...(p.channelId != null
      ? [{ queryKey: messagingKeys.detail(p.channelId) }, { queryKey: messagingKeys.members(p.channelId) }]
      : []),
    { queryKey: ['messaging-summary'] },
    { queryKey: driveKeys.spaces() },
  ],
  // 콘텐츠(의미) 검색·파일 요약·썸네일은 재계산 비용이 커서 제외 — 목록·휴지통·이름 검색·용량·첨부 뷰만. spaceId 로만 무효화(ids 비의존).
  drive: (p) => [
    ...(p.spaceId != null
      ? [
          { queryKey: driveKeys.itemsAll(p.spaceId) },
          { queryKey: driveKeys.trash(p.spaceId) },
          { queryKey: driveKeys.searchAll(p.spaceId) },
        ]
      : []),
    { queryKey: driveKeys.quota },
    { queryKey: ['drive-attachments'] },
    { queryKey: ['drive-file-backlinks'] },
  ],
  'drive-space': (p) => [
    { queryKey: driveKeys.spaces() },
    ...(p.spaceId != null ? [{ queryKey: driveKeys.space(p.spaceId) }, { queryKey: driveKeys.itemsAll(p.spaceId) }] : []),
  ],
  dm: () => [{ queryKey: messagingKeys.dms() }, { queryKey: ['messaging-summary'] }],
  // 연락처·알림 — 즐겨찾기/전체 읽음처럼 ids 가 비어도 루트 전체를 갱신한다.
  contact: () => [{ queryKey: contactKeys.all }],
  notification: () => [{ queryKey: notificationKeys.all }],
  // 이슈 채팅 스레드 응답(멤버 목록 포함)만 — 메시지 캐시(['chat','messages',…])는 chat.* 핸들러가 패치.
  'chat-thread': (p) =>
    p.projectKey && p.issueNumber != null ? [{ queryKey: ['chat', 'thread', p.projectKey, p.issueNumber] }] : [],
  // 메시지별 AI 요약(['mail-summary', id])은 재생성 비용이 커서 위젯 키만 exact 로.
  mail: (p) => [
    ...(p.accountId != null
      ? [
          { queryKey: ['mail-messages', p.accountId] },
          { queryKey: mailMessageKeys.unreadCounts(p.accountId) },
          { queryKey: mailMessageKeys.unreadSummary() },
        ]
      : []),
    ...(p.messageId != null
      ? [{ queryKey: mailMessageKeys.detail(p.messageId) }, { queryKey: ['mail', 'linked-issue', p.messageId] }]
      : []),
    { queryKey: ['mail-summary'], exact: true },
  ],
  // 계정 추가·해제는 모든 계정 목록에 영향 — 개별 계정 수정(accountId>0)은 그 계정의 메일 목록만 다시 받는다(0 은 전 계정 일괄 설정).
  // ['calendar'] 는 op 와 무관하게 유지: M365 연결(신규·IMAP→Graph 전환)이 upsert 라 updated 로 오는데 외부 캘린더 표시가 생긴다.
  'mail-account': (p) => [
    { queryKey: ['mail-accounts'] },
    {
      queryKey:
        p.op === 'updated' && p.accountId != null && p.accountId > 0 ? ['mail-messages', p.accountId] : ['mail-messages'],
    },
    { queryKey: mailMessageKeys.unreadCountsAll() },
    { queryKey: mailMessageKeys.unreadSummary() },
    { queryKey: ['mail-summary'], exact: true },
    { queryKey: calendarKeys.all },
  ],
  'wiki-space': (p) => [
    { queryKey: wikiKeys.spaces() },
    ...(p.spaceId != null ? [{ queryKey: wikiKeys.members(p.spaceId) }, { queryKey: wikiKeys.tree(p.spaceId) }] : []),
  ],
  'wiki-attachment': (p) => (p.pageId != null ? [{ queryKey: wikiKeys.page(p.pageId) }] : []),
};

/** 무효화 규칙이 있는 리소스 이름 — 백엔드 RESOURCE_* 상수와의 계약 테스트(resource-contract.json)용. */
export function ruleResourceNames(): string[] {
  return Object.keys(RULES);
}

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
