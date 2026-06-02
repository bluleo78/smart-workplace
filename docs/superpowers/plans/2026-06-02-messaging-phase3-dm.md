# Messaging Phase 3 (DM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1:1·그룹 DM 을 `kind='DM'` 채널로 도입 — 멤버셋 dedup, find-or-create, DM 사이드바·새 메시지 모달.

**Architecture:** DM 은 별도 도메인이 아니라 `kind='DM'` 채널. `channel`/`channel_member`/`message` 테이블·SSE·메시지 REST 를 전면 재사용. 정렬된 참여자 ID 를 `channel.member_key` 에 저장하고 `kind='DM'` 부분 유니크 인덱스로 dedup·레이스 차단. 1:1 은 타겟 1명 그룹 DM 의 특수 케이스.

**Tech Stack:** Backend — Spring Boot, jOOQ, Flyway, JUnit(@WebMvcTest + IntegrationTestBase). Frontend — React 19 + TS, TanStack Query, shadcn/ui, Playwright(전면 모킹).

**Spec:** [docs/superpowers/specs/2026-06-02-messaging-phase3-dm-design.md](../specs/2026-06-02-messaging-phase3-dm-design.md)

**작업 디렉토리:** 백엔드 `apps/workplace-api`, 프론트 `apps/workplace-web`. 모든 경로는 리포 루트(`/Users/bluleo78/git/smart-workplace`) 기준.

---

## File Structure

**Backend (`apps/workplace-api/src/main`)**
- `resources/db/migration/V22__messaging_dm.sql` — 신규: `member_key` 컬럼 + 부분 유니크 인덱스.
- `java/com/workplace/messaging/dto/DmResponse.java` — 신규: DM 1건(참여자 동봉).
- `java/com/workplace/messaging/dto/DmParticipant.java` — 신규.
- `java/com/workplace/messaging/dto/CreateDmRequest.java` — 신규.
- `java/com/workplace/messaging/exception/InvalidDmRequestException.java` — 신규 → 400.
- `java/com/workplace/messaging/repository/ChannelRepository.java` — 수정: DM 메서드 4개 + `findMyChannels` 에 `kind='CHANNEL'` 필터.
- `java/com/workplace/messaging/service/DmService.java` — 신규: `createOrGet`, `listMyDms`.
- `java/com/workplace/messaging/controller/DmController.java` — 신규: `GET/POST /dms`.
- `java/com/workplace/user/repository/UserRepository.java` — 수정(필요 시): `existsById`.
- `java/com/workplace/global/.../GlobalExceptionHandler.java` — 수정: `InvalidDmRequestException` → 400.

**Backend tests (`apps/workplace-api/src/test`)**
- `java/com/workplace/messaging/repository/ChannelDmRepositoryTest.java` — 신규(IntegrationTestBase).
- `java/com/workplace/messaging/service/DmServiceTest.java` — 신규(IntegrationTestBase).
- `java/com/workplace/messaging/controller/DmControllerTest.java` — 신규(@WebMvcTest).

**Frontend (`apps/workplace-web/src`)**
- `types/messaging.ts` — 수정: `DmParticipant`, `DmResponse`, `CreateDmRequest`.
- `api/messaging.ts` — 수정: `listDms`, `createDm`.
- `hooks/queries/messagingKeys.ts` — 수정: `dms()`.
- `hooks/queries/useMyDms.ts` — 신규.
- `hooks/queries/useCreateDm.ts` — 신규.
- `lib/dm.ts` — 신규: `dmDisplayName`.
- `components/chat/ChannelSidebar.tsx` — 수정: DM 섹션.
- `components/chat/NewDmModal.tsx` — 신규: 다중 선택 참여자 + 시작.
- `components/chat/DmHeader.tsx` — 신규.
- `pages/chat/DmPage.tsx` — 신규.
- `App.tsx` — 수정: `/chat/dms/:id` 라우트.

**Frontend tests (`apps/workplace-web/e2e`)**
- `factories/messaging.factory.ts` — 수정: `createDm`, `createDmParticipant`.
- `pages/chat-dm.spec.ts` — 신규.

---

## Task 1: 마이그레이션 — member_key 컬럼 + 부분 유니크 인덱스

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V22__messaging_dm.sql`

- [ ] **Step 1: 마이그레이션 작성**

`apps/workplace-api/src/main/resources/db/migration/V22__messaging_dm.sql`:
```sql
-- Messaging Phase 3 (DM): DM 채널 정체성 키.
-- 정렬된 참여자 ID 조합("3,7,12")을 채널 행에 저장 → 멤버셋 dedup·레이스 차단.
-- DM 전용 컬럼: kind='CHANNEL' 행은 NULL, kind='DM' 행만 값.
ALTER TABLE channel ADD COLUMN member_key VARCHAR(255);

-- kind='DM' 행에 한해 member_key 유니크 → 동일 멤버셋 중복 생성(동시 요청 포함) 차단.
CREATE UNIQUE INDEX uq_channel_dm_member_key ON channel (member_key) WHERE kind = 'DM';
```

- [ ] **Step 2: 마이그레이션 적용 + jOOQ 코드젠**

`pnpm db:up` 으로 DB 기동(이미 떠 있으면 생략). 그 다음:
```bash
cd apps/workplace-api && ./gradlew bootRun --args='--spring.profiles.active=local' &
# 부팅 로그에 "Migrating schema ... to version 22" 확인 후 종료(Ctrl-C), 또는 별도로:
./gradlew generateJooq
```
Expected: `src/main/generated/.../tables/Channel.java` 에 `MEMBER_KEY` 필드 추가됨.

- [ ] **Step 3: 컬럼·인덱스 검증**

Run:
```bash
docker exec smart-workplace-db-1 psql -U app -d workplace -c "\d channel"
```
Expected: `member_key | character varying(255)` 컬럼 + `uq_channel_dm_member_key` 부분 인덱스 존재.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-api/src/main/resources/db/migration/V22__messaging_dm.sql apps/workplace-api/src/main/generated
git commit -m "feat(messaging): V22 — DM member_key 컬럼 + 부분 유니크 인덱스"
```

---

## Task 2: DTO + 예외 + 예외 매핑

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/messaging/dto/DmParticipant.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/messaging/dto/DmResponse.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/messaging/dto/CreateDmRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/messaging/exception/InvalidDmRequestException.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/global/.../GlobalExceptionHandler.java`

- [ ] **Step 1: DmParticipant 작성**

`dto/DmParticipant.java`:
```java
package com.workplace.messaging.dto;

/** DM 참여자 1명. kind 는 user.kind(HUMAN/AGENT). */
public record DmParticipant(Long userId, String name, String kind) {}
```

- [ ] **Step 2: DmResponse 작성**

`dto/DmResponse.java`:
```java
package com.workplace.messaging.dto;

import java.time.Instant;
import java.util.List;

/**
 * DM 1건 요약. name 이 없는 DM 의 표시를 위해 참여자(본인 포함)를 동봉한다.
 *
 * @param participants 본인 포함 전원 — 프론트가 표시명 파생
 * @param lastMessageAt 최근 메시지 시각(메시지 0건이면 null)
 */
