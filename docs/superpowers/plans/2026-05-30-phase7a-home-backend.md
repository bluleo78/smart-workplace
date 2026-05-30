# Phase 7a — 홈 백엔드 기반 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 컴포저(7b/7c/7d)가 의존하는 백엔드 데이터/쿼리 기반을 만든다 — `assignee=me` 검색 리터럴, `/me/activity` 활동 피드, 홈 AI Chat 세션 모델 + CRUD.

**Architecture:** workplace-api(Spring Boot + jOOQ) 에 (1) 기존 `IssueSearchService` 에 `me` 토큰 치환 추가, (2) 신규 `com.workplace.home` 모듈(activity + session: controller/service/repository/dto/exception), (3) Flyway V17 마이그레이션(`home_session`, `home_message`) 을 더한다. AI/ai-agent 의존 없음 — 순수 데이터/쿼리.

**Tech Stack:** Java 21, Spring Boot 3.4, jOOQ(코드젠 `src/main/generated`), Flyway, Postgres(dev 5434/test 5435), JUnit5 + AssertJ + Mockito, Lombok.

**Issue:** #46 · **Spec:** `docs/superpowers/specs/2026-05-30-ai-native-home-design.md` (§4.1, §7, §9)

**선행 조건:** 로컬 DB 기동 — `pnpm db:up` (jOOQ 코드젠과 통합테스트에 필요).

---

## File Structure (이 플랜이 만들거나 고치는 파일)

**Modify:**
- `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueSearchService.java` — `parse()` 에 `me` 치환

**Create — Flyway:**
- `apps/workplace-api/src/main/resources/db/migration/V17__home_ai.sql`

**Create — `com.workplace.home` 모듈:**
- `home/dto/ActivityEntryResponse.java`
- `home/dto/HomeSessionResponse.java`, `home/dto/HomeSessionSummary.java`, `home/dto/HomeMessageResponse.java`
- `home/repository/HomeActivityRepository.java`
- `home/repository/HomeSessionRepository.java`, `home/repository/HomeMessageRepository.java`
- `home/repository/CursorCodec.java` (커서 인코딩 공용)
- `home/service/HomeActivityService.java`, `home/service/HomeSessionService.java`
- `home/controller/HomeActivityController.java`, `home/controller/HomeSessionController.java`
- `home/exception/HomeSessionNotFoundException.java`

**Create — 테스트:**
- `issue/service/IssueSearchAssigneeMeTest.java`
- `home/service/HomeActivityServiceTest.java`
- `home/service/HomeSessionServiceTest.java`
- `home/controller/HomeSessionControllerTest.java`

각 파일은 단일 책임: activity(읽기 전용 피드)와 session(대화 영속)을 같은 `home` 모듈 안에서 분리.

---

## Task 1: `assignee=me` 검색 리터럴

`IssueSearchService.parse()` 는 현재 `assignee` CSV 토큰을 숫자 userId 로만 변환한다(`"null"` 은 미할당). `"me"` 토큰을 호출자 ID 로 치환한다. `parse()` 는 private 이고 호출자는 `search(Long callerId, …)` 이므로 `callerId` 를 `parse()` 로 전달한다.

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueSearchService.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/service/IssueSearchAssigneeMeTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`apps/workplace-api/src/test/java/com/workplace/issue/service/IssueSearchAssigneeMeTest.java`:

```java
package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.service.ChatFixtures;
import com.workplace.support.IntegrationTestBase;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** assignee=me 리터럴이 호출자 ID 로 치환되는지 검증. */
@Transactional
class IssueSearchAssigneeMeTest extends IntegrationTestBase {

  @Autowired IssueSearchService searchService;
  @Autowired ChatFixtures fx;

  @Test
  void assigneeMe_returnsIssuesAssignedToCaller() {
    // fx.setup(): reporter 가 프로젝트/이슈 생성, assignee 사용자가 그 이슈에 배정됨.
    ChatFixtures.Setup s = fx.setup();

    // 배정자(assignee) 관점: assignee=me → 본인이 배정된 이슈 1건.
    var asAssignee =
        searchService.search(s.assigneeId(), s.projectKey(), Map.of("assignee", "me"));
    assertThat(asAssignee.items()).hasSize(1);

    // reporter 는 그 이슈의 배정자가 아님 → assignee=me 결과 0건.
    var asReporter =
        searchService.search(s.reporterId(), s.projectKey(), Map.of("assignee", "me"));
    assertThat(asReporter.items()).isEmpty();
  }
}
```

> 참고: `ChatFixtures` 는 `@Component` 라 패키지 무관하게 `@Autowired` 가능. `setup()` 은 reporter/assignee/watcher 사용자 + 프로젝트 + 이슈(assignee 배정)를 생성한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.issue.service.IssueSearchAssigneeMeTest"`
Expected: FAIL — `asAssignee.items()` 가 비어 있음(현재 `"me"` 토큰은 NumberFormatException 으로 무시됨).

- [ ] **Step 3: 최소 구현**

`IssueSearchService.java` 에서 `parse` 메서드 시그니처를 `callerId` 받도록 바꾸고, `search()` 의 호출부와 토큰 루프를 수정한다.

