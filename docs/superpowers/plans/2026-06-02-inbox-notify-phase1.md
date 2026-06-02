# 인박스/알림(notify) Phase 1 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인 사용자가 "나에게 온 일"(배정·코멘트·상태변경)을 AppRail 종 아이콘 + 안읽음 배지 + 드롭다운 패널에서 즉시 보는 인앱 알림 인박스 — 3개 기존 이슈 도메인 이벤트를 새 `notify` 슬라이스가 구독해 알림 행을 만들고 SSE 로 실시간 푸시한다.

**Architecture:** 이미 발행 중인 `IssueDomainEvents`(`IssueAssignedEvent`·`IssueCommentedEvent`·`IssueStatusChangedEvent`)를 `com.workplace.notify` 슬라이스가 `@TransactionalEventListener(AFTER_COMMIT)` + `@Async("notifyEventExecutor")` 로 구독 → 수신자 해석(담당자는 이벤트 페이로드 `assignees`, 워처는 기존 `watcher.IssueWatcherRepository` 조회) → `notification` 행 batch insert → 재사용 `SseRegistry.fanOut(recipientIds, "notify.created", …)`. 프론트는 fetch+ReadableStream SSE(Authorization 헤더 필요)로 스트림을 구독하고 TanStack Query 를 invalidate 한다.

**Tech Stack:** Backend — Spring Boot, jOOQ(not JPA), Flyway, Spring `@TransactionalEventListener`/`@Async`. Frontend — React 19 + TS, TanStack Query, React Router v7, shadcn/ui(Popover), Tailwind 4, lucide-react. 테스트 — JUnit 통합(`IntegrationTestBase`), Playwright E2E.

> **스펙 §6 와의 의도된 차이(검토자 참고):** 스펙 §6 은 `EventSource` 를 언급하나, 네이티브 `EventSource` 는 `Authorization: Bearer` 헤더를 실을 수 없다. 따라서 코드베이스의 기존 SSE 클라이언트(`useChatStream.ts`/`useMessageStream.ts`)와 동일하게 **fetch + ReadableStream** 로 구현한다. 이는 인증 제약에 따른 확정된 결정이며 스펙 위반이 아니다.

> **재사용으로 인한 스펙 차이(검토자 참고):** 스펙 §4 는 "신규 `IssueWatcherRepository.findUserIdsByIssue` 추가"를 적었으나, 동일 시그니처가 이미 `com.workplace.watcher.repository.IssueWatcherRepository.findUserIdsByIssue(Long)` 에 존재한다. DRY 원칙상 **기존 것을 재사용**한다(신규 리포 생성 안 함). notify → watcher 의 의존은 스펙 §3 이 명시적으로 허용한 "이벤트 구독 + 읽기 전용 조회" 범위에 든다.

> **읽음 처리 방식의 의도된 차이(검토자 참고):** 스펙 §6 은 행 클릭 읽음을 "낙관적 업데이트"로 적었으나, 본 플랜은 `useMarkNotificationRead`/`useMarkAllNotificationsRead` 에서 **`notificationKeys.all` invalidate(재조회)** 로 갱신한다. 클릭 즉시 패널이 닫히고 이슈로 이동하므로 사용자가 점/배지 갱신을 체감하는 시간이 거의 없고, invalidate 가 단순·정확하다. `onMutate` 낙관적 캐시 패치는 v1 미도입(YAGNI). 배지/점 즉시성이 문제되면 후속에서 `onMutate` 추가.

---

## 파일 구조

### 백엔드 (`apps/workplace-api/src/main/java/com/workplace/`)

| 파일 | 책임 |
|---|---|
| `…/resources/db/migration/V22__notifications.sql` (생성) | `notification` 테이블 + 인덱스 |
| `notify/dto/NotificationType.java` (생성) | 알림 종류 enum (ASSIGNED/COMMENTED/STATUS_CHANGED) |
| `notify/dto/NotificationResponse.java` (생성) | 조회 응답 record (issue·user 조인 결과) |
| `notify/repository/NotificationRepository.java` (생성) | jOOQ: insertBatch/listRecent/countUnread/markRead/markAllRead |
| `notify/service/NotificationService.java` (생성) | 수신자 확정(actor 제외·중복 제거)→persist→fanOut, 조회/읽음 |
| `notify/outbound/NotificationDispatcher.java` (생성) | 3개 이슈 이벤트 구독 → 수신자 해석 → service 위임 |
| `notify/controller/NotificationController.java` (생성) | REST + SSE 스트림 엔드포인트 |
| `global/outbound/OutboundConfig.java` (수정) | `notifyEventExecutor` 빈 추가 |

기존 재사용(수정 없음): `global/realtime/SseRegistry`, `issue/outbound/IssueDomainEvents`, `watcher/repository/IssueWatcherRepository`.

### 프론트엔드 (`apps/workplace-web/`)

| 파일 | 책임 |
|---|---|
| `src/types/notification.ts` (생성) | `NotificationResponse` TS 타입 |
| `src/api/notifications.ts` (생성) | axios 호출 4종 |
| `src/hooks/queries/notificationKeys.ts` (생성) | 쿼리키 팩토리 |
| `src/hooks/queries/useNotifications.ts` (생성) | 목록 쿼리(패널 열릴 때) |
| `src/hooks/queries/useUnreadCount.ts` (생성) | 안읽음 수 쿼리 |
| `src/hooks/queries/useMarkNotificationRead.ts` (생성) | 단건 읽음 뮤테이션 |
| `src/hooks/queries/useMarkAllNotificationsRead.ts` (생성) | 모두 읽음 뮤테이션 |
| `src/hooks/useNotificationStream.ts` (생성) | fetch+ReadableStream SSE → invalidate |
| `src/components/layout/InboxPanel.tsx` (생성) | 종+배지+Popover 목록 |
| `src/components/layout/AppRail.tsx` (수정) | 하단에 `<InboxPanel/>` 렌더 |
| `src/components/layout/AppLayout.tsx` (수정) | `useNotificationStream()` 마운트 |
| `e2e/fixtures/auth.fixture.ts` (수정) | 알림 라우트 기본 스텁 |
| `e2e/pages/inbox.spec.ts` (생성) | 배지/목록/빈/행클릭/모두읽음/SSE E2E |

---

## TASK 1: V22 마이그레이션 + jOOQ 코드젠

> jOOQ 생성 소스는 gitignore 되고 코드젠은 수동(`generateSchemaSourceOnCompilation = false`)이다. `Tables.NOTIFICATION` 을 참조하는 어떤 코드도 코드젠 전엔 컴파일되지 않으므로 **이 태스크가 반드시 먼저** 수행되어야 한다.

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V22__notifications.sql`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- notification: 인앱 알림 인박스. recipient 스코프로 격리.
-- 표시용 이름/제목(액터명·이슈키·제목)은 읽을 때 issue·project·user 조인 — 스냅샷 비정규화 안 함.
CREATE TABLE notification (
  id            BIGSERIAL PRIMARY KEY,
  recipient_id  BIGINT NOT NULL REFERENCES "user"(id),
  actor_id      BIGINT     REFERENCES "user"(id),   -- 사람/AI 행위자. 시스템이면 null
  type          VARCHAR(32) NOT NULL,               -- ASSIGNED | COMMENTED | STATUS_CHANGED
  issue_id      BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  comment_id    BIGINT,                             -- COMMENTED 시
  read_at       TIMESTAMPTZ,                        -- null = 안읽음
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 최신순 목록 조회
CREATE INDEX idx_notification_recipient_created ON notification(recipient_id, created_at DESC);
-- 안읽음 카운트(부분 인덱스)
CREATE INDEX idx_notification_unread ON notification(recipient_id) WHERE read_at IS NULL;
```

