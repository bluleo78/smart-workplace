# 읽은 알림 자동 보관·보관함 (WP-1690) — 설계

기획: WP-1671 3판(AI 팀장 승인, dh.yang 확정). 선행 WP-1689(읽은 알림 한 번에 보관·되돌리기, V300 마이그레이션) 머지됨.
무인 work-loop 세션이 기획 본문만으로 정한 설계다 — 사람 확인 없이 스스로 승인했다(아래 「내가 정한 것」).

## 의도

읽은 알림이 손대지 않아도 목록에 쌓이지 않고(읽은 지 7일 자동 보관), 치운 알림은 보관함에서 다시 보고 되돌릴 수 있으며,
보관함도 끝없이 쌓이지 않게(보관 90일 뒤 지움) 한다. 사람·AI(MCP) 모두 같은 보관함을 본다.

## 하지 않는 것

- 자동 보관 기간 사용자 설정, 영구 지우기 단추, 줄별 보관, 여러 줄 골라 되돌리기.
- 옛 인덱스 DROP(WP-1695 — 운영 반영 뒤).
- 마이그레이션 — V300 이 칸·인덱스(`idx_notification_recipient_archived`, `idx_notification_read_unarchived`)를 이미 넣었다.

## 방안

| 방안 | 내용 | 판단 |
|---|---|---|
| A. 보관함 전용 엔드포인트 `GET /notifications/archived` | 목록과 같은 응답 모양, 정렬만 `archived_at DESC, id DESC` | **고름** — 목록 쿼리·캐시 키가 갈리지 않고 기존 목록 동작을 건드리지 않는다 |
| B. `GET /notifications?archived=true` | 한 엔드포인트에 갈래 | 정렬·인덱스가 달라 한 메서드 안에서 갈래가 생기고, 옛 클라이언트 회귀 위험 |
| C. 클라이언트에서 보관함을 따로 저장 | — | 서버 RLS·다른 기기와 맞지 않아 버림 |

작업(job)은 `DriveTrashCleanupJob`·`HelpMetricRetentionScheduler` 와 같은 `@Scheduled` + `@SchedulerLock` + `TenantScopedRunner` 방식. 묶음은 테넌트마다 `runForTenant` 를 묶음 한 번씩 불러 묶음마다 트랜잭션을 짧게 끊는다(긴 잠금 회피).

## 설계

### API (`notify` 모듈)

- `NotificationRepository`
  - `listArchived(recipientId, recipientIsAdmin, limit, offset)` — `listRecent` 와 같은 select·조인·보이기 조건(지운 이슈 제외, `readableByRecipient`)에 `archived_at IS NOT NULL`, 정렬 `archived_at DESC, id DESC`. 응답 `NotificationResponse` 그대로(select·매핑은 공용 private 메서드로 뽑아 중복을 없앤다).
  - `autoArchiveReadBefore(cutoff, batch)` — `archived_at IS NULL AND read_at < cutoff` 인 행을 id 로 `batch` 개 골라(`idx_notification_read_unarchived`) `archived_at = now()`. 바꾼 행 수.
  - `deleteArchivedBefore(cutoff, batch)` — `archived_at < cutoff` 인 행을 `batch` 개 지움. 지운 행 수.
  - 둘 다 RLS(테넌트 GUC) 아래서 돈다 — 수신자 조건 없음(작업은 그 테넌트 전체).
- `NotificationService.listArchived(...)` — readOnly, `isAdmin` 갈래 같음.
- `NotificationController` `GET /api/v1/notifications/archived?limit&offset` — `list` 와 같은 클램프.
- `NotificationArchiveJob`(`notify/service`) — `@Scheduled(initialDelay = 300_000, fixedDelay = 86_400_000)`, `@SchedulerLock(name = "NotificationArchiveJob.run")`.
  - 활성 테넌트마다: 1) 자동 보관(cutoff = now − 7일)을 묶음 1000개씩 0 이 될 때까지, 2) 정리(cutoff = now − 90일)를 같은 방식으로. 묶음마다 `runForTenant` 한 번(트랜잭션 하나).
  - 상수 `AUTO_ARCHIVE_DAYS = 7`, `PURGE_DAYS = 90`, `BATCH = 1000`. 한 테넌트 실패는 러너가 격리한다(그 테넌트만 건너뜀 — 기존 러너 동작 확인).
  - 실시간 이벤트는 내지 않는다 — 대상이 7일 넘게 지난 읽은 알림이라 열린 창이 바로 바뀔 필요가 없고, 다음 조회에서 반영된다.