`search(...)` 내부의 `parse(params)` 호출을 `parse(callerId, params)` 로 변경. 그리고 `parse` 시그니처:

```java
// 변경 전: private IssueSearchQuery parse(Map<String, String> p) {
private IssueSearchQuery parse(Long callerId, Map<String, String> p) {
```

assignee 토큰 루프(현재 라인 ~114-126)를 다음으로 교체:

```java
var assigneeTokens = csv(p.get("assignee"));
List<Long> assigneeIds = new ArrayList<>();
boolean includeUnassigned = false;
for (String tok : assigneeTokens) {
  if ("me".equalsIgnoreCase(tok)) {
    // 7a: 'me' 리터럴 → 호출자 본인. 홈 컴포저가 사용자 ID 를 몰라도 "내 담당" 조회 가능.
    assigneeIds.add(callerId);
  } else if ("null".equalsIgnoreCase(tok)) {
    includeUnassigned = true;
  } else {
    try {
      assigneeIds.add(Long.parseLong(tok));
    } catch (NumberFormatException e) {
      // 알 수 없는 토큰은 무시 — 비어 있으면 필터 미적용
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.issue.service.IssueSearchAssigneeMeTest"`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/issue/service/IssueSearchService.java \
        apps/workplace-api/src/test/java/com/workplace/issue/service/IssueSearchAssigneeMeTest.java
git commit -m "feat(api): 이슈 검색 assignee=me 리터럴 — #46"
```

---

## Task 2: `/me/activity` 활동 피드

내가 배정(assignee)되었거나 워치(watcher)하는 이슈들의 `issue_history` 를 교차 조회해 최신순으로 반환한다. `actorKind`(HUMAN/AGENT) 필터로 "AI 가 한 일"을 분리할 수 있다. 신규 마이그레이션 불필요(기존 `issue_history`, 인덱스 `idx_issue_history_issue_created` 활용).

**Files:**
- Create: `home/repository/CursorCodec.java`, `home/dto/ActivityEntryResponse.java`, `home/repository/HomeActivityRepository.java`, `home/service/HomeActivityService.java`, `home/controller/HomeActivityController.java`
- Test: `home/service/HomeActivityServiceTest.java`

- [ ] **Step 1: 커서 코덱 작성 (공용)**

`apps/workplace-api/src/main/java/com/workplace/home/repository/CursorCodec.java`:

```java
package com.workplace.home.repository;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;

/** 키셋 페이지네이션 커서 인코딩: (createdAt, id) 튜플을 base64 문자열로. id 는 bigint/uuid 공용 String. */
public final class CursorCodec {
  private CursorCodec() {}

  public static String encode(Instant createdAt, String id) {
    String raw = createdAt.toEpochMilli() + ":" + id;
    return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 디코드 실패/공백 시 null. */
  public static Decoded decode(String cursor) {
    if (cursor == null || cursor.isBlank()) return null;
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      int i = raw.indexOf(':');
      if (i < 0) return null;
      return new Decoded(Instant.ofEpochMilli(Long.parseLong(raw.substring(0, i))), raw.substring(i + 1));
    } catch (RuntimeException e) {
      return null;
    }
  }

  public record Decoded(Instant createdAt, String id) {}
}
```

- [ ] **Step 2: 응답 DTO 작성**

`apps/workplace-api/src/main/java/com/workplace/home/dto/ActivityEntryResponse.java`:

```java
package com.workplace.home.dto;

import java.time.Instant;

/** 활동 피드 1건 — 이슈 컨텍스트 + 행위자 + 이벤트. */
public record ActivityEntryResponse(
    Long id,
    Long issueId,
    String projectKey,
    Integer issueNumber,
    String issueTitle,
    Long actorId,
    String actorName,
    String actorKind,
    String eventType,
    Instant createdAt) {}
```

- [ ] **Step 3: 실패 테스트 작성**

`apps/workplace-api/src/test/java/com/workplace/home/service/HomeActivityServiceTest.java`:

```java
package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.service.ChatFixtures;
import com.workplace.home.dto.ActivityEntryResponse;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 내 담당/워치 이슈의 history 교차 조회 + actorKind 필터 + 소유 범위 검증. */
@Transactional
class HomeActivityServiceTest extends IntegrationTestBase {

  @Autowired HomeActivityService activityService;
  @Autowired IssueHistoryRepository historyRepo;
  @Autowired ChatFixtures fx;
  @Autowired DSLContext dsl;

  private long insertAgent(String username) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, username)
        .set(USER.EMAIL, username + "@example.com")
        .set(USER.KIND, "AGENT")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void activity_assignee_seesHistory_filteredByActorKind() {
    ChatFixtures.Setup s = fx.setup(); // 이슈는 assignee 배정됨
    long agentId = insertAgent("agent" + s.issueId());

    historyRepo.insert(s.issueId(), s.reporterId(), "STATUS", "TODO", "IN_PROGRESS"); // HUMAN
    historyRepo.insert(s.issueId(), agentId, "COMMENT", null, null); // AGENT

    // assignee 관점: 두 이벤트 모두 보임.
    List<ActivityEntryResponse> all = activityService.recent(s.assigneeId(), null, null, 20).items();
    assertThat(all).hasSize(2);
    assertThat(all.get(0).createdAt()).isAfterOrEqualTo(all.get(1).createdAt()); // 최신순

    // actorKind=AGENT 필터: AGENT 이벤트만.
    List<ActivityEntryResponse> agentOnly =
        activityService.recent(s.assigneeId(), "AGENT", null, 20).items();
    assertThat(agentOnly).hasSize(1);
    assertThat(agentOnly.get(0).actorKind()).isEqualTo("AGENT");

    // 외부인(배정/워치 아님): 비어 있음.
    assertThat(activityService.recent(s.outsiderId(), null, null, 20).items()).isEmpty();
  }
}
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.home.service.HomeActivityServiceTest"`
Expected: FAIL — `HomeActivityService` / `recent(...)` 미존재(컴파일 에러).