public record DmResponse(
    Long id, List<DmParticipant> participants, Instant lastMessageAt, Instant createdAt) {}
```

- [ ] **Step 3: CreateDmRequest 작성**

`dto/CreateDmRequest.java`:
```java
package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotEmpty;
import java.util.List;

/** DM 생성 요청. userIds 는 본인 제외 타겟(서비스에서 caller 합집합·검증). */
public record CreateDmRequest(@NotEmpty List<Long> userIds) {}
```

- [ ] **Step 4: InvalidDmRequestException 작성**

`exception/InvalidDmRequestException.java`:
```java
package com.workplace.messaging.exception;

/** 잘못된 DM 생성 요청(빈 타겟·self-only·>8명·미존재 유저). → 400. */
public class InvalidDmRequestException extends RuntimeException {
  public InvalidDmRequestException(String message) {
    super(message);
  }
}
```

- [ ] **Step 5: GlobalExceptionHandler 에 매핑 추가**

`GlobalExceptionHandler.java` 의 messaging 예외 핸들러들 옆(예: `ChannelNotFoundException` 핸들러 근처)에 추가. import 도 함께 추가(`com.workplace.messaging.exception.InvalidDmRequestException`):
```java
  /** 잘못된 DM 생성 요청 → 400. */
  @ExceptionHandler(InvalidDmRequestException.class)
  public ResponseEntity<ErrorResponse> handleInvalidDmRequest(
      InvalidDmRequestException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
  }
```
> 기존 핸들러의 정확한 시그니처(`buildError(...)` 인자 순서)는 파일에서 확인해 동일하게 맞춘다.

- [ ] **Step 6: 컴파일 확인**

Run: `cd apps/workplace-api && ./gradlew compileJava`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/messaging/dto apps/workplace-api/src/main/java/com/workplace/messaging/exception apps/workplace-api/src/main/java/com/workplace/global
git commit -m "feat(messaging): DM DTO(DmResponse/DmParticipant/CreateDmRequest) + InvalidDmRequestException(400)"
```

---

## Task 3: ChannelRepository — DM 메서드 + findMyChannels kind 필터

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/messaging/repository/ChannelRepository.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/messaging/repository/ChannelDmRepositoryTest.java`

> 먼저 기존 messaging 통합 테스트(예: `apps/workplace-api/src/test/java/com/workplace/messaging/` 하위에서 `IntegrationTestBase` 를 상속하고 DB 에 유저·채널을 시딩하는 리포지토리/서비스 테스트)를 1개 읽어 **유저 시딩 헬퍼 패턴**(userRepository 또는 SQL insert)을 그대로 차용한다. 아래 테스트의 `seedUser(...)`/`seedDm(...)` 는 그 패턴으로 채운다.

- [ ] **Step 1: 회귀 테스트 작성 — findMyChannels 가 DM 을 제외**

`apps/workplace-api/src/test/java/com/workplace/messaging/repository/ChannelDmRepositoryTest.java`:
```java
package com.workplace.messaging.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.IntegrationTestBase;
import com.workplace.messaging.dto.DmResponse;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** DM 리포지토리 메서드 + 채널 목록 DM 누수 회귀 테스트(실제 DB). */
class ChannelDmRepositoryTest extends IntegrationTestBase {

  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;

  // 기존 messaging 통합 테스트의 시딩 패턴을 그대로 차용해 채운다.
  // long seedUser(String name) { ... }  // "user" 행 insert 후 id 반환

  @Test
  void findMyChannels_excludesDm() {
    long u1 = seedUser("alice");
    long u2 = seedUser("bob");
    // 일반 채널 1개 (u1 OWNER)
    long ch = channelRepo.insert("일반", "PUBLIC", u1);
    memberRepo.add(ch, u1, "OWNER");
    // DM 1개 (u1, u2)
    long dm = channelRepo.insertDm("%d,%d".formatted(Math.min(u1, u2), Math.max(u1, u2)), u1);
    memberRepo.add(dm, u1, "MEMBER");
    memberRepo.add(dm, u2, "MEMBER");

    var mine = channelRepo.findMyChannels(u1);

    assertThat(mine).extracting("id").containsExactly(ch); // DM 미포함
  }

  @Test
  void findDmIdByMemberKey_findsExistingDm() {
    long u1 = seedUser("a");
    long u2 = seedUser("b");
    String key = "%d,%d".formatted(Math.min(u1, u2), Math.max(u1, u2));
    long dm = channelRepo.insertDm(key, u1);

    assertThat(channelRepo.findDmIdByMemberKey(key)).contains(dm);
    assertThat(channelRepo.findDmIdByMemberKey("999,1000")).isEmpty();
  }

  @Test
  void findMyDms_returnsParticipants() {
    long u1 = seedUser("alice");
    long u2 = seedUser("bob");
    long dm = channelRepo.insertDm("%d,%d".formatted(Math.min(u1, u2), Math.max(u1, u2)), u1);
    memberRepo.add(dm, u1, "MEMBER");
    memberRepo.add(dm, u2, "MEMBER");

    List<DmResponse> dms = channelRepo.findMyDms(u1);

    assertThat(dms).hasSize(1);
    assertThat(dms.get(0).participants()).extracting("userId").containsExactlyInAnyOrder(u1, u2);
    assertThat(dms.get(0).lastMessageAt()).isNull(); // 메시지 0건
  }
}
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.messaging.repository.ChannelDmRepositoryTest"`
Expected: FAIL — `insertDm`/`findDmIdByMemberKey`/`findMyDms` 미정의 컴파일 에러.

- [ ] **Step 3: findMyChannels 에 kind 필터 추가**

`ChannelRepository.findMyChannels` 의 `.where(CHANNEL.ARCHIVED_AT.isNull())` 를 다음으로 교체(DM 누수 차단):
```java
        .where(CHANNEL.ARCHIVED_AT.isNull().and(CHANNEL.KIND.eq("CHANNEL")))
```

- [ ] **Step 4: DM 리포지토리 메서드 추가**

