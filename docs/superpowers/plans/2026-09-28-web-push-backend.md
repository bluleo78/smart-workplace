# Web Push 백엔드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** workplace-api 가 브라우저 푸시 구독을 저장하고, 인박스 알림(이슈·캘린더)과 메시지(DM·멘션)를 Web Push 로 발송한다.

**Architecture:** notify 모듈 하위 `com.workplace.notify.push` 패키지에 VAPID 키·구독·설정·암호화·발송을 둔다. 암호화(RFC 8291 aes128gcm)는 JDK 암호 API, VAPID(RFC 8292)는 기존 jjwt ES256, HTTP 는 RestClient 로 구현한다. 인박스 알림은 `NotificationService` 가, 메시지는 `MessageService` 가 이벤트를 발행하고 notify 의 `PushDispatcher` 가 커밋 후 `pushExecutor` 에서 발송한다.

**Tech Stack:** Java 21, Spring Boot 3.5, jOOQ(커밋된 codegen), Flyway, PostgreSQL(Testcontainers), jjwt 0.12, JUnit5 + AssertJ + Mockito + Awaitility, MockRestServiceServer.

**Spec:** `docs/superpowers/specs/2026-09-28-pwa-web-push-design.md` (에픽 #862 — 이 계획은 #864·#865·#866 담당. 프론트 #863·#867·#868·#869 는 별도 계획)

## Global Constraints

- Java 21 소스/타깃. 외부 web-push 라이브러리·BouncyCastle 추가 금지(JDK 암호 + 기존 jjwt 만).
- 모든 클래스·public 메서드·주요 로직에 **한국어 주석**(무엇을·왜) — `docs/CODING_CONVENTION.md`.
- 포맷: google-java-format(spotless). 각 Task 커밋 전 `./gradlew spotlessApply`.
- `@Async` 는 반드시 executor 이름을 지정한다(`@Async("pushExecutor")`) — 이름 없는 `@Async` 는 SimpleAsyncTaskExecutor 로 조용히 폴백.
- `@SpringBootTest` 테스트는 반드시 `IntegrationTestBase` 상속(ArchUnit 강제). `*Repository` 를 주입하는 컨트롤러는 `@Transactional` 필요(ArchUnit) → `PushController` 는 서비스만 주입.
- 새 테이블은 글로벌(비-RLS). `app_tenant` 권한은 V44 `ALTER DEFAULT PRIVILEGES` 로 자동 부여 — GRANT 문 불필요.
- 마이그레이션 번호: 현재 최신 V133 → 이 계획은 `V134__web_push.sql`. 착수 시 `ls src/main/resources/db/migration | sort -V | tail -1` 로 재확인하고 충돌하면 다음 번호로.
- 마이그레이션 추가 후 반드시 `./gradlew generateJooq` 실행하고 `src/main/generated` 변경을 함께 커밋(없으면 `Tables.PUSH_SUBSCRIPTION` 이 존재하지 않음).
- 설정 키: `workplace.push.enabled`(기본 true), `workplace.push.preview`(기본 true), `workplace.push.subject`(기본 `mailto:admin@localhost`), `workplace.push.timeout`(기본 5s), `workplace.push.vapid-public-key` / `workplace.push.vapid-private-key`(env `WORKPLACE_PUSH_VAPID_PUBLIC` / `WORKPLACE_PUSH_VAPID_PRIVATE`, base64url raw — 공개키 65바이트 비압축점, 개인키 32바이트 스칼라).
- 사용자당 구독 최대 20개. 미리보기 120자. 메시지 `Urgency: high`·`TTL: 86400`, 이슈·캘린더 `Urgency: normal`·`TTL: 259200`.
- 연속 실패 5회 이상 구독 삭제, 404/410 즉시 삭제.
- 커밋 컨벤션: `docs/COMMIT_CONVENTION.md` — `<type>(<scope>): <한글 제목>` + 본문 첫 줄 `- #<issue>`, `Closes` 금지. **커밋은 사용자 명시 승인 후에만** 실행(CLAUDE.md). 각 Task 의 Commit 단계는 승인받아 실행한다.
- 이슈 착수 시 GitHub Projects #4 에서 해당 이슈 Status `In progress` + 현재 이터레이션 할당.
- 테스트 실행: `cd apps/workplace-api && ./gradlew test --tests '<FQCN>'` (Docker 데몬 필요 — Colima).

## Review Focus

1. **이미 등록된 endpoint 를 다른 사용자가 등록** — 소유자가 새 사용자로 이전되고 이전 사용자에게는 더 이상 발송되지 않아야 한다(Task 5 테스트 `register_sameEndpoint_transfersOwnership`).
2. **브라우저가 준 키가 형식에 안 맞음**(p256dh 가 65바이트 비압축점이 아님, auth 가 16바이트 아님, base64url 이 아님) — 500 이 아니라 400(Task 5 `register_invalidKeys_returns400`).
3. **알림 대상 이슈/일정이 커밋 직후 삭제됨** — 푸시 조립 시 조회 결과 없음 → 예외 없이 건너뛴다(Task 7 `forInbox_deletedIssue_returnsNull`).
4. **멘션 대상이 채널 비멤버·AGENT·작성자 본인** — 발송 대상에서 빠져야 한다(Task 8 `create_channelMention_excludesNonMemberAgentAndAuthor`).
5. **발송 중 한 구독에서 예외(잘못 저장된 키 등)** — 같은 수신자의 다른 기기 발송은 계속되어야 한다(Task 6 `send_oneSubscriptionThrows_othersStillDelivered`).

---

## File Structure

```
apps/workplace-api/src/main/resources/db/migration/V134__web_push.sql        (Task 1)
apps/workplace-api/src/main/resources/application.yml                          (Task 3, workplace.push 블록)
apps/workplace-api/src/main/java/com/workplace/notify/push/
  PushCategory.java                 알림 카테고리 enum + NotificationType 매핑       (Task 1)
  PushSubscriptionRepository.java   push_subscription jOOQ                           (Task 1)
  PushSubscriptionRow.java          구독 행 record                                   (Task 1)
  NotificationPreferenceRepository.java  notification_preference jOOQ               (Task 1)
  PushVapidKeyRepository.java       push_vapid_key jOOQ                              (Task 1)
  EcKeys.java                       P-256 키 인코딩/디코딩 유틸                      (Task 2)
  WebPushEncryptor.java             RFC 8291 aes128gcm 암호화                        (Task 2)
  PushProperties.java               workplace.push 설정                              (Task 3)
  VapidKeys.java                    VAPID 키쌍 record                                (Task 3)
  VapidKeyProvider.java             env → DB → 생성                                  (Task 3)
  VapidSigner.java                  RFC 8292 Authorization 헤더                      (Task 3)
  EndpointValidator.java            https + 내부망(SSRF) 차단                        (Task 4)
  PushGateway.java                  HTTP 발송 추상화 interface                       (Task 4)
  WebPushGateway.java               RestClient 구현                                  (Task 4)
  PushConfig.java                   pushExecutor 빈                                  (Task 4)
  PushSubscriptionService.java      구독 등록/해제                                   (Task 5)
  NotificationPreferenceService.java 종류별 설정                                     (Task 5)
  PushMessage.java                  발송 단위 record(+ 미리보기 가림)                (Task 6)
  PushSender.java                   구독 조회 → 암호화 → 발송 → 결과 반영            (Task 6)
  InboxPushRequestedEvent.java      인박스 알림 생성 이벤트                          (Task 7)
  PushContentRepository.java        이슈/일정/사용자 표시 정보 조회                  (Task 7)
  PushContentService.java           인박스 알림 → PushMessage 조립                   (Task 7)
  PushDispatcher.java               이벤트 리스너(인박스·메시지)                     (Task 7, 8)
apps/workplace-api/src/main/java/com/workplace/notify/controller/PushController.java   (Task 5)
apps/workplace-api/src/main/java/com/workplace/notify/dto/
  PushConfigResponse.java, PushSubscriptionRequest.java, PushSubscriptionDeleteRequest.java (Task 5)
apps/workplace-api/src/main/java/com/workplace/notify/service/NotificationService.java  (Task 7 수정)
apps/workplace-api/src/main/java/com/workplace/messaging/outbound/MessagingDomainEvents.java (Task 8 수정)
apps/workplace-api/src/main/java/com/workplace/messaging/service/MessagePushPreview.java (Task 8)
apps/workplace-api/src/main/java/com/workplace/messaging/service/MessageService.java    (Task 8 수정)
테스트: apps/workplace-api/src/test/java/com/workplace/notify/push/*, notify/controller/PushControllerTest.java,
        messaging/service/MessagePushPreviewTest.java, messaging/MessagePushEventTest.java
```

---

### Task 1: 스키마 + jOOQ 생성 + 저장소 (#864)

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V134__web_push.sql`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushCategory.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushSubscriptionRow.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushSubscriptionRepository.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/NotificationPreferenceRepository.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushVapidKeyRepository.java`
- Modify(생성물): `apps/workplace-api/src/main/generated/**`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/push/PushRepositoriesTest.java`

**Interfaces:**
- Produces:
  - `enum PushCategory { DM, MENTION, ISSUE, CALENDAR; static PushCategory of(NotificationType t) }`
  - `record PushSubscriptionRow(long id, long userId, String endpoint, String p256dh, String auth)`
  - `PushSubscriptionRepository`: `void upsert(long userId, String endpoint, String p256dh, String auth, String userAgent)`, `int trimToLimit(long userId, int limit)`, `int deleteByUserAndEndpoint(long userId, String endpoint)`, `List<PushSubscriptionRow> findByUserIds(Collection<Long> userIds)`, `void markSuccess(long id)`, `int incrementFailure(long id)`(증가 후 값), `void deleteById(long id)`, `Optional<Long> findOwner(String endpoint)`
  - `NotificationPreferenceRepository`: `Map<PushCategory, Boolean> findByUser(long userId)`, `void upsert(long userId, PushCategory c, boolean enabled)`, `Set<Long> findDisabledUsers(Collection<Long> userIds, PushCategory c)`
  - `PushVapidKeyRepository`: `Optional<String[]> find()`(`[publicKey, privateKeyEnc]`), `void insertIfAbsent(String publicKey, String privateKeyEnc)`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- V134: Web Push — 기기별 구독, 사용자 알림 종류 설정, 서버 VAPID 키.
-- 세 테이블 모두 글로벌(비-RLS): 한 기기가 여러 테넌트 알림을 받고(membership 과 같은 성격),
-- 발송 경로는 수신자 기준으로 테넌트와 무관하게 구독을 조회한다. app_tenant 권한은 V44 DEFAULT PRIVILEGES 로 자동.

-- 기기별 푸시 구독. endpoint 는 브라우저 푸시 서비스가 발급한 고유 URL — 같은 브라우저 재등록 시 소유자 이전.
CREATE TABLE push_subscription (
  id               BIGSERIAL   PRIMARY KEY,
  user_id          BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  endpoint         TEXT        NOT NULL UNIQUE,
  p256dh           TEXT        NOT NULL,   -- 브라우저 공개키(base64url, 65바이트 비압축점)
  auth             TEXT        NOT NULL,   -- 인증 비밀(base64url, 16바이트)
  user_agent       VARCHAR(512),
  failure_count    INT         NOT NULL DEFAULT 0,  -- 연속 일시 실패 수(5 이상이면 삭제)
  last_success_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_subscription_user ON push_subscription(user_id);

-- 사용자 단위 알림 종류 설정. 행이 없으면 켜짐(enabled=true)으로 간주한다.
CREATE TABLE notification_preference (
  user_id   BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  category  VARCHAR(32) NOT NULL,   -- DM | MENTION | ISSUE | CALENDAR
  enabled   BOOLEAN     NOT NULL,
  PRIMARY KEY (user_id, category),
  CONSTRAINT notification_preference_category_check
    CHECK (category IN ('DM', 'MENTION', 'ISSUE', 'CALENDAR'))
);

-- 서버당 VAPID 키 1쌍(id=1 고정). 교체하면 기존 구독이 모두 무효가 되므로 한 번 생성 후 유지한다.
CREATE TABLE push_vapid_key (
  id               SMALLINT    PRIMARY KEY CHECK (id = 1),
  public_key       TEXT        NOT NULL,   -- base64url 65바이트 비압축점
  private_key_enc  TEXT        NOT NULL,   -- EncryptionService 로 암호화한 base64url 32바이트 스칼라
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: jOOQ 코드 생성**

Run: `cd apps/workplace-api && ./gradlew generateJooq`
Expected: `src/main/generated/com/workplace/jooq/tables/PushSubscription.java`, `NotificationPreference.java`, `PushVapidKey.java` 생성, `Tables.java` 에 `PUSH_SUBSCRIPTION`, `NOTIFICATION_PREFERENCE`, `PUSH_VAPID_KEY` 추가. `git status` 로 확인.

- [ ] **Step 3: 실패하는 저장소 테스트 작성**

```java
package com.workplace.notify.push;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.notify.dto.NotificationType;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 푸시 저장소 3종(구독·설정·VAPID) 통합 테스트 — 글로벌 테이블 CRUD 와 upsert 의미 검증. */
@Transactional
class PushRepositoriesTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired PushSubscriptionRepository subs;
  @Autowired NotificationPreferenceRepository prefs;
  @Autowired PushVapidKeyRepository vapid;

  /** 격리된 HUMAN 사용자 1명 시드. */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "wp_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Wp" + s)
        .set(USER.EMAIL, "wp_" + s + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void upsert_sameEndpoint_transfersOwnerAndResetsFailure() {
    long a = seedUser();
    long b = seedUser();
    String ep = "https://203.0.113.10/push/" + UUID.randomUUID();
    subs.upsert(a, ep, "k1", "s1", "UA");
    long id = subs.findByUserIds(List.of(a)).get(0).id();
    subs.incrementFailure(id);

    subs.upsert(b, ep, "k2", "s2", "UA2");

    assertThat(subs.findByUserIds(List.of(a))).isEmpty();
    PushSubscriptionRow row = subs.findByUserIds(List.of(b)).get(0);
    assertThat(row.p256dh()).isEqualTo("k2");
    assertThat(subs.incrementFailure(row.id())).isEqualTo(1); // 이전 후 0 에서 다시 시작
  }

  @Test
  void trimToLimit_keepsNewest() {
    long a = seedUser();
    for (int i = 0; i < 4; i++) {
      subs.upsert(a, "https://203.0.113.10/push/" + i + UUID.randomUUID(), "k", "s", null);
    }
    int removed = subs.trimToLimit(a, 2);
    assertThat(removed).isEqualTo(2);
    assertThat(subs.findByUserIds(List.of(a))).hasSize(2);
  }

  @Test
  void deleteByUserAndEndpoint_onlyOwner() {
    long a = seedUser();
    long b = seedUser();
    String ep = "https://203.0.113.10/push/" + UUID.randomUUID();
    subs.upsert(a, ep, "k", "s", null);
    assertThat(subs.deleteByUserAndEndpoint(b, ep)).isZero();
    assertThat(subs.deleteByUserAndEndpoint(a, ep)).isEqualTo(1);
  }

  @Test
  void preferences_defaultOn_andDisabledUsers() {
    long a = seedUser();
    long b = seedUser();
    prefs.upsert(a, PushCategory.DM, false);
    prefs.upsert(a, PushCategory.DM, false); // 멱등
    prefs.upsert(b, PushCategory.DM, true);

    assertThat(prefs.findByUser(a)).containsEntry(PushCategory.DM, false);
    assertThat(prefs.findDisabledUsers(List.of(a, b), PushCategory.DM)).isEqualTo(Set.of(a));
    assertThat(prefs.findDisabledUsers(List.of(a, b), PushCategory.ISSUE)).isEmpty();
  }

  @Test
  void vapid_insertIfAbsent_keepsFirst() {
    // 비-@Transactional 발송 테스트가 공유 컨테이너에 실제 키를 커밋했을 수 있다 — 이 트랜잭션 안에서 비우고 시작.
    dsl.deleteFrom(com.workplace.jooq.Tables.PUSH_VAPID_KEY).execute();
    vapid.insertIfAbsent("pub1", "enc1");
    vapid.insertIfAbsent("pub2", "enc2");
    assertThat(vapid.find()).get().satisfies(k -> assertThat(k[0]).isEqualTo("pub1"));
  }

  @Test
  void category_mapsNotificationTypes() {
    assertThat(PushCategory.of(NotificationType.ASSIGNED)).isEqualTo(PushCategory.ISSUE);
    assertThat(PushCategory.of(NotificationType.PRIORITY_CHANGED)).isEqualTo(PushCategory.ISSUE);
    assertThat(PushCategory.of(NotificationType.REMINDER)).isEqualTo(PushCategory.CALENDAR);
    assertThat(PushCategory.of(NotificationType.CALENDAR_RSVP_CHANGED))
        .isEqualTo(PushCategory.CALENDAR);
  }
}
```

- [ ] **Step 4: 실패 확인**

Run: `./gradlew test --tests 'com.workplace.notify.push.PushRepositoriesTest'`
Expected: 컴파일 실패(`PushSubscriptionRepository` 등 없음).

- [ ] **Step 5: 구현**

`PushCategory.java`:
```java
package com.workplace.notify.push;