- [ ] **Step 5: 리포지토리 구현**

`apps/workplace-api/src/main/java/com/workplace/home/repository/HomeActivityRepository.java`:

```java
package com.workplace.home.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.home.dto.ActivityEntryResponse;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** 내 담당/워치 이슈의 issue_history 교차 조회(읽기 전용). */
@Repository
@RequiredArgsConstructor
public class HomeActivityRepository {
  private final DSLContext dsl;

  private ActivityEntryResponse map(Record r) {
    OffsetDateTime created = r.get(ISSUE_HISTORY.CREATED_AT);
    return new ActivityEntryResponse(
        r.get(ISSUE_HISTORY.ID),
        r.get(ISSUE_HISTORY.ISSUE_ID),
        r.get(PROJECT.KEY),
        r.get(ISSUE.NUMBER),
        r.get(ISSUE.TITLE),
        r.get(ISSUE_HISTORY.ACTOR_ID),
        r.get(USER.NAME),
        r.get(USER.KIND),
        r.get(ISSUE_HISTORY.EVENT_TYPE),
        created != null ? created.toInstant() : null);
  }

  /**
   * userId 가 배정자이거나 워처인 이슈들의 history 를 최신순으로. actorKind 가 있으면 행위자 kind 필터.
   * cursor 가 있으면 (created_at, id) 키셋으로 그 이전 페이지.
   */
  public List<ActivityEntryResponse> findRecent(
      Long userId, String actorKind, CursorCodec.Decoded cursor, int limit) {
    // 내 이슈 id 집합 = 배정 ∪ 워치
    var myIssues =
        DSL.selectDistinct(ISSUE_ASSIGNEE.ISSUE_ID)
            .from(ISSUE_ASSIGNEE)
            .where(ISSUE_ASSIGNEE.USER_ID.eq(userId))
            .union(
                DSL.select(ISSUE_WATCHER.ISSUE_ID)
                    .from(ISSUE_WATCHER)
                    .where(ISSUE_WATCHER.USER_ID.eq(userId)));

    Condition where = ISSUE_HISTORY.ISSUE_ID.in(myIssues);
    if (actorKind != null && !actorKind.isBlank()) {
      where = where.and(USER.KIND.eq(actorKind));
    }
    if (cursor != null) {
      // 키셋: created_at 이 더 과거이거나, 같으면 id 가 더 작은 것
      where =
          where.and(
              DSL.row(ISSUE_HISTORY.CREATED_AT, ISSUE_HISTORY.ID)
                  .lessThan(OffsetDateTime.ofInstant(cursor.createdAt(), java.time.ZoneOffset.UTC),
                      Long.parseLong(cursor.id())));
    }

    return dsl.select(
            ISSUE_HISTORY.ID,
            ISSUE_HISTORY.ISSUE_ID,
            PROJECT.KEY,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            ISSUE_HISTORY.ACTOR_ID,
            USER.NAME,
            USER.KIND,
            ISSUE_HISTORY.EVENT_TYPE,
            ISSUE_HISTORY.CREATED_AT)
        .from(ISSUE_HISTORY)
        .join(ISSUE).on(ISSUE.ID.eq(ISSUE_HISTORY.ISSUE_ID))
        .join(PROJECT).on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .join(USER).on(USER.ID.eq(ISSUE_HISTORY.ACTOR_ID))
        .where(where)
        .orderBy(ISSUE_HISTORY.CREATED_AT.desc(), ISSUE_HISTORY.ID.desc())
        .limit(limit)
        .fetch(this::map);
  }
}
```

> 주의: jOOQ 생성 클래스의 정확한 필드명(`ISSUE.NUMBER`, `ISSUE.TITLE`, `ISSUE.PROJECT_ID`, `PROJECT.KEY`)을 `src/main/generated/com/workplace/jooq/Tables.java` 에서 확인. 다르면 맞춰 수정.

- [ ] **Step 6: 서비스 구현**

`apps/workplace-api/src/main/java/com/workplace/home/service/HomeActivityService.java`:

```java
package com.workplace.home.service;

import com.workplace.home.dto.ActivityEntryResponse;
import com.workplace.home.repository.CursorCodec;
import com.workplace.home.repository.HomeActivityRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 내 활동 피드. */
@Service
@RequiredArgsConstructor
public class HomeActivityService {
  private final HomeActivityRepository repo;

  /** size 는 1..50 클램프(기본 20). 다음 커서는 마지막 항목 (createdAt,id). */
  @Transactional(readOnly = true)
  public Page recent(Long callerId, String actorKind, String cursor, int size) {
    int limit = Math.min(50, Math.max(1, size));
    List<ActivityEntryResponse> items =
        repo.findRecent(callerId, actorKind, CursorCodec.decode(cursor), limit);
    String next =
        items.size() < limit || items.isEmpty()
            ? null
            : CursorCodec.encode(
                items.get(items.size() - 1).createdAt(),
                String.valueOf(items.get(items.size() - 1).id()));
    return new Page(items, next);
  }

  public record Page(List<ActivityEntryResponse> items, String nextCursor) {}
}
```

- [ ] **Step 7: 테스트 통과 확인 (서비스)**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.home.service.HomeActivityServiceTest"`
Expected: PASS

- [ ] **Step 8: 컨트롤러 구현**

`apps/workplace-api/src/main/java/com/workplace/home/controller/HomeActivityController.java`:

```java
package com.workplace.home.controller;

import com.workplace.home.service.HomeActivityService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import lombok.RequiredArgsConstructor;

/** GET /api/v1/me/activity — 내 담당/워치 이슈의 최근 활동(읽기 전용). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/me/activity")
public class HomeActivityController {
  private final HomeActivityService activityService;

  @GetMapping
  public HomeActivityService.Page list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(required = false) String actorKind,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "20") int size) {
    return activityService.recent(callerId, actorKind, cursor, size);
  }
}
```

- [ ] **Step 9: 전체 컴파일·테스트 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.home.*" --tests "com.workplace.issue.service.IssueSearchAssigneeMeTest"`
Expected: PASS

- [ ] **Step 10: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/home/ \
        apps/workplace-api/src/test/java/com/workplace/home/service/HomeActivityServiceTest.java
git commit -m "feat(api): /me/activity 활동 피드 (담당/워치 교차, actorKind 필터) — #46"
```

---

## Task 3: Flyway V17 — 세션 테이블 + jOOQ 코드젠

`home_session`(uuid PK), `home_message`(bigserial PK, role/content/widgets jsonb) 생성. pgcrypto(`gen_random_uuid()`)는 V1 에서 활성화됨.

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V17__home_ai.sql`
- Generated(코드젠 산출): `apps/workplace-api/src/main/generated/com/workplace/jooq/tables/HomeSession.java`, `HomeMessage.java` 등

- [ ] **Step 1: 마이그레이션 작성**

`apps/workplace-api/src/main/resources/db/migration/V17__home_ai.sql`:

```sql
-- V17__home_ai.sql
-- 홈 AI Chat: 사용자별 대화 세션 + 메시지(역할/본문/위젯 스펙). 캔버스 복원 원천.
CREATE TABLE home_session (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_home_session_user ON home_session(user_id, last_message_at DESC);

CREATE TABLE home_message (
  id          BIGSERIAL    PRIMARY KEY,
  session_id  UUID         NOT NULL REFERENCES home_session(id) ON DELETE CASCADE,
  role        VARCHAR(16)  NOT NULL,          -- 'USER' | 'ASSISTANT'
  content     TEXT         NOT NULL,
  widgets     JSONB,                          -- ASSISTANT: [{type,params,layout}] = 캔버스 복원 원천
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_home_message_session ON home_message(session_id, created_at);
```

- [ ] **Step 2: 마이그레이션 적용 + 코드젠**

DB 가 떠 있어야 한다(`pnpm db:up`). bootRun 한 번으로 Flyway 적용 후 jOOQ 재생성:

```bash
cd apps/workplace-api
./gradlew flywayMigrate || ./gradlew bootRun --args='--spring.profiles.active=local' &  # 둘 중 적용되는 방식 사용
# 적용 확인 후:
./gradlew generateJooq
```

> 프로젝트 관례: 마이그레이션은 `bootRun` 이 자동 적용. 적용 후 `./gradlew generateJooq` 로 `src/main/generated/` 재생성. 생성 코드는 커밋 대상.

- [ ] **Step 3: 생성 클래스 확인**

Run: `ls apps/workplace-api/src/main/generated/com/workplace/jooq/tables/ | grep -i home`
Expected: `HomeSession.java`, `HomeMessage.java` (+ `records/HomeSessionRecord.java`, `HomeMessageRecord.java`)

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-api/src/main/resources/db/migration/V17__home_ai.sql \
        apps/workplace-api/src/main/generated/
git commit -m "feat(api): V17 home_session/home_message 마이그레이션 + jOOQ 코드젠 — #46"
```

---

## Task 4: 세션/메시지 리포지토리

`home_session`, `home_message` 접근. UUID PK 는 insert 시 `.returning(...).fetchOne()` 으로 회수. jsonb 는 `org.jooq.JSONB` 로 입출력.

**Files:**
- Create: `home/repository/HomeSessionRepository.java`, `home/repository/HomeMessageRepository.java`
- Test: (Task 5 의 서비스 테스트에서 함께 검증)

- [ ] **Step 1: 세션 리포지토리 작성**

`apps/workplace-api/src/main/java/com/workplace/home/repository/HomeSessionRepository.java`:

```java
package com.workplace.home.repository;

