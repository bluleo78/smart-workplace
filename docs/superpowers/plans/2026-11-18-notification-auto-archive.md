# 읽은 알림 자동 보관·보관함 (WP-1690) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 읽은 지 7일 지난 알림을 하루 한 번 자동 보관하고 보관 90일 지난 알림을 지우며, 보관함 목록(API·웹 데스크톱/모바일·MCP)과 줄별 「되돌리기」를 더한다.

**Architecture:** API `notify` 모듈에 보관함 목록 조회·자동 보관/정리 묶음 쿼리와 `@Scheduled` 작업을 더하고, 웹 `InboxList` 에 「알림 | 보관함」 전환을 넣으며, MCP `list_notifications` 에 `archived` 갈래를 더한다. 마이그레이션은 없다(V300 이 칸·인덱스를 넣었다).

**Tech Stack:** Spring Boot + jOOQ + ShedLock(API), React 19 + TanStack Query + vitest(웹), zod MCP 공유 도구(TS).

**Spec:** `docs/superpowers/specs/2026-11-18-notification-auto-archive-design.md` (부모 기획 WP-1671, 선행 WP-1689 코드가 본보기)

## Global Constraints

- 자동 보관: `archived_at IS NULL AND read_at < now() - 7일` → `archived_at = now()`. 안 읽은 알림은 보관하지 않는다.
- 정리: `archived_at < now() - 90일` 지움. 같은 작업 안에서 보관 → 정리 순서, 묶음 1000개씩, 묶음마다 트랜잭션.
- 작업은 `@Scheduled(initialDelay = 300_000, fixedDelay = 86_400_000)` + `@SchedulerLock(name = "NotificationArchiveJob.run")`, `TenantScopedRunner` 로 모든 활성 테넌트.
- 보관함 정렬: `archived_at DESC, id DESC`. 보이기 조건은 `listRecent` 와 같다(지운 이슈 제외, `readableByRecipient`).
- 화면 문구: 전환 「알림」·「보관함」, 줄 단추 「되돌리기」, 빈 상태 「보관한 알림이 없습니다」.
- 한국어 주석 필수(클래스·메서드·주요 로직), `./gradlew spotlessApply`, 커밋은 `docs/COMMIT_CONVENTION.md`(제목 끝 `(WP-1690)`).
- 셸 명령은 단순하게: 한 줄 셸 함수 정의(`f(){ …; }`), `${…:-{…}}` 중괄호 확장, `;`·`&&` 로 길게 이은 한 줄을 쓰지 않는다. 복잡하면 스크립트 파일에 적어 실행한다.
- 새 웹 테스트는 vitest(`*.test.tsx` + `renderPage`/MSW). E2E 는 기하가 걸릴 때만 `@layout` 태그로.

## Review Focus

1. 자동 보관이 **안 읽은** 알림이나 이미 보관된 알림을 건드리면 안 된다 — Task 2 테스트 `autoArchive_skipsUnreadAndAlreadyArchived`.
2. 7일 경계: 읽은 지 6일 23시간은 남고 7일 1시간은 보관 — Task 2 `autoArchive_respectsSevenDayBoundary`.
3. 묶음보다 많은 행(예: 묶음 2로 5행)이 한 번 실행에 모두 처리된다 — Task 2 `job_drainsMoreThanOneBatch`(작업에 묶음 크기 주입 가능한 패키지 생성자/필드).
4. 보관함에 남의 알림·볼 수 없는 프로젝트의 알림이 보이면 안 된다 — Task 1 `listArchived_onlyMineAndReadable`.
5. 보관함에서 「되돌리기」 단추를 눌렀을 때 줄 클릭(이동)이 함께 일어나면 안 된다 — Task 3 `archive view: 되돌리기는 이동하지 않는다`.

---