import com.workplace.notify.dto.NotificationType;

/** 푸시 알림 종류. 사용자 설정(notification_preference.category)의 단위이며 NotificationType 을 이 넷으로 묶는다. */
public enum PushCategory {
  DM,
  MENTION,
  ISSUE,
  CALENDAR;

  /** 인박스 알림 유형 → 카테고리. 이슈 계열은 ISSUE, 일정 계열은 CALENDAR. */
  public static PushCategory of(NotificationType type) {
    return switch (type) {
      case ASSIGNED, COMMENTED, STATUS_CHANGED, PRIORITY_CHANGED -> ISSUE;
      case REMINDER, CALENDAR_INVITED, CALENDAR_RSVP_CHANGED -> CALENDAR;
    };
  }
}
```

`PushSubscriptionRow.java`:
```java
package com.workplace.notify.push;

/** push_subscription 1행 — 발송에 필요한 필드만. p256dh/auth 는 브라우저가 준 base64url 그대로. */
public record PushSubscriptionRow(long id, long userId, String endpoint, String p256dh, String auth) {}
```

`PushSubscriptionRepository.java`:
```java
package com.workplace.notify.push;

import static com.workplace.jooq.Tables.PUSH_SUBSCRIPTION;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** push_subscription 접근. 글로벌 테이블이라 테넌트 GUC 없이 동작한다. */
@Repository
@RequiredArgsConstructor
public class PushSubscriptionRepository {

  private final DSLContext dsl;

  /** endpoint 기준 upsert. 이미 있으면 소유자·키를 덮어쓰고 실패 카운트를 초기화한다(계정 전환 시 소유자 이전). */
  public void upsert(long userId, String endpoint, String p256dh, String auth, String userAgent) {
    OffsetDateTime now = OffsetDateTime.now();
    dsl.insertInto(PUSH_SUBSCRIPTION)
        .set(PUSH_SUBSCRIPTION.USER_ID, userId)
        .set(PUSH_SUBSCRIPTION.ENDPOINT, endpoint)
        .set(PUSH_SUBSCRIPTION.P256DH, p256dh)
        .set(PUSH_SUBSCRIPTION.AUTH, auth)
        .set(PUSH_SUBSCRIPTION.USER_AGENT, userAgent)
        .onConflict(PUSH_SUBSCRIPTION.ENDPOINT)
        .doUpdate()
        .set(PUSH_SUBSCRIPTION.USER_ID, userId)
        .set(PUSH_SUBSCRIPTION.P256DH, p256dh)
        .set(PUSH_SUBSCRIPTION.AUTH, auth)
        .set(PUSH_SUBSCRIPTION.USER_AGENT, userAgent)
        .set(PUSH_SUBSCRIPTION.FAILURE_COUNT, 0)
        .set(PUSH_SUBSCRIPTION.UPDATED_AT, now)
        .execute();
  }

  /** 사용자 구독을 최신(updated_at) limit 개만 남기고 삭제. 삭제 건수 반환. */
  public int trimToLimit(long userId, int limit) {
    var keep =
        dsl.select(PUSH_SUBSCRIPTION.ID)
            .from(PUSH_SUBSCRIPTION)
            .where(PUSH_SUBSCRIPTION.USER_ID.eq(userId))
            .orderBy(PUSH_SUBSCRIPTION.UPDATED_AT.desc(), PUSH_SUBSCRIPTION.ID.desc())
            .limit(limit);
    return dsl.deleteFrom(PUSH_SUBSCRIPTION)
        .where(PUSH_SUBSCRIPTION.USER_ID.eq(userId))
        .and(PUSH_SUBSCRIPTION.ID.notIn(keep))
        .execute();
  }

  /** 본인 소유 구독만 삭제(타인 endpoint 삭제 방지). 삭제 건수 반환. */
  public int deleteByUserAndEndpoint(long userId, String endpoint) {
    return dsl.deleteFrom(PUSH_SUBSCRIPTION)
        .where(PUSH_SUBSCRIPTION.USER_ID.eq(userId))
        .and(PUSH_SUBSCRIPTION.ENDPOINT.eq(endpoint))
        .execute();
  }

  /** 수신자들의 모든 구독. 빈 입력은 빈 결과. */
  public List<PushSubscriptionRow> findByUserIds(Collection<Long> userIds) {
    if (userIds.isEmpty()) return List.of();
    return dsl.select(
            PUSH_SUBSCRIPTION.ID,
            PUSH_SUBSCRIPTION.USER_ID,
            PUSH_SUBSCRIPTION.ENDPOINT,
            PUSH_SUBSCRIPTION.P256DH,
            PUSH_SUBSCRIPTION.AUTH)
        .from(PUSH_SUBSCRIPTION)
        .where(PUSH_SUBSCRIPTION.USER_ID.in(userIds))
        .orderBy(PUSH_SUBSCRIPTION.ID)
        .fetch(
            r ->
                new PushSubscriptionRow(
                    r.get(PUSH_SUBSCRIPTION.ID),
                    r.get(PUSH_SUBSCRIPTION.USER_ID),
                    r.get(PUSH_SUBSCRIPTION.ENDPOINT),
                    r.get(PUSH_SUBSCRIPTION.P256DH),
                    r.get(PUSH_SUBSCRIPTION.AUTH)));
  }

  /** endpoint 현재 소유자(테스트·진단용). */
  public Optional<Long> findOwner(String endpoint) {
    return dsl.select(PUSH_SUBSCRIPTION.USER_ID)
        .from(PUSH_SUBSCRIPTION)
        .where(PUSH_SUBSCRIPTION.ENDPOINT.eq(endpoint))
        .fetchOptional(PUSH_SUBSCRIPTION.USER_ID);
  }

  /** 발송 성공 — 연속 실패 초기화 + 마지막 성공 시각 기록. */
  public void markSuccess(long id) {
    dsl.update(PUSH_SUBSCRIPTION)
        .set(PUSH_SUBSCRIPTION.FAILURE_COUNT, 0)
        .set(PUSH_SUBSCRIPTION.LAST_SUCCESS_AT, OffsetDateTime.now())
        .where(PUSH_SUBSCRIPTION.ID.eq(id))
        .execute();
  }

  /** 일시 실패 1회 누적 후 누적값 반환(행이 없으면 0). */
  public int incrementFailure(long id) {
    return dsl.update(PUSH_SUBSCRIPTION)
        .set(PUSH_SUBSCRIPTION.FAILURE_COUNT, PUSH_SUBSCRIPTION.FAILURE_COUNT.plus(1))
        .where(PUSH_SUBSCRIPTION.ID.eq(id))
        .returning(PUSH_SUBSCRIPTION.FAILURE_COUNT)
        .fetchOptional(PUSH_SUBSCRIPTION.FAILURE_COUNT)
        .orElse(0);
  }

  /** 만료·무효 구독 삭제. */
  public void deleteById(long id) {
    dsl.deleteFrom(PUSH_SUBSCRIPTION).where(PUSH_SUBSCRIPTION.ID.eq(id)).execute();
  }
}
```

`NotificationPreferenceRepository.java`:
```java
package com.workplace.notify.push;

import static com.workplace.jooq.Tables.NOTIFICATION_PREFERENCE;

import java.util.Collection;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** notification_preference 접근. 행이 없으면 켜짐으로 간주하므로 "꺼진 사용자"만 조회한다. */
@Repository
@RequiredArgsConstructor
public class NotificationPreferenceRepository {

  private final DSLContext dsl;

  /** 사용자에게 저장된 설정(저장 안 된 카테고리는 결과에 없음 = 기본 켜짐). */
  public Map<PushCategory, Boolean> findByUser(long userId) {
    Map<PushCategory, Boolean> out = new EnumMap<>(PushCategory.class);
    dsl.select(NOTIFICATION_PREFERENCE.CATEGORY, NOTIFICATION_PREFERENCE.ENABLED)
        .from(NOTIFICATION_PREFERENCE)
        .where(NOTIFICATION_PREFERENCE.USER_ID.eq(userId))
        .forEach(
            r ->
                out.put(
                    PushCategory.valueOf(r.get(NOTIFICATION_PREFERENCE.CATEGORY)),
                    r.get(NOTIFICATION_PREFERENCE.ENABLED)));
    return out;
  }

  /** (user, category) upsert. */
  public void upsert(long userId, PushCategory category, boolean enabled) {
    dsl.insertInto(NOTIFICATION_PREFERENCE)
        .set(NOTIFICATION_PREFERENCE.USER_ID, userId)
        .set(NOTIFICATION_PREFERENCE.CATEGORY, category.name())
        .set(NOTIFICATION_PREFERENCE.ENABLED, enabled)
        .onConflict(NOTIFICATION_PREFERENCE.USER_ID, NOTIFICATION_PREFERENCE.CATEGORY)
        .doUpdate()
        .set(NOTIFICATION_PREFERENCE.ENABLED, enabled)
        .execute();
  }

  /** 주어진 사용자 중 해당 카테고리를 끈 사용자 집합. */
  public Set<Long> findDisabledUsers(Collection<Long> userIds, PushCategory category) {
    if (userIds.isEmpty()) return Set.of();
    return new HashSet<>(
        dsl.select(NOTIFICATION_PREFERENCE.USER_ID)
            .from(NOTIFICATION_PREFERENCE)
            .where(NOTIFICATION_PREFERENCE.USER_ID.in(userIds))
            .and(NOTIFICATION_PREFERENCE.CATEGORY.eq(category.name()))
            .and(NOTIFICATION_PREFERENCE.ENABLED.isFalse())
            .fetch(NOTIFICATION_PREFERENCE.USER_ID));
  }
}
```

`PushVapidKeyRepository.java`:
```java
package com.workplace.notify.push;

import static com.workplace.jooq.Tables.PUSH_VAPID_KEY;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** push_vapid_key(id=1 단일 행) 접근. 다중 인스턴스 동시 기동 시 먼저 들어간 키만 남도록 ON CONFLICT DO NOTHING. */
@Repository
@RequiredArgsConstructor
public class PushVapidKeyRepository {

  private static final short SINGLETON_ID = 1;
  private final DSLContext dsl;

  /** 저장된 키. [0]=공개키(base64url), [1]=암호화된 개인키. */
  public Optional<String[]> find() {
    return dsl.select(PUSH_VAPID_KEY.PUBLIC_KEY, PUSH_VAPID_KEY.PRIVATE_KEY_ENC)
        .from(PUSH_VAPID_KEY)
        .where(PUSH_VAPID_KEY.ID.eq(SINGLETON_ID))
        .fetchOptional(
            r -> new String[] {r.get(PUSH_VAPID_KEY.PUBLIC_KEY), r.get(PUSH_VAPID_KEY.PRIVATE_KEY_ENC)});
  }

  /** 키가 없을 때만 저장. 경합에서 진 쪽은 조용히 무시되고 호출자가 find() 로 승자 키를 읽는다. */
  public void insertIfAbsent(String publicKey, String privateKeyEnc) {
    dsl.insertInto(PUSH_VAPID_KEY)
        .set(PUSH_VAPID_KEY.ID, SINGLETON_ID)
        .set(PUSH_VAPID_KEY.PUBLIC_KEY, publicKey)
        .set(PUSH_VAPID_KEY.PRIVATE_KEY_ENC, privateKeyEnc)
        .onConflictDoNothing()
        .execute();
  }
}
```

> 주의: `PUSH_VAPID_KEY.ID` 가 jOOQ 에서 `Short` 로 생성된다. 생성 타입이 다르면(예: `Integer`) `SINGLETON_ID` 타입을 맞춘다.

- [ ] **Step 6: 통과 확인**

Run: `./gradlew test --tests 'com.workplace.notify.push.PushRepositoriesTest' --tests 'com.workplace.architecture.*'`
Expected: 6 tests PASS + ArchUnit PASS(저장소가 `notify/push/` 에 있어도 규칙 위반 없음을 조기 확인).

- [ ] **Step 7: 포맷 + 커밋(승인 후)**

```bash
cd apps/workplace-api && ./gradlew spotlessApply
git add src/main/resources/db/migration/V134__web_push.sql src/main/generated src/main/java/com/workplace/notify/push src/test/java/com/workplace/notify/push
git commit -m "feat(api/notify): Web Push 구독·알림 설정·VAPID 키 스키마와 저장소 추가

- #864
- 기기별 푸시 구독과 사용자 알림 종류 설정, 서버 VAPID 키를 글로벌 테이블로 저장한다
- 같은 브라우저를 다른 계정이 등록하면 구독 소유자를 이전해 이전 사용자 알림이 새지 않게 한다"
```

---

### Task 2: P-256 키 유틸 + RFC 8291 암호화 (#864)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/EcKeys.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/WebPushEncryptor.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/push/WebPushEncryptorTest.java`

**Interfaces:**
- Produces:
  - `EcKeys`(static): `KeyPair generate()`, `byte[] encodePublic(ECPublicKey)`(65바이트), `ECPublicKey decodePublic(byte[] raw65)`, `byte[] encodePrivate(ECPrivateKey)`(32바이트), `ECPrivateKey decodePrivate(byte[] d32)`, `KeyPair fromRaw(byte[] pub65, byte[] d32)`, `byte[] b64d(String)`, `String b64e(byte[])` — base64url(패딩 없음)
  - `WebPushEncryptor`(`@Component`): `byte[] encrypt(byte[] plaintext, byte[] uaPublic65, byte[] authSecret16)`; 패키지 전용 `byte[] encrypt(byte[] plaintext, byte[] uaPublic65, byte[] authSecret16, KeyPair asKeys, byte[] salt16)`

- [ ] **Step 1: 실패하는 테스트 작성**

RFC 8291 Appendix A 테스트 벡터를 사용한다. **아래 상수는 실행 전 https://www.rfc-editor.org/rfc/rfc8291#appendix-A 원문과 한 글자씩 대조한다**(오타 시 암호화가 맞아도 테스트가 실패). 벡터와 무관하게 동작을 보장하는 왕복(복호화) 테스트도 함께 둔다.

```java
package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.interfaces.ECPublicKey;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

/** RFC 8291(aes128gcm) 암호화 검증 — 공식 테스트 벡터 일치 + 수신자 관점 왕복 복호화. */
class WebPushEncryptorTest {

  // RFC 8291 Appendix A — 원문 대조 필수.
  static final String PLAINTEXT = "When I grow up, I want to be a watermelon";
  static final String AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
  static final String AS_PUBLIC =
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
  static final String UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
  static final String UA_PUBLIC =
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
  static final String SALT = "DGv6ra1nlYgDCS1FRnbzlw";
  static final String AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
  static final String EXPECTED =
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

  final WebPushEncryptor encryptor = new WebPushEncryptor();

  @Test
  void matchesRfc8291Vector() {
    KeyPair as = EcKeys.fromRaw(EcKeys.b64d(AS_PUBLIC), EcKeys.b64d(AS_PRIVATE));
    byte[] out =
        encryptor.encrypt(
            PLAINTEXT.getBytes(StandardCharsets.UTF_8),
            EcKeys.b64d(UA_PUBLIC),
            EcKeys.b64d(AUTH),
            as,
            EcKeys.b64d(SALT));
    assertThat(EcKeys.b64e(out)).isEqualTo(EXPECTED);
  }

  @Test
  void roundTrip_receiverCanDecrypt() throws Exception {
    KeyPair ua = EcKeys.generate();
    byte[] auth = new byte[16];
    new java.security.SecureRandom().nextBytes(auth);
    byte[] uaPub = EcKeys.encodePublic((ECPublicKey) ua.getPublic());
    byte[] msg = "{\"v\":1,\"title\":\"한글 제목\"}".getBytes(StandardCharsets.UTF_8);

    byte[] body = encryptor.encrypt(msg, uaPub, auth);

    assertThat(decrypt(body, ua, uaPub, auth)).isEqualTo(msg);
  }

  @Test
  void decodePublic_rejectsWrongLength() {
    assertThatThrownBy(() -> EcKeys.decodePublic(new byte[64]))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** 테스트 전용 수신자(브라우저) 측 복호화 — RFC 8291 §3.4 역연산. */
  private static byte[] decrypt(byte[] body, KeyPair ua, byte[] uaPub, byte[] auth)
      throws Exception {
    ByteBuffer buf = ByteBuffer.wrap(body);
    byte[] salt = new byte[16];
    buf.get(salt);
    buf.getInt(); // rs
    int idlen = buf.get() & 0xff;
    byte[] asPub = new byte[idlen];
    buf.get(asPub);
    byte[] ct = new byte[buf.remaining()];
    buf.get(ct);

    KeyAgreement ka = KeyAgreement.getInstance("ECDH");
    ka.init(ua.getPrivate());
    ka.doPhase(EcKeys.decodePublic(asPub), true);
    byte[] ecdh = ka.generateSecret();
    byte[] prkKey = hmac(auth, ecdh);
    byte[] keyInfo =
        concat("WebPush: info\0".getBytes(StandardCharsets.US_ASCII), uaPub, asPub, new byte[] {1});
    byte[] ikm = hmac(prkKey, keyInfo);
    byte[] prk = hmac(salt, ikm);
    byte[] cek =
        Arrays.copyOf(
            hmac(prk, concat("Content-Encoding: aes128gcm\0".getBytes(StandardCharsets.US_ASCII), new byte[] {1})),
            16);
    byte[] nonce =
        Arrays.copyOf(
            hmac(prk, concat("Content-Encoding: nonce\0".getBytes(StandardCharsets.US_ASCII), new byte[] {1})),
            12);
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
    byte[] padded = c.doFinal(ct);
    assertThat(padded[padded.length - 1]).isEqualTo((byte) 2); // 마지막 레코드 구분자
    return Arrays.copyOf(padded, padded.length - 1);
  }

  private static byte[] hmac(byte[] key, byte[] data) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(key, "HmacSHA256"));
    return mac.doFinal(data);
  }

  private static byte[] concat(byte[]... parts) {
    int n = 0;
    for (byte[] p : parts) n += p.length;
    byte[] out = new byte[n];
    int o = 0;
    for (byte[] p : parts) {
      System.arraycopy(p, 0, out, o, p.length);
      o += p.length;
    }
    return out;
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'com.workplace.notify.push.WebPushEncryptorTest'`
Expected: 컴파일 실패(`EcKeys`, `WebPushEncryptor` 없음).