import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.HOME_SESSION;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** home_session 접근. */
@Repository
@RequiredArgsConstructor
public class HomeSessionRepository {
  private final DSLContext dsl;

  public UUID insert(long userId) {
    return dsl.insertInto(HOME_SESSION)
        .set(HOME_SESSION.USER_ID, userId)
        .returning(HOME_SESSION.ID)
        .fetchOne()
        .getId();
  }

  public Optional<Row> findById(UUID id) {
    return dsl.select(
            HOME_SESSION.ID,
            HOME_SESSION.USER_ID,
            HOME_SESSION.TITLE,
            HOME_SESSION.CREATED_AT,
            HOME_SESSION.LAST_MESSAGE_AT)
        .from(HOME_SESSION)
        .where(HOME_SESSION.ID.eq(id))
        .fetchOptional(
            r ->
                new Row(
                    r.get(HOME_SESSION.ID),
                    r.get(HOME_SESSION.USER_ID),
                    r.get(HOME_SESSION.TITLE),
                    r.get(HOME_SESSION.CREATED_AT).toInstant(),
                    r.get(HOME_SESSION.LAST_MESSAGE_AT).toInstant()));
  }

  /** 사용자의 세션을 last_message_at 최신순. cursor 키셋. widgetCount = 세션 내 위젯 총합. */
  public List<Summary> listByUser(long userId, CursorCodec.Decoded cursor, int limit) {
    var widgetCount =
        DSL.field(
            "(select coalesce(sum(jsonb_array_length(widgets)),0) from home_message"
                + " where session_id = home_session.id and widgets is not null)",
            Integer.class);

    Condition where = HOME_SESSION.USER_ID.eq(userId);
    if (cursor != null) {
      where =
          where.and(
              DSL.row(HOME_SESSION.LAST_MESSAGE_AT, HOME_SESSION.ID)
                  .lessThan(
                      OffsetDateTime.ofInstant(cursor.createdAt(), ZoneOffset.UTC),
                      UUID.fromString(cursor.id())));
    }
    return dsl.select(
            HOME_SESSION.ID, HOME_SESSION.TITLE, HOME_SESSION.LAST_MESSAGE_AT, widgetCount)
        .from(HOME_SESSION)
        .where(where)
        .orderBy(HOME_SESSION.LAST_MESSAGE_AT.desc(), HOME_SESSION.ID.desc())
        .limit(limit)
        .fetch(
            r ->
                new Summary(
                    r.get(HOME_SESSION.ID),
                    r.get(HOME_SESSION.TITLE),
                    r.get(HOME_SESSION.LAST_MESSAGE_AT).toInstant(),
                    r.get(widgetCount)));
  }

  /** 메시지 추가 시 호출 — last_message_at/updated_at 갱신, title 이 비어 있으면 설정. */
  public void touch(UUID id, String titleIfNull) {
    var step =
        dsl.update(HOME_SESSION)
            .set(HOME_SESSION.LAST_MESSAGE_AT, DSL.currentOffsetDateTime())
            .set(HOME_SESSION.UPDATED_AT, DSL.currentOffsetDateTime());
    if (titleIfNull != null) {
      step = step.set(HOME_SESSION.TITLE, DSL.coalesce(HOME_SESSION.TITLE, DSL.val(titleIfNull)));
    }
    step.where(HOME_SESSION.ID.eq(id)).execute();
  }

  public int delete(UUID id) {
    return dsl.deleteFrom(HOME_SESSION).where(HOME_SESSION.ID.eq(id)).execute();
  }

  public record Row(
      UUID id, long userId, String title, java.time.Instant createdAt, java.time.Instant lastMessageAt) {}

  public record Summary(
      UUID id, String title, java.time.Instant lastMessageAt, int widgetCount) {}
}
```

- [ ] **Step 2: 메시지 리포지토리 작성**

`apps/workplace-api/src/main/java/com/workplace/home/repository/HomeMessageRepository.java`:

```java
package com.workplace.home.repository;

import static com.workplace.jooq.Tables.HOME_MESSAGE;

import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.springframework.stereotype.Repository;

/** home_message 접근. widgets 는 raw JSON 문자열로 입출력(상위에서 직렬화). */
@Repository
@RequiredArgsConstructor
public class HomeMessageRepository {
  private final DSLContext dsl;