`ChannelRepository` 클래스 안에 추가. 상단 import 에 `com.workplace.messaging.dto.DmParticipant`, `com.workplace.messaging.dto.DmResponse`, `static com.workplace.jooq.Tables.MESSAGE`, `static com.workplace.jooq.Tables.USER`, `java.util.Map`, `java.util.Comparator` 추가:
```java
  /** kind='DM' AND member_key=? 인 DM 채널 id. */
  public java.util.Optional<Long> findDmIdByMemberKey(String memberKey) {
    return dsl.select(CHANNEL.ID)
        .from(CHANNEL)
        .where(CHANNEL.KIND.eq("DM").and(CHANNEL.MEMBER_KEY.eq(memberKey)))
        .fetchOptional(CHANNEL.ID);
  }

  /** DM 채널 생성(name=null, visibility=PRIVATE). id 반환. */
  public long insertDm(String memberKey, long createdBy) {
    return dsl.insertInto(CHANNEL)
        .set(CHANNEL.KIND, "DM")
        .set(CHANNEL.VISIBILITY, "PRIVATE")
        .set(CHANNEL.MEMBER_KEY, memberKey)
        .set(CHANNEL.CREATED_BY, createdBy)
        .returning(CHANNEL.ID)
        .fetchOne()
        .getId();
  }

  /** caller 가 멤버인 단일 DM 상세(참여자 동봉). 비멤버/비DM 이면 empty. */
  public java.util.Optional<DmResponse> findDmDetail(long channelId, long callerId) {
    boolean isMember =
        dsl.fetchExists(
            dsl.selectOne()
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER
                        .CHANNEL_ID
                        .eq(channelId)
                        .and(CHANNEL_MEMBER.USER_ID.eq(callerId))));
    if (!isMember) return java.util.Optional.empty();
    var ch =
        dsl.select(
                CHANNEL.ID,
                CHANNEL.CREATED_AT,
                dsl.select(org.jooq.impl.DSL.max(MESSAGE.CREATED_AT))
                    .from(MESSAGE)
                    .where(MESSAGE.CHANNEL_ID.eq(CHANNEL.ID))
                    .asField("last_message_at"))
            .from(CHANNEL)
            .where(CHANNEL.ID.eq(channelId).and(CHANNEL.KIND.eq("DM")))
            .fetchOne();
    if (ch == null) return java.util.Optional.empty();
    List<DmParticipant> parts = participantsOf(channelId);
    java.time.OffsetDateTime last = ch.get("last_message_at", java.time.OffsetDateTime.class);
    java.time.OffsetDateTime created = ch.get(CHANNEL.CREATED_AT);
    return java.util.Optional.of(
        new DmResponse(
            ch.get(CHANNEL.ID),
            parts,
            last == null ? null : last.toInstant(),
            created == null ? null : created.toInstant()));
  }

  /** caller 가 멤버인 DM 목록(참여자 동봉). 최근 메시지 → 생성 시각 내림차순. */
  public List<DmResponse> findMyDms(long callerId) {
    var rows =
        dsl.select(
                CHANNEL.ID,
                CHANNEL.CREATED_AT,
                dsl.select(org.jooq.impl.DSL.max(MESSAGE.CREATED_AT))
                    .from(MESSAGE)
                    .where(MESSAGE.CHANNEL_ID.eq(CHANNEL.ID))
                    .asField("last_message_at"))
            .from(CHANNEL)
            .join(CHANNEL_MEMBER)
            .on(
                CHANNEL_MEMBER
                    .CHANNEL_ID
                    .eq(CHANNEL.ID)
                    .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
            .where(CHANNEL.KIND.eq("DM"))
            .fetch();
    List<Long> ids = rows.map(r -> r.get(CHANNEL.ID));
    if (ids.isEmpty()) return List.of();
    // 참여자 일괄 조회(N+1 회피).
    Map<Long, List<DmParticipant>> byChannel =
        dsl.select(CHANNEL_MEMBER.CHANNEL_ID, USER.ID, USER.NAME, USER.KIND)
            .from(CHANNEL_MEMBER)
            .join(USER)
            .on(USER.ID.eq(CHANNEL_MEMBER.USER_ID))
            .where(CHANNEL_MEMBER.CHANNEL_ID.in(ids))
            .fetchGroups(
                r -> r.get(CHANNEL_MEMBER.CHANNEL_ID),
                r -> new DmParticipant(r.get(USER.ID), r.get(USER.NAME), r.get(USER.KIND)));
    return rows.stream()
        .map(
            r -> {
              java.time.OffsetDateTime last =
                  r.get("last_message_at", java.time.OffsetDateTime.class);
              java.time.OffsetDateTime created = r.get(CHANNEL.CREATED_AT);
              return new DmResponse(
                  r.get(CHANNEL.ID),
                  byChannel.getOrDefault(r.get(CHANNEL.ID), List.of()),
                  last == null ? null : last.toInstant(),
                  created == null ? null : created.toInstant());
            })
        .sorted(
            Comparator.comparing(
                    (DmResponse d) ->
                        d.lastMessageAt() != null ? d.lastMessageAt() : d.createdAt(),
                    Comparator.nullsLast(Comparator.naturalOrder()))
                .reversed())
        .toList();
  }

  /** 채널 참여자(user 조인) — DM 표시명 파생용. */
  private List<DmParticipant> participantsOf(long channelId) {
    return dsl.select(USER.ID, USER.NAME, USER.KIND)
        .from(CHANNEL_MEMBER)
        .join(USER)
        .on(USER.ID.eq(CHANNEL_MEMBER.USER_ID))
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId))
        .fetch(r -> new DmParticipant(r.get(USER.ID), r.get(USER.NAME), r.get(USER.KIND)));
  }
```
> `USER.KIND` 가 jOOQ enum 타입으로 생성된 경우 `r.get(USER.KIND).toString()`/`.getLiteral()` 등으로 String 변환이 필요할 수 있다. 기존 `ChannelMemberRepository.listMembers` 가 `user.kind` 를 String 으로 매핑하는 방식을 그대로 따른다.

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.messaging.repository.ChannelDmRepositoryTest"`
Expected: PASS (3 tests).

- [ ] **Step 6: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/messaging/repository/ChannelRepository.java apps/workplace-api/src/test/java/com/workplace/messaging/repository/ChannelDmRepositoryTest.java
git commit -m "feat(messaging): ChannelRepository DM 메서드 + findMyChannels kind 필터(DM 누수 차단)"
```

---

## Task 4: DmService — createOrGet + listMyDms

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/messaging/service/DmService.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/user/repository/UserRepository.java` (필요 시 `existsById`)
- Test: `apps/workplace-api/src/test/java/com/workplace/messaging/service/DmServiceTest.java`

- [ ] **Step 1: 테스트 작성 — dedup·검증**