### Task 1: 보관함 목록 API

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/notify/repository/NotificationRepository.java` (listRecent 의 select·매핑을 private 공용 메서드로 뽑고 `listArchived` 추가)
- Modify: `apps/workplace-api/src/main/java/com/workplace/notify/service/NotificationService.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/notify/controller/NotificationController.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/repository/NotificationRepositoryTest.java`, `.../controller/NotificationControllerTest.java`

**Interfaces:**
- Produces: `List<NotificationResponse> NotificationRepository.listArchived(long recipientId, boolean recipientIsAdmin, int limit, long offset)`; `NotificationService.listArchived(long recipientId, int limit, long offset)`; `GET /api/v1/notifications/archived?limit=20&offset=0` → `NotificationResponse[]` (limit 1~100 클램프, offset 음수 0).

- [ ] **Step 1: 실패하는 테스트** — 레포지토리 테스트(WP-1689 가 더한 테스트의 데이터 준비 방식을 따른다):
  - `listArchived_newestArchivedFirst`: 보관 시각이 다른 알림 3개 → id 가 보관 시각 내림차순; 보관 안 된 알림은 없다.
  - `listArchived_onlyMineAndReadable`: 남의 보관 알림, 지운 이슈의 보관 알림, 내가 빠진 프로젝트의 보관 알림은 결과에 없다.
  - `listArchived_pagesWithOffset`: 3개, limit 2 → 2개, offset 2 → 1개.
  - 컨트롤러: `archived_returnsOnlyMyArchived` (200, 본인 보관 알림만), `archived_clampsLimit` (limit=500 → 최대 100 적용, 응답 200).
- [ ] **Step 2:** `cd apps/workplace-api && ./gradlew test --tests "com.workplace.notify.*"` → 새 테스트 FAIL.
- [ ] **Step 3:** 구현. `listArchived` 는 `listRecent` 와 같은 조인·보이기 조건에 `NOTIFICATION.ARCHIVED_AT.isNotNull()`, 정렬 `ARCHIVED_AT.desc(), ID.desc()`. 컨트롤러 javadoc 에 보관함(WP-1690) 명시.
- [ ] **Step 4:** 같은 명령 PASS, `./gradlew spotlessApply`.
- [ ] **Step 5: Commit** `feat(api): 보관한 알림 목록을 최근 보관순으로 준다 (WP-1690)`

### Task 2: 자동 보관·90일 정리 작업

**Files:**
- Modify: `NotificationRepository.java` (묶음 쿼리 둘)
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/service/NotificationArchiveJob.java`
- Test: `NotificationRepositoryTest.java`, Create `apps/workplace-api/src/test/java/com/workplace/notify/service/NotificationArchiveJobTest.java` (본보기: `help/service/HelpMetricRetentionSchedulerTest.java` 의 테넌트 둘 준비 방식)

**Interfaces:**
- Produces: `int NotificationRepository.autoArchiveReadBefore(OffsetDateTime cutoff, int batch)` — `archived_at IS NULL AND read_at < cutoff` 를 id 로 최대 batch 개 골라 `archived_at = now` 로, 바꾼 수. `int NotificationRepository.deleteArchivedBefore(OffsetDateTime cutoff, int batch)` — `archived_at < cutoff` 최대 batch 개 지움, 지운 수. 수신자 조건 없음(RLS 테넌트 범위).
- Produces: `NotificationArchiveJob.run()`; 상수 `AUTO_ARCHIVE_DAYS = 7`, `PURGE_DAYS = 90`, `BATCH = 1000`; 테스트가 묶음 크기를 줄일 수 있게 package-private `int batchSize` 필드(기본 `BATCH`).
- 묶음 반복: 테넌트마다 `tenantRunner.runForTenant(tid, …)` 를 묶음 한 번씩 불러(반환 수 < batch 이면 멈춤) 보관을 모두 끝낸 뒤 정리를 같은 방식으로. 활성 테넌트 목록은 `forEachActiveTenant` 로 받거나 러너의 기존 API 를 쓴다(러너 코드를 읽고 고른다 — 한 테넌트 실패가 다른 테넌트를 막지 않아야 한다).

- [ ] **Step 1: 실패하는 테스트**
  - repo `autoArchive_respectsSevenDayBoundary`: read_at = now−7일−1시간 → 보관, now−6일−23시간 → 그대로 (cutoff = now−7일).
  - repo `autoArchive_skipsUnreadAndAlreadyArchived`: read_at NULL, 이미 보관된 행은 바뀌지 않고 반환 수에 안 든다.
  - repo `deleteArchived_respectsNinetyDayBoundary`: archived_at now−91일 지움, now−89일 남음, 보관 안 된 오래된 알림 남음.
  - repo `batchLimitsRowCount`: 5행, batch 2 → 반환 2.
  - job `job_archivesAndPurgesInEveryTenant`: 테넌트 둘에 각각 8일 전 읽은 알림·91일 전 보관 알림 → run() 뒤 두 테넌트 모두 앞의 것은 보관, 뒤의 것은 없음.
  - job `job_drainsMoreThanOneBatch`: batchSize=2, 대상 5행 → run() 한 번에 5행 모두 보관.
