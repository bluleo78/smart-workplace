# 위젯 추가 모달 라이브 프리뷰 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `AddWidgetModal`을 카테고리/카드 목록/프리뷰 3단 레이아웃으로 바꾸고, 선택한 위젯을 목데이터로 실제 컴포넌트를 라이브 렌더한 뒤 "+ 위젯 추가" 버튼으로 확정 추가하게 한다.

**Architecture:** 17개 위젯 컴포넌트(카탈로그 9 + 시스템 8) 각각에 선택적 `previewData` prop을 추가해 내부 데이터 훅을 `enabled: false`로 끄고 주입된 목데이터로 즉시 렌더한다. 목데이터는 새 파일 `widgetPreviewFixtures.ts` 한 곳에 모은다. `AddWidgetModal`은 기존 두 레지스트리(`chatWidgetRegistry`/`registry`)를 그대로 재사용해 선택된 위젯을 프리뷰 패널에 렌더한다.

**Tech Stack:** React 19, TanStack Query(`useQuery`/`useInfiniteQuery`), TypeScript, shadcn/ui Dialog, Playwright E2E.

## Global Constraints

- 한국어 주석 필수(클래스·메서드·주요 로직에 무엇을·왜) — 루트 CLAUDE.md
- 프론트엔드는 컴포넌트/유닛 테스트 프레임워크가 없다(Playwright E2E만 존재) — `apps/workplace-web/CLAUDE.md`. 이 플랜의 "테스트" 단계는 각 위젯 태스크에서는 `pnpm typecheck`(컴파일 검증)로, 전체 플로우는 마지막 E2E 태스크(`e2e/pages/home.spec.ts`)로 검증한다.
- 새 UI에는 hex/임의 색 금지 — 시맨틱 토큰(`bg-accent` 등)만 사용
- 커밋/배포는 사용자 명시적 승인 후에만 — 각 태스크는 로컬 커밋까지만 수행, push 하지 않는다
- 이번 작업 범위는 스펙 문서(`docs/superpowers/specs/2026-07-03-widget-add-preview-design.md`) 기준 — 위젯별 사용자 정의 프리뷰 데이터, 카드 검색창, 위젯 크기 변형은 범위 밖

---

### Task 1: 카탈로그/시스템 레지스트리에 `description` 필드 추가

**Files:**
- Modify: `apps/workplace-web/src/components/home/widgets/catalogRegistry.ts:26-37`(interface), `:50-191`(9개 정의)
- Modify: `apps/workplace-web/src/components/home/widgets/registry.ts:20-35`(interface), `:40-99`(8개 정의)

**Interfaces:**
- Produces: `CatalogWidget.description: string`, `DashboardWidget.description: string` — Task 3(모달)이 프리뷰 패널 상단 설명 텍스트로 소비.

- [ ] **Step 1: `CatalogWidget`에 `description` 필드 추가**

`catalogRegistry.ts:26-37`을 다음으로 교체(필드 하나 추가):

```ts
export interface CatalogWidget {
  type: string
  title: string
  /** 위젯 추가 모달 프리뷰 패널에 노출되는 1줄 용도 설명. */
  description: string
  icon: LucideIcon
  category: string
  /** 그리드 크기 표기(카드 갤러리 UI 전용, row-span 미연동). */
  size: '1×1' | '1×2'
  /** 추가 즉시 적용되는 기본 params — 필터 없이 바로 위젯이 렌더된다. */
  defaultParams: Record<string, unknown>
  /** 설정 팝오버에 렌더할 필드 목록. 빈 배열이면 "필터 없음" 위젯(예: 채널/프로젝트/드라이브). */
  fields: CatalogFieldDef[]
}
```

- [ ] **Step 2: 9개 카탈로그 위젯 정의에 `description` 값 추가**

각 정의의 `title` 다음 줄에 `description` 한 줄씩 추가(`catalogRegistry.ts:50-191`, `title:` 바로 아래):

```ts
  issue_list: {
    type: 'issue_list',
    title: '이슈 목록',
    description: '내가 담당한 이슈를 우선순위 순으로 보여줍니다.',
    icon: ListTodo,
    // ...
  mail_list: {
    type: 'mail_list',
    title: '메일 목록',
    description: '선택한 폴더의 최근 메일을 보여줍니다.',
    icon: Mail,
    // ...
  calendar: {
    type: 'calendar',
    title: '캘린더',
    description: '오늘 또는 이번 주 일정을 보여줍니다.',
    icon: CalendarDays,
    // ...
  activity: {
    type: 'activity',
    title: '활동 피드',
    description: '이슈 생성·변경 등 최근 활동을 보여줍니다.',
    icon: Bell,
    // ...
  wiki: {
    type: 'wiki',
    title: '위키',
    description: '접근 가능한 노트 스페이스 목록을 보여줍니다.',
    icon: ClipboardList,
    // ...
  contacts: {
    type: 'contacts',
    title: '연락처',
    description: '구성원·외부 연락처를 검색하고 보여줍니다.',
    icon: Contact,
    // ...
  projects: {
    type: 'projects',
    title: '프로젝트',
    description: '참여 중인 프로젝트 목록을 보여줍니다.',
    icon: Folder,
    // ...
  drive: {
    type: 'drive',
    title: '드라이브',
    description: '접근 가능한 드라이브 스페이스 목록을 보여줍니다.',
    icon: Folder,
    // ...
  channels: {
    type: 'channels',
    title: '채널',
    description: '내가 속한 채널 목록을 보여줍니다.',
    icon: Hash,
    // ...
```

(각 `// ...`는 기존 `category`/`size`/`defaultParams`/`fields` 줄이 그대로 이어짐 — 삭제하지 않는다.)

- [ ] **Step 3: `DashboardWidget`에 `description` 필드 추가**

`registry.ts:20-35`를 다음으로 교체:

```ts
export interface DashboardWidget {
  type: string
  title: string
  /** 위젯 추가 모달 프리뷰 패널에 노출되는 1줄 용도 설명. */
  description: string
  icon: LucideIcon
  // 본문은 자체 훅으로 로딩/에러를 격리 처리(한 위젯 실패가 다른 위젯에 영향 X).
  // count prop = 표시할 항목 수(3·5·10). 미지정 시 본문 기본값 5.
  Component: LazyExoticComponent<ComponentType<{ count?: number }>>
  // 모듈 딥링크. 알림처럼 전용 라우트가 없는 위젯은 미지정 → 헤더 클릭 시 인박스 패널을 연다.
  deepLink?: string
  // 피드성 위젯은 그리드에서 2행을 차지(row-span). 게이트 §1.2: 활동/알림만 tall.
  tall?: boolean
  // #브레인스토밍 2026-07-02: 카운트 스트립·2x2 분면·가로 버튼처럼 1/3 폭에 찌그러지는 위젯용 —
  // true 면 lg:col-span-3(그리드 전체 폭). tall 과 독립적으로 조합 가능.
  wide?: boolean
}
```

- [ ] **Step 4: 8개 시스템 위젯 정의에 `description` 값 추가**

`registry.ts:40-99`, 각 `title:` 다음 줄:

```ts
  my_tasks: {
    type: 'my_tasks',
    title: '내 작업',
    description: '마감·차단·진행 중인 내 작업을 우선순위별로 보여줍니다.',
    icon: ClipboardList,
    // ...
  calendar_today: {
    type: 'calendar_today',
    title: '오늘 일정',
    description: '오늘 예정된 일정을 시간순으로 보여줍니다.',
    icon: CalendarDays,
    // ...
  notifications: {
    type: 'notifications',
    title: '알림',
    description: '내 차례인 항목과 최근 업데이트 알림을 보여줍니다.',
    icon: Bell,
    // ...
  recent_chats: {
    type: 'recent_chats',
    title: '대화',
    description: '최근 대화 목록과 회신 필요 여부를 보여줍니다.',
    icon: MessageSquare,
    // ...
  unread_mail: {
    type: 'unread_mail',
    title: '메일',
    description: '읽지 않은 메일과 회신 필요 메일을 보여줍니다.',
    icon: Mail,
    // ...
  synthesis: {
    type: 'synthesis',
    title: '요약',
    description: '지금 신경 써야 할 일들을 한눈에 요약해 보여줍니다.',
    icon: AlertTriangle,
    // ...
  quick_actions: {
    type: 'quick_actions',
    title: '빠른 액션',
    description: '새 이슈·메일·대화를 바로 시작하는 버튼 모음입니다.',
    icon: Zap,
    // ...
  priority_quadrant: {
    type: 'priority_quadrant',
    title: 'AI 우선순위',
    description: '중요도·긴급도 기준 4분면으로 할 일을 정리해 보여줍니다.',
    icon: Sparkles,
    // ...
```

- [ ] **Step 5: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `AddWidgetModal.tsx`가 아직 `description`을 안 쓰므로 이 시점엔 통과. (이 필드를 아직 아무도 안 읽으므로 신규 에러 없음)

- [ ] **Step 6: 커밋**

```bash
git add apps/workplace-web/src/components/home/widgets/catalogRegistry.ts apps/workplace-web/src/components/home/widgets/registry.ts
git commit -m "feat(web): 위젯 카탈로그/시스템 레지스트리에 description 필드 추가"
```