`apps/workplace-api/src/test/java/com/workplace/messaging/service/DmServiceTest.java`:
```java
package com.workplace.messaging.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.IntegrationTestBase;
import com.workplace.messaging.exception.InvalidDmRequestException;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** DM find-or-create·검증 통합 테스트(실제 DB). */
class DmServiceTest extends IntegrationTestBase {

  @Autowired DmService dmService;

  // 기존 messaging 통합 테스트의 시딩 패턴 차용.
  // long seedUser(String name) { ... }

  @Test
  void createOrGet_oneToOne_isDeduped() {
    long a = seedUser("alice");
    long b = seedUser("bob");

    var first = dmService.createOrGet(a, List.of(b));
    var again = dmService.createOrGet(a, List.of(b));
    var reversed = dmService.createOrGet(b, List.of(a)); // 순서 무관

    assertThat(first.created()).isTrue();
    assertThat(again.created()).isFalse();
    assertThat(again.dm().id()).isEqualTo(first.dm().id());
    assertThat(reversed.dm().id()).isEqualTo(first.dm().id());
  }

  @Test
  void createOrGet_group_dedupBySet() {
    long a = seedUser("a");
    long b = seedUser("b");
    long c = seedUser("c");

    var g1 = dmService.createOrGet(a, List.of(b, c));
    var g1again = dmService.createOrGet(a, List.of(c, b)); // 같은 셋
    var g2 = dmService.createOrGet(a, List.of(b)); // 다른 셋

    assertThat(g1again.dm().id()).isEqualTo(g1.dm().id());
    assertThat(g2.dm().id()).isNotEqualTo(g1.dm().id());
  }

  @Test
  void createOrGet_rejectsInvalid() {
    long a = seedUser("a");
    assertThatThrownBy(() -> dmService.createOrGet(a, List.of()))
        .isInstanceOf(InvalidDmRequestException.class);
    assertThatThrownBy(() -> dmService.createOrGet(a, List.of(a))) // self-only
        .isInstanceOf(InvalidDmRequestException.class);
    assertThatThrownBy(() -> dmService.createOrGet(a, List.of(999_999L))) // 미존재
        .isInstanceOf(InvalidDmRequestException.class);
  }

  @Test
  void createOrGet_rejectsOverEight() {
    long a = seedUser("owner");
    List<Long> targets =
        java.util.stream.IntStream.range(0, 8) // 본인+8 = 9 > 8
            .mapToObj(i -> seedUser("u" + i))
            .toList();
    assertThatThrownBy(() -> dmService.createOrGet(a, targets))
        .isInstanceOf(InvalidDmRequestException.class);
  }

  @Test
  void listMyDms_returnsOnlyMine() {
    long a = seedUser("a");
    long b = seedUser("b");
    long c = seedUser("c");
    dmService.createOrGet(a, List.of(b));
    dmService.createOrGet(b, List.of(c)); // a 무관 DM

    assertThat(dmService.listMyDms(a)).hasSize(1);
  }
}
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.messaging.service.DmServiceTest"`
Expected: FAIL — `DmService` 미정의.

- [ ] **Step 3: UserRepository 에 existsById 확보**

`UserRepository.java` 를 열어 사용자 존재 확인 메서드(`existsById`/`findById` 등)가 있는지 본다. 없으면 추가(상단 `static com.workplace.jooq.Tables.USER` import 확인):
```java
  /** 사용자 존재 여부. */
  public boolean existsById(long id) {
    return dsl.fetchExists(dsl.selectOne().from(USER).where(USER.ID.eq(id)));
  }
```
> 이미 동등 메서드가 있으면 그것을 DmService 에서 사용하고 이 단계는 생략.

- [ ] **Step 4: DmService 작성**

`service/DmService.java`:
```java
package com.workplace.messaging.service;

import com.workplace.messaging.dto.DmResponse;
import com.workplace.messaging.exception.InvalidDmRequestException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.user.repository.UserRepository;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** DM(다이렉트 메시지) — find-or-create(멤버셋 dedup) + 내 DM 목록. */
@Service
@RequiredArgsConstructor
public class DmService {

  private static final int MAX_MEMBERS = 8; // 본인 포함

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final UserRepository userRepo;

  /** create 결과 — 신규(201)/기존(200) 구분용. */
  public record DmResult(DmResponse dm, boolean created) {}

  /** 내 DM 목록(최근순). */
  public List<DmResponse> listMyDms(long callerId) {
    return channelRepo.findMyDms(callerId);
  }

  /**
   * caller + targets 멤버셋의 DM 을 찾거나 생성한다. 멤버셋 dedup(정렬 member_key). 1:1 은 타겟 1명
   * 그룹 DM 의 특수 케이스.
   */
  @Transactional
  public DmResult createOrGet(long callerId, List<Long> targetUserIds) {
    if (targetUserIds == null || targetUserIds.isEmpty()) {
      throw new InvalidDmRequestException("대상이 비어 있습니다");
    }
    LinkedHashSet<Long> members = new LinkedHashSet<>();
    members.add(callerId);
    members.addAll(targetUserIds);
    if (members.size() < 2) {
      throw new InvalidDmRequestException("자기 자신과는 DM 할 수 없습니다");
    }
    if (members.size() > MAX_MEMBERS) {
      throw new InvalidDmRequestException("DM 은 본인 포함 최대 " + MAX_MEMBERS + "명입니다");
    }
    for (Long uid : members) {
      if (!userRepo.existsById(uid)) {
        throw new InvalidDmRequestException("존재하지 않는 사용자: " + uid);
      }
    }
    String memberKey =
        members.stream().sorted().map(String::valueOf).collect(Collectors.joining(","));

    // 기존 DM 재사용(idempotent).
    var existing = channelRepo.findDmIdByMemberKey(memberKey);
    if (existing.isPresent()) {
      return new DmResult(channelRepo.findDmDetail(existing.get(), callerId).orElseThrow(), false);
    }
    // 신규 생성 — 동시 생성 레이스는 유니크 인덱스가 차단, catch 후 재조회.
    try {
      long id = channelRepo.insertDm(memberKey, callerId);
      for (Long uid : members) {
        memberRepo.add(id, uid, "MEMBER");
      }
      return new DmResult(channelRepo.findDmDetail(id, callerId).orElseThrow(), true);
    } catch (DuplicateKeyException race) {
      long id = channelRepo.findDmIdByMemberKey(memberKey).orElseThrow();
      return new DmResult(channelRepo.findDmDetail(id, callerId).orElseThrow(), false);
    }
  }
}
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.messaging.service.DmServiceTest"`
Expected: PASS (5 tests).

- [ ] **Step 6: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/messaging/service/DmService.java apps/workplace-api/src/main/java/com/workplace/user/repository/UserRepository.java apps/workplace-api/src/test/java/com/workplace/messaging/service/DmServiceTest.java
git commit -m "feat(messaging): DmService — 멤버셋 dedup find-or-create + 검증 + listMyDms"
```

---

## Task 5: DmController — GET/POST /dms

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/messaging/controller/DmController.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/messaging/controller/DmControllerTest.java`

- [ ] **Step 1: 컨트롤러 라우팅 테스트 작성**