- [ ] **Step 2: 로컬 dev DB 기동 + 마이그레이션 적용**

루트에서 DB 컨테이너를 띄우고, 마이그레이션을 적용한다. (이 repo 는 Flyway Gradle 플러그인이 없어 `flywayMigrate` 태스크가 없다 — 마이그레이션은 `bootRun` 시 자동 적용된다.) 백그라운드로 띄운 뒤 `notification` 테이블이 생길 때까지 폴링하고, 확인되면 프로세스를 종료한다(결정적 적용).

```bash
pnpm db:up
cd apps/workplace-api && ./gradlew bootRun --args='--spring.profiles.active=local' > /tmp/notify-bootrun.log 2>&1 &
BOOT_PID=$!
# notification 테이블이 생길 때까지 최대 ~90s 폴링.
for i in $(seq 1 45); do
  if docker exec smart-workplace-db-1 psql -U app -d workplace -tAc \
       "SELECT to_regclass('public.notification');" | grep -q notification; then
    echo "migration applied"; break
  fi
  sleep 2
done
kill $BOOT_PID 2>/dev/null
```

Expected: `migration applied` 출력. 적용 확인:

```bash
docker exec smart-workplace-db-1 psql -U app -d workplace -c '\d notification'
```
Expected: `notification` 테이블 + 2개 인덱스(`idx_notification_recipient_created`, `idx_notification_unread`) 출력.

- [ ] **Step 3: jOOQ 코드젠**

```bash
cd apps/workplace-api && ./gradlew generateJooq
```
Expected: BUILD SUCCESSFUL. `src/main/generated/.../jooq/tables/Notification.java` 생성, `com.workplace.jooq.Tables.NOTIFICATION` 사용 가능.

- [ ] **Step 4: 커밋**

```bash
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-api/src/main/resources/db/migration/V22__notifications.sql
git commit -m "feat(notify): V22 notification 테이블 — 인앱 알림 인박스 스키마"
```
> 생성된 jOOQ 소스는 gitignore 대상이라 커밋되지 않는다(정상).

---

## TASK 2: NotificationType enum + NotificationResponse DTO

순수 데이터 타입(테스트 대상 행위 없음) — 생성 후 컴파일만 확인.

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/dto/NotificationType.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/dto/NotificationResponse.java`

- [ ] **Step 1: NotificationType 작성**

```java
package com.workplace.notify.dto;

/** 알림 종류 — DB 의 notification.type(VARCHAR) 과 name() 으로 매핑. Phase 2 에서 MENTIONED 추가 예정. */
public enum NotificationType {
  ASSIGNED,
  COMMENTED,
  STATUS_CHANGED
}
```

- [ ] **Step 2: NotificationResponse 작성**

```java
package com.workplace.notify.dto;

import java.time.Instant;

/**
 * 알림 1건 응답. 표시용 필드(actorName/projectKey/issueNumber/issueTitle)는 읽을 때 issue·project·user 조인 결과.
 * 프론트는 issueKey 를 {projectKey}-{issueNumber} 로 합성하고 /projects/{projectKey}/issues/{issueNumber} 로 이동한다.
 *
 * @param actorId 행위자 id. 시스템 알림이면 null
 * @param actorKind 'HUMAN' | 'AGENT' | null — AGENT 면 프론트가 AI 배지 표시
 * @param read read_at 존재 여부(읽음)
 */
public record NotificationResponse(
    Long id,
    String type,
    Long actorId,
    String actorName,
    String actorKind,
    Long issueId,
    String projectKey,
    Integer issueNumber,
    String issueTitle,
    Long commentId,
    boolean read,
    Instant createdAt) {}
```

- [ ] **Step 3: 컴파일 확인**

```bash
cd apps/workplace-api && ./gradlew compileJava
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/notify/dto/
git commit -m "feat(notify): NotificationType·NotificationResponse DTO"
```

---

## TASK 3: NotificationRepository (jOOQ)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/repository/NotificationRepository.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/repository/NotificationRepositoryTest.java`

> 이 테스트는 `@Transactional`(롤백)로 작성한다 — 이벤트/`@Async` 를 거치지 않고 리포지토리 메서드를 직접 호출하므로 롤백이 정상 동작하며 공유 test DB(5435)를 오염시키지 않는다. 시드는 전역 상태(ADMIN 역할 등)를 건드리지 않고 고유 토큰 사용자/프로젝트만 만든다.

- [ ] **Step 1: 실패 테스트 작성**

```java
package com.workplace.notify.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationType;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** NotificationRepository 통합 테스트 — insert/조회/읽음. 직접 호출이라 @Transactional 롤백. */
@Transactional
class NotificationRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationRepository repo;

  private String tok() {
    return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
  }

  private long seedUser(String kind) {
    String s = tok();
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "nr_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Nr" + s)
        .set(USER.EMAIL, "nr_" + s + "@example.com")
        .set(USER.KIND, kind)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** project + issue 1건 시드 후 issueId 반환. */
  private long seedIssue(long ownerId, String title) {
    String s = tok();
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "N" + s.substring(0, 5))
            .set(PROJECT.NAME, "P" + s)
            .set(PROJECT.OWNER_ID, ownerId)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(ISSUE)
        .set(ISSUE.PROJECT_ID, projectId)
        .set(ISSUE.NUMBER, 1)
        .set(ISSUE.TITLE, title)
        .set(ISSUE.REPORTER_ID, ownerId)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void insertBatch_then_listRecent_joinsDisplayFields() {
    long recipient = seedUser("HUMAN");
    long actor = seedUser("AGENT");
    long issueId = seedIssue(actor, "리팩터링");

    repo.insertBatch(List.of(recipient), NotificationType.COMMENTED, actor, issueId, 77L);

    List<NotificationResponse> list = repo.listRecent(recipient, 20);
    assertThat(list).hasSize(1);
    NotificationResponse n = list.get(0);
    assertThat(n.type()).isEqualTo("COMMENTED");
    assertThat(n.actorId()).isEqualTo(actor);
    assertThat(n.actorKind()).isEqualTo("AGENT"); // AI 액터 보존
    assertThat(n.issueId()).isEqualTo(issueId);
    assertThat(n.issueTitle()).isEqualTo("리팩터링");
    assertThat(n.issueNumber()).isEqualTo(1);
    assertThat(n.projectKey()).isNotBlank();
    assertThat(n.commentId()).isEqualTo(77L);
    assertThat(n.read()).isFalse();
    assertThat(n.createdAt()).isNotNull();
  }

  @Test
  void countUnread_and_markRead_areRecipientScoped() {
    long a = seedUser("HUMAN");
    long b = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a, b), NotificationType.STATUS_CHANGED, null, issueId, null);

    assertThat(repo.countUnread(a)).isEqualTo(1);
    long aNotifId = repo.listRecent(a, 20).get(0).id();

    // 타인(b) 이 a 의 알림 id 로 읽음 시도 → 0행(스코프 격리)
    assertThat(repo.markRead(b, aNotifId)).isZero();
    assertThat(repo.countUnread(a)).isEqualTo(1);

    // 본인(a) 읽음 → 1행, 카운트 0
    assertThat(repo.markRead(a, aNotifId)).isEqualTo(1);
    assertThat(repo.countUnread(a)).isZero();
    assertThat(repo.listRecent(a, 20).get(0).read()).isTrue();
  }

  @Test
  void markAllRead_clearsOnlyCallerUnread() {
    long a = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a, a), NotificationType.ASSIGNED, null, issueId, null);
    assertThat(repo.countUnread(a)).isEqualTo(2);

    assertThat(repo.markAllRead(a)).isEqualTo(2);
    assertThat(repo.countUnread(a)).isZero();
  }
}
```