- [ ] **Step 2:** `./gradlew test --tests "com.workplace.notify.*"` → FAIL.
- [ ] **Step 3:** 구현(Global Constraints 의 값 그대로). 클래스 javadoc 에 「실시간 이벤트를 내지 않는 이유」(7일 넘은 읽은 알림이라 열린 창이 바로 바뀔 필요가 없고 다음 조회에 반영) 를 적는다.
- [ ] **Step 4:** PASS, `spotlessApply`.
- [ ] **Step 5: Commit** `feat(api): 읽은 지 7일 지난 알림을 자동 보관하고 보관 90일 지난 알림을 지운다 (WP-1690)`

### Task 3: 웹 — 데스크톱 「알림 | 보관함」 전환·보관함 목록·되돌리기

**Files:**
- Modify: `apps/workplace-web/src/api/notifications.ts` (`listArchived(limit = 20, offset = 0)` → `GET /notifications/archived`)
- Modify: `apps/workplace-web/src/hooks/queries/notificationKeys.ts` (`archived: () => [...notificationKeys.all, 'archived']`)
- Create: `apps/workplace-web/src/hooks/queries/useArchivedNotifications.ts` (`useNotifications` 와 같은 무한 스크롤 모양, `enabled` 인자), `apps/workplace-web/src/hooks/queries/useUnarchiveNotification.ts` (`mutate(id: number)` → `notificationsApi.unarchive([id])`, 성공 시 `notificationKeys.all` 무효화)
- Modify: `apps/workplace-web/src/components/layout/InboxList.tsx`
- Test: Create `apps/workplace-web/src/components/layout/inboxArchive.test.tsx` (기존 `appRail.test.tsx` 의 알림 패널 MSW 준비 방식을 따른다)

**Interfaces:**
- Produces: `export type InboxView = 'inbox' | 'archive'`; `export function InboxViewTabs({ view, onChange }: { view: InboxView; onChange: (v: InboxView) => void })` — `role="tablist"`, 탭 버튼 둘(`role="tab"`, `aria-selected`, testid `inbox-tab-inbox`·`inbox-tab-archive`), 선택 탭은 굵게·밑줄로 구분. `InboxList` 새 props `view?: InboxView`, `onViewChange?: (v: InboxView) => void` (없으면 내부 상태, 기본 `'inbox'`). 보관함 줄 단추 testid `inbox-unarchive`.
- 보관함일 때: 데스크톱 제목 줄에서 「모두 읽음」·「읽은 알림 보관」 숨김, 푸시 배너 숨김, 줄 클릭은 `notifTarget` 으로 이동(읽음 처리 없음), 「되돌리기」는 `stopPropagation` 후 그 id 되돌리기. 빈 상태 「보관한 알림이 없습니다」(`screenEmpty` 면 `MobileEmptyState`).

- [ ] **Step 1: 실패하는 테스트** (`inboxArchive.test.tsx`)
  - `탭 전환: 보관함을 누르면 GET /notifications/archived 결과가 보이고 모두 읽음·읽은 알림 보관이 숨는다`
  - `되돌리기: POST /notifications/unarchive 본문 { ids: [<id>] } 를 보내고 그 줄이 보관함에서 사라진다`(성공 뒤 MSW 가 빈 보관함을 돌려줌)
  - `archive view: 되돌리기는 이동하지 않는다`(경로 그대로)
  - `빈 보관함이면 「보관한 알림이 없습니다」`
  - `알림 탭이 기본이고 aria-selected 가 맞다`
- [ ] **Step 2:** `cd apps/workplace-web && npx vitest run src/components/layout/inboxArchive.test.tsx` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 위 명령 PASS, 이어서 `pnpm test`(웹 vitest 전체 — 기존 `appRail.test.tsx`·모바일 테스트가 깨지지 않는지) 와 `pnpm typecheck`, 루트 `pnpm lint`.
- [ ] **Step 5: Commit** `feat(web): 알림 창에서 보관함을 보고 줄마다 되돌린다 (WP-1690)`

### Task 4: 웹 — 모바일 `/notifications` 전환·매뉴얼