`apps/workplace-api/src/test/java/com/workplace/messaging/controller/DmControllerTest.java` — 기존 `ChannelCrudControllerTest` 의 @WebMvcTest 설정(@Import SecurityConfig 등, @BeforeEach auth)을 그대로 차용:
```java
package com.workplace.messaging.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.messaging.dto.CreateDmRequest;
import com.workplace.messaging.dto.DmParticipant;
import com.workplace.messaging.dto.DmResponse;
import com.workplace.messaging.exception.InvalidDmRequestException;
import com.workplace.messaging.service.DmService;
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
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** DM 컨트롤러 라우팅·상태코드 매핑 테스트. 서비스는 Mockito. */
@SuppressWarnings("null")
@WebMvcTest(controllers = DmController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class DmControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;

  @MockitoBean DmService dmService;
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

  private DmResponse sampleDm() {
    return new DmResponse(
        7L, List.of(new DmParticipant(1L, "나", "HUMAN"), new DmParticipant(2L, "밥", "HUMAN")),
        null, Instant.parse("2026-06-01T00:00:00Z"));
  }

  @Test
  void list_returns200() throws Exception {
    when(dmService.listMyDms(1L)).thenReturn(List.of(sampleDm()));
    mockMvc
        .perform(get("/api/v1/messaging/dms").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(7))
        .andExpect(jsonPath("$[0].participants[1].name").value("밥"));
  }

  @Test
  void create_new_returns201() throws Exception {
    when(dmService.createOrGet(eq(1L), any()))
        .thenReturn(new DmService.DmResult(sampleDm(), true));
    mockMvc
        .perform(
            post("/api/v1/messaging/dms")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new CreateDmRequest(List.of(2L)))))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").value(7));
  }

  @Test
  void create_existing_returns200() throws Exception {
    when(dmService.createOrGet(eq(1L), any()))
        .thenReturn(new DmService.DmResult(sampleDm(), false));
    mockMvc
        .perform(
            post("/api/v1/messaging/dms")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new CreateDmRequest(List.of(2L)))))
        .andExpect(status().isOk());
  }

  @Test
  void create_invalid_returns400() throws Exception {
    when(dmService.createOrGet(eq(1L), any()))
        .thenThrow(new InvalidDmRequestException("자기 자신과는 DM 할 수 없습니다"));
    mockMvc
        .perform(
            post("/api/v1/messaging/dms")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new CreateDmRequest(List.of(1L)))))
        .andExpect(status().isBadRequest());
  }

  @Test
  void create_emptyUserIds_returns400() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/messaging/dms")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"userIds\":[]}"))
        .andExpect(status().isBadRequest()); // @NotEmpty
  }
}
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.messaging.controller.DmControllerTest"`
Expected: FAIL — `DmController` 미정의.

- [ ] **Step 3: DmController 작성**

`controller/DmController.java`:
```java
package com.workplace.messaging.controller;

import com.workplace.messaging.dto.CreateDmRequest;
import com.workplace.messaging.dto.DmResponse;
import com.workplace.messaging.service.DmService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** DM 목록/생성. 메시지 송수신은 기존 채널 메시지 엔드포인트(DM 채널 id)를 재사용. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class DmController {

  private final DmService dmService;

  /** 내 DM 목록(최근순, 참여자 동봉). */
  @GetMapping("/dms")
  public ResponseEntity<List<DmResponse>> list(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(dmService.listMyDms(callerId));
  }

  /** DM find-or-create. 기존 재사용=200, 신규=201. */
  @PostMapping("/dms")
  public ResponseEntity<DmResponse> create(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody CreateDmRequest req) {
    DmService.DmResult res = dmService.createOrGet(callerId, req.userIds());
    return ResponseEntity.status(res.created() ? HttpStatus.CREATED : HttpStatus.OK)
        .body(res.dm());
  }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.messaging.controller.DmControllerTest"`
Expected: PASS (5 tests).

- [ ] **Step 5: 백엔드 전체 테스트**

Run: `cd apps/workplace-api && ./gradlew test`
Expected: BUILD SUCCESSFUL — 기존 채널 테스트 포함 회귀 없음.

- [ ] **Step 6: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/messaging/controller/DmController.java apps/workplace-api/src/test/java/com/workplace/messaging/controller/DmControllerTest.java
git commit -m "feat(messaging): DmController — GET/POST /dms(신규 201/기존 200)"
```

---

## Task 6: 프론트 타입 + API + 훅

**Files:**
- Modify: `apps/workplace-web/src/types/messaging.ts`
- Modify: `apps/workplace-web/src/api/messaging.ts`
- Modify: `apps/workplace-web/src/hooks/queries/messagingKeys.ts`
- Create: `apps/workplace-web/src/hooks/queries/useMyDms.ts`
- Create: `apps/workplace-web/src/hooks/queries/useCreateDm.ts`

- [ ] **Step 1: 타입 추가**

`types/messaging.ts` 끝에 추가:
```ts
/** DM 참여자(본인 포함). */
export interface DmParticipant {
  userId: number
  name: string
  kind: UserKind
}

/** DM 1건 — name 이 없으므로 참여자에서 표시명 파생. */
export interface DmResponse {
  id: number
  participants: DmParticipant[]
  lastMessageAt: string | null
  createdAt: string
}

/** DM 생성 요청 — 본인 제외 타겟. */
export interface CreateDmRequest {
  userIds: number[]
}
```

- [ ] **Step 2: API 함수 추가**

`api/messaging.ts` 의 import 에 `DmResponse` 추가하고 `messagingApi` 객체 끝에 추가:
```ts
  // DM 목록(참여자·최근시각 포함).
  listDms: () => client.get<DmResponse[]>('/messaging/dms'),

  // DM find-or-create. 기존 멤버셋이면 서버가 같은 DM 반환.
  createDm: (userIds: number[]) =>
    client.post<DmResponse>('/messaging/dms', { userIds }),
```

- [ ] **Step 3: 쿼리 키 추가**

`hooks/queries/messagingKeys.ts` 의 객체에 추가:
```ts
  dms: () => [...messagingKeys.all, 'dms'] as const,
```

- [ ] **Step 4: useMyDms 작성**

`hooks/queries/useMyDms.ts`:
```ts
// 내 DM 목록(사이드바 DM 섹션). 채널과 동일하게 10s staleTime.
import { useQuery } from '@tanstack/react-query'

import { messagingApi } from '../../api/messaging'
import type { DmResponse } from '../../types/messaging'
import { messagingKeys } from './messagingKeys'

export function useMyDms() {
  return useQuery<DmResponse[]>({
    queryKey: messagingKeys.dms(),
    queryFn: () => messagingApi.listDms().then((r) => r.data),
    staleTime: 10_000,
  })
}
```

- [ ] **Step 5: useCreateDm 작성**

`hooks/queries/useCreateDm.ts`:
```ts
// DM find-or-create. 성공 시 DM 목록 무효화 — 호출처가 응답 id 로 라우팅.
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { messagingApi } from '../../api/messaging'
import { handleApiError } from '../../lib/api-error'
import type { DmResponse } from '../../types/messaging'
import { messagingKeys } from './messagingKeys'

export function useCreateDm() {
  const qc = useQueryClient()
  return useMutation<DmResponse, unknown, number[]>({
    mutationFn: (userIds) => messagingApi.createDm(userIds).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.dms() }),
    onError: (err) => handleApiError(err, 'DM 을 만들 수 없어요'),
  })
}
```

- [ ] **Step 6: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-web/src/types/messaging.ts apps/workplace-web/src/api/messaging.ts apps/workplace-web/src/hooks/queries/messagingKeys.ts apps/workplace-web/src/hooks/queries/useMyDms.ts apps/workplace-web/src/hooks/queries/useCreateDm.ts
git commit -m "feat(web/messaging): DM 타입·API·훅(useMyDms/useCreateDm)"
```

---

## Task 7: 표시명 유틸 + E2E 팩토리

**Files:**
- Create: `apps/workplace-web/src/lib/dm.ts`
- Modify: `apps/workplace-web/e2e/factories/messaging.factory.ts`

- [ ] **Step 1: dmDisplayName 유틸 작성**