- [ ] **Step 3: 구현**

`EcKeys.java`:
```java
package com.workplace.notify.push;

import java.math.BigInteger;
import java.security.AlgorithmParameters;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPrivateKeySpec;
import java.security.spec.ECPublicKeySpec;
import java.util.Arrays;
import java.util.Base64;

/**
 * P-256(secp256r1) 키 변환 유틸. Web Push 는 공개키를 65바이트 비압축점(0x04‖X‖Y), 개인키를 32바이트 스칼라로 주고받는데 JDK 는
 * X.509/PKCS#8 객체를 쓰므로 그 사이를 변환한다. base64url 은 패딩 없는 형식(브라우저 PushSubscription.toJSON 과 동일).
 */
public final class EcKeys {

  private static final ECParameterSpec P256 = p256();

  private EcKeys() {}

  private static ECParameterSpec p256() {
    try {
      AlgorithmParameters ap = AlgorithmParameters.getInstance("EC");
      ap.init(new ECGenParameterSpec("secp256r1"));
      return ap.getParameterSpec(ECParameterSpec.class);
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("P-256 파라미터 초기화 실패", e);
    }
  }

  /** 새 P-256 키쌍 생성(VAPID 키, 메시지별 임시 키). */
  public static KeyPair generate() {
    try {
      KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
      g.initialize(new ECGenParameterSpec("secp256r1"));
      return g.generateKeyPair();
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("P-256 키 생성 실패", e);
    }
  }

  /** 공개키 → 65바이트 비압축점. */
  public static byte[] encodePublic(ECPublicKey key) {
    byte[] out = new byte[65];
    out[0] = 0x04;
    System.arraycopy(fixed32(key.getW().getAffineX()), 0, out, 1, 32);
    System.arraycopy(fixed32(key.getW().getAffineY()), 0, out, 33, 32);
    return out;
  }

  /** 65바이트 비압축점 → 공개키. 형식이 다르면 IllegalArgumentException(400 으로 매핑). */
  public static ECPublicKey decodePublic(byte[] raw) {
    if (raw == null || raw.length != 65 || raw[0] != 0x04) {
      throw new IllegalArgumentException("P-256 공개키는 65바이트 비압축점이어야 합니다");
    }
    BigInteger x = new BigInteger(1, Arrays.copyOfRange(raw, 1, 33));
    BigInteger y = new BigInteger(1, Arrays.copyOfRange(raw, 33, 65));
    try {
      return (ECPublicKey)
          KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(new ECPoint(x, y), P256));
    } catch (GeneralSecurityException e) {
      throw new IllegalArgumentException("유효하지 않은 P-256 공개키", e);
    }
  }

  /** 개인키 → 32바이트 스칼라. */
  public static byte[] encodePrivate(ECPrivateKey key) {
    return fixed32(key.getS());
  }

  /** 32바이트 스칼라 → 개인키. */
  public static ECPrivateKey decodePrivate(byte[] d) {
    if (d == null || d.length != 32) {
      throw new IllegalArgumentException("P-256 개인키는 32바이트여야 합니다");
    }
    try {
      return (ECPrivateKey)
          KeyFactory.getInstance("EC")
              .generatePrivate(new ECPrivateKeySpec(new BigInteger(1, d), P256));
    } catch (GeneralSecurityException e) {
      throw new IllegalArgumentException("유효하지 않은 P-256 개인키", e);
    }
  }

  /** raw 공개키 + raw 개인키 → KeyPair. */
  public static KeyPair fromRaw(byte[] pub65, byte[] d32) {
    return new KeyPair(decodePublic(pub65), decodePrivate(d32));
  }

  /** base64url 디코드(패딩 유무 모두 허용). 잘못된 문자면 IllegalArgumentException. */
  public static byte[] b64d(String s) {
    return Base64.getUrlDecoder().decode(s);
  }

  /** base64url 인코드(패딩 없음). */
  public static String b64e(byte[] b) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
  }

  /** BigInteger → 정확히 32바이트(앞자리 0 채움 / 부호 바이트 제거). */
  private static byte[] fixed32(BigInteger v) {
    byte[] b = v.toByteArray();
    byte[] out = new byte[32];
    int len = Math.min(b.length, 32);
    System.arraycopy(b, b.length - len, out, 32 - len, len);
    return out;
  }
}
```

`WebPushEncryptor.java`:
```java
package com.workplace.notify.push;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.SecureRandom;
import java.security.interfaces.ECPublicKey;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/**
 * RFC 8291 Web Push 메시지 암호화(Content-Encoding: aes128gcm, 단일 레코드). 메시지마다 임시 P-256 키와 16바이트 salt 를 새로 만들어
 * 브라우저 공개키와 ECDH → HKDF 로 CEK/nonce 를 유도하고 AES-128-GCM 으로 암호화한다. 푸시 서비스(Apple/Google)는 내용을 볼 수 없다.
 */
@Component
public class WebPushEncryptor {

  /** 레코드 크기(rs). 단일 레코드만 쓰므로 페이로드(≤ 약 3KB)가 이 안에 들어가야 한다. */
  static final int RECORD_SIZE = 4096;

  private static final byte[] KEY_INFO_PREFIX = "WebPush: info\0".getBytes(StandardCharsets.US_ASCII);
  private static final byte[] CEK_INFO = "Content-Encoding: aes128gcm\0".getBytes(StandardCharsets.US_ASCII);
  private static final byte[] NONCE_INFO = "Content-Encoding: nonce\0".getBytes(StandardCharsets.US_ASCII);
  private static final SecureRandom RANDOM = new SecureRandom();

  /** 운영 경로 — 임시 키·salt 를 새로 생성해 암호화. */
  public byte[] encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret) {
    byte[] salt = new byte[16];
    RANDOM.nextBytes(salt);
    return encrypt(plaintext, uaPublic, authSecret, EcKeys.generate(), salt);
  }

  /** 결정적 경로(테스트 벡터 검증용) — 임시 키·salt 를 주입받는다. */
  byte[] encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret, KeyPair as, byte[] salt) {
    if (authSecret == null || authSecret.length != 16) {
      throw new IllegalArgumentException("auth 비밀은 16바이트여야 합니다");
    }
    try {
      ECPublicKey uaKey = EcKeys.decodePublic(uaPublic);
      byte[] asPublic = EcKeys.encodePublic((ECPublicKey) as.getPublic());

      // 1) ECDH 공유 비밀
      KeyAgreement ka = KeyAgreement.getInstance("ECDH");
      ka.init(as.getPrivate());
      ka.doPhase(uaKey, true);
      byte[] ecdh = ka.generateSecret();

      // 2) auth 비밀로 IKM 유도 (HKDF-Extract(auth, ecdh) → Expand(key_info, 32))
      byte[] prkKey = hmac(authSecret, ecdh);
      byte[] ikm = hmac(prkKey, concat(KEY_INFO_PREFIX, uaPublic, asPublic, new byte[] {1}));

      // 3) salt 로 CEK(16)·nonce(12) 유도
      byte[] prk = hmac(salt, ikm);
      byte[] cek = Arrays.copyOf(hmac(prk, concat(CEK_INFO, new byte[] {1})), 16);
      byte[] nonce = Arrays.copyOf(hmac(prk, concat(NONCE_INFO, new byte[] {1})), 12);

      // 4) 평문 + 마지막 레코드 구분자(0x02) 를 AES-128-GCM 암호화
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
      byte[] ct = c.doFinal(concat(plaintext, new byte[] {2}));

      // 5) 헤더(salt ‖ rs ‖ idlen ‖ keyid=임시 공개키) + 암호문
      ByteBuffer out = ByteBuffer.allocate(16 + 4 + 1 + asPublic.length + ct.length);
      out.put(salt).putInt(RECORD_SIZE).put((byte) asPublic.length).put(asPublic).put(ct);
      return out.array();
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("Web Push 암호화 실패", e);
    }
  }

  private static byte[] hmac(byte[] key, byte[] data) throws GeneralSecurityException {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(key, "HmacSHA256"));
    return mac.doFinal(data);
  }

  private static byte[] concat(byte[]... parts) {
    int n = 0;
    for (byte[] p : parts) n += p.length;
    byte[] out = new byte[n];
    int o = 0;
    for (byte[] p : parts) {
      System.arraycopy(p, 0, out, o, p.length);
      o += p.length;
    }
    return out;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `./gradlew test --tests 'com.workplace.notify.push.WebPushEncryptorTest'`
Expected: 3 tests PASS. `matchesRfc8291Vector` 만 실패하면 먼저 상수를 RFC 원문과 대조한다(왕복 테스트가 통과했다면 구현보다 상수 오타일 가능성이 높다). 대조 후에도 실패하면 헤더 바이트(rs=4096, idlen=65)와 key_info 순서(ua_public → as_public)를 점검한다.

- [ ] **Step 5: 포맷 + 커밋(승인 후)**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/notify/push/EcKeys.java src/main/java/com/workplace/notify/push/WebPushEncryptor.java src/test/java/com/workplace/notify/push/WebPushEncryptorTest.java
git commit -m "feat(api/notify): RFC 8291 Web Push 메시지 암호화 구현

- #864
- 외부 라이브러리 없이 JDK ECDH·HMAC·AES-GCM 으로 aes128gcm 암호화를 구현한다
- RFC 테스트 벡터와 수신자 관점 왕복 복호화로 바이트 단위 정확성을 검증한다"
```

---

### Task 3: 설정 + VAPID 키 제공자 + VAPID 서명 (#864)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushProperties.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/VapidKeys.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/VapidKeyProvider.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/VapidSigner.java`
- Modify: `apps/workplace-api/src/main/resources/application.yml` (`workplace:` 하위에 `push:` 블록)
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/push/VapidKeyProviderTest.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/push/VapidSignerTest.java`

**Interfaces:**
- Consumes: `EcKeys`(Task 2), `PushVapidKeyRepository`(Task 1), `EncryptionService`(`global/security`)
- Produces:
  - `record PushProperties(boolean enabled, boolean preview, String subject, Duration timeout, String vapidPublicKey, String vapidPrivateKey)` — `@ConfigurationProperties("workplace.push")`
  - `record VapidKeys(String publicKeyBase64Url, ECPublicKey publicKey, ECPrivateKey privateKey)`
  - `VapidKeyProvider`: `VapidKeys get()`(최초 호출 시 로드/생성 후 캐시)
  - `VapidSigner`: `String authorization(String endpoint)` → `"vapid t=<jwt>, k=<publicKey>"`

- [ ] **Step 1: application.yml 에 설정 블록 추가**

`workplace:` 하위(기존 `ai-agent:` 와 같은 들여쓰기)에 추가:
```yaml
  # Web Push — 폐쇄망(푸시 서비스로 외부 연결 불가)이면 enabled=false. VAPID 키는 env 우선, 없으면 DB 자동 생성.
  push:
    enabled: ${WORKPLACE_PUSH_ENABLED:true}
    preview: ${WORKPLACE_PUSH_PREVIEW:true}          # false 면 알림에 본문 대신 고정 문구
    subject: ${WORKPLACE_PUSH_SUBJECT:mailto:admin@localhost}  # VAPID 연락처(푸시 서비스가 문제 시 연락)
    timeout: ${WORKPLACE_PUSH_TIMEOUT:5s}
    vapid-public-key: ${WORKPLACE_PUSH_VAPID_PUBLIC:}
    vapid-private-key: ${WORKPLACE_PUSH_VAPID_PRIVATE:}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`VapidKeyProviderTest.java`:
```java
package com.workplace.notify.push;

import static com.workplace.jooq.Tables.PUSH_VAPID_KEY;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.EncryptionService;
import com.workplace.support.IntegrationTestBase;
import java.security.KeyPair;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.time.Duration;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** VAPID 키 로딩 우선순위(env → DB → 생성)와 재기동 시 동일 키 유지 검증. provider 는 테스트마다 새로 만든다(캐시 격리). */
@Transactional
class VapidKeyProviderTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired PushVapidKeyRepository repo;
  @Autowired EncryptionService encryption;

  private PushProperties props(String pub, String priv) {
    return new PushProperties(true, true, "mailto:t@example.com", Duration.ofSeconds(5), pub, priv);
  }

  @Test
  void generatesOnce_thenReusesFromDb() {
    dsl.deleteFrom(PUSH_VAPID_KEY).execute();
    VapidKeys first = new VapidKeyProvider(props("", ""), repo, encryption).get();
    VapidKeys second = new VapidKeyProvider(props("", ""), repo, encryption).get(); // "재기동"

    assertThat(second.publicKeyBase64Url()).isEqualTo(first.publicKeyBase64Url());
    assertThat(EcKeys.b64d(first.publicKeyBase64Url())).hasSize(65);
    // DB 에는 평문 개인키가 저장되지 않는다.
    String enc = repo.find().orElseThrow()[1];
    assertThat(enc).doesNotContain(EcKeys.b64e(EcKeys.encodePrivate(first.privateKey())));
  }

  @Test
  void envKeys_takePrecedence() {
    KeyPair kp = EcKeys.generate();
    String pub = EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) kp.getPublic()));
    String priv = EcKeys.b64e(EcKeys.encodePrivate((ECPrivateKey) kp.getPrivate()));

    VapidKeys keys = new VapidKeyProvider(props(pub, priv), repo, encryption).get();

    assertThat(keys.publicKeyBase64Url()).isEqualTo(pub);
  }
}
```

`VapidSignerTest.java`:
```java
package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import java.security.KeyPair;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/** RFC 8292 VAPID 헤더 — 서명 검증 가능, aud=endpoint origin, sub=설정값, exp=12시간 후. */
class VapidSignerTest {

  @Test
  void authorization_isVerifiableJwtWithOriginAudience() {
    KeyPair kp = EcKeys.generate();
    ECPublicKey pub = (ECPublicKey) kp.getPublic();
    String pubB64 = EcKeys.b64e(EcKeys.encodePublic(pub));
    VapidKeys keys = new VapidKeys(pubB64, pub, (ECPrivateKey) kp.getPrivate());
    Instant now = Instant.parse("2026-09-28T00:00:00Z");
    VapidSigner signer =
        new VapidSigner(() -> keys, "mailto:ops@example.com", Clock.fixed(now, ZoneOffset.UTC));

    String header = signer.authorization("https://fcm.googleapis.com:443/fcm/send/abc?x=1");

    assertThat(header).startsWith("vapid t=").endsWith(", k=" + pubB64);
    String jwt = header.substring("vapid t=".length(), header.indexOf(", k="));
    Claims c =
        Jwts.parser()
            .verifyWith(pub)
            .clock(() -> java.util.Date.from(now))
            .build()
            .parseSignedClaims(jwt)
            .getPayload();
    assertThat(c.getAudience()).containsExactly("https://fcm.googleapis.com:443");
    assertThat(c.getSubject()).isEqualTo("mailto:ops@example.com");
    assertThat(c.getExpiration().toInstant()).isEqualTo(now.plusSeconds(12 * 3600));
  }
}
```

- [ ] **Step 3: 실패 확인**

Run: `./gradlew test --tests 'com.workplace.notify.push.Vapid*'`
Expected: 컴파일 실패.

- [ ] **Step 4: 구현**