  public long insert(UUID sessionId, String role, String content, String widgetsJson) {
    return dsl.insertInto(HOME_MESSAGE)
        .set(HOME_MESSAGE.SESSION_ID, sessionId)
        .set(HOME_MESSAGE.ROLE, role)
        .set(HOME_MESSAGE.CONTENT, content)
        .set(HOME_MESSAGE.WIDGETS, widgetsJson == null ? null : JSONB.valueOf(widgetsJson))
        .returning(HOME_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  public List<Row> findBySession(UUID sessionId) {
    return dsl.select(
            HOME_MESSAGE.ID,
            HOME_MESSAGE.ROLE,
            HOME_MESSAGE.CONTENT,
            HOME_MESSAGE.WIDGETS,
            HOME_MESSAGE.CREATED_AT)
        .from(HOME_MESSAGE)
        .where(HOME_MESSAGE.SESSION_ID.eq(sessionId))
        .orderBy(HOME_MESSAGE.CREATED_AT.asc(), HOME_MESSAGE.ID.asc())
        .fetch(
            r ->
                new Row(
                    r.get(HOME_MESSAGE.ID),
                    r.get(HOME_MESSAGE.ROLE),
                    r.get(HOME_MESSAGE.CONTENT),
                    r.get(HOME_MESSAGE.WIDGETS) == null ? null : r.get(HOME_MESSAGE.WIDGETS).data(),
                    r.get(HOME_MESSAGE.CREATED_AT).toInstant()));
  }

  public record Row(
      long id, String role, String content, String widgetsJson, java.time.Instant createdAt) {}
}
```

- [ ] **Step 3: 컴파일 확인**

Run: `cd apps/workplace-api && ./gradlew compileJava`
Expected: BUILD SUCCESSFUL (리포지토리가 생성 테이블 `HOME_SESSION`/`HOME_MESSAGE` 를 참조 — Task 3 코드젠 선행 필수).

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/home/repository/
git commit -m "feat(api): home_session/home_message 리포지토리 — #46"
```

---

## Task 5: 세션 서비스 (CRUD + 소유권 + 제목 + 메시지)

**Files:**
- Create: `home/dto/HomeSessionResponse.java`, `home/dto/HomeSessionSummary.java`, `home/dto/HomeMessageResponse.java`, `home/exception/HomeSessionNotFoundException.java`, `home/service/HomeSessionService.java`
- Test: `home/service/HomeSessionServiceTest.java`

- [ ] **Step 1: DTO + 예외 작성**

`apps/workplace-api/src/main/java/com/workplace/home/dto/HomeSessionResponse.java`:

```java
package com.workplace.home.dto;

import java.time.Instant;
import java.util.UUID;

/** 세션 단건(생성 응답 등). */
public record HomeSessionResponse(UUID id, String title, Instant createdAt, Instant lastMessageAt) {}
```

`apps/workplace-api/src/main/java/com/workplace/home/dto/HomeSessionSummary.java`:

```java
package com.workplace.home.dto;

import java.time.Instant;
import java.util.UUID;

/** 세션 목록 1건(스위처용). */
public record HomeSessionSummary(UUID id, String title, Instant lastMessageAt, int widgetCount) {}
```

`apps/workplace-api/src/main/java/com/workplace/home/dto/HomeMessageResponse.java`:

```java
package com.workplace.home.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/** 세션 메시지 1건(복원용). widgets 는 실제 JSON 으로 직렬화. */
public record HomeMessageResponse(
    long id, String role, String content, JsonNode widgets, Instant createdAt) {}
```

`apps/workplace-api/src/main/java/com/workplace/home/exception/HomeSessionNotFoundException.java`:

```java
package com.workplace.home.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 세션이 없거나 호출자 소유가 아님(존재 노출 방지 위해 404 통일). */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class HomeSessionNotFoundException extends RuntimeException {
  public HomeSessionNotFoundException(java.util.UUID id) {
    super("home session not found: " + id);
  }
}
```

- [ ] **Step 2: 실패 테스트 작성**

`apps/workplace-api/src/test/java/com/workplace/home/service/HomeSessionServiceTest.java`:

```java
package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionResponse;
import com.workplace.home.dto.HomeSessionSummary;
import com.workplace.home.exception.HomeSessionNotFoundException;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 세션 CRUD + 소유권 + 제목 자동생성 + 메시지 영속/복원. */
@Transactional
class HomeSessionServiceTest extends IntegrationTestBase {

  @Autowired HomeSessionService sessionService;
  @Autowired DSLContext dsl;

  private long user(String n) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, n)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, n)
        .set(USER.EMAIL, n + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void create_append_listAndRestore() {
    long u = user("u" + System.nanoTime());
    HomeSessionResponse s = sessionService.create(u);

    // 첫 USER 메시지 → 제목 자동 설정, ASSISTANT 메시지에 위젯 영속.
    sessionService.appendMessage(u, s.id(), "USER", "막힌 내 이슈 보여줘", null);
    sessionService.appendMessage(
        u, s.id(), "ASSISTANT", "차단된 이슈 2건이에요", "[{\"type\":\"issue_list\",\"params\":{\"blocked\":true}}]");

    // 목록: 위젯 수 1, 제목 설정됨.
    List<HomeSessionSummary> list = sessionService.list(u, null, 30).items();
    assertThat(list).hasSize(1);
    assertThat(list.get(0).title()).isEqualTo("막힌 내 이슈 보여줘");
    assertThat(list.get(0).widgetCount()).isEqualTo(1);

    // 복원: 순서대로 + assistant 위젯이 실제 JSON.
    List<HomeMessageResponse> msgs = sessionService.getMessages(u, s.id());
    assertThat(msgs).hasSize(2);
    assertThat(msgs.get(0).role()).isEqualTo("USER");
    assertThat(msgs.get(1).widgets().get(0).get("type").asText()).isEqualTo("issue_list");
  }

  @Test
  void getMessages_byNonOwner_throwsNotFound() {
    long owner = user("own" + System.nanoTime());
    long other = user("oth" + System.nanoTime());
    HomeSessionResponse s = sessionService.create(owner);

    assertThatThrownBy(() -> sessionService.getMessages(other, s.id()))
        .isInstanceOf(HomeSessionNotFoundException.class);
  }

  @Test
  void delete_byOwner_removes() {
    long u = user("del" + System.nanoTime());
    HomeSessionResponse s = sessionService.create(u);

    sessionService.delete(u, s.id());

    assertThat(sessionService.list(u, null, 30).items()).isEmpty();
  }
}
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.home.service.HomeSessionServiceTest"`
Expected: FAIL — `HomeSessionService` 미존재(컴파일 에러).

- [ ] **Step 4: 서비스 구현**

`apps/workplace-api/src/main/java/com/workplace/home/service/HomeSessionService.java`:

```java
package com.workplace.home.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionResponse;
import com.workplace.home.dto.HomeSessionSummary;
import com.workplace.home.exception.HomeSessionNotFoundException;
import com.workplace.home.repository.CursorCodec;
import com.workplace.home.repository.HomeMessageRepository;
import com.workplace.home.repository.HomeSessionRepository;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 홈 AI Chat 세션 CRUD + 메시지 영속/복원. 모든 변경은 소유권 검증. */
@Service
@RequiredArgsConstructor
public class HomeSessionService {
  private static final int TITLE_MAX = 40;

  private final HomeSessionRepository sessionRepo;
  private final HomeMessageRepository messageRepo;
  private final ObjectMapper objectMapper;

  @Transactional
  public HomeSessionResponse create(long callerId) {
    UUID id = sessionRepo.insert(callerId);
    var row = sessionRepo.findById(id).orElseThrow(() -> new HomeSessionNotFoundException(id));
    return new HomeSessionResponse(row.id(), row.title(), row.createdAt(), row.lastMessageAt());
  }

  @Transactional(readOnly = true)
  public Page list(long callerId, String cursor, int size) {
    int limit = Math.min(100, Math.max(1, size));
    List<HomeSessionSummary> items =
        sessionRepo.listByUser(callerId, CursorCodec.decode(cursor), limit).stream()
            .map(s -> new HomeSessionSummary(s.id(), s.title(), s.lastMessageAt(), s.widgetCount()))
            .toList();
    String next =
        items.size() < limit || items.isEmpty()
            ? null
            : CursorCodec.encode(
                items.get(items.size() - 1).lastMessageAt(),
                items.get(items.size() - 1).id().toString());
    return new Page(items, next);
  }

  @Transactional(readOnly = true)
  public List<HomeMessageResponse> getMessages(long callerId, UUID sessionId) {
    ensureOwner(callerId, sessionId);
    return messageRepo.findBySession(sessionId).stream()
        .map(m -> new HomeMessageResponse(m.id(), m.role(), m.content(), parse(m.widgetsJson()), m.createdAt()))
        .toList();
  }

  /** 7b(compose)가 호출. USER 첫 메시지면 제목 자동 설정. widgetsJson 은 ASSISTANT 위젯 스펙(nullable). */
  @Transactional
  public long appendMessage(long callerId, UUID sessionId, String role, String content, String widgetsJson) {
    ensureOwner(callerId, sessionId);
    long id = messageRepo.insert(sessionId, role, content, widgetsJson);
    String titleIfNull = "USER".equals(role) ? trimTitle(content) : null;
    sessionRepo.touch(sessionId, titleIfNull);
    return id;
  }

  @Transactional
  public void delete(long callerId, UUID sessionId) {
    ensureOwner(callerId, sessionId);
    sessionRepo.delete(sessionId);
  }

  private void ensureOwner(long callerId, UUID sessionId) {
    var row = sessionRepo.findById(sessionId).orElseThrow(() -> new HomeSessionNotFoundException(sessionId));
    if (row.userId() != callerId) throw new HomeSessionNotFoundException(sessionId);
  }

  private static String trimTitle(String content) {
    String t = content.strip();
    return t.length() <= TITLE_MAX ? t : t.substring(0, TITLE_MAX);
  }

  @SneakyThrows
  private JsonNode parse(String json) {
    return json == null ? null : objectMapper.readTree(json);
  }

  public record Page(List<HomeSessionSummary> items, String nextCursor) {}
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.home.service.HomeSessionServiceTest"`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/home/dto/ \
        apps/workplace-api/src/main/java/com/workplace/home/exception/ \
        apps/workplace-api/src/main/java/com/workplace/home/service/HomeSessionService.java \
        apps/workplace-api/src/test/java/com/workplace/home/service/HomeSessionServiceTest.java
git commit -m "feat(api): 홈 세션 서비스 — CRUD·소유권·제목·메시지 영속 — #46"
```

---

## Task 6: 세션 컨트롤러 + 엔드포인트

`POST/GET /api/v1/home/sessions`, `GET /home/sessions/{id}/messages`, `DELETE /home/sessions/{id}`. 컨트롤러는 인증 principal 만 사용(개인 리소스), 소유권은 서비스에서.

**Files:**
- Create: `home/controller/HomeSessionController.java`
- Test: `home/controller/HomeSessionControllerTest.java`

- [ ] **Step 1: 컨트롤러 구현**

`apps/workplace-api/src/main/java/com/workplace/home/controller/HomeSessionController.java`:

```java
package com.workplace.home.controller;

import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionResponse;
import com.workplace.home.service.HomeSessionService;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 홈 AI Chat 세션 — 목록/생성/복원/삭제. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/home/sessions")
public class HomeSessionController {
  private final HomeSessionService sessionService;

  @PostMapping
  public ResponseEntity<HomeSessionResponse> create(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.status(HttpStatus.CREATED).body(sessionService.create(callerId));
  }

  @GetMapping
  public HomeSessionService.Page list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "30") int size) {
    return sessionService.list(callerId, cursor, size);
  }