`lib/dm.ts`:
```ts
// DM 표시명 파생 — name 이 없는 DM 을 참여자로 표기.
// 1:1 = 상대 이름, 그룹 = 상대들 이름 결합(3명 초과면 "외 N명" 축약).
import type { DmResponse } from '../types/messaging'

export function dmDisplayName(dm: DmResponse, currentUserId: number): string {
  const others = dm.participants.filter((p) => p.userId !== currentUserId)
  if (others.length === 0) return '(나)' // 방어적 — 정상 DM 엔 발생 안 함
  if (others.length === 1) return others[0].name
  if (others.length <= 3) return others.map((p) => p.name).join(', ')
  return `${others[0].name}, ${others[1].name} 외 ${others.length - 2}명`
}
```

- [ ] **Step 2: 팩토리 추가**

`e2e/factories/messaging.factory.ts` 의 import 에 `DmResponse`, `DmParticipant` 추가하고 함수 추가:
```ts
export function createDmParticipant(
  overrides: Partial<DmParticipant> = {},
): DmParticipant {
  return { userId: 1, name: '테스트 사용자', kind: 'HUMAN', ...overrides }
}

export function createDm(overrides: Partial<DmResponse> = {}): DmResponse {
  return {
    id: 100,
    participants: [
      createDmParticipant({ userId: 1, name: '나' }),
      createDmParticipant({ userId: 2, name: '밥' }),
    ],
    lastMessageAt: null,
    createdAt: new Date('2026-06-01T00:00:00Z').toISOString(),
    ...overrides,
  }
}
```

- [ ] **Step 3: 타입 체크**

Run: `cd apps/workplace-web && npx tsc -p tsconfig.e2e.json --noEmit && pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/lib/dm.ts apps/workplace-web/e2e/factories/messaging.factory.ts
git commit -m "feat(web/messaging): dmDisplayName 유틸 + E2E DM 팩토리"
```

---

## Task 8: 사이드바 DM 섹션

**Files:**
- Modify: `apps/workplace-web/src/components/chat/ChannelSidebar.tsx`

- [ ] **Step 1: DM 섹션 추가**

`ChannelSidebar.tsx` 수정:
1. import 추가: `import { useMyDms } from '@/hooks/queries/useMyDms'`, `import { useAuth } from '@/hooks/useAuth'`, `import { dmDisplayName } from '@/lib/dm'`, `import { NewDmModal } from './NewDmModal'`, lucide 에서 `MessageSquare` 추가.
2. 컴포넌트 본문 상단(채널 훅 옆)에 추가:
```tsx
  const { data: dms } = useMyDms()
  const { user } = useAuth()
  const [newDmOpen, setNewDmOpen] = useState(false)
  const myId = user?.id ?? 0
```
3. `</nav>` 닫힘 직후, `<CreateChannelModal ...>` 앞에 DM 섹션 추가:
```tsx
      <div className="mt-4 flex items-center justify-between px-2 py-2">
        <span className="text-xs font-semibold text-muted-foreground">다이렉트 메시지</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          data-testid="dm-new-btn"
          aria-label="새 메시지"
          onClick={() => setNewDmOpen(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <nav className="space-y-1" data-testid="dm-list">
        {dms?.map((dm) => (
          <Link
            key={dm.id}
            to={`/chat/dms/${dm.id}`}
            data-testid={`dm-link-${dm.id}`}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
              activeId === dm.id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span className="truncate">{dmDisplayName(dm, myId)}</span>
          </Link>
        ))}
      </nav>
      <NewDmModal open={newDmOpen} onOpenChange={setNewDmOpen} />
```
> `activeId` 는 채널·DM 이 같은 `:id` param 을 공유하지 않으므로(채널 라우트는 `/chat/channels/:id`, DM 은 `/chat/dms/:id`) 하이라이트가 교차로 켜질 수 있다. 정확히 하려면 `useLocation().pathname` 으로 `/chat/dms/` 접두사를 확인해 DM 활성만 판별한다:
```tsx
  const location = useLocation()
  const isDmRoute = location.pathname.startsWith('/chat/dms/')
```
DM `<Link>` 활성 조건은 `isDmRoute && activeId === dm.id`, 채널 `<Link>` 는 `!isDmRoute && activeId === c.id` 로 둔다. (`useLocation` 을 `react-router-dom` import 에 추가.)

- [ ] **Step 2: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: 에러 없음(NewDmModal 미작성이면 Task 9 후 통과 — 이 단계에서 NewDmModal import 가 에러나면 Task 9 를 먼저 끝내고 재확인).

> 구현 순서상 NewDmModal(Task 9) 을 먼저 만들고 본 Task 의 import 를 연결하는 것이 자연스럽다. 두 Task 는 한 커밋으로 묶어도 무방하다.

- [ ] **Step 3: 커밋(Task 9 와 묶어도 됨)**

```bash
git add apps/workplace-web/src/components/chat/ChannelSidebar.tsx
git commit -m "feat(web/messaging): 사이드바 DM 섹션 + 새 메시지 버튼"
```

---

## Task 9: NewDmModal — 다중 선택 참여자 + 시작

**Files:**
- Create: `apps/workplace-web/src/components/chat/NewDmModal.tsx`

- [ ] **Step 1: NewDmModal 작성**