---

### Task 2: 위젯 프리뷰 목데이터 픽스처 파일 생성

**Files:**
- Create: `apps/workplace-web/src/components/home/widgets/widgetPreviewFixtures.ts`

**Interfaces:**
- Consumes: `IssueSearchResponse`(`@/types/issue`), `EmailMessageSummary`(`@/types/mailMessage`), `CalendarEvent`(`@/types/calendar`), `ActivityPage`(`@/types/home`), `WikiSpace`(`@/types/wiki`), `ContactSummary`(`@/types/contact`), `ProjectResponse`(`@/types/project`), `DriveSpace`(`@/types/drive`), `ChannelResponse`(`@/types/messaging`), `ConversationSummaryItem`/`MailSummaryItem`(`@/types/dashboard`), `PriorityItem`(`@/api/priorityItems`)
- Produces: `widgetPreviewFixtures: Record<string, unknown>` — Task 3(모달) 및 각 위젯 태스크(4~20)가 `widgetPreviewFixtures[type]`을 `previewData`로 소비.

**참고:** `IssueResponse`(`@/types/issue`)는 전체 필드를 다 확인하지 못했다(58행 이후 미조사). 위젯이 실제로 읽는 필드(`id`/`projectKey`/`number`/`title`/`status`/`priority`)만 채우고 `as unknown as IssueSearchResponse`로 캐스팅한다 — 프리뷰 목데이터는 타입 정확성보다 컴포넌트가 실제로 접근하는 필드 커버가 우선이다. `my_tasks`(Task 13)의 `buildMyTaskRows` 인자 타입은 `@/lib/myTasks.ts`를 직접 열어 확인 후 맞춘다(이 파일은 조사 범위 밖).

- [ ] **Step 1: 픽스처 파일 작성**

```ts
// apps/workplace-web/src/components/home/widgets/widgetPreviewFixtures.ts
// 위젯 추가 모달의 라이브 프리뷰용 고정 목데이터 — 17개 위젯(카탈로그 9 + 시스템 8) 전부 1세트씩.
// 실제 API 호출 없이 각 위젯 컴포넌트를 그대로 렌더하기 위한 previewData 소스(#브레인스토밍 2026-07-03).
import type { CalendarEvent } from '@/types/calendar'
import type { ContactSummary } from '@/types/contact'
import type { ConversationSummaryItem, MailSummaryItem } from '@/types/dashboard'
import type { DriveSpace } from '@/types/drive'
import type { ActivityPage } from '@/types/home'
import type { IssueSearchResponse } from '@/types/issue'
import type { EmailMessageSummary } from '@/types/mailMessage'
import type { ChannelResponse } from '@/types/messaging'
import type { ProjectResponse } from '@/types/project'
import type { WikiSpace } from '@/types/wiki'
import type { PriorityItem } from '@/api/priorityItems'

const now = '2026-07-03T09:00:00Z'

const sampleIssues: IssueSearchResponse = {
  items: [
    { id: 1, projectKey: 'SW', number: 101, title: '로그인 세션 만료 버그 수정', status: 'IN_PROGRESS', priority: 'HIGH' },
    { id: 2, projectKey: 'SW', number: 102, title: '대시보드 위젯 프리뷰 추가', status: 'TODO', priority: 'MID' },
    { id: 3, projectKey: 'SW', number: 103, title: '알림 설정 화면 정리', status: 'TODO', priority: 'LOW' },
  ] as unknown as IssueSearchResponse['items'],
  nextCursor: null,
  hasMore: false,
}

const sampleMails: EmailMessageSummary[] = [
  {
    id: 1, accountId: 1, threadId: 't1', fromAddress: 'lead@example.com', fromName: '김리드',
    subject: '이번 주 스프린트 리뷰 일정 안내', snippet: '금요일 오후 2시에 진행 예정입니다...',
    receivedAt: now, seen: false, hasAttachment: false, aiCategory: null, aiNeedsReply: true, needsReplyDoneAt: null,
  },
  {
    id: 2, accountId: 1, threadId: 't2', fromAddress: 'hr@example.com', fromName: '인사팀',
    subject: '7월 급여명세서 발송', snippet: '첨부된 명세서를 확인해 주세요.',
    receivedAt: now, seen: true, hasAttachment: true, aiCategory: null, aiNeedsReply: false, needsReplyDoneAt: null,
  },
]

const sampleEvents: CalendarEvent[] = [
  {
    id: 1, title: '주간 스탠드업', description: null, startsAt: '2026-07-03T00:00:00Z', endsAt: '2026-07-03T00:30:00Z',
    allDay: false, location: null, color: null, calendarId: 1, calendarName: '내 캘린더', effectiveColor: '#7c5cff',
    reminderMinutes: null, recurrenceRule: null, createdAt: now, updatedAt: now,
  },
  {
    id: 2, title: '분기 목표 리뷰', description: null, startsAt: '2026-07-03T05:00:00Z', endsAt: '2026-07-03T06:00:00Z',
    allDay: false, location: null, color: null, calendarId: 1, calendarName: '내 캘린더', effectiveColor: '#7c5cff',
    reminderMinutes: null, recurrenceRule: null, createdAt: now, updatedAt: now,
  },
]

const sampleActivity: ActivityPage = {
  items: [
    { id: 1, issueId: 1, projectKey: 'SW', issueNumber: 101, issueTitle: '로그인 세션 만료 버그 수정', actorId: 1, actorName: '김리드', actorKind: 'HUMAN', eventType: 'STATUS_CHANGED', createdAt: now },
    { id: 2, issueId: 2, projectKey: 'SW', issueNumber: 102, issueTitle: '대시보드 위젯 프리뷰 추가', actorId: 2, actorName: 'AI 비서', actorKind: 'AGENT', eventType: 'CREATED', createdAt: now },
  ],
  nextCursor: null,
}

const sampleWikiSpaces: WikiSpace[] = [
  { id: 1, type: 'TEAM', name: '제품팀 노트', ownerId: 1, role: 'EDITOR', createdAt: now },
  { id: 2, type: 'PERSONAL', name: '개인 노트', ownerId: 1, role: 'OWNER', createdAt: now },
]

const sampleContacts: ContactSummary[] = [
  { type: 'MEMBER', id: 1, name: '김리드', email: 'lead@example.com', title: 'PM', organization: '제품팀', isFavorite: true },
  { type: 'EXTERNAL', id: 2, name: '박협력', email: 'partner@example.com', title: '대표', organization: '협력사', isFavorite: false },
]

const sampleProjects: ProjectResponse[] = [
  { id: 1, key: 'SW', name: 'Smart Workplace', description: null, ownerId: 1, type: 'TEAM', isDefault: true, createdAt: now, updatedAt: now, issueTotal: 42, issueDone: 20, memberCount: 5, memberNames: ['김리드', '박팀원'], viewerIsMember: true },
]

const sampleDriveSpaces: DriveSpace[] = [
  { id: 1, type: 'TEAM', name: '제품팀 드라이브', ownerId: 1, role: 'EDITOR', archived: false, createdAt: now },
]

const sampleChannels: ChannelResponse[] = [
  { id: 1, kind: 'CHANNEL', name: '# 제품-일반', visibility: 'PUBLIC', member: true, role: 'MEMBER', archived: false, memberCount: 12, unreadCount: 3, hasUnreadThreads: false, lastReadMessageId: 100, createdAt: now },
]

const sampleConversations: ConversationSummaryItem[] = [
  { kind: 'DM', conversationId: 1, label: '김리드', lastAuthorName: '김리드', lastMessagePreview: '검토 끝나면 알려주세요', lastMessageAt: now, unreadCount: 1, mentioned: false, needsReply: true, newThreadReplyCount: 0, aiReason: null },
  { kind: 'CHANNEL', conversationId: 2, label: '# 제품-일반', lastAuthorName: '박팀원', lastMessagePreview: '배포 완료했습니다', lastMessageAt: now, unreadCount: 0, mentioned: true, needsReply: false, newThreadReplyCount: 2, aiReason: null },
]

const sampleMailSummary: MailSummaryItem[] = [
  { id: 1, accountId: 1, subject: '이번 주 스프린트 리뷰 일정 안내', fromAddress: 'lead@example.com', fromName: '김리드', snippet: '금요일 오후 2시에 진행 예정입니다...', receivedAt: now, seen: false, hasAttachment: false, aiCategory: null, aiNeedsReply: true, needsReplyDoneAt: null },
]

const samplePriorityItems: PriorityItem[] = [
  { sourceType: 'issue', sourceId: '1', title: '로그인 세션 만료 버그 수정', deepLink: '/projects/SW/issues/101', importanceScore: 80, urgencyScore: 90, reason: '마감 임박' },
  { sourceType: 'mail', sourceId: '1', title: '이번 주 스프린트 리뷰 일정 안내', deepLink: '/mail', importanceScore: 60, urgencyScore: 40, reason: '회신 대기' },
]

/** 위젯 type/key → 프리뷰용 목데이터. AddWidgetModal 프리뷰 패널이 previewData prop 으로 그대로 주입한다. */
export const widgetPreviewFixtures: Record<string, unknown> = {
  // 카탈로그 위젯 9종
  issue_list: sampleIssues,
  mail_list: sampleMails,
  calendar: sampleEvents,
  activity: sampleActivity,
  wiki: sampleWikiSpaces,
  contacts: sampleContacts,
  projects: sampleProjects,
  drive: sampleDriveSpaces,
  channels: sampleChannels,
  // 시스템 위젯 8종(my_tasks/notifications 는 각 위젯 태스크에서 실제 훅 인자 타입 확인 후 채움)
  my_tasks: { assigned: sampleIssues, watched: sampleIssues },
  calendar_today: sampleEvents,
  notifications: [],
  recent_chats: sampleConversations,
  unread_mail: sampleMailSummary,
  synthesis: undefined,
  quick_actions: undefined,
  priority_quadrant: samplePriorityItems,
}
```