`PushProperties.java`:
```java
package com.workplace.notify.push;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Web Push 설정(workplace.push). enabled=false 면 발송·키 생성을 하지 않고 config API 가 비활성으로 응답한다(폐쇄망). preview=false 면
 * 알림에 본문 대신 고정 문구를 보낸다(온프레미스 보안 요구). VAPID 키는 base64url raw(공개 65B, 개인 32B) — 비어 있으면 DB 키 사용.
 */
@ConfigurationProperties("workplace.push")
public record PushProperties(
    boolean enabled,
    boolean preview,
    String subject,
    Duration timeout,
    String vapidPublicKey,
    String vapidPrivateKey) {

  /** 필수값 기본 보정 — yml 누락 시에도 안전하게 동작. */
  public PushProperties {
    if (subject == null || subject.isBlank()) subject = "mailto:admin@localhost";
    if (timeout == null) timeout = Duration.ofSeconds(5);
  }

  /** env 로 키쌍이 모두 주어졌는지. */
  public boolean hasEnvKeys() {
    return vapidPublicKey != null
        && !vapidPublicKey.isBlank()
        && vapidPrivateKey != null
        && !vapidPrivateKey.isBlank();
  }
}
```

> `@ConfigurationProperties` record 에서 `boolean enabled` 가 yml 에 없으면 false 가 된다. Step 1 의 yml 기본값(`true`)이 반드시 있어야 한다. `application-test.yml` 은 main yml 을 상속하므로 별도 추가 불필요.

`VapidKeys.java`:
```java
package com.workplace.notify.push;

import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;

/** 서버 VAPID 키쌍. publicKeyBase64Url 은 브라우저 subscribe(applicationServerKey) 와 Authorization k= 에 그대로 쓴다. */
public record VapidKeys(String publicKeyBase64Url, ECPublicKey publicKey, ECPrivateKey privateKey) {}
```

`VapidKeyProvider.java`:
```java
package com.workplace.notify.push;

import com.workplace.global.security.EncryptionService;
import java.security.KeyPair;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.util.function.Supplier;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * VAPID 키 제공. 우선순위: env(workplace.push.vapid-*) → DB(push_vapid_key) → 둘 다 없으면 생성해 DB 저장. 키가 바뀌면 기존 구독이 모두
 * 무효가 되므로 한 번 만든 키를 계속 쓴다. 다중 인스턴스 동시 생성은 insertIfAbsent + 재조회로 승자 키 하나로 수렴한다. 최초 get() 에서 로드 후
 * 메모리 캐시(설정이 enabled=false 면 아예 호출되지 않음).
 */
@Slf4j
@Component
public class VapidKeyProvider implements Supplier<VapidKeys> {

  private final PushProperties props;
  private final PushVapidKeyRepository repo;
  private final EncryptionService encryption;
  private volatile VapidKeys cached;

  public VapidKeyProvider(
      PushProperties props, PushVapidKeyRepository repo, EncryptionService encryption) {
    this.props = props;
    this.repo = repo;
    this.encryption = encryption;
  }

  /** 키 반환(최초 1회 로드/생성). */
  @Override
  public VapidKeys get() {
    VapidKeys k = cached;
    if (k != null) return k;
    synchronized (this) {
      if (cached == null) cached = load();
      return cached;
    }
  }

  private VapidKeys load() {
    if (props.hasEnvKeys()) {
      return toKeys(props.vapidPublicKey(), EcKeys.b64d(props.vapidPrivateKey()));
    }
    var stored = repo.find();
    if (stored.isEmpty()) {
      KeyPair kp = EcKeys.generate();
      String pub = EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) kp.getPublic()));
      String privEnc =
          encryption.encrypt(EcKeys.b64e(EcKeys.encodePrivate((ECPrivateKey) kp.getPrivate())));
      repo.insertIfAbsent(pub, privEnc);
      log.info("[push] VAPID 키를 새로 생성했습니다");
      stored = repo.find();
    }
    String[] row = stored.orElseThrow(() -> new IllegalStateException("VAPID 키 저장 실패"));
    return toKeys(row[0], EcKeys.b64d(encryption.decrypt(row[1])));
  }

  private static VapidKeys toKeys(String pubB64, byte[] d) {
    KeyPair kp = EcKeys.fromRaw(EcKeys.b64d(pubB64), d);
    return new VapidKeys(pubB64, (ECPublicKey) kp.getPublic(), (ECPrivateKey) kp.getPrivate());
  }
}
```

`VapidSigner.java`:
```java
package com.workplace.notify.push;

import io.jsonwebtoken.Jwts;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.util.Date;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * RFC 8292 VAPID Authorization 헤더 생성. 푸시 서비스는 aud(endpoint origin)·exp(≤24h)·sub(연락처)를 담은 ES256 JWT 와 공개키로 발신
 * 서버를 식별한다. exp 는 12시간으로 둔다(서비스별 24h 상한 대비 여유).
 */
@Component
public class VapidSigner {

  private static final Duration TTL = Duration.ofHours(12);
  private final Supplier<VapidKeys> keys;
  private final String subject;
  private final Clock clock;

  @Autowired
  public VapidSigner(VapidKeyProvider keys, PushProperties props) {
    this(keys, props.subject(), Clock.systemUTC());
  }

  VapidSigner(Supplier<VapidKeys> keys, String subject, Clock clock) {
    this.keys = keys;
    this.subject = subject;
    this.clock = clock;
  }

  /** endpoint 에 대한 "vapid t=<jwt>, k=<공개키>" 값. */
  public String authorization(String endpoint) {
    VapidKeys k = keys.get();
    URI u = URI.create(endpoint);
    String aud = u.getScheme() + "://" + u.getHost() + (u.getPort() == -1 ? "" : ":" + u.getPort());
    String jwt =
        Jwts.builder()
            .header()
            .add("typ", "JWT")
            .and()
            .audience()
            .single(aud)
            .expiration(Date.from(clock.instant().plus(TTL)))
            .subject(subject)
            .signWith(k.privateKey(), Jwts.SIG.ES256)
            .compact();
    return "vapid t=" + jwt + ", k=" + k.publicKeyBase64Url();
  }
}
```

> `audience().single(aud)` 는 aud 를 배열이 아닌 문자열로 넣는다(푸시 서비스 호환). jjwt 0.12 API 에 없으면 `.claim("aud", aud)` 로 대체.

- [ ] **Step 5: 통과 확인**

Run: `./gradlew test --tests 'com.workplace.notify.push.Vapid*'`
Expected: 3 tests PASS.

- [ ] **Step 6: 포맷 + 커밋(승인 후)**

```bash
./gradlew spotlessApply
git add src/main/resources/application.yml src/main/java/com/workplace/notify/push src/test/java/com/workplace/notify/push
git commit -m "feat(api/notify): VAPID 키 관리와 서명 헤더 생성 추가

- #864
- VAPID 키는 환경변수를 우선하고 없으면 최초 기동 시 생성해 암호화 저장한 뒤 계속 재사용한다
- 기존 jjwt 의 ES256 으로 RFC 8292 Authorization 헤더를 만든다
- workplace.push 설정으로 폐쇄망 비활성과 미리보기 가림을 제어한다"
```

---

### Task 4: endpoint 검증 + 발송 게이트웨이 + 실행기 (#864)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/EndpointValidator.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushGateway.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/WebPushGateway.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushConfig.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/push/EndpointValidatorTest.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/push/WebPushGatewayTest.java`

**Interfaces:**
- Consumes: `PushProperties`(Task 3)
- Produces:
  - `EndpointValidator`(`@Component`): `boolean isAllowed(String endpoint)`
  - `interface PushGateway { int deliver(String endpoint, byte[] body, Map<String, String> headers); }` — HTTP 상태코드, 네트워크 오류·타임아웃은 `-1`
  - `WebPushGateway` implements `PushGateway` — 운영 생성자 `WebPushGateway(PushProperties)` 가 타임아웃 RestClient 를 내부 생성, 테스트용 패키지 전용 `WebPushGateway(RestClient)`
  - 빈: `pushExecutor`(Executor). RestClient 는 빈으로 등록하지 않는다(기존 클래스들이 RestClient 를 내부 생성하는 관례, 두 번째 RestClient 빈으로 인한 주입 모호성 방지)

- [ ] **Step 1: 실패하는 테스트 작성**

`EndpointValidatorTest.java`:
```java
package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** 푸시 endpoint SSRF 방지 — https + 공인 주소만 허용. IP 리터럴만 써서 DNS 없이 결정적으로 검증. */
class EndpointValidatorTest {

  final EndpointValidator v = new EndpointValidator();

  @ParameterizedTest
  @ValueSource(
      strings = {
        "https://203.0.113.10/push/abc",
        "https://[2001:db8::1]/push/abc",
      })
  void allowsPublicHttps(String ep) {
    assertThat(v.isAllowed(ep)).isTrue();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "http://203.0.113.10/push/abc", // https 아님
        "https://127.0.0.1/x",
        "https://10.0.0.5/x",
        "https://172.16.0.1/x",
        "https://192.168.1.1/x",
        "https://169.254.169.254/latest/meta-data", // 클라우드 메타데이터
        "https://100.64.0.1/x", // CGNAT
        "https://0.0.0.0/x",
        "https://[::1]/x",
        "https://[fd00::1]/x", // ULA
        "https:///nohost",
        "not a url",
      })
  void rejectsInternalOrMalformed(String ep) {
    assertThat(v.isAllowed(ep)).isFalse();
  }

  @org.junit.jupiter.api.Test
  void rejectsTooLong() {
    assertThat(v.isAllowed("https://203.0.113.10/" + "a".repeat(2100))).isFalse();
  }
}
```

`WebPushGatewayTest.java`:
```java
package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** WebPushGateway — 헤더·본문 전달과 상태코드 그대로 반환(4xx/5xx 도 예외 없이). */
class WebPushGatewayTest {

  @Test
  void deliver_passesHeaders_andReturnsStatus() {
    RestClient.Builder b = RestClient.builder();
    MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
    WebPushGateway gw = new WebPushGateway(b.build());
    server
        .expect(requestTo("https://push.example.com/sub/1"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header("TTL", "60"))
        .andExpect(header("Content-Encoding", "aes128gcm"))
        .andRespond(withStatus(HttpStatus.CREATED));
    server
        .expect(requestTo("https://push.example.com/sub/2"))
        .andRespond(withStatus(HttpStatus.GONE));

    int ok =
        gw.deliver(
            "https://push.example.com/sub/1",
            new byte[] {1, 2},
            Map.of("TTL", "60", "Content-Encoding", "aes128gcm"));
    int gone = gw.deliver("https://push.example.com/sub/2", new byte[] {1}, Map.of());

    assertThat(ok).isEqualTo(201);
    assertThat(gone).isEqualTo(410);
    server.verify();
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'com.workplace.notify.push.EndpointValidatorTest' --tests 'com.workplace.notify.push.WebPushGatewayTest'`
Expected: 컴파일 실패.

- [ ] **Step 3: 구현**

`EndpointValidator.java`:
```java
package com.workplace.notify.push;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import org.springframework.stereotype.Component;

/**
 * 푸시 endpoint 검증. 서버가 이 URL 로 직접 HTTP 요청을 보내므로(SSRF 경로) https + 공인 주소만 허용한다. 푸시 서비스 호스트는 브라우저마다
 * 달라 허용 목록 대신 내부 대역 차단 방식을 쓴다. 등록 시와 발송 직전에 모두 호출한다(DNS 재바인딩 완화).
 */
@Component
public class EndpointValidator {

  static final int MAX_LENGTH = 2048;

  /** 허용 여부. 파싱 불가·해석 실패도 거부. */
  public boolean isAllowed(String endpoint) {
    if (endpoint == null || endpoint.length() > MAX_LENGTH) return false;
    try {
      URI u = URI.create(endpoint);
      if (!"https".equalsIgnoreCase(u.getScheme()) || u.getHost() == null) return false;
      String host = u.getHost();
      if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length() - 1);
      for (InetAddress a : InetAddress.getAllByName(host)) {
        if (isInternal(a)) return false;
      }
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  /** 루프백·사설·링크로컬·미지정·멀티캐스트·CGNAT(100.64/10)·IPv6 ULA(fc00::/7). */
  static boolean isInternal(InetAddress a) {
    if (a.isLoopbackAddress()
        || a.isSiteLocalAddress()
        || a.isLinkLocalAddress()
        || a.isAnyLocalAddress()
        || a.isMulticastAddress()) return true;
    byte[] b = a.getAddress();
    if (a instanceof Inet4Address) {
      return (b[0] & 0xff) == 100 && (b[1] & 0xc0) == 64;
    }
    if (a instanceof Inet6Address) {
      return (b[0] & 0xfe) == 0xfc;
    }
    return false;
  }
}
```

`PushGateway.java`:
```java
package com.workplace.notify.push;

import java.util.Map;

/** 암호화된 푸시 본문을 endpoint 로 전송하는 HTTP 추상화. 테스트에서 가짜 구현으로 교체해 발송을 캡처한다. */
public interface PushGateway {

  /**
   * 전송 후 HTTP 상태코드를 반환한다. 4xx/5xx 도 예외 없이 코드로 돌려주고, 네트워크 오류·타임아웃은 -1.
   *
   * @param headers TTL, Urgency, Content-Encoding, Content-Type, Authorization
   */
  int deliver(String endpoint, byte[] body, Map<String, String> headers);
}
```

`WebPushGateway.java`:
```java
package com.workplace.notify.push;

import java.net.URI;
import java.net.http.HttpClient;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * RestClient 기반 PushGateway. 상태코드 해석은 PushSender 가 하므로 여기서는 전송과 코드 반환만 한다. RestClient 는 연결·응답 타임아웃
 * (workplace.push.timeout)을 건 전용 인스턴스를 내부 생성한다 — 외부 푸시 서비스 지연이 스레드를 오래 잡지 않게.
 */
@Slf4j
@Component
public class WebPushGateway implements PushGateway {

  private final RestClient client;

  @Autowired
  public WebPushGateway(PushProperties props) {
    this(buildClient(props));
  }

  /** 테스트용 — MockRestServiceServer 에 바인딩된 RestClient 주입. */
  WebPushGateway(RestClient client) {
    this.client = client;
  }

  private static RestClient buildClient(PushProperties props) {
    HttpClient http = HttpClient.newBuilder().connectTimeout(props.timeout()).build();
    JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
    factory.setReadTimeout(props.timeout());
    return RestClient.builder().requestFactory(factory).build();
  }

  @Override
  public int deliver(String endpoint, byte[] body, Map<String, String> headers) {
    try {
      return client
          .post()
          .uri(URI.create(endpoint))
          .headers(h -> headers.forEach(h::set))
          .body(body)
          .exchange((req, res) -> res.getStatusCode().value());
    } catch (RestClientException e) {
      log.debug("[push] 전송 실패 host={}: {}", URI.create(endpoint).getHost(), e.getMessage());
      return -1;
    }
  }
}
```

`PushConfig.java`:
```java
package com.workplace.notify.push;

import com.workplace.global.tenant.TenantContextTaskDecorator;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 푸시 전용 실행기. 외부 푸시 서비스 지연이 도메인 API·SSE 알림 스레드(notifyEventExecutor)를 막지 않도록 분리하고, 큐가 넘치면
 * 버린다(푸시는 best-effort). TenantContextTaskDecorator 로 발행 스레드의 테넌트를 복원해 표시 정보 조회(RLS)가 동작하게 한다.
 */
@Slf4j
@Configuration
public class PushConfig {

  @Bean(name = "pushExecutor")
  public Executor pushExecutor() {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(4);
    ex.setMaxPoolSize(4);
    ex.setQueueCapacity(1000);
    ex.setThreadNamePrefix("push-");
    ex.setTaskDecorator(new TenantContextTaskDecorator());
    // 큐 초과 시 호출 스레드를 막지 않고 로그 후 버린다.
    ex.setRejectedExecutionHandler(
        (r, pool) -> log.warn("[push] 실행 큐 초과 — 푸시 1건 폐기"));
    ex.initialize();
    return ex;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `./gradlew test --tests 'com.workplace.notify.push.EndpointValidatorTest' --tests 'com.workplace.notify.push.WebPushGatewayTest'`
Expected: PASS.

- [ ] **Step 5: 포맷 + 커밋(승인 후)**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/notify/push src/test/java/com/workplace/notify/push
git commit -m "feat(api/notify): 푸시 endpoint 검증과 발송 게이트웨이·전용 실행기 추가

- #864
- 서버가 endpoint 로 직접 요청하므로 https 와 공인 주소만 허용해 내부망 요청을 차단한다
- 전용 pushExecutor 와 타임아웃이 걸린 RestClient 로 외부 지연이 다른 알림을 막지 않게 한다"
```

---

### Task 5: 구독·설정 서비스 + REST API (#864)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushSubscriptionService.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/NotificationPreferenceService.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/dto/PushConfigResponse.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/dto/PushSubscriptionRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/dto/PushSubscriptionDeleteRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/controller/PushController.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/controller/PushControllerTest.java`