`components/chat/NewDmModal.tsx` — 기존 `MemberSearchPopover`(단일 onSelect)를 다중 선택 칩으로 누적 래핑:
```tsx
// 새 DM 모달 — 참여자 1~7명(본인 제외) 선택 후 시작. find-or-create → 응답 DM 으로 라우팅.
import { X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCreateDm } from '@/hooks/queries/useCreateDm'
import { MemberSearchPopover } from '@/pages/projects/components/MemberSearchPopover'
import type { UserResponse } from '@/types/auth'

interface NewDmModalProps {
  open: boolean
  onOpenChange: (next: boolean) => void
}

const MAX_TARGETS = 7 // 본인 포함 8명

export function NewDmModal({ open, onOpenChange }: NewDmModalProps) {
  const navigate = useNavigate()
  const createDm = useCreateDm()
  const [selected, setSelected] = useState<UserResponse[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  const selectedIds = new Set(selected.map((u) => u.id))

  const handleSelect = (user: UserResponse) => {
    if (selectedIds.has(user.id) || selected.length >= MAX_TARGETS) return
    setSelected((prev) => [...prev, user])
  }

  const remove = (id: number) => setSelected((prev) => prev.filter((u) => u.id !== id))

  const reset = () => {
    setSelected([])
    setPickerOpen(false)
  }

  const start = async () => {
    if (selected.length === 0) return
    const dm = await createDm.mutateAsync(selected.map((u) => u.id))
    reset()
    onOpenChange(false)
    navigate(`/chat/dms/${dm.id}`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent data-testid="new-dm-modal">
        <DialogHeader>
          <DialogTitle>새 메시지</DialogTitle>
        </DialogHeader>

        {/* 선택된 참여자 칩 */}
        <div className="flex flex-wrap gap-1" data-testid="new-dm-chips">
          {selected.map((u) => (
            <span
              key={u.id}
              data-testid={`new-dm-chip-${u.id}`}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-sm"
            >
              {u.name}
              <button
                type="button"
                aria-label={`${u.name} 제거`}
                onClick={() => remove(u.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        <MemberSearchPopover
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          existingMemberIds={selectedIds}
          onSelect={handleSelect}
          trigger={
            <Button
              type="button"
              variant="outline"
              data-testid="new-dm-add-btn"
              disabled={selected.length >= MAX_TARGETS}
              onClick={() => setPickerOpen(true)}
            >
              참여자 추가
            </Button>
          }
        />
        {selected.length >= MAX_TARGETS && (
          <p className="text-xs text-muted-foreground">최대 {MAX_TARGETS}명까지 선택할 수 있어요.</p>
        )}

        <DialogFooter>
          <Button
            type="button"
            data-testid="new-dm-start-btn"
            disabled={selected.length === 0 || createDm.isPending}
            onClick={() => void start()}
          >
            시작
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: 에러 없음. (`UserResponse` 의 실제 경로는 `@/types/auth` 인지 확인 — MemberSearchPopover 가 쓰는 import 와 일치시킨다.)

- [ ] **Step 3: 커밋**

```bash
git add apps/workplace-web/src/components/chat/NewDmModal.tsx
git commit -m "feat(web/messaging): NewDmModal — 다중 선택 참여자 + DM 시작"
```

---

## Task 10: DmPage + 라우팅

**Files:**
- Create: `apps/workplace-web/src/components/chat/DmHeader.tsx`
- Create: `apps/workplace-web/src/pages/chat/DmPage.tsx`
- Modify: `apps/workplace-web/src/App.tsx`

- [ ] **Step 1: DmHeader 작성**

`components/chat/DmHeader.tsx`:
```tsx
// DM 헤더 — 참여자 기반 표시명 + 인원수. 채널과 달리 이름변경/멤버관리/아카이브 없음.
import type { DmResponse } from '@/types/messaging'
import { dmDisplayName } from '@/lib/dm'

interface DmHeaderProps {
  dm: DmResponse
  currentUserId: number
}

export function DmHeader({ dm, currentUserId }: DmHeaderProps) {
  return (
    <header className="flex items-center gap-2 border-b px-4 py-2" data-testid="dm-header">
      <span className="font-semibold" data-testid="dm-title">
        {dmDisplayName(dm, currentUserId)}
      </span>
      <span className="text-xs text-muted-foreground">{dm.participants.length}명</span>
    </header>
  )
}
```

- [ ] **Step 2: DmPage 작성**

`pages/chat/DmPage.tsx` — 메시지 리스트/컴포저는 채널과 동일 컴포넌트·훅 재사용(DM id = 채널 id). 헤더 표시용 참여자는 `useMyDms` 캐시에서 조회:
```tsx
// DM 메시지 뷰 — 기존 메시지 컴포넌트 재사용(DM 채널 id). 헤더는 참여자 기반.
import { useParams } from 'react-router-dom'

import { DmHeader } from '@/components/chat/DmHeader'
import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageList } from '@/components/chat/MessageList'
import { useChannelMessages } from '@/hooks/queries/useChannelMessages'
import { useCreateMessage } from '@/hooks/queries/useCreateMessage'
import { useMyDms } from '@/hooks/queries/useMyDms'
import { useAuth } from '@/hooks/useAuth'
import type { UserKind } from '@/types/messaging'

export default function DmPage() {
  const { id } = useParams()
  const dmId = id ? Number(id) : undefined
  const { user } = useAuth()
  const { data: dms, isLoading } = useMyDms()
  const { data } = useChannelMessages(dmId)
  const messages = data?.pages.flatMap((p) => p.items) ?? []

  const me = user
    ? { id: user.id, name: user.name, kind: (user.kind ?? 'HUMAN') as UserKind }
    : { id: 0, name: '', kind: 'HUMAN' as UserKind }
  const create = useCreateMessage(dmId ?? 0, me)

  const dm = dms?.find((d) => d.id === dmId)

  // 목록 로딩 끝났는데 해당 DM 이 없으면 비참여자/미존재 → 은닉.
  if (!isLoading && !dm) {
    return (
      <div
        className="flex h-full items-center justify-center text-muted-foreground"
        data-testid="dm-not-found"
      >
        대화를 찾을 수 없습니다.
      </div>
    )
  }
  if (!dm) {
    return <div className="p-4 text-sm text-muted-foreground">불러오는 중…</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DmHeader dm={dm} currentUserId={me.id} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList messages={messages} />
      </div>
      <MessageComposer onSend={(body) => create.mutate({ body })} />
    </div>
  )
}
```
> `MessageComposer`/`MessageList`/`useChannelMessages`/`useCreateMessage` 의 실제 props 시그니처는 `ChannelPage.tsx` 와 동일하게 맞춘다(`disabled` 는 DM 엔 불필요하므로 생략).

- [ ] **Step 3: 라우트 추가**

`App.tsx` 의 lazy 선언부에 추가:
```tsx
const DmPage = lazy(() => import('./pages/chat/DmPage'))
```
`ChatModuleLayout` 라우트 블록에 추가:
```tsx
  <Route path="chat/dms/:id" element={<DmPage />} />
```

- [ ] **Step 4: 타입 체크 + 빌드**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-web/src/components/chat/DmHeader.tsx apps/workplace-web/src/pages/chat/DmPage.tsx apps/workplace-web/src/App.tsx
git commit -m "feat(web/messaging): DmPage + /chat/dms/:id 라우트(메시지 컴포넌트 재사용)"
```

---

## Task 11: E2E — DM 흐름

**Files:**
- Create: `apps/workplace-web/e2e/pages/chat-dm.spec.ts`

> 모킹 스타일은 기존 `e2e/pages/chat-channel-crud.spec.ts` 를 그대로 따른다(`page.route(url=>url.pathname===..., route=>...)`, `postDataJSON()` payload 검증, fixtures `authenticatedPage`). 사이드바는 `GET /messaging/channels`(채널)와 `GET /messaging/dms`(DM) 둘 다 stub 해야 한다.

- [ ] **Step 1: E2E 스펙 작성**