- [ ] **Step 2: 실패 확인**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.notify.repository.NotificationRepositoryTest"
```
Expected: 컴파일 실패(`NotificationRepository` 없음).

- [ ] **Step 3: NotificationRepository 구현**

```java
package com.workplace.notify.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationType;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Query;
import org.springframework.stereotype.Repository;

/** notification jOOQ 리포지토리. 모든 조회/변경은 recipientId 스코프로 격리한다. */
@Repository
@RequiredArgsConstructor
public class NotificationRepository {

  private final DSLContext dsl;

  /** 수신자별 1행씩 batch insert. created_at 은 DB default, read_at 은 null(안읽음). */
  public void insertBatch(
      List<Long> recipientIds, NotificationType type, Long actorId, long issueId, Long commentId) {
    List<Query> rows =
        recipientIds.stream()
            .map(
                rid ->
                    (Query)
                        dsl.insertInto(NOTIFICATION)
                            .set(NOTIFICATION.RECIPIENT_ID, rid)
                            .set(NOTIFICATION.ACTOR_ID, actorId)
                            .set(NOTIFICATION.TYPE, type.name())
                            .set(NOTIFICATION.ISSUE_ID, issueId)
                            .set(NOTIFICATION.COMMENT_ID, commentId))
            .toList();
    dsl.batch(rows).execute();
  }

  /** 최신순 알림 — issue·project·user(actor, LEFT) 조인으로 표시 필드 합성. */
  public List<NotificationResponse> listRecent(long recipientId, int limit) {
    return dsl
        .select(
            NOTIFICATION.ID,
            NOTIFICATION.TYPE,
            NOTIFICATION.ACTOR_ID,
            USER.NAME,
            USER.KIND,
            NOTIFICATION.ISSUE_ID,
            PROJECT.KEY,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            NOTIFICATION.COMMENT_ID,
            NOTIFICATION.READ_AT,
            NOTIFICATION.CREATED_AT)
        .from(NOTIFICATION)
        .join(ISSUE)
        .on(ISSUE.ID.eq(NOTIFICATION.ISSUE_ID))
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .leftJoin(USER)
        .on(USER.ID.eq(NOTIFICATION.ACTOR_ID))
        .where(NOTIFICATION.RECIPIENT_ID.eq(recipientId))
        .orderBy(NOTIFICATION.CREATED_AT.desc(), NOTIFICATION.ID.desc())
        .limit(limit)
        .fetch(
            r -> {
              OffsetDateTime created = r.get(NOTIFICATION.CREATED_AT);
              return new NotificationResponse(
                  r.get(NOTIFICATION.ID),
                  r.get(NOTIFICATION.TYPE),
                  r.get(NOTIFICATION.ACTOR_ID),
                  r.get(USER.NAME),
                  r.get(USER.KIND),
                  r.get(NOTIFICATION.ISSUE_ID),
                  r.get(PROJECT.KEY),
                  r.get(ISSUE.NUMBER),
                  r.get(ISSUE.TITLE),
                  r.get(NOTIFICATION.COMMENT_ID),
                  r.get(NOTIFICATION.READ_AT) != null,
                  created == null ? null : created.toInstant());
            });
  }

  /** 안읽음 수. */
  public long countUnread(long recipientId) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(NOTIFICATION)
            .where(NOTIFICATION.RECIPIENT_ID.eq(recipientId).and(NOTIFICATION.READ_AT.isNull())));
  }

  /** 단건 읽음 — recipient 스코프 + 이미 읽은 건 제외. 영향 행 수 반환(타인 id 면 0). */
  public int markRead(long recipientId, long id) {
    return dsl.update(NOTIFICATION)
        .set(NOTIFICATION.READ_AT, OffsetDateTime.now())
        .where(
            NOTIFICATION
                .ID
                .eq(id)
                .and(NOTIFICATION.RECIPIENT_ID.eq(recipientId))
                .and(NOTIFICATION.READ_AT.isNull()))
        .execute();
  }

  /** 본인 안읽음 전체 읽음. 영향 행 수 반환. */
  public int markAllRead(long recipientId) {
    return dsl.update(NOTIFICATION)
        .set(NOTIFICATION.READ_AT, OffsetDateTime.now())
        .where(NOTIFICATION.RECIPIENT_ID.eq(recipientId).and(NOTIFICATION.READ_AT.isNull()))
        .execute();
  }
}
```

- [ ] **Step 4: 통과 확인**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.notify.repository.NotificationRepositoryTest"
```
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/notify/repository/ apps/workplace-api/src/test/java/com/workplace/notify/repository/
git commit -m "feat(notify): NotificationRepository — insertBatch·listRecent·읽음(recipient 스코프)"
```

---

## TASK 4: NotificationService

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/service/NotificationService.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/service/NotificationServiceTest.java`

> `@Transactional` 롤백. `createAndFanOut` 을 직접 호출(이벤트/async 미경유)하므로 동기·결정적이다. `SseRegistry.fanOut` 은 등록된 emitter 가 없으면 no-op 이라 부수효과 없음.

- [ ] **Step 1: 실패 테스트 작성**

```java
package com.workplace.notify.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.notify.dto.NotificationType;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** NotificationService 통합 테스트 — actor 제외·중복 제거·빈 수신자 no-op·스코프. */
@Transactional
class NotificationServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationService service;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ns_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Ns" + s)
        .set(USER.EMAIL, "ns_" + s + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long seedIssue(long ownerId) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 5);
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "S" + s)
            .set(PROJECT.NAME, "P" + s)
            .set(PROJECT.OWNER_ID, ownerId)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(ISSUE)
        .set(ISSUE.PROJECT_ID, projectId)
        .set(ISSUE.NUMBER, 1)
        .set(ISSUE.TITLE, "t")
        .set(ISSUE.REPORTER_ID, ownerId)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void createAndFanOut_excludesActor_andDedupes() {
    long actor = seedUser();
    long r1 = seedUser();
    long issueId = seedIssue(actor);

    // 후보에 actor 자신 + r1 중복 → actor 제외, r1 1건만
    service.createAndFanOut(
        NotificationType.COMMENTED, List.of(actor, r1, r1, actor), actor, issueId, 5L);

    assertThat(service.countUnread(actor)).isZero(); // 셀프 제외
    assertThat(service.countUnread(r1)).isEqualTo(1); // 중복 폴딩
  }

  @Test
  void createAndFanOut_emptyRecipients_isNoOp() {
    long actor = seedUser();
    long issueId = seedIssue(actor);
    service.createAndFanOut(NotificationType.ASSIGNED, List.of(actor), actor, issueId, null);
    assertThat(service.countUnread(actor)).isZero();
    assertThat(service.listRecent(actor, 20)).isEmpty();
  }

  @Test
  void markAllRead_isCallerScoped() {
    long a = seedUser();
    long b = seedUser();
    long issueId = seedIssue(a);
    service.createAndFanOut(NotificationType.STATUS_CHANGED, List.of(a, b), null, issueId, null);

    service.markAllRead(a);
    assertThat(service.countUnread(a)).isZero();
    assertThat(service.countUnread(b)).isEqualTo(1); // b 는 영향 없음
  }
}
```