- [ ] **Step 2: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: PASS (새 파일은 아직 아무도 import하지 않으므로 자체 타입 오류만 검증됨). `IssueResponse`/`ContactSummary` 등 필드가 실제 타입과 다르면 여기서 에러가 나므로, 에러가 나면 해당 `@/types/*.ts` 파일을 열어 정확한 필드명으로 고친다.

- [ ] **Step 3: 커밋**

```bash
git add apps/workplace-web/src/components/home/widgets/widgetPreviewFixtures.ts
git commit -m "feat(web): 위젯 프리뷰 목데이터 픽스처 추가"
```

---

### Task 3: `AddWidgetModal` 3단 레이아웃 + 선택→프리뷰→추가 플로우

**Files:**
- Modify: `apps/workplace-web/src/components/home/widgets/AddWidgetModal.tsx` (전체 재작성)

**Interfaces:**
- Consumes: `getChatWidget(type)`(`./chatWidgetRegistry`), `getDashboardWidget(type)`(`./registry`), `widgetPreviewFixtures`(`./widgetPreviewFixtures`, Task 2), `CatalogWidget.description`/`DashboardWidget.description`(Task 1)
- Produces: 기존 `AddWidgetModal` public prop 시그니처는 그대로 유지(`open`/`onOpenChange`/`systemWidgets`/`catalogWidgets`/`disabled`/`onAdd`) — `Dashboard.tsx` 등 호출부 변경 불필요.

- [ ] **Step 1: `AddWidgetModal.tsx` 전체를 아래 코드로 교체**