`e2e/pages/chat-dm.spec.ts`:
```ts
// messaging DM E2E — 백엔드 없이 page.route() 모킹.
import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { createDm, createDmParticipant, createMessage } from '../factories/messaging.factory'

// 채널·DM 사이드바 목록 stub.
async function stubLists(
  page: Page,
  dms: ReturnType<typeof createDm>[],
) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
          })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/dms',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dms),
      })
    },
  )
}

// DM 메시지 히스토리 stub.
async function stubMessages(page: Page, dmId: number, items: ReturnType<typeof createMessage>[]) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${dmId}/messages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items, nextCursor: null, hasMore: false }),
          })
        : route.fallback(),
  )
}

test.describe('messaging DM', () => {
  test('새 1:1 DM 생성 → DM 섹션 등장 → 진입', { tag: '@smoke' }, async ({
    authenticatedPage: page,
  }) => {
    // 초기: DM 없음. 생성 후: DM 1개.
    const created = createDm({
      id: 100,
      participants: [
        createDmParticipant({ userId: 1, name: '나' }),
        createDmParticipant({ userId: 2, name: '밥' }),
      ],
    })
    let dmsState: ReturnType<typeof createDm>[] = []
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/dms',
      (route) => {
        const m = route.request().method()
        if (m === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(dmsState),
          })
        }
        if (m === 'POST') {
          const payload = route.request().postDataJSON() as { userIds: number[] }
          expect(payload).toEqual({ userIds: [2] })
          dmsState = [created] // 이후 GET 에 반영
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(created),
          })
        }
        return route.fallback()
      },
    )
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
          : route.fallback(),
    )
    await stubMessages(page, 100, [])
    // 사용자 검색(MemberSearchPopover) stub — id=2 '밥'.
    await page.route(
      (url) => url.pathname === '/api/v1/users',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            content: [{ id: 2, name: '밥', username: 'bob', kind: 'HUMAN' }],
            totalElements: 1,
          }),
        }),
    )

    await page.goto('/chat')
    await page.getByTestId('dm-new-btn').click()
    await page.getByTestId('new-dm-add-btn').click()
    await page.getByLabel('멤버 검색').fill('밥')
    await page.getByTestId('member-search-row-2').click()
    await expect(page.getByTestId('new-dm-chip-2')).toBeVisible()
    await page.getByTestId('new-dm-start-btn').click()

    await expect(page).toHaveURL(/\/chat\/dms\/100$/)
    await expect(page.getByTestId('dm-title')).toHaveText('밥')
  })

  test('그룹 DM 표시명 — 상대 이름 결합', async ({ authenticatedPage: page }) => {
    const group = createDm({
      id: 101,
      participants: [
        createDmParticipant({ userId: 1, name: '나' }),
        createDmParticipant({ userId: 2, name: '밥' }),
        createDmParticipant({ userId: 3, name: '캐럴' }),
      ],
    })
    await stubLists(page, [group])
    await stubMessages(page, 101, [])

    await page.goto('/chat/dms/101')
    await expect(page.getByTestId('dm-title')).toHaveText('밥, 캐럴')
  })

  test('DM 메시지 전송 → payload 검증 + UI 반영', async ({ authenticatedPage: page }) => {
    const dm = createDm({ id: 102 })
    await stubLists(page, [dm])
    await stubMessages(page, 102, [])
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/102/messages',
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        const payload = route.request().postDataJSON() as { body: string }
        expect(payload).toEqual({ body: '안녕 밥' })
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(
            createMessage({ id: 5, channelId: 102, authorId: 1, body: '안녕 밥' }),
          ),
        })
      },
    )

    await page.goto('/chat/dms/102')
    // MessageComposer 입력 셀렉터는 기존 chat.spec.ts 의 셀렉터와 동일하게 사용.
    await page.getByTestId('message-composer-input').fill('안녕 밥')
    await page.getByTestId('message-composer-send').click()
    await expect(page.getByText('안녕 밥')).toBeVisible()
  })

  test('비참여자 직접 진입 → 대화 없음', async ({ authenticatedPage: page }) => {
    await stubLists(page, []) // 내 DM 목록에 없음
    await page.goto('/chat/dms/999')
    await expect(page.getByTestId('dm-not-found')).toBeVisible()
  })
})
```
> `message-composer-input`/`message-composer-send` 등 컴포저 셀렉터·`멤버 검색` 라벨·사용자 검색 응답 형태(`{content, totalElements}`)는 기존 `chat.spec.ts`/`MemberSearchPopover`/`useUserSearch` 의 실제 계약과 일치시킨다(작성 시 해당 파일 확인).

- [ ] **Step 2: E2E 타입 체크**

Run: `cd apps/workplace-web && npx tsc -p tsconfig.e2e.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: DM E2E 실행**

Run: `cd apps/workplace-web && pnpm test:e2e chat-dm`
Expected: PASS (4 tests).

- [ ] **Step 4: 전체 E2E 회귀**

Run: `cd apps/workplace-web && pnpm test:e2e`
Expected: 기존 채널/멤버/글로벌챗 스펙 포함 전부 PASS(사이드바에 DM 섹션 추가로 인한 회귀 없음 — 기존 스펙은 `GET /dms` 미stub 시 빈 배열 폴백되도록, 필요하면 기존 사이드바 사용 스펙에 `GET /messaging/dms → []` stub 보강).

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-web/e2e/pages/chat-dm.spec.ts
git commit -m "test(web/messaging): DM E2E — 생성/표시명/전송/은닉"
```

---

## Self-Review (작성자 체크 — 실행됨)

**1. Spec coverage:**
- `member_key` + 부분 유니크 인덱스 → Task 1. ✓
- find-or-create 알고리즘(검증·dedup·레이스) → Task 4. ✓
- `findMyChannels` kind 필터 회귀 → Task 3. ✓
- `DmResponse` 참여자 동봉(N+1 회피) → Task 2 DTO + Task 3 `findMyDms` 일괄 조회. ✓
- `GET/POST /dms`(200/201) → Task 5. ✓
- 사이드바 DM 섹션 / NewDmModal / DmPage / 표시명 → Task 7~10. ✓
- 비목표(실시간 메타 푸시·멤버 변경·숨기기)는 미구현 — 계획에 추가 안 함. ✓
- 테스트: 백엔드 dedup/검증/은닉/회귀 → Task 3·4·5, 프론트 E2E → Task 11. ✓

**2. Placeholder scan:** 프로덕션 코드 스텝은 전부 완전한 코드. 테스트의 `seedUser(...)` 헬퍼만 "기존 통합 테스트 패턴 차용"으로 위임(DB 시딩 헬퍼는 코드베이스 표준을 따라야 하므로 의도적). 구현자는 참조 파일을 읽고 채운다.

**3. Type consistency:** `DmResult(DmResponse dm, boolean created)` — Task 4 정의, Task 5 컨트롤러·테스트에서 동일 사용. `DmResponse`/`DmParticipant`/`CreateDmRequest` 백엔드(Task 2)·프론트(Task 6) 필드 일치. `dmDisplayName(dm, currentUserId)` Task 7 정의, Task 8·9·10 사용 일치.

---

## Execution Handoff

이 계획은 백엔드(Task 1~5) → 프론트(Task 6~11) 순으로 의존한다. Task 8·9 는 상호 import 가 있어 한 묶음으로 처리한다.

**구현 시 주의(실제 코드 확인 필요 지점):**
- `GlobalExceptionHandler.buildError(...)` 인자 순서.
- `USER.KIND` jOOQ 매핑 타입(String vs enum) — 기존 `listMembers` 방식 차용.
- `UserRepository` 의 기존 사용자-존재 메서드 유무.
- 프론트 `MessageComposer`/`MessageList`/`useChannelMessages`/`useCreateMessage` 실제 props·셀렉터, `UserResponse` import 경로, `useUserSearch` 응답 형태.