- [ ] **Step 2: 실패 확인**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.notify.service.NotificationServiceTest"
```
Expected: 컴파일 실패(`NotificationService` 없음).

- [ ] **Step 3: NotificationService 구현**

```java
package com.workplace.notify.service;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.repository.NotificationRepository;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 알림 생성·조회·읽음. 생성 시 수신자 후보에서 actor 본인 제외 + 중복 제거 후 persist 하고, 같은 수신자 집합에 SSE("notify.created")로
 * fan-out 한다. 모든 조회/변경은 recipientId 스코프(타 사용자 알림 접근 불가).
 */
@Service
@RequiredArgsConstructor
public class NotificationService {

  private final NotificationRepository repo;
  private final SseRegistry registry;

  /** 수신자 확정(actor 제외·중복 제거) → batch insert → SSE fan-out. 빈 수신자면 no-op. */
  @Transactional
  public void createAndFanOut(
      NotificationType type, List<Long> recipientIds, Long actorId, long issueId, Long commentId) {
    List<Long> recipients =
        recipientIds.stream()
            .filter(Objects::nonNull)
            .distinct()
            .filter(id -> !id.equals(actorId))
            .toList();
    if (recipients.isEmpty()) return;
    repo.insertBatch(recipients, type, actorId, issueId, commentId);
    // 페이로드는 경량(클라가 수신 즉시 쿼리 invalidate). 상세는 REST 재조회.
    registry.fanOut(recipients, "notify.created", Map.of("type", type.name(), "issueId", issueId));
  }

  @Transactional(readOnly = true)
  public List<NotificationResponse> listRecent(long recipientId, int limit) {
    return repo.listRecent(recipientId, limit);
  }

  @Transactional(readOnly = true)
  public long countUnread(long recipientId) {
    return repo.countUnread(recipientId);
  }

  @Transactional
  public int markRead(long recipientId, long id) {
    return repo.markRead(recipientId, id);
  }

  @Transactional
  public int markAllRead(long recipientId) {
    return repo.markAllRead(recipientId);
  }
}
```

- [ ] **Step 4: 통과 확인**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.notify.service.NotificationServiceTest"
```
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/notify/service/ apps/workplace-api/src/test/java/com/workplace/notify/service/
git commit -m "feat(notify): NotificationService — actor 제외·중복 제거·SSE fan-out"
```

---

## TASK 5: notifyEventExecutor 빈 + NotificationDispatcher

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/global/outbound/OutboundConfig.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/outbound/NotificationDispatcher.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/outbound/NotificationDispatcherTest.java`

> 디스패처 테스트는 기존 `IssueEventDispatcherTest` 와 동일하게 **Spring 컨텍스트 없이 직접 호출**(서비스·워처리포 mock)로 수신자 해석 로직만 검증한다. `@Async`/`AFTER_COMMIT` 배선·DB persist 는 Task 3·4 에서 이미 검증됨 — 따라서 async end-to-end 테스트(Awaitility 등)는 작성하지 않는다(코드베이스에 Awaitility 미도입, 기존 디스패처 선례 동일).

- [ ] **Step 1: notifyEventExecutor 빈 추가 (OutboundConfig 수정)**

`OutboundConfig.java` 의 `aiAgentEventExecutor()` 빈 **아래에** 다음 메서드를 추가한다(기존 import `Executor`, `ThreadPoolTaskExecutor` 재사용).

```java
  /**
   * notify 디스패처 전용 executor. @Async 무인자는 단일 Executor 빈(aiAgentEventExecutor)에 바인딩되거나, 빈이 2개면 모호해져
   * SimpleAsyncTaskExecutor 로 조용히 폴백한다. 따라서 항상 명시 한정(@Async("notifyEventExecutor"))한다.
   * 알림은 가벼운 insert+fan-out 이므로 작은 풀로 충분, queue 는 버스트 흡수용으로 넉넉히.
   */
  @Bean(name = "notifyEventExecutor")
  public Executor notifyEventExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(500);
    executor.setThreadNamePrefix("notify-");
    executor.initialize();
    return executor;
  }
```

- [ ] **Step 2: 실패 테스트 작성**

```java
package com.workplace.notify.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.service.NotificationService;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

/** NotificationDispatcher — 수신자 해석 검증. Spring 컨텍스트 없이 직접 호출. */
class NotificationDispatcherTest {

  private static final UserSummary HUMAN_ACTOR = new UserSummary(1L, "alice", "Alice", "HUMAN");
  private static final UserSummary AGENT_ACTOR = new UserSummary(9L, "ai", "AI", "AGENT");
  private static final UserSummary ASSIGNEE_A = new UserSummary(2L, "bob", "Bob", "HUMAN");
  private static final UserSummary ASSIGNEE_B = new UserSummary(3L, "carol", "Carol", "HUMAN");

  private NotificationService service;
  private IssueWatcherRepository watcherRepo;
  private NotificationDispatcher dispatcher;

  @BeforeEach
  void setUp() {
    service = Mockito.mock(NotificationService.class);
    watcherRepo = Mockito.mock(IssueWatcherRepository.class);
    dispatcher = new NotificationDispatcher(service, watcherRepo);
  }

  @Test
  @SuppressWarnings("unchecked")
  void onIssueAssigned_usesAdded_typeAssigned_noComment() {
    var e =
        new IssueAssignedEvent(
            10L,
            "WP",
            "WP-10",
            "t",
            HUMAN_ACTOR,
            List.of(ASSIGNEE_A, ASSIGNEE_B),
            List.of(ASSIGNEE_A), // added
            List.of(),
            Instant.now());

    dispatcher.onIssueAssigned(e);

    var recipients = ArgumentCaptor.forClass(List.class);
    verify(service)
        .createAndFanOut(
            eq(NotificationType.ASSIGNED), recipients.capture(), eq(1L), eq(10L), eq(null));
    assertThat(recipients.getValue()).containsExactly(2L); // added 의 id
  }

  @Test
  @SuppressWarnings("unchecked")
  void onIssueCommented_unionsAssigneesAndWatchers_typeCommented_withCommentId() {
    when(watcherRepo.findUserIdsByIssue(11L)).thenReturn(List.of(4L, 2L));
    var e =
        new IssueCommentedEvent(
            11L, "WP", "WP-11", "t", HUMAN_ACTOR, List.of(ASSIGNEE_A), 55L, "hi", Instant.now());

    dispatcher.onIssueCommented(e);

    var recipients = ArgumentCaptor.forClass(List.class);
    verify(service)
        .createAndFanOut(
            eq(NotificationType.COMMENTED), recipients.capture(), eq(1L), eq(11L), eq(55L));
    // 담당자(2) ∪ 워처(4,2) — 중복 제거/actor 제외는 service 책임이므로 여기선 후보 합집합만 확인
    assertThat(recipients.getValue()).contains(2L, 4L);
  }

  @Test
  @SuppressWarnings("unchecked")
  void onIssueStatusChanged_unionsAssigneesAndWatchers_agentActorPreserved() {
    when(watcherRepo.findUserIdsByIssue(12L)).thenReturn(List.of());
    var e =
        new IssueStatusChangedEvent(
            12L,
            "WP",
            "WP-12",
            "t",
            AGENT_ACTOR, // AI 액터
            List.of(ASSIGNEE_A, ASSIGNEE_B),
            "TODO",
            "IN_PROGRESS",
            Instant.now());

    dispatcher.onIssueStatusChanged(e);

    var recipients = ArgumentCaptor.forClass(List.class);
    verify(service)
        .createAndFanOut(
            eq(NotificationType.STATUS_CHANGED),
            recipients.capture(),
            eq(9L), // AGENT actor id 전달(액터 facet 보존)
            eq(12L),
            eq(null));
    assertThat(recipients.getValue()).contains(2L, 3L);
  }

  @Test
  void onIssueAssigned_nullActor_passesNullActorId() {
    var e =
        new IssueAssignedEvent(
            13L, "WP", "WP-13", "t", null, List.of(ASSIGNEE_A), List.of(ASSIGNEE_A), List.of(),
            Instant.now());

    dispatcher.onIssueAssigned(e);

    verify(service)
        .createAndFanOut(eq(NotificationType.ASSIGNED), any(), eq(null), eq(13L), eq(null));
  }

  @Test
  void serviceThrows_isSwallowed_noPropagation() {
    Mockito.doThrow(new RuntimeException("boom"))
        .when(service)
        .createAndFanOut(any(), any(), any(), Mockito.anyLong(), any());
    var e =
        new IssueAssignedEvent(
            14L, "WP", "WP-14", "t", HUMAN_ACTOR, List.of(ASSIGNEE_A), List.of(ASSIGNEE_A),
            List.of(), Instant.now());

    // 예외가 밖으로 전파되지 않아야 한다(async 핸들러에서 조용히 로깅).
    dispatcher.onIssueAssigned(e);
    verify(service, never()).markAllRead(Mockito.anyLong());
  }
}
```