**Interfaces:**
- Consumes: Task 1 저장소, `EndpointValidator`(Task 4), `VapidKeyProvider`·`PushProperties`(Task 3), `EcKeys`(Task 2)
- Produces:
  - `PushSubscriptionService`: `void register(long userId, String endpoint, String p256dh, String auth, String userAgent)`(검증 실패 시 `IllegalArgumentException` → 400), `void unregister(long userId, String endpoint)`
  - `NotificationPreferenceService`: `Map<PushCategory, Boolean> get(long userId)`(4개 모두 채움), `Map<PushCategory, Boolean> update(long userId, Map<PushCategory, Boolean> changes)`, `Set<Long> filterEnabled(Collection<Long> userIds, PushCategory c)`
  - REST: `GET /api/v1/push/config` → `{enabled, vapidPublicKey}`; `POST /api/v1/push/subscriptions` body `{endpoint, keys:{p256dh, auth}}` → 204; `DELETE /api/v1/push/subscriptions` body `{endpoint}` → 204; `GET /api/v1/push/preferences` → `{"DM":true,...}`; `PUT /api/v1/push/preferences` 부분 맵 → 전체 맵

- [ ] **Step 1: 실패하는 테스트 작성**

```java
package com.workplace.notify.controller;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.notify.push.EcKeys;
import com.workplace.notify.push.PushSubscriptionRepository;
import com.workplace.support.IntegrationTestBase;
import java.security.interfaces.ECPublicKey;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * /api/v1/push/* 통합 테스트 — 실제 JWT(테넌트 미선택 토큰 포함)로 호출. 구독 upsert·소유자 이전·본인만 삭제·20개 제한·키/endpoint 검증,
 * 설정 기본값·부분 업데이트, config 응답.
 */
@Transactional
@AutoConfigureMockMvc
class PushControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired PushSubscriptionRepository subs;

  long userA;
  long userB;
  String tokenA; // 테넌트 미선택(2-인자) 토큰 — 구독/설정은 글로벌이라 이 토큰으로도 동작해야 한다.
  String tokenB;
  String p256dh;
  final String auth = EcKeys.b64e(new byte[16]);

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "pc_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Pc" + s)
        .set(USER.EMAIL, "pc_" + s + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @BeforeEach
  void setUp() {
    userA = seedUser();
    userB = seedUser();
    tokenA = jwt.generateAccessToken(userA, "a");
    tokenB = jwt.generateAccessToken(userB, "b");
    p256dh = EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) EcKeys.generate().getPublic()));
  }

  private String body(String endpoint) {
    return """
        {"endpoint":"%s","keys":{"p256dh":"%s","auth":"%s"}}"""
        .formatted(endpoint, p256dh, auth);
  }

  private String ep() {
    return "https://203.0.113.10/push/" + UUID.randomUUID();
  }

  @Test
  void config_returnsEnabledAndPublicKey() throws Exception {
    mvc.perform(get("/api/v1/push/config").header("Authorization", "Bearer " + tokenA))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.enabled").value(true))
        .andExpect(jsonPath("$.vapidPublicKey").isString());
  }

  @Test
  void register_thenUnregister() throws Exception {
    String ep = ep();
    mvc.perform(
            post("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + tokenA)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body(ep)))
        .andExpect(status().isNoContent());
    assertThat(subs.findOwner(ep)).contains(userA);

    mvc.perform(
            delete("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + tokenA)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"endpoint\":\"" + ep + "\"}"))
        .andExpect(status().isNoContent());
    assertThat(subs.findOwner(ep)).isEmpty();
  }

  @Test
  void register_sameEndpoint_transfersOwnership() throws Exception {
    String ep = ep();
    for (String t : List.of(tokenA, tokenB)) {
      mvc.perform(
              post("/api/v1/push/subscriptions")
                  .header("Authorization", "Bearer " + t)
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(body(ep)))
          .andExpect(status().isNoContent());
    }
    assertThat(subs.findOwner(ep)).contains(userB);
    assertThat(subs.findByUserIds(List.of(userA))).isEmpty();
  }

  @Test
  void unregister_othersEndpoint_isNoop() throws Exception {
    String ep = ep();
    subs.upsert(userA, ep, p256dh, auth, null);
    mvc.perform(
            delete("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + tokenB)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"endpoint\":\"" + ep + "\"}"))
        .andExpect(status().isNoContent());
    assertThat(subs.findOwner(ep)).contains(userA);
  }

  @Test
  void register_keepsAtMost20PerUser() throws Exception {
    for (int i = 0; i < 21; i++) {
      mvc.perform(
              post("/api/v1/push/subscriptions")
                  .header("Authorization", "Bearer " + tokenA)
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(body(ep())))
          .andExpect(status().isNoContent());
    }
    assertThat(subs.findByUserIds(List.of(userA))).hasSize(20);
  }

  @Test
  void register_internalEndpoint_returns400() throws Exception {
    mvc.perform(
            post("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + tokenA)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("https://169.254.169.254/latest")))
        .andExpect(status().isBadRequest());
  }

  @Test
  void register_invalidKeys_returns400() throws Exception {
    String bad =
        """
        {"endpoint":"%s","keys":{"p256dh":"%s","auth":"%s"}}"""
            .formatted(ep(), EcKeys.b64e(new byte[10]), auth);
    mvc.perform(
            post("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + tokenA)
                .contentType(MediaType.APPLICATION_JSON)
                .content(bad))
        .andExpect(status().isBadRequest());
    String notB64 =
        """
        {"endpoint":"%s","keys":{"p256dh":"%s","auth":"%%%%"}}"""
            .formatted(ep(), p256dh);
    mvc.perform(
            post("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + tokenA)
                .contentType(MediaType.APPLICATION_JSON)
                .content(notB64))
        .andExpect(status().isBadRequest());
  }

  @Test
  void preferences_defaultAllOn_thenPartialUpdate() throws Exception {
    mvc.perform(get("/api/v1/push/preferences").header("Authorization", "Bearer " + tokenA))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.DM").value(true))
        .andExpect(jsonPath("$.MENTION").value(true))
        .andExpect(jsonPath("$.ISSUE").value(true))
        .andExpect(jsonPath("$.CALENDAR").value(true));

    mvc.perform(
            put("/api/v1/push/preferences")
                .header("Authorization", "Bearer " + tokenA)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"CALENDAR\":false}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.CALENDAR").value(false))
        .andExpect(jsonPath("$.DM").value(true));
  }

  @Test
  void unauthenticated_returns401() throws Exception {
    mvc.perform(get("/api/v1/push/config")).andExpect(status().isUnauthorized());
  }
}
```

> `unauthenticated_returns401`: 이 프로젝트의 미인증 응답이 403 이면 기존 컨트롤러 테스트 관례에 맞춰 기대값을 조정한다.

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'com.workplace.notify.controller.PushControllerTest'`
Expected: 컴파일 실패.

- [ ] **Step 3: 구현**

`PushSubscriptionService.java`:
```java
package com.workplace.notify.push;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 기기 구독 등록/해제. 브라우저가 준 키·endpoint 를 검증해 잘못된 값이 발송 단계까지 가지 않게 한다. */
@Service
@RequiredArgsConstructor
public class PushSubscriptionService {

  /** 사용자당 최대 구독 수 — 초과 시 오래된 것부터 삭제. */
  static final int MAX_PER_USER = 20;

  private final PushSubscriptionRepository repo;
  private final EndpointValidator endpointValidator;

  /** 구독 등록(같은 endpoint 면 소유자 이전). 검증 실패는 IllegalArgumentException(400). */
  @Transactional
  public void register(long userId, String endpoint, String p256dh, String auth, String userAgent) {
    if (!endpointValidator.isAllowed(endpoint)) {
      throw new IllegalArgumentException("허용되지 않는 푸시 endpoint 입니다");
    }
    EcKeys.decodePublic(EcKeys.b64d(p256dh)); // 65바이트 비압축점 검증(형식 오류 시 IAE)
    if (EcKeys.b64d(auth).length != 16) {
      throw new IllegalArgumentException("auth 비밀은 16바이트여야 합니다");
    }
    String ua = userAgent == null ? null : userAgent.substring(0, Math.min(userAgent.length(), 512));
    repo.upsert(userId, endpoint, p256dh, auth, ua);
    repo.trimToLimit(userId, MAX_PER_USER);
  }

  /** 본인 구독 해제(타인 endpoint 는 조용히 무시). */
  @Transactional
  public void unregister(long userId, String endpoint) {
    repo.deleteByUserAndEndpoint(userId, endpoint);
  }
}
```

`NotificationPreferenceService.java`:
```java
package com.workplace.notify.push;

import java.util.Collection;
import java.util.EnumMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 사용자 단위 알림 종류 설정. 저장 안 된 카테고리는 켜짐으로 채워 돌려준다. */
@Service
@RequiredArgsConstructor
public class NotificationPreferenceService {

  private final NotificationPreferenceRepository repo;

  /** 4개 카테고리 전체 상태. */
  @Transactional(readOnly = true)
  public Map<PushCategory, Boolean> get(long userId) {
    Map<PushCategory, Boolean> out = new EnumMap<>(PushCategory.class);
    for (PushCategory c : PushCategory.values()) out.put(c, true);
    out.putAll(repo.findByUser(userId));
    return out;
  }

  /** 부분 업데이트 후 전체 상태 반환. */
  @Transactional
  public Map<PushCategory, Boolean> update(long userId, Map<PushCategory, Boolean> changes) {
    changes.forEach((c, enabled) -> repo.upsert(userId, c, Boolean.TRUE.equals(enabled)));
    return get(userId);
  }

  /** 해당 카테고리를 끄지 않은 사용자만(입력 순서 유지, 중복 제거). */
  @Transactional(readOnly = true)
  public Set<Long> filterEnabled(Collection<Long> userIds, PushCategory category) {
    Set<Long> disabled = repo.findDisabledUsers(userIds, category);
    Set<Long> out = new LinkedHashSet<>(userIds);
    out.removeAll(disabled);
    return out;
  }
}
```

`dto/PushConfigResponse.java`:
```java
package com.workplace.notify.dto;

/** 푸시 사용 가능 여부와 VAPID 공개키. enabled=false(폐쇄망)면 vapidPublicKey=null — 프론트는 푸시 UI 를 숨긴다. */
public record PushConfigResponse(boolean enabled, String vapidPublicKey) {}
```

`dto/PushSubscriptionRequest.java`:
```java
package com.workplace.notify.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** 브라우저 PushSubscription.toJSON() 과 같은 모양의 구독 등록 요청. */
public record PushSubscriptionRequest(
    @NotBlank @Size(max = 2048) String endpoint, @NotNull @Valid Keys keys) {

  /** 브라우저 공개키(p256dh)와 인증 비밀(auth) — base64url. */
  public record Keys(@NotBlank @Size(max = 200) String p256dh, @NotBlank @Size(max = 100) String auth) {}
}
```

`dto/PushSubscriptionDeleteRequest.java`:
```java
package com.workplace.notify.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 구독 해제 요청 — 이 기기의 endpoint. */
public record PushSubscriptionDeleteRequest(@NotBlank @Size(max = 2048) String endpoint) {}
```

`controller/PushController.java`:
```java
package com.workplace.notify.controller;

import com.workplace.notify.dto.PushConfigResponse;
import com.workplace.notify.dto.PushSubscriptionDeleteRequest;
import com.workplace.notify.dto.PushSubscriptionRequest;
import com.workplace.notify.push.NotificationPreferenceService;
import com.workplace.notify.push.PushCategory;
import com.workplace.notify.push.PushProperties;
import com.workplace.notify.push.PushSubscriptionService;
import com.workplace.notify.push.VapidKeyProvider;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Web Push API. 구독·설정은 사용자 단위 글로벌 데이터라 테넌트 미선택 토큰으로도 호출 가능하다(테넌트 선택 전 로그인 직후 재등록). 저장소를 직접 주입하지
 * 않는다(ArchUnit: 저장소 주입 컨트롤러는 @Transactional 필요) — 트랜잭션은 서비스가 연다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/push")
public class PushController {

  private final PushProperties props;
  private final VapidKeyProvider vapidKeys;
  private final PushSubscriptionService subscriptions;
  private final NotificationPreferenceService preferences;

  /** 푸시 가능 여부 + VAPID 공개키. 비활성이면 키를 만들지도 노출하지도 않는다. */
  @GetMapping("/config")
  public ResponseEntity<PushConfigResponse> config() {
    if (!props.enabled()) return ResponseEntity.ok(new PushConfigResponse(false, null));
    return ResponseEntity.ok(new PushConfigResponse(true, vapidKeys.get().publicKeyBase64Url()));
  }

  /** 이 기기 구독 등록/갱신. */
  @PostMapping("/subscriptions")
  public ResponseEntity<Void> subscribe(
      @AuthenticationPrincipal Long callerId,
      @RequestHeader(value = "User-Agent", required = false) String userAgent,
      @Valid @RequestBody PushSubscriptionRequest req) {
    subscriptions.register(
        callerId, req.endpoint(), req.keys().p256dh(), req.keys().auth(), userAgent);
    return ResponseEntity.noContent().build();
  }

  /** 이 기기 구독 해제(로그아웃·토글 off). */
  @DeleteMapping("/subscriptions")
  public ResponseEntity<Void> unsubscribe(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody PushSubscriptionDeleteRequest req) {
    subscriptions.unregister(callerId, req.endpoint());
    return ResponseEntity.noContent().build();
  }

  /** 종류별 설정 전체. */
  @GetMapping("/preferences")
  public ResponseEntity<Map<PushCategory, Boolean>> getPreferences(
      @AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(preferences.get(callerId));
  }