  @GetMapping("/{id}/messages")
  public List<HomeMessageResponse> messages(
      @AuthenticationPrincipal Long callerId, @PathVariable UUID id) {
    return sessionService.getMessages(callerId, id);
  }

  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable UUID id) {
    sessionService.delete(callerId, id);
    return ResponseEntity.noContent().build();
  }
}
```

- [ ] **Step 2: 실패 테스트 작성 (@WebMvcTest)**

`apps/workplace-api/src/test/java/com/workplace/home/controller/HomeSessionControllerTest.java`:

```java
package com.workplace.home.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.SecurityConfig;
import com.workplace.home.dto.HomeSessionResponse;
import com.workplace.home.service.HomeSessionService;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.AgentApiKeyRepository;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** 홈 세션 컨트롤러 라우팅/상태코드. */
@WebMvcTest(HomeSessionController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class HomeSessionControllerTest {
  @Autowired MockMvc mockMvc;
  @MockitoBean HomeSessionService sessionService;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of());
  }

  @Test
  void create_201() throws Exception {
    UUID id = UUID.randomUUID();
    when(sessionService.create(1L))
        .thenReturn(new HomeSessionResponse(id, null, Instant.now(), Instant.now()));
    mockMvc
        .perform(post("/api/v1/home/sessions").header("Authorization", "Bearer v"))
        .andExpect(status().isCreated());
    verify(sessionService).create(1L);
  }

  @Test
  void delete_204() throws Exception {
    UUID id = UUID.randomUUID();
    mockMvc
        .perform(delete("/api/v1/home/sessions/" + id).header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(sessionService).delete(eq(1L), eq(id));
  }
}
```

> 참고: `@MockitoBean` 목록은 기존 `ChatThreadMemberControllerTest` 와 동일 패턴(보안 필터가 요구하는 빈). import 경로는 실제 패키지에 맞춰 확인(`com.workplace.global.security.*`, `com.workplace.permission.service.PermissionService`, `com.workplace.user.repository.*`).

- [ ] **Step 3: 테스트 실패 → 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.home.controller.HomeSessionControllerTest"`
Expected: 컨트롤러 구현 후 PASS. (먼저 실패하면 import/빈 경로를 기존 컨트롤러 테스트와 대조해 정정.)