- [ ] **Step 3: 실패 확인**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.notify.outbound.NotificationDispatcherTest"
```
Expected: 컴파일 실패(`NotificationDispatcher` 없음).

- [ ] **Step 4: NotificationDispatcher 구현**

```java
package com.workplace.notify.outbound;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.service.NotificationService;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 이슈 도메인 이벤트 → 알림 생성. AFTER_COMMIT 에서만 동작(롤백 시 알림 없음), @Async("notifyEventExecutor")로 호출 스레드와 분리해
 * 알림 처리가 이슈 API 응답을 지연시키지 않는다. 수신자 후보만 해석하고(담당자=이벤트 페이로드, 워처=리포 조회), actor 제외/중복 제거는
 * NotificationService 가 담당한다. 핸들러 예외는 도메인 트랜잭션에 영향 없도록 자체 로깅(전파 안 함).
 *
 * <p>"AI 담당자 활동"은 별도 트리거가 아니라 actor.kind=="AGENT" 인 활동 — actorId 를 그대로 실어 프론트가 AI 배지로 구분한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NotificationDispatcher {

  private final NotificationService service;
  private final IssueWatcherRepository watcherRepo;

  /** 배정: 새로 추가된 담당자에게(added). */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueAssigned(IssueAssignedEvent e) {
    try {
      List<Long> recipients = e.added().stream().map(UserSummary::id).toList();
      service.createAndFanOut(
          NotificationType.ASSIGNED, recipients, actorId(e.actor()), e.issueId(), null);
    } catch (Exception ex) {
      log.warn("[notify] assigned 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /** 코멘트: 담당자 ∪ 워처. */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueCommented(IssueCommentedEvent e) {
    try {
      service.createAndFanOut(
          NotificationType.COMMENTED,
          unionAssigneesAndWatchers(e.issueId(), e.assignees()),
          actorId(e.actor()),
          e.issueId(),
          e.commentId());
    } catch (Exception ex) {
      log.warn("[notify] commented 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /** 상태변경: 담당자 ∪ 워처. */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueStatusChanged(IssueStatusChangedEvent e) {
    try {
      service.createAndFanOut(
          NotificationType.STATUS_CHANGED,
          unionAssigneesAndWatchers(e.issueId(), e.assignees()),
          actorId(e.actor()),
          e.issueId(),
          null);
    } catch (Exception ex) {
      log.warn("[notify] status_changed 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /** 담당자(이벤트 페이로드 — 같은 트랜잭션이라 정확) ∪ 워처(경량 조회). 중복/actor 제외는 service 가 처리. */
  private List<Long> unionAssigneesAndWatchers(long issueId, List<UserSummary> assignees) {
    List<Long> ids = new ArrayList<>();
    if (assignees != null) assignees.forEach(u -> ids.add(u.id()));
    ids.addAll(watcherRepo.findUserIdsByIssue(issueId));
    return ids;
  }

  private static Long actorId(UserSummary actor) {
    return actor == null ? null : actor.id();
  }
}
```

- [ ] **Step 5: 통과 확인**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.notify.outbound.NotificationDispatcherTest"
```
Expected: PASS (5 tests).

- [ ] **Step 6: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/global/outbound/OutboundConfig.java apps/workplace-api/src/main/java/com/workplace/notify/outbound/ apps/workplace-api/src/test/java/com/workplace/notify/outbound/
git commit -m "feat(notify): NotificationDispatcher — 3개 이슈 이벤트 구독·수신자 해석 + 전용 executor"
```

---

## TASK 6: NotificationController

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/controller/NotificationController.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/controller/NotificationControllerTest.java`

> `@WebMvcTest` + `@Import(SecurityConfig…)` + 서비스 mock. 기존 `ChannelCrudControllerTest` 패턴(인증: `Bearer v` → userId 1L).

- [ ] **Step 1: 실패 테스트 작성**

```java
package com.workplace.notify.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.service.NotificationService;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** NotificationController 라우팅·페이로드·인증 테스트. 서비스는 Mockito. */
@SuppressWarnings("null")
@WebMvcTest(controllers = NotificationController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class NotificationControllerTest {

  @Autowired MockMvc mockMvc;

  @MockitoBean NotificationService service;
  @MockitoBean SseRegistry sseRegistry;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("project:read"));
  }

  @Test
  void list_returnsCallerScoped() throws Exception {
    var n =
        new NotificationResponse(
            5L, "COMMENTED", 9L, "AI", "AGENT", 7L, "WP", 3, "제목", 55L, false, Instant.now());
    when(service.listRecent(eq(1L), eq(20))).thenReturn(List.of(n));

    mockMvc
        .perform(get("/api/v1/notifications").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(5))
        .andExpect(jsonPath("$[0].actorKind").value("AGENT"))
        .andExpect(jsonPath("$[0].projectKey").value("WP"))
        .andExpect(jsonPath("$[0].issueNumber").value(3));
    verify(service).listRecent(eq(1L), eq(20));
  }

  @Test
  void unreadCount_returnsCountObject() throws Exception {
    when(service.countUnread(1L)).thenReturn(4L);
    mockMvc
        .perform(get("/api/v1/notifications/unread-count").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.count").value(4));
  }

  @Test
  void markRead_returns204_andScopesToCaller() throws Exception {
    mockMvc
        .perform(post("/api/v1/notifications/5/read").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(service).markRead(eq(1L), eq(5L));
  }

  @Test
  void markAllRead_returns204() throws Exception {
    mockMvc
        .perform(post("/api/v1/notifications/read-all").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(service).markAllRead(eq(1L));
  }

  @Test
  void list_unauthenticated_returns401() throws Exception {
    mockMvc.perform(get("/api/v1/notifications")).andExpect(status().isUnauthorized());
  }
}
```

- [ ] **Step 2: 실패 확인**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.notify.controller.NotificationControllerTest"
```
Expected: 컴파일 실패(`NotificationController` 없음).

- [ ] **Step 3: NotificationController 구현**

```java
package com.workplace.notify.controller;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.service.NotificationService;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 알림 인박스 REST + SSE. 모든 엔드포인트는 본인(callerId) 스코프 — @RequirePermission 대신 recipientId=callerId 격리로
 * 타 사용자 알림 접근을 차단한다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/notifications")
public class NotificationController {

  private final NotificationService service;
  private final SseRegistry registry;

  /** 최신 알림 목록(평면). limit 1~100 클램프. */
  @GetMapping
  public ResponseEntity<List<NotificationResponse>> list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(name = "limit", defaultValue = "20") int limit) {
    return ResponseEntity.ok(service.listRecent(callerId, Math.min(Math.max(limit, 1), 100)));
  }

  /** 안읽음 수. */
  @GetMapping("/unread-count")
  public ResponseEntity<Map<String, Long>> unreadCount(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(Map.of("count", service.countUnread(callerId)));
  }

  /** 단건 읽음. 타인 id 면 service 가 0행 — 멱등하게 204. */
  @PostMapping("/{id}/read")
  public ResponseEntity<Void> markRead(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long id) {
    service.markRead(callerId, id);
    return ResponseEntity.noContent().build();
  }

  /** 모두 읽음. */
  @PostMapping("/read-all")
  public ResponseEntity<Void> markAllRead(@AuthenticationPrincipal Long callerId) {
    service.markAllRead(callerId);
    return ResponseEntity.noContent().build();
  }

  /** 실시간 스트림 — 유저당 1개. 프론트는 fetch+ReadableStream 으로 Authorization 헤더를 실어 호출한다. */
  @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter stream(@AuthenticationPrincipal Long callerId) {
    return registry.register(callerId);
  }
}
```

- [ ] **Step 4: 통과 확인 + 전체 notify 테스트**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.notify.*"
```
Expected: PASS (전 notify 테스트). 그 다음 회귀 확인:
```bash
cd apps/workplace-api && ./gradlew spotlessApply && ./gradlew build
```
Expected: BUILD SUCCESSFUL.
> `./gradlew build` 가 ProjectConflictException(키 충돌)으로 깨지면 재시도 — 알려진 공유 test DB flake(메모 참조), 코드 문제 아님.

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/notify/controller/ apps/workplace-api/src/test/java/com/workplace/notify/controller/
git commit -m "feat(notify): NotificationController — 목록/안읽음수/읽음/모두읽음/SSE 스트림"
```

---

## TASK 7: 프론트 타입 + API 모듈

**Files:**
- Create: `apps/workplace-web/src/types/notification.ts`
- Create: `apps/workplace-web/src/api/notifications.ts`

- [ ] **Step 1: 타입 작성**

```ts
// 백엔드 NotificationResponse 와 1:1 매칭.
export interface NotificationResponse {
  id: number
  type: 'ASSIGNED' | 'COMMENTED' | 'STATUS_CHANGED'
  actorId: number | null
  actorName: string | null
  actorKind: string | null // 'HUMAN' | 'AGENT' | null
  issueId: number
  projectKey: string
  issueNumber: number
  issueTitle: string
  commentId: number | null
  read: boolean
  createdAt: string
}
```

- [ ] **Step 2: API 모듈 작성**

```ts
// 알림 인박스 REST 호출. client(baseURL /api/v1) 사용.
import { client } from './client'
import type { NotificationResponse } from '../types/notification'

export const notificationsApi = {
  list: (limit = 20) =>
    client
      .get<NotificationResponse[]>('/notifications', { params: { limit } })
      .then((r) => r.data),
  unreadCount: () =>
    client.get<{ count: number }>('/notifications/unread-count').then((r) => r.data.count),
  markRead: (id: number) => client.post(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => client.post('/notifications/read-all').then((r) => r.data),
}
```

- [ ] **Step 3: 타입체크**

```bash
cd apps/workplace-web && pnpm typecheck
```
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/types/notification.ts apps/workplace-web/src/api/notifications.ts
git commit -m "feat(web/notify): notification 타입 + API 모듈"
```

---

## TASK 8: 쿼리키 + 쿼리/뮤테이션 훅

**Files:**
- Create: `apps/workplace-web/src/hooks/queries/notificationKeys.ts`
- Create: `apps/workplace-web/src/hooks/queries/useNotifications.ts`
- Create: `apps/workplace-web/src/hooks/queries/useUnreadCount.ts`
- Create: `apps/workplace-web/src/hooks/queries/useMarkNotificationRead.ts`
- Create: `apps/workplace-web/src/hooks/queries/useMarkAllNotificationsRead.ts`

- [ ] **Step 1: 쿼리키 팩토리**

```ts
// 알림 쿼리키. all 프리픽스 invalidate 로 목록+카운트 동시 갱신.
export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
}
```

- [ ] **Step 2: 목록 쿼리 훅(패널 열릴 때 lazy)**

```ts
import { useQuery } from '@tanstack/react-query'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'

// 패널이 열려 있을 때만(enabled) 최근 20건을 가져온다.
export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.list(),
    queryFn: () => notificationsApi.list(20),
    enabled,
    staleTime: 10_000,
  })
}
```

- [ ] **Step 3: 안읽음 수 훅**

```ts
import { useQuery } from '@tanstack/react-query'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'

// 배지용 안읽음 수. 앱 셸에서 상시 구독.
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => notificationsApi.unreadCount(),
    staleTime: 30_000,
  })
}
```

- [ ] **Step 4: 단건 읽음 뮤테이션**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'

// 읽음 처리 후 목록+카운트 갱신.
export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  })
}
```

- [ ] **Step 5: 모두 읽음 뮤테이션**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'

// 모두 읽음 후 목록+카운트 갱신.
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  })
}
```

- [ ] **Step 6: 타입체크 + 커밋**

```bash
cd apps/workplace-web && pnpm typecheck
git add apps/workplace-web/src/hooks/queries/notificationKeys.ts apps/workplace-web/src/hooks/queries/useNotifications.ts apps/workplace-web/src/hooks/queries/useUnreadCount.ts apps/workplace-web/src/hooks/queries/useMarkNotificationRead.ts apps/workplace-web/src/hooks/queries/useMarkAllNotificationsRead.ts
git commit -m "feat(web/notify): 알림 쿼리키 + 목록/카운트 쿼리 + 읽음 뮤테이션 훅"
```

---

## TASK 9: useNotificationStream (fetch+ReadableStream SSE)

**Files:**
- Create: `apps/workplace-web/src/hooks/useNotificationStream.ts`

> `useChatStream.ts` 의 SSE 클라이언트 구조를 그대로 따른다(인증 헤더 때문에 fetch+ReadableStream). `notify.created` 수신 시, 그리고 매 (재)연결 직후 알림 쿼리를 invalidate(끊김 동안 놓친 알림 따라잡기 — 스펙 §6).

- [ ] **Step 1: 훅 작성**

```ts
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { getAccessToken, refreshAccessToken } from '../api/client'
import { notificationKeys } from './queries/notificationKeys'

// 앱 셸에서 1회 구독하는 알림 실시간 스트림. notify.created 수신 → 목록+카운트 invalidate.
// 네이티브 EventSource 는 Authorization 헤더 미지원 → fetch+ReadableStream 으로 Bearer 토큰 첨부.
export function useNotificationStream() {
  const qc = useQueryClient()

  useEffect(() => {
    let cancelled = false
    let attempt = 0
    let controller: AbortController | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleReconnect = () => {
      if (cancelled) return
      const delay = Math.min(1000 * Math.pow(2, attempt), 60_000) + Math.random() * 1000
      attempt++
      reconnectTimer = setTimeout(connect, delay)
    }

    const handleEvent = (eventName: string) => {
      // 어떤 알림 이벤트든 캐시를 무효화하면 REST 가 최신 목록/카운트를 다시 가져온다.
      if (eventName === 'notify.created') {
        qc.invalidateQueries({ queryKey: notificationKeys.all })
      }
    }

    const connect = async () => {
      if (cancelled) return
      const token = getAccessToken()
      if (!token) {
        scheduleReconnect()
        return
      }
      controller = new AbortController()
      try {
        const response = await fetch('/api/v1/notifications/stream', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
          credentials: 'include',
        })
        if (response.status === 401) {
          const refreshed = await refreshAccessToken()
          if (!refreshed) {
            cancelled = true // 401 → 조용히 중단
            return
          }
          scheduleReconnect()
          return
        }
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        attempt = 0
        // 재(연결) 직후 invalidate — 끊김 동안 놓친 알림을 따라잡는다(스펙 §6: 재연결 시 invalidate).
        // 없으면 다음 라이브 이벤트가 올 때까지 배지가 과소 카운트된다.
        qc.invalidateQueries({ queryKey: notificationKeys.all })

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent = 'message'

        const dispatch = () => {
          handleEvent(currentEvent)
          currentEvent = 'message'
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl).replace(/\r$/, '')
            buffer = buffer.slice(nl + 1)
            if (line === '') {
              dispatch()
              continue
            }
            if (line.startsWith(':')) continue // heartbeat
            const ci = line.indexOf(':')
            const field = ci === -1 ? line : line.slice(0, ci)
            const raw = ci === -1 ? '' : line.slice(ci + 1)
            const val = raw.startsWith(' ') ? raw.slice(1) : raw
            if (field === 'event') currentEvent = val
            // data 페이로드는 사용하지 않음(invalidate 만 함)
          }
        }
        if (!cancelled) scheduleReconnect()
      } catch (error) {
        if ((error as Error).name === 'AbortError' || cancelled) return
        scheduleReconnect()
      }
    }

    connect()
    return () => {
      cancelled = true
      controller?.abort()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [qc])
}
```

- [ ] **Step 2: 타입체크 + 커밋**

```bash
cd apps/workplace-web && pnpm typecheck
git add apps/workplace-web/src/hooks/useNotificationStream.ts
git commit -m "feat(web/notify): useNotificationStream — fetch+ReadableStream SSE → invalidate"
```

---

## TASK 10: InboxPanel + AppRail/AppLayout 통합

**Files:**
- Create: `apps/workplace-web/src/components/layout/InboxPanel.tsx`
- Modify: `apps/workplace-web/src/components/layout/AppRail.tsx`
- Modify: `apps/workplace-web/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: InboxPanel 작성**

```tsx
// src/components/layout/InboxPanel.tsx
// 인박스 — AppRail 하단 종 아이콘 + 안읽음 배지 + Popover 평면 목록.
// 행 클릭 → 이슈 상세 이동 + 읽음 처리. 헤더 "모두 읽음".
import { Bell } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMarkAllNotificationsRead } from '@/hooks/queries/useMarkAllNotificationsRead'
import { useMarkNotificationRead } from '@/hooks/queries/useMarkNotificationRead'
import { useNotifications } from '@/hooks/queries/useNotifications'
import { useUnreadCount } from '@/hooks/queries/useUnreadCount'
import { formatRelativeTime } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { NotificationResponse } from '@/types/notification'

// 알림 종류별 동작 문구(액터명 뒤에 붙는다).
const ACTION_LABEL: Record<NotificationResponse['type'], string> = {
  ASSIGNED: '님이 회원님을 배정했습니다',
  COMMENTED: '님이 코멘트를 남겼습니다',
  STATUS_CHANGED: '님이 상태를 변경했습니다',
}

export function InboxPanel() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { data: unread = 0 } = useUnreadCount()
  const { data: items = [], isLoading } = useNotifications(open)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()

  // 행 클릭: 안읽음이면 읽음 처리 → 패널 닫고 이슈 상세로 이동.
  const onRowClick = (n: NotificationResponse) => {
    if (!n.read) markRead.mutate(n.id)
    setOpen(false)
    navigate(`/projects/${n.projectKey}/issues/${n.issueNumber}`)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="알림"
          data-testid="inbox-trigger"
          className="relative flex w-full items-center justify-center rounded-md px-2 py-2.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span
              data-testid="inbox-badge"
              className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-80 p-0" data-testid="inbox-panel">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">알림</span>
          <button
            type="button"
            data-testid="inbox-mark-all"
            onClick={() => markAll.mutate()}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            모두 읽음
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">불러오는 중…</p>
          ) : items.length === 0 ? (
            <p
              data-testid="inbox-empty"
              className="px-3 py-6 text-center text-sm text-muted-foreground"
            >
              새 알림이 없습니다
            </p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    data-testid="inbox-item"
                    onClick={() => onRowClick(n)}
                    className={cn(
                      'flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm hover:bg-accent/50',
                      !n.read && 'bg-accent/20',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{n.actorName ?? '시스템'}</span>
                      {n.actorKind === 'AGENT' && (
                        <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] text-primary">
                          AI
                        </span>
                      )}
                      <span className="text-muted-foreground">{ACTION_LABEL[n.type]}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {n.projectKey}-{n.issueNumber} {n.issueTitle}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatRelativeTime(n.createdAt)}
                    </span>
                    {!n.read && (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: AppRail 하단에 InboxPanel 추가**

`AppRail.tsx` 의 import 블록(`import { AppRailUserMenu } from './AppRailUserMenu'` 줄 근처)에 추가:

```tsx
import { InboxPanel } from './InboxPanel'
```

그리고 하단 유저 메뉴 영역을 다음으로 교체:

```tsx
        {/* 하단: 알림 인박스 + 유저 메뉴 */}
        <div className="shrink-0 space-y-1 border-t p-2">
          <InboxPanel />
          <AppRailUserMenu />
        </div>
```

- [ ] **Step 3: AppLayout 에 스트림 마운트**

`AppLayout.tsx` 에 import 추가:

```tsx
import { useNotificationStream } from '@/hooks/useNotificationStream'
```

`useChatStream()` 호출 바로 아래에 추가:

```tsx
  // 알림 실시간 SSE 를 앱 셸에서 1회 구독.
  useNotificationStream()
```

- [ ] **Step 4: 타입체크 + 커밋**

```bash
cd apps/workplace-web && pnpm typecheck
git add apps/workplace-web/src/components/layout/InboxPanel.tsx apps/workplace-web/src/components/layout/AppRail.tsx apps/workplace-web/src/components/layout/AppLayout.tsx
git commit -m "feat(web/notify): InboxPanel(종+배지+패널) + AppRail/AppLayout 통합"
```

---

## TASK 11: E2E — fixture 스텁 + inbox.spec.ts

**Files:**
- Modify: `apps/workplace-web/e2e/fixtures/auth.fixture.ts`
- Create: `apps/workplace-web/e2e/pages/inbox.spec.ts`

- [ ] **Step 1: fixture 에 기본 스텁 추가**

`setupAuthMocks` 함수 안(다른 `mockApi` 기본 스텁들과 같은 위치)에 추가한다. 기존 테스트가 알림 호출/스트림 때문에 깨지지 않도록 안전한 기본값을 깐다.

> **의도적 미포함(검토자 참고):** 스펙 §7 의 "SSE `notify.created` 수신 시 배지 증가" E2E 는 본 Task 에서 **유보**한다. 프론트가 네이티브 EventSource 가 아니라 fetch+ReadableStream 을 쓰므로 Playwright 에서 스트리밍 응답을 청크 단위로 모킹해야 해 까다롭고 flaky 하다. 재연결-시-invalidate 로직(Task 9)이 배지 갱신 경로를 이미 커버하며, SSE 수신→invalidate 단위 동작은 후속에서 전용 스트림 모킹 헬퍼와 함께 추가한다.

```ts
  // 알림 인박스 기본 스텁 — 모든 인증 페이지에서 종/배지가 마운트되므로 기본값 제공.
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  // SSE 스트림은 즉시 닫히는 빈 event-stream 으로 스텁(실네트워크 차단).
  await page.route('**/api/v1/notifications/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  )
```

- [ ] **Step 2: 실패 spec 작성**

```ts
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'
import type { NotificationResponse } from '../../src/types/notification'

// 알림 1건 팩토리.
function notif(over: Partial<NotificationResponse> = {}): NotificationResponse {
  return {
    id: 1,
    type: 'COMMENTED',
    actorId: 9,
    actorName: 'AI 동료',
    actorKind: 'AGENT',
    issueId: 7,
    projectKey: 'WP',
    issueNumber: 3,
    issueTitle: '리팩터링',
    commentId: 55,
    read: false,
    createdAt: new Date().toISOString(),
    ...over,
  }
}

test('안읽음 배지가 카운트를 렌더한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 3 })
  await page.goto('/')
  await expect(page.getByTestId('inbox-badge')).toHaveText('3')
})

test('패널을 열면 목록을 보여주고, AI 액터에 배지를 단다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/notifications', [notif()])
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  await expect(page.getByTestId('inbox-panel')).toBeVisible()
  const item = page.getByTestId('inbox-item').first()
  await expect(item).toContainText('AI 동료')
  await expect(item).toContainText('WP-3 리팩터링')
  await expect(item).toContainText('AI') // AGENT 배지
})

test('빈 목록은 안내 문구를 보여준다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  await expect(page.getByTestId('inbox-empty')).toHaveText('새 알림이 없습니다')
})

test('행 클릭 → 읽음 POST + 이슈 상세로 이동', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/notifications', [notif()])
  // 이슈 상세 진입에 필요한 최소 스텁(상세 페이지 깨짐 방지) — 라우팅만 검증한다.
  await mockApi(page, 'GET', '/api/v1/projects/WP/issues/3', {}, { status: 200 })
  const readCapture = await mockApi(page, 'POST', '/api/v1/notifications/1/read', {}, {
    status: 204,
    capture: true,
  })
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  await page.getByTestId('inbox-item').first().click()

  await readCapture.waitForRequest()
  await expect(page).toHaveURL(/\/projects\/WP\/issues\/3$/)
})

test('"모두 읽음" → read-all POST', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications', [notif()])
  const allCapture = await mockApi(page, 'POST', '/api/v1/notifications/read-all', {}, {
    status: 204,
    capture: true,
  })
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  await page.getByTestId('inbox-mark-all').click()
  await allCapture.waitForRequest()
})
```

- [ ] **Step 3: E2E 실행**

```bash
cd apps/workplace-web && npx playwright test e2e/pages/inbox.spec.ts
```
Expected: 5 passed.
> ECONNREFUSED 등 산발적 flake 발생 시 재시도(메모: web pre-commit E2E flake) — 코드 문제 아님.

- [ ] **Step 4: 기존 E2E 회귀 확인(스모크)**

```bash
cd apps/workplace-web && npx playwright test --grep @smoke
```
Expected: 통과(알림 스텁 추가로 기존 인증 페이지가 깨지지 않음 확인).

- [ ] **Step 5: 타입체크 + 커밋**

```bash
cd apps/workplace-web && npx tsc -p tsconfig.e2e.json --noEmit
git add apps/workplace-web/e2e/fixtures/auth.fixture.ts apps/workplace-web/e2e/pages/inbox.spec.ts
git commit -m "test(web/notify): 인박스 E2E — 배지/목록/AI배지/빈/행클릭읽음+이동/모두읽음"
```

---

## 최종 검증

- [ ] 백엔드 전체 빌드: `cd apps/workplace-api && ./gradlew build` → BUILD SUCCESSFUL
- [ ] 프론트 빌드: `cd apps/workplace-web && pnpm build` → 성공
- [ ] 수동 스모크(선택): `pnpm db:up` + API/Web 기동 후, 이슈에 코멘트/배정/상태변경을 발생시키고 다른 사용자로 로그인해 종 배지 증가·패널 목록·행 이동·모두 읽음·실시간(SSE) 갱신 확인.

---

## 자가 검토 (작성자 체크)

**스펙 커버리지:**
- §2 트리거 3종(배정/코멘트/상태변경) → Task 5 디스패처 3 핸들러. AI 액터 facet(actorKind 보존) → Task 3 listRecent 조인 + Task 10 AI 배지. (멘션은 Phase 2, 범위 외 — OK)
- §4 데이터 모델 V22 + 인덱스 → Task 1. issue CASCADE, read_at 부분 인덱스 포함.
- §4 수신자 규칙(ASSIGNED=added−actor / COMMENTED·STATUS=담당자∪워처−actor) → Task 5(후보 해석) + Task 4(actor 제외·중복 제거).
- §5 백엔드 컴포넌트 5종 + 엔드포인트 5개 → Task 3·4·5·6. 본인 스코프 격리 → 리포/서비스 recipientId 스코프 + 컨트롤러 callerId.
- §6 프론트(종+배지, InboxPanel 평면목록, 행클릭 이동+읽음, 모두읽음, useNotificationStream, 빈상태, 401 중단, **재연결 시 invalidate**) → Task 7~11. 읽음 즉시성은 invalidate 채택(상단 의도된 차이 노트). 
- §7 테스트(디스패처/서비스/컨트롤러 + E2E 배지/목록/AI/빈/클릭/모두읽음) → 각 Task 테스트 스텝. **SSE-수신-배지증가 E2E 는 유보**(Task 11 노트 — fetch+ReadableStream 스트림 모킹 복잡).

**플레이스홀더 스캔:** 모든 코드 스텝에 완전한 코드 포함. TBD/TODO 없음.

**타입 일관성:** `createAndFanOut(NotificationType, List<Long>, Long actorId, long issueId, Long commentId)` — Task 4 정의, Task 5 호출 일치. `NotificationResponse` 12필드 — Task 2 정의, Task 3 fetch, Task 6 jsonPath, Task 7 TS 타입, Task 10 사용 일치. `notificationKeys.all` invalidate — Task 8 정의, Task 8 뮤테이션·Task 9 스트림 사용 일치. 엔드포인트 경로 `/api/v1/notifications*` — Task 6 컨트롤러 ↔ Task 7 API ↔ Task 11 스텁 일치. SSE 이벤트 `notify.created` — Task 4 발행 ↔ Task 9 수신 일치.

---

## 실행 핸드오프

**Plan complete and saved to `docs/superpowers/plans/2026-06-02-inbox-notify-phase1.md`. 두 가지 실행 옵션:**

**1. Subagent-Driven (권장)** — 태스크마다 새 서브에이전트 디스패치, 태스크 사이 2단계 리뷰(스펙→코드품질), 빠른 반복.

**2. Inline 실행** — 현재 세션에서 executing-plans 로 체크포인트 배치 실행.

**어느 방식으로 진행할까요?**