  /** 종류별 설정 부분 업데이트 — 알 수 없는 키는 역직렬화 단계에서 400. */
  @PutMapping("/preferences")
  public ResponseEntity<Map<PushCategory, Boolean>> updatePreferences(
      @AuthenticationPrincipal Long callerId, @RequestBody Map<PushCategory, Boolean> changes) {
    return ResponseEntity.ok(preferences.update(callerId, changes));
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `./gradlew test --tests 'com.workplace.notify.controller.PushControllerTest'`
Expected: 9 tests PASS. 잘못된 base64(`%%`)가 400 이 아니면 `IllegalArgumentException` 전역 핸들러(`GlobalExceptionHandler:768`)가 이 경로에서 적용되는지 확인한다.

- [ ] **Step 5: ArchUnit 포함 notify 전체 테스트**

Run: `./gradlew test --tests 'com.workplace.notify.*' --tests 'com.workplace.architecture.*'`
Expected: PASS.

- [ ] **Step 6: 포맷 + 커밋(승인 후)**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/notify src/test/java/com/workplace/notify
git commit -m "feat(api/notify): 푸시 구독·알림 설정 API 추가

- #864
- 기기 구독 등록·해제와 종류별 알림 설정, VAPID 공개키 조회 API 를 제공한다
- 구독은 사용자 단위 글로벌 데이터라 테넌트 선택 전 토큰으로도 등록할 수 있다
- 브라우저 키와 endpoint 를 등록 시점에 검증하고 사용자당 20개로 제한한다"
```

---

### Task 6: PushSender — 암호화·발송·결과 반영 (#864)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushMessage.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushSender.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/push/PushSenderTest.java`

**Interfaces:**
- Consumes: `PushSubscriptionRepository`(Task 1), `NotificationPreferenceService`(Task 5), `WebPushEncryptor`·`EcKeys`(Task 2), `VapidSigner`·`PushProperties`(Task 3), `EndpointValidator`·`PushGateway`(Task 4)
- Produces:
  - `record PushMessage(long tenantId, PushCategory category, String title, String body, String url, String tag, String urgency, int ttlSeconds)` + `PushMessage redacted()`(미리보기 가림) + static `String truncate(String s, int max)`
  - `PushSender`: `void send(Collection<Long> userIds, PushMessage message)` — 동기 실행(호출자가 pushExecutor 스레드)

- [ ] **Step 1: 실패하는 테스트 작성**

```java
package com.workplace.notify.push;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.support.IntegrationTestBase;
import java.security.KeyPair;
import java.security.interfaces.ECPublicKey;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/** PushSender — 설정 필터, 헤더, 상태코드별 구독 처리(성공 초기화·410 삭제·5회 실패 삭제), 한 구독 실패 격리. */
@Transactional
class PushSenderTest extends IntegrationTestBase {

  @MockitoBean PushGateway gateway;
  @Autowired PushSender sender;
  @Autowired PushSubscriptionRepository subs;
  @Autowired NotificationPreferenceRepository prefs;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;

  long user;
  final String auth = EcKeys.b64e(new byte[16]);
  String p256dh;

  static PushMessage msg() {
    return new PushMessage(1L, PushCategory.DM, "박OO", "PR 리뷰 부탁드려요", "/chat/dms/42", "ch-42", "high", 86400);
  }

  @BeforeEach
  void seed() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    user =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "ps_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Ps" + s)
            .set(USER.EMAIL, "ps_" + s + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    KeyPair ua = EcKeys.generate();
    p256dh = EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) ua.getPublic()));
  }

  private String addSub() {
    String ep = "https://203.0.113.10/push/" + UUID.randomUUID();
    subs.upsert(user, ep, p256dh, auth, null);
    return ep;
  }

  @Test
  void send_success_setsHeaders_andResetsFailure() {
    String ep = addSub();
    when(gateway.deliver(eq(ep), any(), anyMap())).thenReturn(201);

    sender.send(List.of(user), msg());

    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, String>> headers = ArgumentCaptor.forClass(Map.class);
    verify(gateway).deliver(eq(ep), any(), headers.capture());
    assertThat(headers.getValue())
        .containsEntry("TTL", "86400")
        .containsEntry("Urgency", "high")
        .containsEntry("Content-Encoding", "aes128gcm")
        .containsEntry("Content-Type", "application/octet-stream");
    assertThat(headers.getValue().get("Authorization")).startsWith("vapid t=");
  }

  @Test
  void send_gone_deletesSubscription() {
    String ep = addSub();
    when(gateway.deliver(eq(ep), any(), anyMap())).thenReturn(410);
    sender.send(List.of(user), msg());
    assertThat(subs.findOwner(ep)).isEmpty();
  }

  @Test
  void send_transientFailure5Times_deletes() {
    String ep = addSub();
    when(gateway.deliver(eq(ep), any(), anyMap())).thenReturn(503);
    for (int i = 0; i < 4; i++) sender.send(List.of(user), msg());
    assertThat(subs.findOwner(ep)).isPresent();
    sender.send(List.of(user), msg());
    assertThat(subs.findOwner(ep)).isEmpty();
  }

  @Test
  void send_categoryDisabled_skips() {
    addSub();
    prefs.upsert(user, PushCategory.DM, false);
    sender.send(List.of(user), msg());
    verify(gateway, never()).deliver(any(), any(), anyMap());
  }

  @Test
  void send_oneSubscriptionThrows_othersStillDelivered() {
    // 잘못 저장된 키(검증 우회 데이터) — 암호화에서 예외.
    subs.upsert(user, "https://203.0.113.10/push/broken-" + UUID.randomUUID(), "AAAA", auth, null);
    String ok = addSub();
    when(gateway.deliver(eq(ok), any(), anyMap())).thenReturn(201);

    sender.send(List.of(user), msg());

    verify(gateway, times(1)).deliver(eq(ok), any(), anyMap());
  }

  @Test
  void payload_json_hasContract() throws Exception {
    byte[] json = sender.payload(msg());
    JsonNode n = om.readTree(json);
    assertThat(n.get("v").asInt()).isEqualTo(1);
    assertThat(n.get("tenantId").asLong()).isEqualTo(1L);
    assertThat(n.get("category").asText()).isEqualTo("DM");
    assertThat(n.get("title").asText()).isEqualTo("박OO");
    assertThat(n.get("url").asText()).isEqualTo("/chat/dms/42");
    assertThat(n.get("tag").asText()).isEqualTo("ch-42");
    assertThat(json.length).isLessThan(3000);
  }

  @Test
  void redacted_hidesContent() {
    PushMessage r = msg().redacted();
    assertThat(r.title()).isEqualTo("새 메시지");
    assertThat(r.body()).isEqualTo("새 메시지가 있습니다");
    assertThat(r.url()).isEqualTo("/chat/dms/42");
    PushMessage issue =
        new PushMessage(1L, PushCategory.ISSUE, "SW-1 제목", "배정", "/projects/SW/issues/1", "issue-1", "normal", 259200)
            .redacted();
    assertThat(issue.title()).isEqualTo("새 알림");
    assertThat(issue.body()).isEqualTo("새 알림이 있습니다");
  }

  @Test
  void truncate_keepsCodePoints() {
    assertThat(PushMessage.truncate("가".repeat(130), 120)).hasSize(121).endsWith("…");
    assertThat(PushMessage.truncate("짧다", 120)).isEqualTo("짧다");
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'com.workplace.notify.push.PushSenderTest'`
Expected: 컴파일 실패.

- [ ] **Step 3: 구현**

`PushMessage.java`:
```java
package com.workplace.notify.push;

/**
 * 발송 단위(수신자 무관 공통 내용). JSON 으로 직렬화되어 암호화된다 — 프론트 서비스워커가 이 필드로 알림을 표시하고 url 로 이동한다.
 *
 * @param urgency Web Push Urgency 헤더(high|normal)
 * @param tag 같은 tag 알림은 교체(채널·이슈·일정 단위로 한 줄 유지)
 */
public record PushMessage(
    long tenantId,
    PushCategory category,
    String title,
    String body,
    String url,
    String tag,
    String urgency,
    int ttlSeconds) {

  /** 미리보기 가림(workplace.push.preview=false) — 이동 정보는 유지하고 제목·본문만 고정 문구로. */
  public PushMessage redacted() {
    boolean message = category == PushCategory.DM || category == PushCategory.MENTION;
    return new PushMessage(
        tenantId,
        category,
        message ? "새 메시지" : "새 알림",
        message ? "새 메시지가 있습니다" : "새 알림이 있습니다",
        url,
        tag,
        urgency,
        ttlSeconds);
  }

  /** 코드포인트 기준 max 자로 자르고 말줄임표. null 은 빈 문자열. */
  public static String truncate(String s, int max) {
    if (s == null) return "";
    if (s.codePointCount(0, s.length()) <= max) return s;
    return s.substring(0, s.offsetByCodePoints(0, max)) + "…";
  }
}
```

`PushSender.java`:
```java
package com.workplace.notify.push;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 수신자 → 구독 조회 → 암호화 → 발송 → 결과 반영. 호출자(PushDispatcher)가 pushExecutor 스레드에서 동기 호출한다. 한 구독의 실패/예외는 로그만 남기고
 * 다른 구독 발송을 계속한다(best-effort, 재시도 큐 없음). DB 트랜잭션 없이 호출해 외부 HTTP 동안 커넥션을 잡지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PushSender {

  /** 연속 일시 실패 허용 한도 — 도달 시 구독 삭제. */
  static final int MAX_FAILURES = 5;

  private final PushProperties props;
  private final PushSubscriptionRepository subscriptions;
  private final NotificationPreferenceService preferences;
  private final WebPushEncryptor encryptor;
  private final VapidSigner signer;
  private final EndpointValidator endpointValidator;
  private final PushGateway gateway;
  private final ObjectMapper objectMapper;

  /** 사용자들에게 발송. 비활성·빈 수신자·설정 off 는 건너뛴다. */
  public void send(Collection<Long> userIds, PushMessage message) {
    if (!props.enabled() || userIds.isEmpty()) return;
    Set<Long> targets = preferences.filterEnabled(userIds, message.category());
    if (targets.isEmpty()) return;
    List<PushSubscriptionRow> subs = subscriptions.findByUserIds(targets);
    if (subs.isEmpty()) return;
    byte[] json = payload(props.preview() ? message : message.redacted());
    for (PushSubscriptionRow sub : subs) {
      try {
        deliverOne(sub, json, message);
      } catch (Exception e) {
        log.warn("[push] 구독 {} 발송 중 예외: {}", sub.id(), e.getMessage());
        failed(sub);
      }
    }
  }

  /** 서비스워커 계약(v=1) JSON. */
  byte[] payload(PushMessage m) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("v", 1);
    p.put("tenantId", m.tenantId());
    p.put("category", m.category().name());
    p.put("title", m.title());
    p.put("body", m.body());
    p.put("url", m.url());
    p.put("tag", m.tag());
    try {
      return objectMapper.writeValueAsBytes(p);
    } catch (Exception e) {
      throw new IllegalStateException("푸시 payload 직렬화 실패", e);
    }
  }

  private void deliverOne(PushSubscriptionRow sub, byte[] json, PushMessage m) {
    if (!endpointValidator.isAllowed(sub.endpoint())) {
      subscriptions.deleteById(sub.id()); // 재해석 결과 내부 주소 — 폐기
      return;
    }
    byte[] body = encryptor.encrypt(json, EcKeys.b64d(sub.p256dh()), EcKeys.b64d(sub.auth()));
    Map<String, String> headers = new LinkedHashMap<>();
    headers.put("TTL", String.valueOf(m.ttlSeconds()));
    headers.put("Urgency", m.urgency());
    headers.put("Content-Encoding", "aes128gcm");
    headers.put("Content-Type", "application/octet-stream");
    headers.put("Authorization", signer.authorization(sub.endpoint()));
    int status = gateway.deliver(sub.endpoint(), body, headers);
    if (status >= 200 && status < 300) {
      subscriptions.markSuccess(sub.id());
    } else if (status == 404 || status == 410) {
      subscriptions.deleteById(sub.id()); // 만료·해지된 구독
    } else if (status == 413) {
      log.error("[push] payload 초과(413) — 구독 {} 유지, payload 크기 점검 필요", sub.id());
    } else {
      failed(sub); // 429·5xx·타임아웃(-1)·기타
    }
  }

  private void failed(PushSubscriptionRow sub) {
    if (subscriptions.incrementFailure(sub.id()) >= MAX_FAILURES) {
      subscriptions.deleteById(sub.id());
    }
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `./gradlew test --tests 'com.workplace.notify.push.PushSenderTest'`
Expected: 8 tests PASS.

- [ ] **Step 5: 포맷 + 커밋(승인 후)**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/notify/push src/test/java/com/workplace/notify/push
git commit -m "feat(api/notify): 푸시 발송기 추가 — 설정 필터·암호화·만료 구독 정리

- #864
- 수신자의 켜진 카테고리 구독에만 암호화된 알림을 보내고 응답 코드로 구독 상태를 관리한다
- 만료된 구독은 즉시, 연속 5회 실패한 구독은 삭제하고 한 기기 실패가 다른 기기 발송을 막지 않게 한다
- 미리보기 가림 설정이면 제목과 본문을 고정 문구로 바꿔 보낸다"
```

---

### Task 7: 인박스 알림(이슈·캘린더) 푸시 (#865)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/InboxPushRequestedEvent.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushContentRepository.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushContentService.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushDispatcher.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/notify/service/NotificationService.java` (4개 생성 메서드에 이벤트 발행)
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/push/PushContentServiceTest.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/push/InboxPushEventTest.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/push/PushDispatcherTest.java`

**Interfaces:**
- Consumes: `PushSender`·`PushMessage`(Task 6), `PushCategory`(Task 1), `NotificationType`
- Produces:
  - `record InboxPushRequestedEvent(long tenantId, NotificationType type, List<Long> recipientIds, Long actorId, Long issueId, Long eventId)`
  - `PushContentRepository`: `Optional<IssueInfo> findIssue(long issueId)`(`record IssueInfo(String projectKey, int number, String title)`), `Optional<String> findEventTitle(long eventId)`, `Optional<String> findUserName(long userId)`
  - `PushContentService`: `PushMessage forInbox(InboxPushRequestedEvent e)` — 대상 삭제됨이면 `null`
  - `PushDispatcher`: `onInboxPush(InboxPushRequestedEvent)` — `@Async("pushExecutor") @TransactionalEventListener(AFTER_COMMIT)`

- [ ] **Step 1: 실패하는 테스트 작성**

`PushContentServiceTest.java` (`@Transactional`, 조립 규칙):
```java
package com.workplace.notify.push;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
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

/** 인박스 알림 → 푸시 문구/url/tag 조립. 표시 문구는 프론트 InboxPanel ACTION_LABEL 과 같은 표현을 쓴다. */
@Transactional
class PushContentServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired PushContentService content;

  long actor;
  String key;
  long issueId;

  private long seedUser(String name) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "pcs_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, "pcs_" + s + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private void seedIssue() {
    actor = seedUser("박민수");
    key = "P" + UUID.randomUUID().toString().replace("-", "").substring(0, 4).toUpperCase();
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, key)
            .set(PROJECT.NAME, "N")
            .set(PROJECT.OWNER_ID, actor)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    long typeId =
        dsl.insertInto(ISSUE_TYPE_DEF)
            .set(ISSUE_TYPE_DEF.PROJECT_ID, projectId)
            .set(ISSUE_TYPE_DEF.NAME, "TASK")
            .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
            .set(ISSUE_TYPE_DEF.ICON, "Circle")
            .returning(ISSUE_TYPE_DEF.ID)
            .fetchOne()
            .getId();
    issueId =
        dsl.insertInto(ISSUE)
            .set(ISSUE.PROJECT_ID, projectId)
            .set(ISSUE.NUMBER, 7)
            .set(ISSUE.TITLE, "로그인 버그")
            .set(ISSUE.REPORTER_ID, actor)
            .set(ISSUE.TYPE_ID, typeId)
            .returning(ISSUE.ID)
            .fetchOne()
            .getId();
  }

  @Test
  void forInbox_assigned_buildsIssueMessage() {
    seedIssue();
    PushMessage m =
        content.forInbox(
            new InboxPushRequestedEvent(1L, NotificationType.ASSIGNED, List.of(99L), actor, issueId, null));

    assertThat(m.category()).isEqualTo(PushCategory.ISSUE);
    assertThat(m.title()).isEqualTo(key + "-7 로그인 버그");
    assertThat(m.body()).isEqualTo("박민수님이 회원님을 배정했습니다");
    assertThat(m.url()).isEqualTo("/projects/" + key + "/issues/7");
    assertThat(m.tag()).isEqualTo("issue-" + issueId);
    assertThat(m.urgency()).isEqualTo("normal");
    assertThat(m.ttlSeconds()).isEqualTo(259200);
    assertThat(m.tenantId()).isEqualTo(1L);
  }

  @Test
  void forInbox_deletedIssue_returnsNull() {
    PushMessage m =
        content.forInbox(
            new InboxPushRequestedEvent(1L, NotificationType.COMMENTED, List.of(1L), null, -1L, null));
    assertThat(m).isNull();
  }

  @Test
  void forInbox_missingEvent_returnsNull() {
    assertThat(
            content.forInbox(
                new InboxPushRequestedEvent(1L, NotificationType.REMINDER, List.of(1L), null, null, -1L)))
        .isNull();
  }
}
```

> 캘린더 조립(제목=일정 제목, url `/calendar?eventId=`)은 `calendar_event` 시드 컬럼이 많아 이 테스트에서 행 시드 대신 `PushDispatcherTest`(Mockito)에서 `PushContentService` 동작 경계만 검증한다. 캘린더 경로의 실데이터 검증은 Step 7 의 `InboxPushEventTest` 에서 기존 캘린더 서비스(`CalendarAttendeeNotifyTest` 와 같은 방식)를 통해 수행한다.

`InboxPushEventTest.java` (`@RecordApplicationEvents` — 커밋 없이 발행 여부만):
```java
package com.workplace.notify.push;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.service.NotificationService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/** NotificationService 가 인박스 알림 생성 시 InboxPushRequestedEvent 를 발행하는지(수신자 = 실제 insert 대상, actor 제외). */
@Transactional
@RecordApplicationEvents
class InboxPushEventTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationService service;
  @Autowired ApplicationEvents events;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ipe_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Ipe" + s)
        .set(USER.EMAIL, "ipe_" + s + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long seedIssue(long owner) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 5);
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "I" + s)
            .set(PROJECT.NAME, "P" + s)
            .set(PROJECT.OWNER_ID, owner)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    long typeId =
        dsl.insertInto(ISSUE_TYPE_DEF)
            .set(ISSUE_TYPE_DEF.PROJECT_ID, projectId)
            .set(ISSUE_TYPE_DEF.NAME, "TASK")
            .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
            .set(ISSUE_TYPE_DEF.ICON, "Circle")
            .returning(ISSUE_TYPE_DEF.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(ISSUE)
        .set(ISSUE.PROJECT_ID, projectId)
        .set(ISSUE.NUMBER, 1)
        .set(ISSUE.TITLE, "t")
        .set(ISSUE.REPORTER_ID, owner)
        .set(ISSUE.TYPE_ID, typeId)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void createAndFanOut_publishesPushEvent_withFilteredRecipients() {
    long actor = seedUser();
    long r1 = seedUser();
    long issueId = seedIssue(actor);

    service.createAndFanOut(NotificationType.COMMENTED, List.of(actor, r1, r1), actor, issueId, 3L);

    InboxPushRequestedEvent e =
        events.stream(InboxPushRequestedEvent.class).findFirst().orElseThrow();
    assertThat(e.recipientIds()).containsExactly(r1);
    assertThat(e.type()).isEqualTo(NotificationType.COMMENTED);
    assertThat(e.issueId()).isEqualTo(issueId);
    assertThat(e.tenantId()).isEqualTo(1L);
  }

  @Test
  void noTenant_skipsPushButKeepsNotification() {
    long actor = seedUser();
    long r1 = seedUser();
    long issueId = seedIssue(actor);
    TenantContext.clear(); // 트랜잭션은 이미 GUC 로 열려 있어 insert 는 성공한다
    try {
      service.createAndFanOut(NotificationType.ASSIGNED, List.of(r1), actor, issueId, null);
    } finally {
      TenantContext.set(1L);
    }
    assertThat(service.countUnread(r1)).isEqualTo(1);
    assertThat(events.stream(InboxPushRequestedEvent.class)).isEmpty();
  }

  @Test
  void emptyRecipients_noEvent() {
    long actor = seedUser();
    long issueId = seedIssue(actor);
    service.createAndFanOut(NotificationType.ASSIGNED, List.of(actor), actor, issueId, null);
    assertThat(events.stream(InboxPushRequestedEvent.class)).isEmpty();
  }
}
```

`PushDispatcherTest.java` (Mockito 단위):
```java
package com.workplace.notify.push;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.notify.dto.NotificationType;
import java.util.List;
import org.junit.jupiter.api.Test;