```tsx
// 위젯 추가 모달 — 좌: 카테고리, 중: 카드 목록, 우: 선택한 위젯의 라이브 프리뷰(목데이터).
// 카드 클릭은 선택(하이라이트)만 하고, 프리뷰 패널의 "+ 위젯 추가" 버튼을 눌러야 실제로 추가된다
// (예전엔 카드 클릭 = 즉시 추가였으나, 어떤 위젯인지 모르고 고르는 문제를 해결하기 위해 변경).
import { Suspense, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

import { CATALOG_CATEGORIES, type CatalogWidget } from './catalogRegistry'
import { getChatWidget } from './chatWidgetRegistry'
import { getDashboardWidget, type DashboardWidget } from './registry'
import { widgetPreviewFixtures } from './widgetPreviewFixtures'

const ALL_CATEGORY = '전체'
const SYSTEM_CATEGORY = '기본'

// 시스템 위젯 크기 라벨 — tall(행 2칸)·wide(그리드 전체 폭 3칸) 조합에 따라 실제 그리드 점유 크기를 표시.
function systemSizeLabel(w: DashboardWidget): string {
  const cols = w.wide ? 3 : 1
  const rows = w.tall ? 2 : 1
  return `${cols}×${rows}`
}

type CardEntry =
  | { kind: 'system'; widget: DashboardWidget }
  | { kind: 'catalog'; widget: CatalogWidget }

export function AddWidgetModal({
  open,
  onOpenChange,
  systemWidgets,
  catalogWidgets,
  disabled,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** draft 에 아직 없는 시스템 위젯만(싱글턴 재추가 경로). */
  systemWidgets: DashboardWidget[]
  /** 카탈로그 위젯 전체(항상 노출, 다중 추가 허용). */
  catalogWidgets: CatalogWidget[]
  /** 총 인스턴스 상한 도달 시 카드 클릭 비활성화. */
  disabled: boolean
  onAdd: (type: string) => void
}) {
  const [category, setCategory] = useState<string>(ALL_CATEGORY)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const categories = [ALL_CATEGORY, SYSTEM_CATEGORY, ...CATALOG_CATEGORIES]

  const visibleSystem: CardEntry[] =
    (category === ALL_CATEGORY || category === SYSTEM_CATEGORY ? systemWidgets : []).map((widget) => ({
      kind: 'system',
      widget,
    }))
  const visibleCatalog: CardEntry[] = (
    category === ALL_CATEGORY ? catalogWidgets : catalogWidgets.filter((w) => w.category === category)
  ).map((widget) => ({ kind: 'catalog', widget }))
  const visible = [...visibleSystem, ...visibleCatalog]

  // 카테고리를 바꾸면(또는 모달을 열면) 해당 목록의 첫 카드를 자동 선택 — 빈 프리뷰 상태 없음.
  useEffect(() => {
    if (!open) return
    setSelectedType(visible.length > 0 ? visible[0].widget.type : null)
    // category/open 변경 시에만 재선택. visible 은 category 에서 파생되므로 의존성에서 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category])

  const selectedEntry = visible.find((e) => e.widget.type === selectedType) ?? null

  function handleAdd() {
    if (disabled || !selectedType) return
    onAdd(selectedType)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl" data-testid="add-widget-modal">
        <DialogHeader>
          <DialogTitle>위젯 추가</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex shrink-0 gap-1 overflow-x-auto lg:w-32 lg:flex-col lg:overflow-visible lg:space-y-1" data-testid="add-widget-categories">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`shrink-0 rounded-md px-2 py-1.5 text-left text-sm ${
                  category === c
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50'
                }`}
                data-testid="add-widget-category"
                data-category={c}
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div
            className="flex w-full max-h-56 shrink-0 flex-col gap-2 overflow-y-auto lg:w-56 lg:max-h-[70vh]"
            data-testid="add-widget-grid"
          >
            {visible.map(({ kind, widget }) => {
              const Icon = widget.icon
              const selected = widget.type === selectedType
              return (
                <button
                  key={widget.type}
                  type="button"
                  className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected ? 'border-ai-accent bg-ai-accent/5' : 'hover:border-ai-accent'
                  }`}
                  data-testid="add-widget-card"
                  data-widget-type={widget.type}
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => setSelectedType(widget.type)}
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium">{widget.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {kind === 'system' ? `기본 위젯 · ${systemSizeLabel(widget)}` : `${widget.category} · ${widget.size}`}
                  </span>
                </button>
              )
            })}
            {visible.length === 0 && (
              <p className="text-sm text-muted-foreground">이 카테고리에 추가할 수 있는 위젯이 없습니다.</p>
            )}
          </div>
          <div className="flex min-h-[24rem] flex-1 flex-col" data-testid="add-widget-preview">
            {selectedEntry ? (
              <>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">미리보기</div>
                <div className="mb-1 text-base font-bold">{selectedEntry.widget.title}</div>
                <p className="mb-3 text-xs text-muted-foreground">{selectedEntry.widget.description}</p>
                <div className="flex-1 overflow-y-auto rounded-md border p-3">
                  <Suspense fallback={<Skeleton className="h-24 w-full" />}>
                    <PreviewBody entry={selectedEntry} />
                  </Suspense>
                </div>
                <Button className="mt-3 self-end" disabled={disabled} onClick={handleAdd} data-testid="add-widget-confirm">
                  + 위젯 추가
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">왼쪽 목록에서 위젯을 선택하세요.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// 선택된 위젯을 실제 컴포넌트로 렌더 — 카탈로그는 chatWidgetRegistry, 시스템은 registry 를 그대로 재사용.
// previewData 를 주입해 실제 API 호출 없이 목데이터로 즉시 렌더한다(각 위젯 컴포넌트가 자체 지원).
function PreviewBody({ entry }: { entry: CardEntry }) {
  const previewData = widgetPreviewFixtures[entry.widget.type]
  if (entry.kind === 'catalog') {
    const Component = getChatWidget(entry.widget.type)
    if (!Component) return null
    return <Component params={entry.widget.defaultParams} previewData={previewData} />
  }
  const def = getDashboardWidget(entry.widget.type)
  if (!def) return null
  const { Component } = def
  return <Component count={5} previewData={previewData} />
}
```

- [ ] **Step 2: 타입 체크(예상 실패 — 아직 각 위젯이 `previewData` prop을 안 받음)**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: FAIL — `Property 'previewData' does not exist on type ...` 에러가 카탈로그/시스템 위젯 컴포넌트 시그니처마다 발생. (Task 4~20에서 각 위젯에 `previewData`를 추가하면 해소됨 — 이 시점의 실패는 정상)

- [ ] **Step 3: 커밋(타입 에러 있는 채로 중간 커밋 — 후속 태스크에서 해소)**

```bash
git add apps/workplace-web/src/components/home/widgets/AddWidgetModal.tsx
git commit -m "feat(web): 위젯 추가 모달 3단 레이아웃(카테고리/목록/프리뷰) 전환"
```

---

### Task 4: `IssueListWidget` + `useMyIssues` 프리뷰 지원 (카탈로그 `issue_list`)

**Files:**
- Modify: `apps/workplace-web/src/hooks/queries/useHomeQueries.ts:21-27`
- Modify: `apps/workplace-web/src/components/home/widgets/IssueListWidget.tsx:25-26`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.issue_list`(Task 2, `IssueSearchResponse`)
- Produces: `useMyIssues(params, options?: { enabled?: boolean })` — Task 13(`MyTasksBody`)도 이 시그니처를 그대로 사용.

- [ ] **Step 1: `useMyIssues`에 `enabled` 옵션 추가**

`useHomeQueries.ts:21-27`을 다음으로 교체:

```ts
export function useMyIssues(params: Record<string, unknown>, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: homeKeys.myIssues(params),
    queryFn: () => homeApi.myIssues(params).then((r) => r.data),
    retry: false,
    enabled: options?.enabled ?? true,
  });
}
```

- [ ] **Step 2: `IssueListWidget`에 `previewData` prop 추가**

`IssueListWidget.tsx:25-26`을 다음으로 교체:

```tsx
export default function IssueListWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: IssueSearchResponse
}) {
  const { data: queryData, isLoading, isError, refetch } = useMyIssues(params ?? { assignee: 'me' }, {
    enabled: !previewData,
  });
  const data = previewData ?? queryData;
```

`IssueListWidget.tsx` 상단 import 목록에 `import type { IssueSearchResponse } from '@/types/issue';` 추가.

이후 렌더 블록(29행 이하)에서 `isLoading`을 `!previewData && isLoading`으로, `isError`를 `!previewData && isError`로 감싼다(원본 삼항 체인 구조는 그대로 유지, 조건식만 교체):

```tsx
  return (
    <WidgetFrame title="이슈 목록">
      {!previewData && isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : !previewData && isError ? (
        <WidgetError onRetry={() => refetch()} testId="issuelist-error" />
      ) : data && data.items.length > 0 ? (
        // ... 기존 34-63행 내용 그대로
```

(63행 이후의 빈 상태 블록도 그대로 유지 — `data`가 `previewData`로 대체됐을 뿐 구조는 동일.)

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `issue_list` 관련 에러 소거. (다른 16개 위젯의 `previewData` 에러는 아직 남아있음 — 정상)

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/useHomeQueries.ts apps/workplace-web/src/components/home/widgets/IssueListWidget.tsx
git commit -m "feat(web): IssueListWidget 프리뷰(previewData) 지원"
```

---

### Task 5: `ActivityWidget` + `useActivity` 프리뷰 지원 (카탈로그 `activity`)

**Files:**
- Modify: `apps/workplace-web/src/hooks/queries/useHomeQueries.ts:39-44`(Task 4에서 이미 연 파일)
- Modify: `apps/workplace-web/src/components/home/widgets/ActivityWidget.tsx:37-39`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.activity`(Task 2, `ActivityPage`)

- [ ] **Step 1: `useActivity`에 `enabled` 옵션 추가**

```ts
export function useActivity(actorKind?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: homeKeys.activity(actorKind),
    queryFn: () => homeApi.activity({ actorKind, size: 20 }).then((r) => r.data),
    retry: false,
    enabled: options?.enabled ?? true,
  });
}
```

- [ ] **Step 2: `ActivityWidget`에 `previewData` prop 추가**

```tsx
export default function ActivityWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: ActivityPage
}) {
  const actorKind = params?.actorKind as string | undefined;
  const { data: queryData, isLoading, isError, refetch } = useActivity(actorKind, { enabled: !previewData });
  const data = previewData ?? queryData;
```

`import type { ActivityPage } from '@/types/home';` 추가. 43-46행의 `isLoading`/`isError` 조건도 Task 4와 동일하게 `!previewData && isLoading` / `!previewData && isError`로 감싼다.

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `activity` 관련 에러 소거.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/useHomeQueries.ts apps/workplace-web/src/components/home/widgets/ActivityWidget.tsx
git commit -m "feat(web): ActivityWidget 프리뷰(previewData) 지원"
```

---

### Task 6: `CalendarWidget` + `useCalendarEvents` 프리뷰 지원 (카탈로그 `calendar`)

**Files:**
- Modify: `apps/workplace-web/src/hooks/queries/useCalendarEvents.ts:8-14`
- Modify: `apps/workplace-web/src/components/home/widgets/CalendarWidget.tsx:52-55`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.calendar`(Task 2, `CalendarEvent[]`)
- Produces: `useCalendarEvents(from, to, options?: { enabled?: boolean })` — Task 14(`CalendarTodayBody`)도 동일 시그니처 재사용.

- [ ] **Step 1: `useCalendarEvents`에 `enabled` 옵션 추가**

```ts
export function useCalendarEvents(from: string, to: string, options?: { enabled?: boolean }) {
  return useQuery<CalendarEvent[]>({
    queryKey: calendarKeys.range(from, to),
    queryFn: () => calendarApi.list(from, to).then((r) => r.data),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  })
}
```

- [ ] **Step 2: `CalendarWidget`에 `previewData` prop 추가**

```tsx
export default function CalendarWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: CalendarEvent[]
}) {
  const { from, to } = resolveRange(params);

  const { data: queryData, isLoading, isError, refetch } = useCalendarEvents(from, to, { enabled: !previewData });
  const data = previewData ?? queryData;
```

57행/65행의 `isLoading`/`isError`도 `!previewData &&`로 감싼다.

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `calendar` 관련 에러 소거.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/useCalendarEvents.ts apps/workplace-web/src/components/home/widgets/CalendarWidget.tsx
git commit -m "feat(web): CalendarWidget 프리뷰(previewData) 지원"
```

---

### Task 7: `MailListWidget` + `useMailAccounts`/`useMailMessages` 프리뷰 지원 (카탈로그 `mail_list`)

**Files:**
- Modify: `apps/workplace-web/src/hooks/queries/useMailAccounts.ts:22-26`
- Modify: `apps/workplace-web/src/hooks/queries/useMailMessages.ts:23-39`
- Modify: `apps/workplace-web/src/components/home/widgets/MailListWidget.tsx:30-45`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.mail_list`(Task 2, `EmailMessageSummary[]`)

이 위젯은 계정 목록(`accounts`)과 선택 계정 메시지(`messages`) 두 훅이 순차 결합돼 있다(파일 30~45행에 `accountId` 도출 로직이 있음 — 정확한 코드는 파일을 열어 확인). `previewData`가 있으면 두 훅 모두 비활성화하고, `accountId` 도출 결과와 무관하게 "계정 없음" 분기를 건너뛰도록 만든다.

- [ ] **Step 1: `useMailAccounts`에 `enabled` 옵션 추가**

```ts
export function useMailAccounts(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: mailAccountKeys.all,
    queryFn: listMailAccounts,
    enabled: options?.enabled ?? true,
  });
}
```

- [ ] **Step 2: `useMailMessages`에 `options` 7번째 인자 추가**

```ts
export function useMailMessages(
  accountId: number | undefined,
  folder: MailFolder,
  query: string,
  unread = false,
  category = '',
  needsReply = false,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: mailMessageKeys.list(accountId ?? 0, folder, query, unread, category, needsReply),
    queryFn: () =>
      listMessages(accountId as number, folder, query || undefined, unread,
                   category || undefined, needsReply),
    enabled: (options?.enabled ?? true) && !!accountId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
```

- [ ] **Step 3: `MailListWidget`에 `previewData` prop 추가**

`MailListWidget.tsx:30-45` 부근을 다음 방향으로 수정한다(정확한 `accountId` 계산식은 실제 파일에서 확인 후, `previewData` 존재 시 두 훅을 비활성화하고 렌더 분기를 프리뷰 데이터로 단축):

```tsx
export default function MailListWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: EmailMessageSummary[]
}) {
  // ... 기존 title/folder/query/unreadOnly 등 params 파싱 로직 그대로 유지 ...
  const accounts = useMailAccounts({ enabled: !previewData });
  // accountId 도출 로직(기존 코드 그대로) — previewData 존재 시에도 그대로 두되,
  // 아래 messages 훅과 렌더 분기에서 previewData 를 우선한다.
  const messages = useMailMessages(accountId, folder, query, unreadOnly, '', false, { enabled: !previewData });

  // previewData 가 있으면 계정 로딩/에러/미설정 분기를 모두 건너뛰고 바로 콘텐츠를 렌더한다.
  if (previewData) {
    return (
      <WidgetFrame title={title}>
        {previewData.length > 0 ? (
          <ul className="divide-y" data-testid="maillist-items">
            {previewData.map((m) => (
              <li key={m.id}>
                <Link
                  to="/mail"
                  aria-label={`메일 열기: ${m.subject?.trim() || '(제목 없음)'}`}
                  className="flex items-center gap-2 py-2 text-sm hover:text-ai-accent"
                >
                  <span
                    aria-hidden
                    className={`size-1.5 shrink-0 rounded-full ${m.seen ? 'bg-transparent' : 'bg-ai-accent'}`}
                  />
                  <span className="w-10 shrink-0 text-xs text-muted-foreground">{shortDate(m.receivedAt)}</span>
                  <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{sender(m)}</span>
                  <span className={`flex-1 truncate ${m.seen ? '' : 'font-medium'}`}>
                    {m.subject?.trim() || '(제목 없음)'}
                  </span>
                  {m.hasAttachment && (
                    <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-label="첨부 있음" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center" data-testid="maillist-empty">
            <Mail className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-semibold">메일이 없어요</p>
            <p className="max-w-xs text-xs text-muted-foreground">{title}에 표시할 메일이 없습니다.</p>
          </div>
        )}
      </WidgetFrame>
    );
  }

  // ... 이하 기존 45-131행 로직(계정 로딩/에러/미설정 → 메시지 로딩/에러/빈/콘텐츠) 그대로 유지 ...
}
```

(`shortDate`/`sender` 헬퍼는 기존 파일에 이미 정의돼 있으므로 그대로 재사용.)

- [ ] **Step 4: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `mail_list` 관련 에러 소거.

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/useMailAccounts.ts apps/workplace-web/src/hooks/queries/useMailMessages.ts apps/workplace-web/src/components/home/widgets/MailListWidget.tsx
git commit -m "feat(web): MailListWidget 프리뷰(previewData) 지원"
```

---

### Task 8: `WikiWidget` + `useWikiSpaces` 프리뷰 지원 (카탈로그 `wiki`)

**Files:**
- Modify: `apps/workplace-web/src/hooks/queries/useWikiSpaces.ts:7-11`
- Modify: `apps/workplace-web/src/components/home/widgets/WikiWidget.tsx:18-27`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.wiki`(Task 2, `WikiSpace[]`)

카탈로그 `wiki`의 `defaultParams`는 `{}`이므로 `spaceId`가 항상 `undefined` → 위젯은 항상 "스페이스 모드"로 렌더된다. `useWikiTree`(페이지 모드)는 이미 `enabled: spaceId != null`이라 `spaceId`가 없는 프리뷰에서 자연히 비활성 상태이므로 수정 불필요.

- [ ] **Step 1: `useWikiSpaces`에 `enabled` 옵션 추가**

```ts
export function useWikiSpaces(options?: { enabled?: boolean }) {
  return useQuery<WikiSpace[]>({
    queryKey: wikiKeys.spaces(),
    queryFn: () => wikiApi.listSpaces().then((r) => r.data),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  })
}
```

- [ ] **Step 2: `WikiWidget`에 `previewData` prop 추가**

```tsx
export default function WikiWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: WikiSpace[]
}) {
  const spaceId = params?.spaceId != null ? Number(params.spaceId) : null
  const query = typeof params?.query === 'string' ? params.query.toLowerCase() : ''
  const spaces = useWikiSpaces({ enabled: !previewData })
  const tree = useWikiTree(spaceId)
  const isSpaceMode = spaceId === null
```

(기존 파라미터 파싱 줄은 그대로 두고 `useWikiSpaces()` 호출만 옵션을 받도록 교체.) 스페이스 모드 블록(30-78행)에서 `spaces.data`를 읽는 지점(45행)을 `previewData ?? spaces.data`로 교체하고, 30/37행의 `spaces.isLoading`/`spaces.isError`를 `!previewData && spaces.isLoading` / `!previewData && spaces.isError`로 감싼다.

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `wiki` 관련 에러 소거.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/useWikiSpaces.ts apps/workplace-web/src/components/home/widgets/WikiWidget.tsx
git commit -m "feat(web): WikiWidget 프리뷰(previewData) 지원"
```

---

### Task 9: `ContactsWidget` + `useContacts` 프리뷰 지원 (카탈로그 `contacts`)

**Files:**
- Modify: `apps/workplace-web/src/hooks/queries/useContacts.ts:8-32`
- Modify: `apps/workplace-web/src/components/home/widgets/ContactsWidget.tsx:17-25`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.contacts`(Task 2, `ContactSummary[]`)

- [ ] **Step 1: `useContacts`에 `enabled` 옵션 추가**

```ts
export function useContacts(
  search: string,
  type: ContactTypeFilter,
  organization?: string,
  title?: string,
  options?: { enabled?: boolean },
) {
  return useInfiniteQuery<ContactPage>({
    queryKey: contactKeys.list(search, type, organization, title),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      contactsApi
        .list({
          search: search.trim() || undefined,
          type: type === 'FAVORITE' ? undefined : type,
          favorite: type === 'FAVORITE' ? true : undefined,
          organization: organization || undefined,
          title: title || undefined,
          cursor: pageParam as string | undefined,
        })
        .then((r) => r.data),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  })
}
```

- [ ] **Step 2: `ContactsWidget`에 `previewData` prop 추가**

```tsx
export default function ContactsWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: ContactSummary[]
}) {
  const search = typeof params?.search === 'string' ? params.search : ''
  const typeFilter = (params?.type as ContactTypeFilter) ?? 'ALL'
  const org = typeof params?.organization === 'string' ? params.organization : undefined
  const title = typeof params?.title === 'string' ? params.title : undefined
  const { data: queryData, isLoading, isError, refetch } = useContacts(search, typeFilter, org, title, {
    enabled: !previewData,
  })
```

(위 4개 파라미터 파싱 줄은 기존 17-24행 로직을 그대로 옮긴 것 — 실제 파일의 변수명과 다르면 기존 변수명 유지.) `import type { ContactSummary } from '@/types/contact'` 추가. 42행의 `data?.pages?.[0]?.items`를 `previewData ?? data?.pages?.[0]?.items`로, 27/34행의 로딩/에러 조건을 `!previewData &&`로 감싼다.

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `contacts` 관련 에러 소거.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/useContacts.ts apps/workplace-web/src/components/home/widgets/ContactsWidget.tsx
git commit -m "feat(web): ContactsWidget 프리뷰(previewData) 지원"
```

---

### Task 10: `ProjectsWidget` + `useProjects` 프리뷰 지원 (카탈로그 `projects`)

**Files:**
- Modify: `apps/workplace-web/src/hooks/queries/useProjects.ts:14-18`
- Modify: `apps/workplace-web/src/components/home/widgets/ProjectsWidget.tsx:16-17`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.projects`(Task 2, `ProjectResponse[]`)

- [ ] **Step 1: `useProjects`에 `enabled` 옵션 추가**

```ts
export function useProjects(page = 0, size = 20, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: projectKeys.list(page, size),
    queryFn: () => projectsApi.list({ page, size }).then(r => r.data),
    enabled: options?.enabled ?? true,
  });
}
```

- [ ] **Step 2: `ProjectsWidget`에 `previewData` prop 추가**

현재 `ProjectsWidget`은 인자를 받지 않는다(`export default function ProjectsWidget()`). `chatWidgetRegistry`/`AddWidgetModal`의 `PreviewBody`는 모든 위젯에 `params`/`previewData`를 전달하므로, 여기서부터 prop을 받도록 시그니처를 넓힌다:

```tsx
export default function ProjectsWidget({
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: ProjectResponse[]
}) {
  const { data: queryData, isLoading, isError, refetch } = useProjects(0, 20, { enabled: !previewData })
  const data = previewData ? { content: previewData } : queryData
```

(`params`는 이 위젯이 실제로 안 쓰므로 타입에만 선언하고 구조분해하지 않는다.) 19/26행의 로딩/에러 조건을 `!previewData &&`로 감싼다.

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `projects` 관련 에러 소거.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/useProjects.ts apps/workplace-web/src/components/home/widgets/ProjectsWidget.tsx
git commit -m "feat(web): ProjectsWidget 프리뷰(previewData) 지원"
```

---

### Task 11: `DriveWidget` + `useDriveSpaces` 프리뷰 지원 (카탈로그 `drive`)

**Files:**
- Modify: `apps/workplace-web/src/hooks/queries/useDriveSpaces.ts:7-12`
- Modify: `apps/workplace-web/src/components/home/widgets/DriveWidget.tsx:16-25`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.drive`(Task 2, `DriveSpace[]`)

Task 8(wiki)과 동일한 이유로 — 카탈로그 `drive`의 `defaultParams`가 `{}`라 항상 스페이스 모드이며, `useDriveItems`(아이템 모드)는 `spaceId` 미지정 시 이미 자연히 비활성화되므로 수정 불필요.

- [ ] **Step 1: `useDriveSpaces`에 `enabled` 옵션 추가**

```ts
export function useDriveSpaces(options?: { enabled?: boolean }) {
  return useQuery<DriveSpace[]>({
    queryKey: ['drive', 'spaces'],
    queryFn: () => driveApi.listSpaces().then((r) => r.data),
    retry: false,
    enabled: options?.enabled ?? true,
  })
}
```

- [ ] **Step 2: `DriveWidget`에 `previewData` prop 추가**

```tsx
export default function DriveWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: DriveSpace[]
}) {
  const spaceId = params?.spaceId != null ? Number(params.spaceId) : undefined
  const folderId = params?.folderId != null ? Number(params.folderId) : undefined
  const spaces = useDriveSpaces({ enabled: !previewData })
  const items = useDriveItems(spaceId, folderId)
  const isSpaceMode = spaceId === undefined
```

(파라미터 파싱 줄은 기존 로직 유지, `useDriveSpaces()` 호출만 옵션 추가.) 스페이스 모드 블록의 `spaces.data`(44행)를 `previewData ?? spaces.data`로, 29/36행의 로딩/에러 조건을 `!previewData &&`로 감싼다.

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `drive` 관련 에러 소거.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/useDriveSpaces.ts apps/workplace-web/src/components/home/widgets/DriveWidget.tsx
git commit -m "feat(web): DriveWidget 프리뷰(previewData) 지원"
```

---

### Task 12: `ChannelsWidget` + `useMyChannels` 프리뷰 지원 (카탈로그 `channels`)

**Files:**
- Modify: `apps/workplace-web/src/hooks/queries/useMyChannels.ts:8-13`
- Modify: `apps/workplace-web/src/components/home/widgets/ChannelsWidget.tsx:22-23`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.channels`(Task 2, `ChannelResponse[]`)

- [ ] **Step 1: `useMyChannels`에 `enabled` 옵션 추가**

```ts
export function useMyChannels(options?: { enabled?: boolean }) {
  return useQuery<ChannelResponse[]>({
    queryKey: messagingKeys.channels(),
    queryFn: () => messagingApi.listChannels().then((r) => r.data),
    staleTime: 10_000,
    enabled: options?.enabled ?? true,
  });
}
```

- [ ] **Step 2: `ChannelsWidget`에 `previewData` prop 추가**

```tsx
export default function ChannelsWidget({
  params: _params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: ChannelResponse[]
}) {
  const channels = useMyChannels({ enabled: !previewData });
  const items = (previewData ?? channels.data ?? []).slice(0, 20);
```

(기존 43행 `const items = (channels.data ?? []).slice(0, 20);`을 위와 같이 교체.) 26/34행의 `channels.isLoading`/`channels.isError` 조건을 `!previewData && channels.isLoading` / `!previewData && channels.isError`로 감싼다.

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `channels` 관련 에러 소거.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/useMyChannels.ts apps/workplace-web/src/components/home/widgets/ChannelsWidget.tsx
git commit -m "feat(web): ChannelsWidget 프리뷰(previewData) 지원"
```

---

### Task 13: `MyTasksBody` + `useWatchedIssues` 프리뷰 지원 (시스템 `my_tasks`)

**Files:**
- Modify: `apps/workplace-web/src/hooks/queries/useWatchedIssues.ts:8-14`
- Modify: `apps/workplace-web/src/components/home/widgets/dashboard/MyTasksBody.tsx:22-24`
- Read (변경 없음, 확인용): `apps/workplace-web/src/lib/myTasks.ts` — `buildMyTaskRows` 정확한 인자/반환 타입 확인

**Interfaces:**
- Consumes: `widgetPreviewFixtures.my_tasks`(Task 2, `{ assigned: IssueSearchResponse; watched: IssueSearchResponse }`)

`useMyIssues`는 Task 4에서 이미 `options?: { enabled?: boolean }`를 지원하도록 바뀌었으므로 여기서는 `useWatchedIssues`만 추가로 손본다. `buildMyTaskRows`(`@/lib/myTasks.ts`)가 받는 정확한 인자 타입은 이 조사에서 확인하지 못했으므로, 구현 전 해당 파일을 열어 시그니처를 확인하고 `assigned.data`/`watched.data` 대신 `previewData.assigned`/`previewData.watched`를 넘기도록 맞춘다(픽스처의 `{ assigned, watched }` 형태가 실제 시그니처와 다르면 `widgetPreviewFixtures.ts`의 `my_tasks` 항목을 맞춰 수정).

- [ ] **Step 1: `useWatchedIssues`에 `enabled` 옵션 추가**

```ts
export function useWatchedIssues(size = 30, options?: { enabled?: boolean }) {
  return useInfiniteQuery<IssueSearchResponse, Error>({
    queryKey: ['watched-issues', size],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchWatchedIssues(pageParam as string | null, size),
    getNextPageParam: (last) => last.nextCursor,
    enabled: options?.enabled ?? true,
  });
}
```

- [ ] **Step 2: `MyTasksBody`에 `previewData` prop 추가**

```tsx
export default function MyTasksBody({
  count: limit = 5,
  previewData,
}: {
  count?: number
  previewData?: { assigned: IssueSearchResponse; watched: IssueSearchResponse }
}) {
  const assigned = useMyIssues({ assignee: 'me', size: 50 }, { enabled: !previewData })
  const watched = useWatchedIssues(30, { enabled: !previewData })
  // buildMyTaskRows 호출부(기존 코드)에서 assigned.data/watched.data 대신
  // previewData ? previewData.assigned : assigned.data, previewData ? previewData.watched : watched.data 형태로 소스 결정.
  // isLoading/isError 파생 변수(25/27행)도 `!previewData && (...)`로 감싼다.
```

`import type { IssueSearchResponse } from '@/types/issue'` 추가(없다면).

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `my_tasks` 관련 에러 소거. `buildMyTaskRows` 인자 타입이 픽스처와 안 맞으면 에러가 나므로, 그 경우 `widgetPreviewFixtures.ts`의 `my_tasks` 항목을 실제 시그니처에 맞게 조정.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/useWatchedIssues.ts apps/workplace-web/src/components/home/widgets/dashboard/MyTasksBody.tsx apps/workplace-web/src/components/home/widgets/widgetPreviewFixtures.ts
git commit -m "feat(web): MyTasksBody 프리뷰(previewData) 지원"
```

---

### Task 14: `CalendarTodayBody` 프리뷰 지원 (시스템 `calendar_today`)

**Files:**
- Modify: `apps/workplace-web/src/components/home/widgets/dashboard/CalendarTodayBody.tsx:51-55`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.calendar_today`(Task 2, `CalendarEvent[]`) — Task 6에서 이미 `useCalendarEvents`에 `enabled` 옵션을 추가했으므로 훅 파일 변경은 불필요.

- [ ] **Step 1: `CalendarTodayBody`에 `previewData` prop 추가**

```tsx
export default function CalendarTodayBody({
  count = 5,
  previewData,
}: {
  count?: number
  previewData?: CalendarEvent[]
}) {
  const { from, to } = todayRange()
  const { data: queryData, isLoading, isError, refetch } = useCalendarEvents(from, to, { enabled: !previewData })
  const data = previewData ?? queryData
```

56행 `if (isLoading)`을 `if (!previewData && isLoading)`으로, 62행 `if (isError)`를 `if (!previewData && isError)`로 교체. `import type { CalendarEvent } from '@/types/calendar'` 추가(없다면).

- [ ] **Step 2: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `calendar_today` 관련 에러 소거.

- [ ] **Step 3: 커밋**

```bash
git add apps/workplace-web/src/components/home/widgets/dashboard/CalendarTodayBody.tsx
git commit -m "feat(web): CalendarTodayBody 프리뷰(previewData) 지원"
```

---

### Task 15: `NotificationsBody` 프리뷰 지원 (시스템 `notifications`)

**Files:**
- Modify: `apps/workplace-web/src/components/home/widgets/dashboard/NotificationsBody.tsx:17-21`
- Read (변경 없음, 확인용): `apps/workplace-web/src/types/notification.ts`, `apps/workplace-web/src/lib/notifGrouping.ts` — 알림 원본 아이템 타입과 `groupNotifications()` 시그니처 확인

**Interfaces:**
- Consumes: `widgetPreviewFixtures.notifications`(Task 2 — 이 태스크에서 실제 타입으로 채움)

`useNotifications(enabled: boolean)`는 이미 boolean 위치 인자를 받으므로 훅 파일은 변경할 필요가 없다 — 호출부에서 `!previewData`를 넘기면 된다. `groupNotifications()`가 소비하는 원본 아이템 타입은 `@/types/notification.ts`를 열어 확인한 뒤, 픽스처 파일의 `notifications: []`를 해당 타입의 샘플 2~3건으로 채운다(예: 멘션 1건 + 상태 변경 1건).

- [ ] **Step 1: `NotificationsBody`에 `previewData` prop 추가**

```tsx
export default function NotificationsBody({
  count = 5,
  previewData,
}: {
  count?: number
  previewData?: /* @/types/notification.ts 에서 확인한 원본 알림 아이템 배열 타입 */ unknown[]
}) {
  const list = useNotifications(!previewData)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const rawItems = previewData ?? list.data
  // 이하 groupNotifications(rawItems) 등 기존 로직에서 list.data 를 rawItems 로 교체.
  // 24행 list.isLoading, 30행 list.isError 조건도 `!previewData && (...)`로 감싼다.
```

- [ ] **Step 2: 픽스처 채우기**

`widgetPreviewFixtures.ts`의 `notifications: []`를 확인한 실제 타입에 맞춰 2~3건의 샘플 알림으로 교체(예: "내 차례" 알림 1건 + "업데이트" 알림 1건 — 라벨은 `NotificationsBody`의 `mine`/`updatesAll` 분류 조건에 맞춰 작성).

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `notifications` 관련 에러 소거.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/components/home/widgets/dashboard/NotificationsBody.tsx apps/workplace-web/src/components/home/widgets/widgetPreviewFixtures.ts
git commit -m "feat(web): NotificationsBody 프리뷰(previewData) 지원"
```

---

### Task 16: `ConversationsBody` + `useMessagingSummary` 프리뷰 지원 (시스템 `recent_chats`)

**Files:**
- Modify: `apps/workplace-web/src/hooks/queries/useMessagingSummary.ts:6-12`
- Modify: `apps/workplace-web/src/components/home/widgets/dashboard/ConversationsBody.tsx:62-63`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.recent_chats`(Task 2, `ConversationSummaryItem[]`)

- [ ] **Step 1: `useMessagingSummary`에 `enabled` 옵션 추가**

```ts
export function useMessagingSummary(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['messaging-summary'],
    queryFn: messagingSummaryApi.get,
    staleTime: 30_000,
    retry: false,
    enabled: options?.enabled ?? true,
  })
}
```

- [ ] **Step 2: `ConversationsBody`에 `previewData` prop 추가**

```tsx
export default function ConversationsBody({
  count = 5,
  previewData,
}: {
  count?: number
  previewData?: ConversationSummaryItem[]
}) {
  const { data: queryData, isLoading, isError, refetch } = useMessagingSummary({ enabled: !previewData })
  const recent = previewData ?? queryData?.recent ?? []
  const unreadCount = previewData ? previewData.filter((c) => c.unreadCount > 0).length : (queryData?.unreadConversationCount ?? 0)
  const needsReplyCount = previewData ? previewData.filter((c) => c.needsReply).length : (queryData?.needsReplyCount ?? 0)
```

(기존 파일이 `data.recent`/`data.unreadConversationCount`/`data.needsReplyCount`를 어떤 변수명으로 파생하든, 위와 같이 `previewData` 우선 순위로 교체 — 정확한 기존 변수명은 파일에서 확인.) 66/72행의 `isLoading`/`isError` 조건을 `!previewData &&`로 감싼다.

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `recent_chats` 관련 에러 소거.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/useMessagingSummary.ts apps/workplace-web/src/components/home/widgets/dashboard/ConversationsBody.tsx
git commit -m "feat(web): ConversationsBody 프리뷰(previewData) 지원"
```

---

### Task 17: `UnreadMailBody` + `useMailSummary` 프리뷰 지원 (시스템 `unread_mail`)

**Files:**
- Modify: `apps/workplace-web/src/hooks/queries/useMailSummary.ts:13-19`
- Modify: `apps/workplace-web/src/components/home/widgets/dashboard/UnreadMailBody.tsx:29-32`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.unread_mail`(Task 2, `MailSummaryItem[]`)

- [ ] **Step 1: `useMailSummary`에 `enabled` 옵션 추가**

```ts
export function useMailSummary(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['mail-summary'],
    queryFn: mailSummaryApi.get,
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: options?.enabled ?? true,
  })
}
```

- [ ] **Step 2: `UnreadMailBody`에 `previewData` prop 추가**

```tsx
export default function UnreadMailBody({
  count = 5,
  previewData,
}: {
  count?: number
  previewData?: MailSummaryItem[]
}) {
  const { data: queryData, isLoading, isError, refetch } = useMailSummary({ enabled: !previewData })
  const recent = previewData ?? queryData?.recent ?? []
  const unreadCount = previewData ? previewData.filter((m) => !m.seen).length : (queryData?.unreadCount ?? 0)
  const needsReplyCount = previewData ? previewData.filter((m) => m.aiNeedsReply && !m.needsReplyDoneAt).length : (queryData?.needsReplyCount ?? 0)
  const classificationActive = previewData ? true : (queryData?.classificationActive ?? false)
```

(기존 34/41행의 `isLoading`/`isError` 조건을 `!previewData &&`로 감싼다. `rows`/`visible` 파생 로직(61-74행)은 그대로 `recent` 변수를 소스로 이어받아 동작.)

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `unread_mail` 관련 에러 소거.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/useMailSummary.ts apps/workplace-web/src/components/home/widgets/dashboard/UnreadMailBody.tsx
git commit -m "feat(web): UnreadMailBody 프리뷰(previewData) 지원"
```

---

### Task 18: `PriorityQuadrantBody` + `usePriorityItems` 프리뷰 지원 (시스템 `priority_quadrant`)

**Files:**
- Modify: `apps/workplace-web/src/hooks/queries/usePriorityItems.ts:7-13`
- Modify: `apps/workplace-web/src/components/home/widgets/dashboard/PriorityQuadrantBody.tsx:31-33`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.priority_quadrant`(Task 2, `PriorityItem[]`)

- [ ] **Step 1: `usePriorityItems`에 `enabled` 옵션 추가**

```ts
export function usePriorityItems(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['priority-items'],
    queryFn: priorityItemsApi.get,
    staleTime: 5 * 60_000,
    retry: false,
    enabled: options?.enabled ?? true,
  })
}
```

- [ ] **Step 2: `PriorityQuadrantBody`에 `previewData` prop 추가**

```tsx
export default function PriorityQuadrantBody({
  previewData,
}: {
  count?: number
  previewData?: PriorityItem[]
}) {
  const { data: queryData, isLoading, isError } = usePriorityItems({ enabled: !previewData })
  const items = previewData ?? queryData?.items ?? []
```

35행 `if (isLoading)`을 `if (!previewData && isLoading)`으로, 45행 `if (isError)`를 `if (!previewData && isError)`로 교체.

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `priority_quadrant` 관련 에러 소거.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/hooks/queries/usePriorityItems.ts apps/workplace-web/src/components/home/widgets/dashboard/PriorityQuadrantBody.tsx
git commit -m "feat(web): PriorityQuadrantBody 프리뷰(previewData) 지원"
```

---

### Task 19: `SynthesisBody`/`QuickActionsBody` 프리뷰 대응 (시스템 `synthesis`/`quick_actions`)

**Files:**
- Read + 필요 시 Modify: `apps/workplace-web/src/components/home/synthesis/SynthesisLayer.tsx`
- Modify: `apps/workplace-web/src/components/home/widgets/dashboard/SynthesisBody.tsx:5-7`
- Modify: `apps/workplace-web/src/components/home/widgets/dashboard/QuickActionsBody.tsx:5-7`

**Interfaces:**
- Consumes: `widgetPreviewFixtures.synthesis`/`widgetPreviewFixtures.quick_actions`(Task 2, 현재 `undefined`)

이 둘은 얇은 어댑터라 데이터 훅이 없다(`SynthesisLayer`/`QuickActions`에 위임). 두 접근 중 이 태스크에서 실제로 필요한 것만 한다:

- `QuickActionsBody`가 감싸는 `QuickActions`는 순수 버튼 행(데이터 페칭 없음) — **프리뷰 데이터 불필요**. `count`/`previewData` prop을 받되 무시하도록 시그니처만 넓힌다.
- `SynthesisLayer`는 카운트 스트립 등 자체 데이터가 있을 가능성이 높다. 파일을 열어 데이터 훅이 있으면 Task 4~18과 동일 패턴(`enabled` 옵션 + `previewData`)으로 배선한다. 훅이 없거나 프리뷰에서 굳이 실데이터를 흉내 낼 가치가 낮다고 판단되면(예: 여러 하위 위젯을 다시 합성하는 컨테이너), 프리뷰 패널에는 "이 위젯은 여러 신호를 종합해 보여줍니다" 같은 안내 문구만 노출하도록 `SynthesisBody`에서 `previewData` 존재 시 실제 `SynthesisLayer` 대신 정적 안내를 렌더해도 된다 — 어느 쪽이든 실제 API 호출이 발생하지 않아야 한다(스펙 요구사항).

- [ ] **Step 1: `QuickActionsBody` 시그니처 확장(무시)**

```tsx
// 대시보드 그리드 위젯 어댑터 — QuickActions(새 이슈·메일 작성·새 대화 버튼 행)를 registry Component
// 시그니처에 맞춰 감싼다. count/previewData 무시(이 위젯은 순수 버튼 행이라 데이터가 없음).
import { QuickActions } from '../../QuickActions'

export default function QuickActionsBody({ previewData: _previewData }: { count?: number; previewData?: unknown }) {
  return <QuickActions />
}
```

- [ ] **Step 2: `SynthesisLayer.tsx`를 열어 데이터 훅 유무 확인, 있으면 Task 4~18과 동일 패턴 적용**

`SynthesisLayer.tsx`에 `useQuery` 등 데이터 훅이 있으면: `enabled` 옵션 추가(다른 태스크와 동일 패턴) + `SynthesisBody`가 `previewData`를 받아 그대로 전달. 없거나(다른 위젯들의 조합만 렌더) 개별 하위 위젯이 각자 자기 훅을 쓰는 구조면, `SynthesisBody`에서 `previewData` 존재 시 실제 `SynthesisLayer` 렌더를 건너뛰고 안내 placeholder를 렌더한다:

```tsx
// 대시보드 그리드 위젯 어댑터 — SynthesisLayer(카운트 스트립+지금 신경 쓸 일)를 registry Component
// 시그니처({ count? })에 맞춰 감싼다. count 는 이 위젯에 의미 없어 무시한다.
// previewData 는 SynthesisLayer 가 여러 하위 신호를 자체 훅으로 합성하는 컨테이너라 목데이터 주입이
// 어려워, 존재 시 실제 API 호출 없는 정적 안내만 렌더한다(위젯 추가 모달 프리뷰 전용, #브레인스토밍 2026-07-03).
import { SynthesisLayer } from '../../synthesis/SynthesisLayer'

export default function SynthesisBody({ previewData }: { count?: number; previewData?: unknown }) {
  if (previewData !== undefined) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        여러 신호(이슈·메일·대화)를 종합해 지금 신경 써야 할 일을 요약해 보여줍니다.
      </p>
    )
  }
  return <SynthesisLayer />
}
```

(`SynthesisLayer`에 실제로 단일 진입점 훅이 있어 Task 4~18과 동일하게 배선 가능하다고 확인되면, 위 placeholder 대신 그 방식을 우선한다.)

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: `synthesis`/`quick_actions` 관련 에러 소거.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/components/home/widgets/dashboard/SynthesisBody.tsx apps/workplace-web/src/components/home/widgets/dashboard/QuickActionsBody.tsx
git commit -m "feat(web): SynthesisBody/QuickActionsBody 프리뷰(previewData) 대응"
```

---

### Task 20: 전체 타입 체크 정리 + `previewData` 배선 최종 확인

**Files:**
- 없음(신규 변경 없음, 검증 전용) — 필요 시 Task 4~19에서 놓친 자잘한 타입 불일치 수정

**Interfaces:**
- Consumes: Task 1~19 전체 산출물

- [ ] **Step 1: 전체 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: PASS — 17개 위젯 모두 `previewData` prop을 지원하므로 Task 3에서 발생했던 "Property 'previewData' does not exist" 에러가 전부 사라져야 한다. 남은 에러가 있으면 해당 위젯 태스크로 돌아가 고친다.

- [ ] **Step 2: lint**

Run: `cd apps/workplace-web && pnpm lint`
Expected: PASS (새로 추가한 `previewData` 관련 코드에 미사용 변수 등 lint 에러 없는지 확인)

- [ ] **Step 3: 커밋(수정 사항이 있었을 경우만)**

```bash
git add apps/workplace-web/src
git commit -m "fix(web): 위젯 previewData 배선 타입/lint 정리"
```

---

### Task 21: E2E 회귀 테스트 추가

**Files:**
- Modify: `apps/workplace-web/e2e/pages/home.spec.ts`

**Interfaces:**
- Consumes: `AddWidgetModal`(Task 3)의 `data-testid`들 — `add-widget-modal`/`add-widget-categories`/`add-widget-category`/`add-widget-grid`/`add-widget-card`/`add-widget-preview`/`add-widget-confirm`

기존 위젯 추가 모달 관련 스펙(카드 클릭 시 즉시 추가되는 걸 검증하던 기존 테스트가 있다면 이 태스크에서 함께 갱신)에 아래 케이스들을 추가한다. 정확한 기존 테스트 함수명/헬퍼(`openAddWidgetModal` 등)는 `home.spec.ts`를 열어 기존 관례를 따른다.

- [ ] **Step 1: "카드 클릭은 선택만 하고 즉시 추가되지 않는다" 테스트 작성**

```ts
test('위젯 추가 모달에서 카드 클릭은 선택만 하고 즉시 추가하지 않는다', { tag: '@smoke' }, async ({ page }) => {
  // ... 기존 auth.fixture/api-mock 초기화 관례를 따라 홈 진입 + 편집 모드 진입 + 모달 오픈 ...
  const modal = page.getByTestId('add-widget-modal')
  await expect(modal).toBeVisible()

  const issueCard = modal.locator('[data-testid="add-widget-card"][data-widget-type="issue_list"]')
  await issueCard.click()

  // 선택 하이라이트만 되고 모달은 그대로 열려 있어야 한다(즉시 추가 X).
  await expect(modal).toBeVisible()
  await expect(issueCard).toHaveAttribute('aria-pressed', 'true')
})
```

- [ ] **Step 2: "선택한 위젯의 프리뷰가 목데이터로 렌더된다" 테스트 작성**

```ts
test('위젯 추가 모달 프리뷰 패널에 선택한 위젯이 목데이터로 렌더된다', { tag: '@smoke' }, async ({ page }) => {
  // ... 홈 진입 + 모달 오픈 ...
  const preview = page.getByTestId('add-widget-preview')
  // 모달을 열면 첫 카드가 자동 선택되어 프리뷰에 바로 콘텐츠가 보인다(빈 상태 없음).
  await expect(preview).toContainText('미리보기')

  const mailCard = page.locator('[data-testid="add-widget-card"][data-widget-type="mail_list"]')
  await mailCard.click()
  // widgetPreviewFixtures.mail_list 샘플 제목이 프리뷰에 나타나야 한다(실 API 호출 없이).
  await expect(preview).toContainText('이번 주 스프린트 리뷰 일정 안내')
})
```

- [ ] **Step 3: "+ 위젯 추가 버튼 클릭 시에만 실제로 추가된다" 테스트 작성**

```ts
test('위젯 추가 모달에서 "+ 위젯 추가" 버튼을 눌러야 실제로 추가된다', { tag: '@smoke' }, async ({ page }) => {
  let addRequested = false
  await page.route('**/api/v1/me/dashboard**', async (route) => {
    if (route.request().method() === 'PUT') {
      addRequested = true
      const body = route.request().postDataJSON()
      expect(JSON.stringify(body)).toContain('issue_list')
    }
    await route.continue()
  })
  // ... 홈 진입 + 모달 오픈 ...
  const issueCard = page.locator('[data-testid="add-widget-card"][data-widget-type="issue_list"]')
  await issueCard.click()
  await expect(page.getByTestId('add-widget-modal')).toBeVisible() // 아직 안 닫힘

  await page.getByTestId('add-widget-confirm').click()
  await expect(page.getByTestId('add-widget-modal')).not.toBeVisible() // 버튼 클릭 후에만 닫힘
  expect(addRequested).toBe(true)
})
```

(대시보드 저장 API 경로/메서드는 기존 `home.spec.ts`의 위젯 추가 관련 테스트에서 실제로 모킹하는 엔드포인트를 그대로 따른다 — 위 `**/api/v1/me/dashboard**`는 추정치이므로 파일 내 기존 패턴으로 교체.)

- [ ] **Step 4: "카테고리 전환 시 첫 카드 자동 선택" 테스트 작성**

```ts
test('위젯 추가 모달에서 카테고리를 바꾸면 목록 첫 카드가 자동 선택된다', { tag: '@smoke' }, async ({ page }) => {
  // ... 홈 진입 + 모달 오픈 ...
  await page.locator('[data-testid="add-widget-category"][data-category="캘린더"]').click()
  const firstCard = page.locator('[data-testid="add-widget-card"][data-widget-type="calendar"]')
  await expect(firstCard).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('add-widget-preview')).toContainText('캘린더')
})
```

- [ ] **Step 5: "좁은 뷰포트에서 프리뷰 패널이 카드 목록 아래로 스택된다" 테스트 작성**

```ts
test('위젯 추가 모달은 좁은 뷰포트에서 프리뷰 패널이 카드 목록 아래로 스택된다', { tag: '@smoke' }, async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 })
  // ... 홈 진입 + 모달 오픈 ...
  const grid = page.getByTestId('add-widget-grid')
  const preview = page.getByTestId('add-widget-preview')
  const gridBox = await grid.boundingBox()
  const previewBox = await preview.boundingBox()
  // lg 미만에서는 flex-col 이라 프리뷰의 y좌표가 카드 목록의 y좌표+높이보다 아래(세로 스택)여야 한다.
  expect(previewBox!.y).toBeGreaterThanOrEqual(gridBox!.y + gridBox!.height - 1)
})
```

- [ ] **Step 6: E2E 타입 체크**

Run: `cd apps/workplace-web && npx tsc -p tsconfig.e2e.json --noEmit`
Expected: PASS

- [ ] **Step 7: E2E 실행**

Run: `cd apps/workplace-web && pnpm test:e2e -- home.spec.ts`
Expected: 신규 5개 테스트 PASS, 기존 `home.spec.ts` 테스트 전체 회귀 없이 PASS(기존에 "카드 클릭 = 즉시 추가"를 가정하던 테스트가 있었다면 이번 변경으로 깨지므로 위 새 플로우에 맞게 함께 갱신했는지 재확인).

- [ ] **Step 8: 커밋**

```bash
git add apps/workplace-web/e2e/pages/home.spec.ts
git commit -m "test(web): 위젯 추가 모달 선택-프리뷰-추가 플로우 E2E 회귀 테스트 추가"
```