**Files:**
- Modify: `apps/workplace-web/src/pages/NotificationsPage.tsx` (view 상태를 들고 `InboxList` 에 넘김, 보관함이면 머리 액션 숨김)
- Modify: `apps/workplace-web/src/components/mobile/MobileListHeader.tsx` 와 필요하면 `MobileDetailBar` — 제목 옆 전환을 넣을 자리(예: `titleAccessory?: ReactNode` prop). 기존 호출부는 바뀌지 않게 선택 prop 으로.
- Modify: `docs/manual/user/02-login-and-layout.md` (WP-1689 가 고친 알림 절에 자동 보관 7일·보관함 전환·되돌리기·90일 정리. 그림 지시문은 새로 넣지 않고 기존 그림 id 가 낡으면 그대로 둔다)
- Test: `apps/workplace-web/src/pages/mobile/` 아래 새 `notificationsArchive.test.tsx` (`headersNav.test.tsx`·`mobileFinalReview.test.tsx` 의 모바일 렌더 방식)

**Interfaces:**
- Consumes: Task 3 의 `InboxView`, `InboxViewTabs`, `InboxList` 의 `view`/`onViewChange`.

- [ ] **Step 1: 실패하는 테스트**
  - `모바일 탭 루트 머리에 알림|보관함 전환이 있고 보관함으로 바꾸면 모두 읽음·읽은 알림 보관이 숨는다`
  - `푸시 화면(MobileDetailBar) 머리에도 같은 전환이 있다`
  - `보관함에서 되돌리기를 누르면 unarchive 요청을 보낸다`
- [ ] **Step 2:** `npx vitest run src/pages/mobile/notificationsArchive.test.tsx` → FAIL.
- [ ] **Step 3:** 구현. 390px 에서 제목+전환+액션이 한 줄에 넘치지 않게(보관함일 때는 액션이 없고, 알림일 때는 전환을 짧은 글자로). 넘침이 의심되면 `e2e/` 에 `@layout` 테스트 하나(390px, 머리 요소의 `scrollWidth <= clientWidth`)를 더한다.
- [ ] **Step 4:** vitest 파일 PASS, `pnpm test`, `pnpm typecheck`, E2E 를 더했으면 `pnpm test:e2e e2e/<그 spec>`.
- [ ] **Step 5: Commit** `feat(web): 모바일 알림 화면에서도 보관함을 본다 (WP-1690)`

### Task 5: MCP `list_notifications` 보관함

**Files:**
- Modify: `packages/mcp-tools-shared/src/notify-tools.ts` (`listNotificationsInput` 에 `archived: z.boolean().optional()`, `unreadOnly` 와 함께면 refine 거절; 클라이언트 인터페이스에 `listArchivedNotifications(p: { limit: number; offset: number }): Promise<NotificationRow[]>`)
- Modify: `packages/mcp-tools-shared/src/rest-client.ts`(`GET /notifications/archived`), 필요하면 `tool-client.ts`
- Modify: 스냅숏·테스트 — `packages/mcp-tools-shared/src/__snapshots__/*`, `apps/workplace-mcp/src/tools/__snapshots__/index.test.ts.snap`, `apps/workplace-ai-agent/src/mcp/tools.ts`·`tools.test.ts`(WP-1689 커밋 `4399497ca` 가 `archive_read_notifications` 를 더할 때 고친 자리를 본다: `git show 4399497ca --stat`)
- Test: `packages/mcp-tools-shared/src/notify-tools.test.ts`, `rest-client.test.ts`

**Interfaces:**
- Produces: `list_notifications({ archived: true, limit, offset })` → `{ unreadCount, items, hasMore?, nextOffset? }`(items 는 보관함, 최신 보관순). 설명 문구에 `archived=true lists the archive (보관함), newest archived first; auto-archived 7 days after read, deleted 90 days after archiving` 뜻을 짧게.

- [ ] **Step 1: 실패하는 테스트** — `archived: true 면 listArchivedNotifications 를 부르고 listNotifications 는 부르지 않는다`, `archived 와 unreadOnly 를 함께 주면 거절`, `페이지가 꽉 차면 hasMore/nextOffset`; rest-client `listArchivedNotifications 는 GET /notifications/archived?limit&offset`.
- [ ] **Step 2:** `pnpm --filter @smart-workplace/mcp-tools-shared test` → FAIL.
- [ ] **Step 3:** 구현 → `pnpm --filter @smart-workplace/mcp-tools-shared build`.
- [ ] **Step 4:** `pnpm --filter @smart-workplace/mcp-tools-shared test`, `pnpm --filter @smart-workplace/workplace-mcp test`, `pnpm --filter @smart-workplace/workplace-ai-agent test` 모두 PASS(스냅숏은 의도한 변경만 `-u`).
- [ ] **Step 5: Commit** `feat(mcp): list_notifications 로 보관함을 본다 (WP-1690)`