/** PushDispatcher 인박스 경로 — 조립 결과를 수신자에게 전달, null(대상 삭제)이면 미발송, 예외는 삼킨다. */
class PushDispatcherTest {

  final PushContentService content = mock(PushContentService.class);
  final PushSender sender = mock(PushSender.class);
  final PushDispatcher dispatcher = new PushDispatcher(content, sender);

  final InboxPushRequestedEvent e =
      new InboxPushRequestedEvent(1L, NotificationType.CALENDAR_INVITED, List.of(5L), 2L, null, 9L);

  @Test
  void onInboxPush_sendsBuiltMessage() {
    PushMessage m =
        new PushMessage(1L, PushCategory.CALENDAR, "주간회의", "박민수님이 일정에 초대했습니다", "/calendar?eventId=9", "event-9", "normal", 259200);
    when(content.forInbox(e)).thenReturn(m);
    dispatcher.onInboxPush(e);
    verify(sender).send(List.of(5L), m);
  }

  @Test
  void onInboxPush_nullContent_skips() {
    when(content.forInbox(e)).thenReturn(null);
    dispatcher.onInboxPush(e);
    verify(sender, never()).send(any(), any());
  }

  @Test
  void onInboxPush_exception_isSwallowed() {
    when(content.forInbox(e)).thenThrow(new RuntimeException("boom"));
    dispatcher.onInboxPush(e); // 예외 전파 없음
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'com.workplace.notify.push.PushContentServiceTest' --tests 'com.workplace.notify.push.InboxPushEventTest' --tests 'com.workplace.notify.push.PushDispatcherTest'`
Expected: 컴파일 실패.

- [ ] **Step 3: 구현**

`InboxPushRequestedEvent.java`:
```java
package com.workplace.notify.push;

import com.workplace.notify.dto.NotificationType;
import java.util.List;

/**
 * 인박스 알림이 생성됐음을 알리는 notify 내부 이벤트. NotificationService 가 insert 직후 발행하고, 커밋 후 PushDispatcher 가 푸시로 내보낸다.
 * recipientIds 는 실제 insert 된 수신자(actor 제외·중복 제거 후). issueId/eventId 중 유형에 맞는 하나만 채워진다.
 */
public record InboxPushRequestedEvent(
    long tenantId,
    NotificationType type,
    List<Long> recipientIds,
    Long actorId,
    Long issueId,
    Long eventId) {}
```

`PushContentRepository.java`:
```java
package com.workplace.notify.push;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** 푸시 문구 조립용 표시 정보 조회. issue/project/calendar_event 는 RLS 대상 → 테넌트 GUC 가 주입된 트랜잭션 안에서 호출해야 한다. */
@Repository
@RequiredArgsConstructor
public class PushContentRepository {

  private final DSLContext dsl;

  /** 이슈 표시 정보(삭제된 이슈 제외). */
  public record IssueInfo(String projectKey, int number, String title) {}

  public Optional<IssueInfo> findIssue(long issueId) {
    return dsl.select(PROJECT.KEY, ISSUE.NUMBER, ISSUE.TITLE)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(ISSUE.ID.eq(issueId))
        .and(ISSUE.DELETED_AT.isNull())
        .fetchOptional(r -> new IssueInfo(r.get(PROJECT.KEY), r.get(ISSUE.NUMBER), r.get(ISSUE.TITLE)));
  }

  public Optional<String> findEventTitle(long eventId) {
    return dsl.select(CALENDAR_EVENT.TITLE)
        .from(CALENDAR_EVENT)
        .where(CALENDAR_EVENT.ID.eq(eventId))
        .fetchOptional(CALENDAR_EVENT.TITLE);
  }

  public Optional<String> findUserName(long userId) {
    return dsl.select(USER.NAME).from(USER).where(USER.ID.eq(userId)).fetchOptional(USER.NAME);
  }
}
```

> `ISSUE.NUMBER` 가 `Integer` 가 아닌 타입으로 생성돼 있으면 `IssueInfo.number` 타입을 맞춘다. `CALENDAR_EVENT` 에 soft-delete 컬럼이 있으면 `.and(CALENDAR_EVENT.DELETED_AT.isNull())` 를 추가한다(`grep -n DELETED_AT src/main/generated/com/workplace/jooq/tables/CalendarEvent.java`).

`PushContentService.java`:
```java
package com.workplace.notify.push;

import com.workplace.notify.dto.NotificationType;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 인박스 알림 → PushMessage 조립. 문구는 프론트 InboxPanel 의 ACTION_LABEL 과 같은 표현을 쓴다(인박스와 푸시 문구 일치). 대상 이슈/일정이
 * 커밋 직후 삭제됐으면 null — 푸시하지 않는다. pushExecutor 스레드(TenantContext 복원됨)에서 새 트랜잭션으로 조회해 RLS GUC 가 주입된다.
 */
@Service
@RequiredArgsConstructor
public class PushContentService {

  static final int INBOX_TTL = 259200;
  private final PushContentRepository repo;

  @Transactional(readOnly = true)
  public PushMessage forInbox(InboxPushRequestedEvent e) {
    String actor = e.actorId() == null ? "" : repo.findUserName(e.actorId()).orElse("");
    PushCategory category = PushCategory.of(e.type());
    if (category == PushCategory.ISSUE) {
      if (e.issueId() == null) return null;
      return repo.findIssue(e.issueId())
          .map(
              i ->
                  new PushMessage(
                      e.tenantId(),
                      category,
                      PushMessage.truncate(i.projectKey() + "-" + i.number() + " " + i.title(), 120),
                      actor + label(e.type()),
                      "/projects/" + i.projectKey() + "/issues/" + i.number(),
                      "issue-" + e.issueId(),
                      "normal",
                      INBOX_TTL))
          .orElse(null);
    }
    if (e.eventId() == null) return null;
    return repo.findEventTitle(e.eventId())
        .map(
            title -> {
              boolean reminder = e.type() == NotificationType.REMINDER;
              return new PushMessage(
                  e.tenantId(),
                  category,
                  reminder ? "일정 알림" : PushMessage.truncate(title, 120),
                  reminder ? PushMessage.truncate(title, 120) : actor + label(e.type()),
                  "/calendar?eventId=" + e.eventId(),
                  "event-" + e.eventId(),
                  "normal",
                  INBOX_TTL);
            })
        .orElse(null);
  }

  /** 행위 문구(행위자 이름 뒤에 붙음). */
  private static String label(NotificationType t) {
    return switch (t) {
      case ASSIGNED -> "님이 회원님을 배정했습니다";
      case COMMENTED -> "님이 코멘트를 남겼습니다";
      case STATUS_CHANGED -> "님이 상태를 변경했습니다";
      case PRIORITY_CHANGED -> "님이 우선순위를 변경했습니다";
      case CALENDAR_INVITED -> "님이 일정에 초대했습니다";
      case CALENDAR_RSVP_CHANGED -> "님이 참석 응답을 변경했습니다";
      case REMINDER -> "일정 알림";
    };
  }
}
```

`PushDispatcher.java` (인박스 경로만 — 메시지 경로는 Task 8 에서 추가):
```java
package com.workplace.notify.push;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 도메인 이벤트 → 푸시 발송. AFTER_COMMIT 에서만 동작(롤백 시 미발송)하고 pushExecutor 에서 실행해 인박스 SSE·도메인 응답과 분리한다. 모든 예외는
 * 로그만 남긴다(푸시는 best-effort).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PushDispatcher {

  private final PushContentService content;
  private final PushSender sender;

  /** 인박스 알림(이슈·캘린더) → 푸시. */
  @Async("pushExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onInboxPush(InboxPushRequestedEvent e) {
    try {
      PushMessage m = content.forInbox(e);
      if (m != null) sender.send(e.recipientIds(), m);
    } catch (Exception ex) {
      log.warn("[push] 인박스 푸시 실패 type={}: {}", e.type(), ex.getMessage());
    }
  }
}
```

`NotificationService.java` 수정 — `ApplicationEventPublisher` 주입 + 4개 메서드에서 insert 후 발행:
```java
// 필드 추가
private final org.springframework.context.ApplicationEventPublisher publisher;

// 공통 private 헬퍼 — 테넌트가 없으면(비정상 경로) 푸시만 건너뛴다. 푸시 때문에 인박스 insert 가 롤백되면 안 되므로 require() 금지.
private void publishPush(
    NotificationType type, List<Long> recipients, Long actorId, Long issueId, Long eventId) {
  Long tenantId = TenantContext.get();
  if (tenantId == null) return;
  publisher.publishEvent(
      new InboxPushRequestedEvent(tenantId, type, recipients, actorId, issueId, eventId));
}

// createAndFanOut: registry.fanOut(...) 다음 줄
publishPush(type, recipients, actorId, issueId, null);

// createEventNotificationAndFanOut: registry.fanOut(...) 다음 줄
publishPush(type, List.of(recipientId), actorId, null, eventId);

// createReminderAndFanOut: registry.fanOut(...) 다음 줄
publishPush(NotificationType.REMINDER, List.of(recipientId), null, null, eventId);
```
import: `com.workplace.global.tenant.TenantContext`, `com.workplace.notify.push.InboxPushRequestedEvent`. `createWithWatchersAndFanOut` 은 `createAndFanOut` 을 호출하므로 추가 불필요. 클래스 Javadoc 에 "insert 후 InboxPushRequestedEvent 발행 → 커밋 후 푸시" 한 줄 추가.

> 주의: 이 메서드들은 이미 `@Async` AFTER_COMMIT 핸들러에서 호출되는 **새 트랜잭션**이다. 여기서 발행한 이벤트의 AFTER_COMMIT 은 이 트랜잭션 커밋 후 실행된다. 기존 `NotificationServiceTest` 가 `publisher` 생성자 인자 추가로 깨지지 않는지(스프링 주입이라 무관) 확인.

- [ ] **Step 4: 통과 확인**

Run: `./gradlew test --tests 'com.workplace.notify.*'`
Expected: 기존 notify 테스트 포함 PASS.

- [ ] **Step 5: 커밋 경로 통합 테스트 작성(비-@Transactional, Awaitility)**

`InboxPushDeliveryTest.java` — 실제 커밋 → AFTER_COMMIT → pushExecutor → PushGateway 호출까지:
```java
package com.workplace.notify.push;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.service.NotificationService;
import com.workplace.support.IntegrationTestBase;
import java.security.interfaces.ECPublicKey;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/** 인박스 알림 커밋 → 수신자 기기로 푸시 게이트웨이 호출까지 배선 검증. 커밋이 필요해 비-@Transactional + 수동 정리. */
class InboxPushDeliveryTest extends IntegrationTestBase {

  @MockitoBean PushGateway gateway;
  @Autowired DSLContext dsl;
  @Autowired NotificationService service;
  @Autowired PushSubscriptionRepository subs;

  final List<Long> users = new ArrayList<>();
  final List<Long> projects = new ArrayList<>();

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(NOTIFICATION).where(NOTIFICATION.RECIPIENT_ID.in(users)).execute();
          dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.in(projects)).execute();
          dsl.deleteFrom(ISSUE_TYPE_DEF).where(ISSUE_TYPE_DEF.PROJECT_ID.in(projects)).execute();
          dsl.deleteFrom(PROJECT).where(PROJECT.ID.in(projects)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(users)).execute(); // push_subscription CASCADE
        });
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "ipd_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Ipd" + s)
            .set(USER.EMAIL, "ipd_" + s + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    users.add(id);
    return id;
  }

  @Test
  void assigned_commit_deliversPush() {
    long actor = seedUser();
    long recipient = seedUser();
    String ep = "https://203.0.113.10/push/" + UUID.randomUUID();
    subs.upsert(
        recipient,
        ep,
        EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) EcKeys.generate().getPublic())),
        EcKeys.b64e(new byte[16]),
        null);
    when(gateway.deliver(eq(ep), any(), anyMap())).thenReturn(201);

    long issueId =
        new TransactionTemplate(txManager)
            .execute(
                st -> {
                  String k = "D" + UUID.randomUUID().toString().replace("-", "").substring(0, 5);
                  long pid =
                      dsl.insertInto(PROJECT)
                          .set(PROJECT.KEY, k)
                          .set(PROJECT.NAME, "P")
                          .set(PROJECT.OWNER_ID, actor)
                          .returning(PROJECT.ID)
                          .fetchOne()
                          .getId();
                  projects.add(pid);
                  long tid =
                      dsl.insertInto(ISSUE_TYPE_DEF)
                          .set(ISSUE_TYPE_DEF.PROJECT_ID, pid)
                          .set(ISSUE_TYPE_DEF.NAME, "TASK")
                          .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
                          .set(ISSUE_TYPE_DEF.ICON, "Circle")
                          .returning(ISSUE_TYPE_DEF.ID)
                          .fetchOne()
                          .getId();
                  return dsl.insertInto(ISSUE)
                      .set(ISSUE.PROJECT_ID, pid)
                      .set(ISSUE.NUMBER, 1)
                      .set(ISSUE.TITLE, "t")
                      .set(ISSUE.REPORTER_ID, actor)
                      .set(ISSUE.TYPE_ID, tid)
                      .returning(ISSUE.ID)
                      .fetchOne()
                      .getId();
                });

    service.createAndFanOut(NotificationType.ASSIGNED, List.of(recipient), actor, issueId, null);

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> verify(gateway).deliver(eq(ep), any(), anyMap()));
  }
}
```

> `service.createAndFanOut` 은 `@Transactional` 이라 테스트 스레드에서 직접 호출해도 자체 트랜잭션이 커밋된다 → AFTER_COMMIT 리스너 발동.

- [ ] **Step 6: 통과 확인**

Run: `./gradlew test --tests 'com.workplace.notify.*'`
Expected: PASS.

- [ ] **Step 7: 기존 캘린더 알림 테스트 회귀 확인**

Run: `./gradlew test --tests 'com.workplace.calendar.CalendarAttendeeNotifyTest' --tests 'com.workplace.issue.*'`
Expected: PASS(푸시 이벤트 추가가 기존 알림 흐름을 깨지 않음).

- [ ] **Step 8: 포맷 + 커밋(승인 후)**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/notify src/test/java/com/workplace/notify
git commit -m "feat(api/notify): 이슈·캘린더 인박스 알림을 Web Push 로도 발송

- #865
- 인박스 알림 생성 시 이벤트를 발행하고 커밋 후 전용 실행기에서 수신자 기기로 푸시한다
- 푸시 문구는 인박스 표시와 같은 표현을 쓰고 대상이 삭제됐으면 보내지 않는다"
```

---

### Task 8: 메시지(DM·멘션) 푸시 (#866)

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/messaging/outbound/MessagingDomainEvents.java` (`MessagePushRequestedEvent` 추가)
- Create: `apps/workplace-api/src/main/java/com/workplace/messaging/service/MessagePushPreview.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/messaging/service/MessageService.java` (`create` 끝에서 발행)
- Modify: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushDispatcher.java` (`onMessagePush` 추가)
- Test: `apps/workplace-api/src/test/java/com/workplace/messaging/service/MessagePushPreviewTest.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/messaging/MessagePushEventTest.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/notify/push/PushDispatcherMessageTest.java`

**Interfaces:**
- Consumes: `PushSender`·`PushMessage`·`PushCategory`(Task 1·6), `PushDispatcher`(Task 7), messaging `ChannelRepository.findKind(long)`·`findName(long)`, `ChannelMemberRepository.findMemberIds(long)`·`listMembers(long)`
- Produces:
  - `record MessagePushRequestedEvent(long tenantId, long channelId, String channelKind, String channelName, long messageId, Long parentMessageId, long authorId, String authorName, String preview, List<Long> dmRecipientIds, List<Long> mentionedUserIds)`
  - `MessagePushPreview.of(String body, List<MentionResponse> mentions, boolean hasAttachments)` → 120자 미리보기
  - `PushDispatcher.onMessagePush(MessagePushRequestedEvent)`

- [ ] **Step 1: 실패하는 테스트 작성**

`MessagePushPreviewTest.java`:
```java
package com.workplace.messaging.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.dto.MentionResponse;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 푸시 미리보기 — 멘션 토큰을 @이름으로, 첨부만이면 고정 문구, 120자 제한. */
class MessagePushPreviewTest {

  @Test
  void replacesMentionTokens() {
    String p =
        MessagePushPreview.of(
            "<@12> 리뷰 부탁 <@99>",
            List.of(new MentionResponse(12L, "kim", "김철수", "HUMAN")),
            false);
    assertThat(p).isEqualTo("@김철수 리뷰 부탁 @사용자");
  }

  @Test
  void attachmentOnly_fixedText() {
    assertThat(MessagePushPreview.of("", List.of(), true)).isEqualTo("파일을 보냈습니다");
    assertThat(MessagePushPreview.of(null, List.of(), true)).isEqualTo("파일을 보냈습니다");
  }

  @Test
  void truncatesTo120() {
    assertThat(MessagePushPreview.of("가".repeat(200), List.of(), false)).hasSize(121);
  }

  @Test
  void collapsesWhitespace() {
    assertThat(MessagePushPreview.of("줄1\n\n줄2   끝", List.of(), false)).isEqualTo("줄1 줄2 끝");
  }
}
```