- [ ] **Step 4: 전체 home/issue 테스트 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.home.*" --tests "com.workplace.issue.service.IssueSearchAssigneeMeTest"`
Expected: PASS (전부)

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/home/controller/HomeSessionController.java \
        apps/workplace-api/src/test/java/com/workplace/home/controller/HomeSessionControllerTest.java
git commit -m "feat(api): 홈 세션 컨트롤러 — /api/v1/home/sessions CRUD — #46"
```

---

## 완료 기준 (Definition of Done)

- [ ] `assignee=me` 가 호출자 담당 이슈를 반환(통합 테스트 통과)
- [ ] `GET /api/v1/me/activity` 가 담당/워치 이슈의 history 를 최신순 반환, `actorKind=AGENT` 필터 동작, 비소유 이슈 제외
- [ ] V17 마이그레이션 적용 + jOOQ 코드젠 커밋
- [ ] `POST/GET /api/v1/home/sessions`, `GET /{id}/messages`, `DELETE /{id}` 동작 + 소유권(비소유 404)
- [ ] 메시지 영속 시 첫 USER 메시지로 제목 자동 설정, ASSISTANT 위젯 JSON 복원
- [ ] 전체 빌드 통과: `./gradlew build`
- [ ] (선행) `pnpm db:up` 으로 DB 기동된 상태에서 코드젠/테스트 수행

## 다음 단계

7b(#47, ai-agent home 프로필 + `/home/compose`)는 본 Task 의 `HomeSessionService.appendMessage(...)` 와 `assignee=me`/`/me/activity` 를 소비한다.

## 리스크 / 주의

- **jOOQ 필드명**: `ISSUE.NUMBER/TITLE/PROJECT_ID`, `PROJECT.KEY`, `USER.KIND` 등은 코드젠 산출(`Tables.java`)에서 정확한 상수명 확인 후 사용. 다르면 맞춰 수정(플랜의 가정).
- **마이그레이션은 머지 후 수정 금지** — 정정은 V18 로. checksum 규칙 준수.
- **Spotless**: 커밋 전 `./gradlew spotlessApply` 로 포맷(Google Java Format). 무관 파일 재포맷 시 해당 변경만 스테이징.
- **pre-commit gradle 플레이크**(ProjectConflictException 키 충돌)는 알려진 병렬 테스트 플레이크 — 재시도. (메모리: api-gradle-projectkey-flake)