### 웹

- `notificationsApi.listArchived(limit, offset)`, `useArchivedNotifications(enabled)`(무한 스크롤, 키 `notificationKeys.archived`), `useUnarchiveNotification`(한 id 되돌리기 → 목록·보관함·안 읽은 수 무효화). 보관·되돌리기·SSE notification UPDATED 무효화에 보관함 키도 넣는다.
- `InboxList` 에 `view: 'inbox' | 'archive'`(제어 prop, 없으면 내부 상태).
  - 데스크톱 제목 줄: 「알림」 글자 자리에 탭 모양 전환 `알림 | 보관함`(role=tablist, 선택 탭은 굵게·밑줄 — `aria-selected`). 보관함일 때 「모두 읽음」·「읽은 알림 보관」은 숨긴다(보관함에서 할 일이 아님).
  - 보관함 목록: 같은 줄 모양(읽은 상태), 줄 오른쪽 「되돌리기」 단추(줄 클릭 이동과 분리 — `stopPropagation`). 되돌리면 그 줄이 보관함에서 빠지고 알림 목록에 돌아간다. 줄 클릭은 알림과 같이 대상으로 이동(읽음 처리 없음).
  - 빈 상태: 「보관한 알림이 없습니다」(모바일은 전체 화면 규격).
  - 푸시 유도 배너는 알림 보기에서만.
- 모바일 `/notifications`: 머리 제목 옆에 같은 전환. `MobileListHeader`·`MobileDetailBar` 의 제목 자리에 전환을 넣을 수 있게 한다(제목 문자열 대신 ReactNode 를 받는 작은 확장 또는 전환 컴포넌트를 제목 옆에 둔다). 보관함일 때 머리 액션(모두 읽음·읽은 알림 보관)은 숨긴다. 390px 에서 넘치지 않는다.
- 매뉴얼 `docs/manual/user/02-login-and-layout.md` 알림 절에 자동 보관(7일)·보관함·되돌리기·90일 정리를 더한다. 그림은 촬영하지 않는다(「매뉴얼 그림 재촬영 필요」로 남김).

### MCP (`packages/mcp-tools-shared`)

- `list_notifications` 에 `archived?: boolean` — true 면 보관함(최신 보관순)을 같은 `{unreadCount, items, hasMore?, nextOffset?}` 모양으로. `unreadOnly` 와 함께 주면 거절(zod refine). 클라이언트 인터페이스에 `listArchivedNotifications({limit, offset})`, rest-client 구현, 쓰는 쪽(workplace-mcp·ai-agent) 스냅숏·테스트 갱신 — WP-1689 의 `archive_read_notifications` 추가와 같은 자리들.

## 테스트

- API 통합: 레포지토리(목록 정렬·보이기 조건·남의 것 제외, 자동 보관 경계 — 7일 직전·안 읽음 제외·이미 보관 제외, 정리 경계, 묶음 반복), 컨트롤러(`/archived` 본인 것만·클램프), 작업(테넌트 둘에서 둘 다 처리 — 완료 기준 4).
- 웹 vitest: 탭 전환·보관함 목록·되돌리기 payload·빈 상태·보관함에서 머리 액션 숨김, 모바일 페이지 전환. 390px 넘침은 레이아웃이 걸리면 `@layout` E2E 하나.
- MCP: notify-tools 단위(archived 갈래·unreadOnly 와 함께 거절), 스냅숏.

## 내가 정한 것

- 보관함은 별도 엔드포인트(방안 A), 응답 모양은 목록과 같음(`archivedAt` 칸은 더하지 않음 — 화면이 쓰지 않는다).
- 보관함 보기에서 「모두 읽음」·「읽은 알림 보관」 숨김.
- 자동 보관·정리는 실시간 이벤트를 내지 않음.
- 작업 주기: 기동 5분 뒤, 이후 24시간마다(fixedDelay). 묶음 1000개, 묶음마다 트랜잭션.
- 보관함 줄 클릭은 대상 이동(읽음 처리 없음), 「되돌리기」는 줄마다 단추.