`MessagePushEventTest.java` (`@Transactional` + `@RecordApplicationEvents`):
```java
package com.workplace.messaging;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessagePushRequestedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.DmService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/** MessageService.create 가 DM 상대·채널 멤버 멘션 대상을 계산해 MessagePushRequestedEvent 를 발행하는지. */
@Transactional
@RecordApplicationEvents
class MessagePushEventTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MessageService messageService;
  @Autowired ChannelService channelService;
  @Autowired DmService dmService;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired ApplicationEvents events;

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  private long seedUser(String kind) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "mp_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Mp" + s)
            .set(USER.EMAIL, "mp_" + s + "@example.com")
            .set(USER.KIND, kind)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private MessagePushRequestedEvent lastEvent() {
    return events.stream(MessagePushRequestedEvent.class).reduce((a, b) -> b).orElseThrow();
  }

  @Test
  void create_dm_targetsOtherHumans() {
    long me = seedUser("HUMAN");
    long you = seedUser("HUMAN");
    long dmId = dmService.createOrGet(me, List.of(you)).dm().id();

    messageService.create(me, dmId, new CreateMessageRequest("안녕"));

    MessagePushRequestedEvent e = lastEvent();
    assertThat(e.channelKind()).isEqualTo("DM");
    assertThat(e.dmRecipientIds()).containsExactly(you);
    assertThat(e.authorId()).isEqualTo(me);
    assertThat(e.preview()).isEqualTo("안녕");
    assertThat(e.tenantId()).isEqualTo(1L);
  }

  @Test
  void create_channelMention_excludesNonMemberAgentAndAuthor() {
    long me = seedUser("HUMAN");
    long member = seedUser("HUMAN");
    long outsider = seedUser("HUMAN");
    long agent = seedUser("AGENT");
    long ch =
        channelService.create(me, "push-" + UUID.randomUUID().toString().substring(0, 8), "PUBLIC").id();
    memberRepo.add(ch, member, "MEMBER");
    memberRepo.add(ch, agent, "MEMBER");

    messageService.create(
        me,
        ch,
        new CreateMessageRequest(
            "<@" + member + "> <@" + outsider + "> <@" + agent + "> <@" + me + "> 확인"));

    MessagePushRequestedEvent e = lastEvent();
    assertThat(e.channelKind()).isEqualTo("CHANNEL");
    assertThat(e.mentionedUserIds()).containsExactly(member);
    assertThat(e.dmRecipientIds()).isEmpty();
    assertThat(e.channelName()).startsWith("push-");
  }

  @Test
  void create_channelWithoutMention_noEvent() {
    long me = seedUser("HUMAN");
    long ch =
        channelService.create(me, "push-" + UUID.randomUUID().toString().substring(0, 8), "PUBLIC").id();
    messageService.create(me, ch, new CreateMessageRequest("그냥 메시지"));
    assertThat(events.stream(MessagePushRequestedEvent.class)).isEmpty();
  }
}
```

> `channelService.create` 의 visibility 값(`"PUBLIC"`)과 `memberRepo.add(channelId, userId, role)` 시그니처는 `ChannelService.java:44`, `ChannelService` 내부 `memberRepo.add(channelId, callerId, "OWNER")` 호출을 따른 것이다. `normalizeVisibility` 가 다른 값을 요구하면 맞춘다.

`PushDispatcherMessageTest.java`:
```java
package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.workplace.messaging.outbound.MessagingDomainEvents.MessagePushRequestedEvent;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 메시지 푸시 매핑 — DM/멘션 카테고리 분리, 중복 시 DM 우선, 제목·url·tag 규칙. */
class PushDispatcherMessageTest {

  final PushSender sender = mock(PushSender.class);
  final PushDispatcher dispatcher = new PushDispatcher(mock(PushContentService.class), sender);

  @Test
  void dm_sendsDmCategory_withAuthorTitle() {
    dispatcher.onMessagePush(
        new MessagePushRequestedEvent(1L, 42L, "DM", null, 1234L, null, 7L, "박민수", "안녕", List.of(8L), List.of(8L)));

    ArgumentCaptor<PushMessage> m = ArgumentCaptor.forClass(PushMessage.class);
    verify(sender).send(eq(List.of(8L)), m.capture());
    assertThat(m.getValue().category()).isEqualTo(PushCategory.DM);
    assertThat(m.getValue().title()).isEqualTo("박민수");
    assertThat(m.getValue().url()).isEqualTo("/chat/dms/42");
    assertThat(m.getValue().tag()).isEqualTo("ch-42");
    assertThat(m.getValue().urgency()).isEqualTo("high");
    assertThat(m.getValue().ttlSeconds()).isEqualTo(86400);
  }

  @Test
  void channelMention_threadReply_urlHasThread() {
    dispatcher.onMessagePush(
        new MessagePushRequestedEvent(1L, 5L, "CHANNEL", "backend", 10L, 3L, 7L, "박민수", "리뷰", List.of(), List.of(9L)));

    ArgumentCaptor<PushMessage> m = ArgumentCaptor.forClass(PushMessage.class);
    verify(sender).send(eq(List.of(9L)), m.capture());
    assertThat(m.getValue().category()).isEqualTo(PushCategory.MENTION);
    assertThat(m.getValue().title()).isEqualTo("#backend · 박민수");
    assertThat(m.getValue().url()).isEqualTo("/chat/channels/5?thread=3");
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'com.workplace.messaging.service.MessagePushPreviewTest' --tests 'com.workplace.messaging.MessagePushEventTest' --tests 'com.workplace.notify.push.PushDispatcherMessageTest'`
Expected: 컴파일 실패.

- [ ] **Step 3: 구현**

`MessagingDomainEvents.java` 에 추가(파일 끝 `}` 앞):
```java
  /**
   * 메시지 푸시 요청 — MessageService.create 가 채널 종류·멤버·멘션을 보고 대상을 계산해 발행한다. notify 가 AFTER_COMMIT 에 수신해
   * 발송만 한다(notify 가 messaging 내부를 조회하지 않도록 대상을 이벤트에 담는다). 대상이 없으면 발행하지 않는다.
   *
   * @param channelName DM 이면 null
   * @param dmRecipientIds DM 이면 작성자 외 HUMAN 멤버, 아니면 빈 목록
   * @param mentionedUserIds 채널 멤버인 HUMAN 멘션 대상(작성자 제외)
   */
  public record MessagePushRequestedEvent(
      long tenantId,
      long channelId,
      String channelKind,
      String channelName,
      long messageId,
      Long parentMessageId,
      long authorId,
      String authorName,
      String preview,
      List<Long> dmRecipientIds,
      List<Long> mentionedUserIds) {}
```

`MessagePushPreview.java`:
```java
package com.workplace.messaging.service;

import com.workplace.global.dto.MentionResponse;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** 푸시 알림 본문 미리보기. 멘션 토큰(<@id>)을 @이름으로 바꾸고 공백을 접어 120자로 자른다. 알 수 없는 멘션은 @사용자. */
public final class MessagePushPreview {

  static final int MAX = 120;
  private static final Pattern MENTION = Pattern.compile("<@(\\d{1,18})>");

  private MessagePushPreview() {}

  public static String of(String body, List<MentionResponse> mentions, boolean hasAttachments) {
    if (body == null || body.isBlank()) return hasAttachments ? "파일을 보냈습니다" : "";
    Map<Long, String> names =
        mentions.stream().collect(Collectors.toMap(MentionResponse::id, MentionResponse::name, (a, b) -> a));
    Matcher m = MENTION.matcher(body);
    StringBuilder sb = new StringBuilder();
    while (m.find()) {
      String name = names.getOrDefault(Long.parseLong(m.group(1)), "사용자");
      m.appendReplacement(sb, Matcher.quoteReplacement("@" + name));
    }
    m.appendTail(sb);
    String flat = sb.toString().replaceAll("\\s+", " ").trim();
    if (flat.codePointCount(0, flat.length()) <= MAX) return flat;
    return flat.substring(0, flat.offsetByCodePoints(0, MAX)) + "…";
  }
}
```

`MessageService.java` 수정 — `create()` 의 `maybeTriggerAi(callerId, channelId, saved);` 다음 줄에 `publishPushRequest(channelId, saved);` 추가하고 private 메서드 추가:
```java
  /**
   * 메시지 푸시 대상 계산 후 발행. DM: 작성자 외 HUMAN 멤버 전원. 멘션: 채널 멤버인 HUMAN(작성자 제외). 둘 다 없으면 발행하지 않는다. 같은
   * 트랜잭션 안이라 멤버 조회에 RLS GUC 가 적용된다.
   */
  private void publishPushRequest(long channelId, MessageResponse saved) {
    String kind = channelRepo.findKind(channelId);
    boolean dm = "DM".equals(kind);
    java.util.Set<Long> memberIds = new java.util.HashSet<>(memberRepo.findMemberIds(channelId));
    java.util.List<Long> dmRecipients =
        dm
            ? memberRepo.listMembers(channelId).stream()
                .filter(m -> !m.userId().equals(saved.authorId()) && !"AGENT".equals(m.kind()))
                .map(ChannelMemberResponse::userId)
                .toList()
            : java.util.List.of();
    java.util.List<Long> mentioned =
        saved.mentions().stream()
            .filter(m -> !"AGENT".equals(m.kind()))
            .map(MentionResponse::id)
            .filter(id -> memberIds.contains(id) && !id.equals(saved.authorId()))
            .distinct()
            .toList();
    if (dmRecipients.isEmpty() && mentioned.isEmpty()) return;
    boolean hasAttachments =
        (saved.attachments() != null && !saved.attachments().isEmpty())
            || (saved.driveLinks() != null && !saved.driveLinks().isEmpty());
    publisher.publishEvent(
        new MessagePushRequestedEvent(
            TenantContext.require(),
            channelId,
            kind,
            dm ? null : channelRepo.findName(channelId).orElse(null),
            saved.id(),
            saved.parentMessageId(),
            saved.authorId(),
            saved.authorName(),
            MessagePushPreview.of(saved.body(), saved.mentions(), hasAttachments),
            dmRecipients,
            mentioned));
  }
```
import 추가: `com.workplace.messaging.outbound.MessagingDomainEvents.MessagePushRequestedEvent`, `com.workplace.messaging.dto.ChannelMemberResponse`, `com.workplace.global.dto.MentionResponse`(이미 있으면 생략), `com.workplace.global.tenant.TenantContext`(이미 있으면 생략). 파일의 기존 스타일이 `java.util.List` FQCN 을 쓰므로 그에 맞춘다.

`PushDispatcher.java` 에 메서드 추가:
```java
  static final int MESSAGE_TTL = 86400;

  /** 메시지(DM·멘션) → 푸시. 한 사람이 DM 과 멘션에 모두 해당하면 DM 으로 1회만. */
  @Async("pushExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onMessagePush(MessagePushRequestedEvent e) {
    try {
      java.util.LinkedHashSet<Long> dm = new java.util.LinkedHashSet<>(e.dmRecipientIds());
      java.util.List<Long> mention =
          e.mentionedUserIds().stream().filter(id -> !dm.contains(id)).distinct().toList();
      boolean isDm = "DM".equals(e.channelKind());
      String title = isDm ? e.authorName() : "#" + e.channelName() + " · " + e.authorName();
      String url =
          isDm
              ? "/chat/dms/" + e.channelId()
              : "/chat/channels/" + e.channelId()
                  + (e.parentMessageId() != null ? "?thread=" + e.parentMessageId() : "");
      if (!dm.isEmpty()) sender.send(java.util.List.copyOf(dm), message(e, PushCategory.DM, title, url));
      if (!mention.isEmpty()) sender.send(mention, message(e, PushCategory.MENTION, title, url));
    } catch (Exception ex) {
      log.warn("[push] 메시지 푸시 실패 channelId={}: {}", e.channelId(), ex.getMessage());
    }
  }

  private static PushMessage message(
      MessagePushRequestedEvent e, PushCategory c, String title, String url) {
    return new PushMessage(
        e.tenantId(),
        c,
        PushMessage.truncate(title, 120),
        e.preview(),
        url,
        "ch-" + e.channelId(),
        "high",
        MESSAGE_TTL);
  }
```
import: `com.workplace.messaging.outbound.MessagingDomainEvents.MessagePushRequestedEvent`. 클래스 Javadoc 에 메시지 경로 한 줄 추가.

- [ ] **Step 4: 통과 확인**

Run: `./gradlew test --tests 'com.workplace.messaging.service.MessagePushPreviewTest' --tests 'com.workplace.messaging.MessagePushEventTest' --tests 'com.workplace.notify.push.PushDispatcherMessageTest'`
Expected: PASS.

- [ ] **Step 5: 커밋 경로 통합 테스트(비-@Transactional)**

`apps/workplace-api/src/test/java/com/workplace/notify/push/MessagePushDeliveryTest.java`:
```java
package com.workplace.notify.push;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.service.DmService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.security.interfaces.ECPublicKey;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** DM 메시지 커밋 → 상대 기기 푸시 게이트웨이 호출까지 배선 검증. MessagingToAiAgentDispatchTest 와 같은 정리 방식. */
class MessagePushDeliveryTest extends IntegrationTestBase {

  @MockitoBean PushGateway gateway;
  @Autowired DSLContext dsl;
  @Autowired DmService dmService;
  @Autowired MessageService messageService;
  @Autowired PushSubscriptionRepository subs;

  final List<Long> users = new ArrayList<>();

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (users.isEmpty()) return;
    dsl.deleteFrom(CHANNEL).where(CHANNEL.CREATED_BY.in(users)).execute();
    dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    users.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "mpd_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Mpd" + s)
            .set(USER.EMAIL, "mpd_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    users.add(id);
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  @Test
  void dm_commit_deliversPushToOtherParticipant() {
    long me = seedUser();
    long you = seedUser();
    String ep = "https://203.0.113.10/push/" + UUID.randomUUID();
    subs.upsert(
        you,
        ep,
        EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) EcKeys.generate().getPublic())),
        EcKeys.b64e(new byte[16]),
        null);
    when(gateway.deliver(eq(ep), any(), anyMap())).thenReturn(201);

    long dmId = dmService.createOrGet(me, List.of(you)).dm().id();
    messageService.create(me, dmId, new CreateMessageRequest("안녕하세요"));

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> verify(gateway).deliver(eq(ep), any(), anyMap()));
  }
}
```

- [ ] **Step 6: 전체 회귀**

Run: `./gradlew test --tests 'com.workplace.messaging.*' --tests 'com.workplace.notify.*' --tests 'com.workplace.architecture.*'`
Expected: PASS. 이후 `./gradlew test` 전체 1회(시간 소요) 실행해 다른 모듈 회귀 없음을 확인.

- [ ] **Step 7: 포맷 + 커밋(승인 후)**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/messaging src/main/java/com/workplace/notify src/test/java/com/workplace/messaging src/test/java/com/workplace/notify
git commit -m "feat(api/messaging): DM 과 멘션 메시지를 Web Push 로 발송

- #866
- 메시지 작성 시 DM 상대와 채널 멤버인 멘션 대상을 계산해 푸시 요청 이벤트를 발행한다
- 작성자 본인과 AI 에이전트는 제외하고 DM 과 멘션이 겹치면 한 번만 보낸다
- 알림 본문은 멘션 토큰을 이름으로 바꾼 120자 미리보기를 쓴다"
```

---

## Self-Review 결과

- **Spec 커버리지:** §3 데이터(Task 1), §3 VAPID(Task 3), §4 API·설정·SSRF(Task 4·5), §5.1 인박스(Task 7), §5.2 메시지(Task 8), §5.3 payload·tag·헤더·preview(Task 6·7·8), §5.4 실패 처리(Task 6), §7 보안(Task 3·4·5), §8 백엔드 테스트(각 Task). §6 프론트·§8 E2E·실기기 스모크는 프론트 계획 담당.
- **타입 일관성:** `PushMessage` 8필드, `PushSender.send(Collection<Long>, PushMessage)`, `InboxPushRequestedEvent` 6필드, `MessagePushRequestedEvent` 11필드를 모든 Task 에서 동일하게 사용.
- **착수 시 재확인 항목(코드베이스 의존):** jOOQ 생성 타입(`PUSH_VAPID_KEY.ID` Short, `ISSUE.NUMBER` Integer), `CALENDAR_EVENT` soft-delete 컬럼 유무, jjwt `audience().single()`, 미인증 응답 코드(401/403), `ChannelService.create` visibility 값.
