# Messaging Phase 2a (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비공개 채널 + 채널 CRUD(이름변경·아카이브·하드삭제) + 탐색 + 멤버 역할(OWNER/ADMIN/MEMBER) 관리의 **백엔드**를 구현한다. 프론트(2b)는 이 API가 확정된 뒤 별도 플랜으로 작성한다.

**Architecture:** Phase 1 `com.workplace.messaging` 도메인을 확장한다. `channel_member.role` 컬럼을 추가하고(`V20`), 권한 판정을 `ChannelPermissions` 헬퍼로 일원화한다(채널 역할 + 시스템 ADMIN 오버라이드 = `PermissionChecker.userHasRole(id,"ADMIN")`). 비공개 채널은 비멤버에게 404로 은닉한다.

**Tech Stack:** Spring Boot, jOOQ(생성 소스 `src/main/generated/`, gitignored), Flyway, JUnit5 + AssertJ 통합 테스트(`IntegrationTestBase`, test DB:5435), Lombok, Google Java Format(Spotless).

**설계 문서:** [docs/superpowers/specs/2026-06-02-messaging-phase2-design.md](../specs/2026-06-02-messaging-phase2-design.md)

---

## 사전 규칙 (모든 작업 공통)

- **한국어 주석 필수**: 클래스·메서드·주요 로직에 무엇을·왜.
- **커밋**: 각 Task 끝에서 커밋. pre-commit 훅이 느린 전체 스위트를 돌리므로 `git commit --no-verify` 사용(테스트는 각 Task에서 명시적으로 실행해 검증).
- **테스트 실행**: `./gradlew test --tests "com.workplace.messaging.*"` (test DB 5435 가 떠 있어야 함 — `pnpm db:up`).
- **포맷**: 커밋 전 `./gradlew spotlessApply`.
- 이 플랜은 **단일 git worktree**에서 실행한다. B1 에서 jOOQ 를 재생성하면 이후 모든 Task 가 같은 worktree 의 생성 소스를 공유한다.

---

## 파일 구조 (생성/수정 대상)

**생성**
- `src/main/resources/db/migration/V20__messaging_phase2.sql`
- `src/main/java/com/workplace/messaging/dto/ChannelMemberResponse.java`
- `src/main/java/com/workplace/messaging/dto/RenameChannelRequest.java`
- `src/main/java/com/workplace/messaging/dto/AddMemberRequest.java`
- `src/main/java/com/workplace/messaging/dto/UpdateRoleRequest.java`
- `src/main/java/com/workplace/messaging/exception/ChannelForbiddenException.java`
- `src/main/java/com/workplace/messaging/exception/ChannelArchivedException.java`
- `src/main/java/com/workplace/messaging/exception/OwnershipTransferRequiredException.java`
- `src/main/java/com/workplace/messaging/service/ChannelPermissions.java`
- `src/main/java/com/workplace/messaging/service/ChannelMemberService.java`
- `src/main/java/com/workplace/messaging/controller/ChannelMemberController.java`
- 테스트: `ChannelPermissions/ChannelService/ChannelMemberService/ChannelControllerCrud` 통합 테스트들

**수정**
- `dto/ChannelResponse.java` (필드 6→9), `dto/CreateChannelRequest.java` (+visibility)
- `repository/ChannelRepository.java`, `repository/ChannelMemberRepository.java`
- `service/ChannelService.java`, `service/MessageService.java`
- `controller/ChannelController.java`
- `global/exception/GlobalExceptionHandler.java`

---

## Task B1: V20 마이그레이션 + jOOQ 재생성 (게이트)

> 이후 모든 Task 는 `CHANNEL_MEMBER.ROLE` jOOQ 필드에 의존하므로 이 Task 가 선행되어야 컴파일된다.

**Files:**
- Create: `src/main/resources/db/migration/V20__messaging_phase2.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

`src/main/resources/db/migration/V20__messaging_phase2.sql`:

```sql
-- Messaging Phase 2: 채널 멤버 역할 + 탐색 인덱스
-- visibility / archived_at 컬럼은 Phase 1(V19)에 이미 존재 → 신규 추가 없음.

-- 채널 멤버 역할: OWNER(소유자, 채널당 1명) / ADMIN(관리자) / MEMBER(일반)
ALTER TABLE channel_member
  ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'MEMBER';

-- 백필: 기존 채널의 생성자를 OWNER 로 승격 (그 외는 DEFAULT 'MEMBER' 유지)
UPDATE channel_member cm
  SET role = 'OWNER'
  FROM channel c
  WHERE cm.channel_id = c.id AND cm.user_id = c.created_by;

-- 탐색 성능: 공개·비아카이브 채널 목록 조회용 부분 인덱스
CREATE INDEX idx_channel_discover ON channel (visibility) WHERE archived_at IS NULL;
```

- [ ] **Step 2: dev DB(5434)에 마이그레이션 적용**

dev DB 컨테이너가 떠 있는지 확인 후, Flyway 자동 마이그레이션을 위해 API 를 잠깐 부팅한다.

Run:
```bash
pnpm db:up   # 이미 떠 있으면 no-op
cd apps/workplace-api
# Flyway 는 부팅 시 자동 적용. 로그에 "Migrating schema ... to version 20" 확인 후 종료.
timeout 90 ./gradlew bootRun || true
```
Expected: 로그에 `Successfully applied 1 migration ... version "20 - messaging phase2"` 류 출력. (앱은 timeout 으로 종료되어도 무방 — 마이그레이션은 부팅 초기에 커밋됨.)

검증:
```bash
docker exec smart-workplace-db-1 psql -U postgres -d workplace -c "\d channel_member" | grep role
```
Expected: `role | character varying(16) | not null | 'MEMBER'::character varying` 출력.

- [ ] **Step 3: jOOQ 재생성**

Run: `./gradlew generateJooq`
Expected: BUILD SUCCESSFUL.

검증:
```bash
grep -r "ROLE" src/main/generated/com/workplace/jooq/tables/ | grep -i channel_member
```
Expected: 생성된 `ChannelMember` 테이블 클래스에 `ROLE` 필드 존재.

- [ ] **Step 4: 컴파일 확인**

Run: `./gradlew compileJava`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add src/main/resources/db/migration/V20__messaging_phase2.sql
git commit --no-verify -m "feat(messaging): V20 — channel_member.role + 탐색 인덱스"
```
> 참고: `src/main/generated/` 는 gitignored 이므로 add 되지 않는다(정상).

---

## Task B2: DTO 확장 + 기존 호출처 보정

> `ChannelResponse` 레코드 필드가 6→9 로 늘어난다. 모든 `new ChannelResponse(...)` 호출처가 깨지므로 이 Task 에서 전부 보정해 컴파일/기존 테스트를 녹색으로 되돌린다.

**Files:**
- Modify: `dto/ChannelResponse.java`, `dto/CreateChannelRequest.java`, `repository/ChannelRepository.java`
- Create: `dto/ChannelMemberResponse.java`, `dto/RenameChannelRequest.java`, `dto/AddMemberRequest.java`, `dto/UpdateRoleRequest.java`

- [ ] **Step 1: `ChannelResponse` 확장**

`dto/ChannelResponse.java` 전체 교체:
```java
package com.workplace.messaging.dto;

import java.time.Instant;

/**
 * 채널 1건 요약. caller 관점 필드 포함.
 *
 * @param member caller 가 멤버인지
 * @param role caller 의 채널 역할(OWNER/ADMIN/MEMBER), 비멤버면 null
 * @param archived 아카이브 여부
 * @param memberCount 멤버 수
 */
public record ChannelResponse(
    Long id,
    String kind,
    String name,
    String visibility,
    boolean member,
    String role,
    boolean archived,
    int memberCount,
    Instant createdAt) {}
```

- [ ] **Step 2: `CreateChannelRequest` 에 visibility 추가**

`dto/CreateChannelRequest.java` 전체 교체:
```java
package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 채널 생성 요청. visibility 가 null 이면 서비스에서 PUBLIC 으로 간주. */
public record CreateChannelRequest(
    @NotBlank @Size(min = 1, max = 80) String name, String visibility) {}
```

- [ ] **Step 3: 신규 DTO 4종 생성**

`dto/ChannelMemberResponse.java`:
```java
package com.workplace.messaging.dto;

import java.time.Instant;

/** 채널 멤버 1건. role 은 OWNER/ADMIN/MEMBER, kind 는 user.kind(HUMAN/AGENT). */
public record ChannelMemberResponse(
    Long userId, String name, String kind, String role, Instant joinedAt) {}
```

`dto/RenameChannelRequest.java`:
```java
package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 채널 이름 변경 요청. */
public record RenameChannelRequest(@NotBlank @Size(min = 1, max = 80) String name) {}
```

`dto/AddMemberRequest.java`:
```java
package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotNull;

/** 채널 멤버 추가 요청. */
public record AddMemberRequest(@NotNull Long userId) {}
```

`dto/UpdateRoleRequest.java`:
```java
package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotNull;

/** 멤버 역할 변경 요청. role: OWNER|ADMIN|MEMBER (값 검증은 서비스에서). */
public record UpdateRoleRequest(@NotNull String role) {}
```

- [ ] **Step 4: `ChannelRepository` 의 기존 매핑 보정 + `insertPublic` 위임화**

`repository/ChannelRepository.java` 에서 `insertPublic` 을 새 `insert` 로 위임하도록 바꾸고(다음 Task 에서 `insert` 본체 추가), `findAllWithMembership` 의 `new ChannelResponse(...)` 를 9-인자로 보정한다. 이 Task 에서는 **기존 동작 유지가 목표**이므로 role/archived/memberCount 에 안전한 기본값을 넣는다.

`findAllWithMembership` 의 select 절에 멤버수 서브쿼리를 추가하고 매핑을 교체:
```java
  /** 전체 공개 채널 + caller 멤버 여부. created_at 오름차순. (Phase 1 호환 — 사이드바는 Task B7 에서 findMyChannels 로 대체) */
  public List<ChannelResponse> findAllWithMembership(long callerId) {
    return dsl.select(
            CHANNEL.ID,
            CHANNEL.KIND,
            CHANNEL.NAME,
            CHANNEL.VISIBILITY,
            CHANNEL.ARCHIVED_AT,
            CHANNEL.CREATED_AT,
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER
                        .CHANNEL_ID
                        .eq(CHANNEL.ID)
                        .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("is_member"),
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID))
                .asField("member_count"),
            dsl.select(CHANNEL_MEMBER.ROLE)
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER
                        .CHANNEL_ID
                        .eq(CHANNEL.ID)
                        .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("my_role"))
        .from(CHANNEL)
        .where(CHANNEL.VISIBILITY.eq("PUBLIC").and(CHANNEL.ARCHIVED_AT.isNull()))
        .orderBy(CHANNEL.CREATED_AT.asc(), CHANNEL.ID.asc())
        .fetch(ChannelRepository::mapChannel);
  }
```

그리고 공용 매퍼와 `insertPublic` 위임을 추가(클래스 내부):
```java
  /** Record → ChannelResponse 공용 매퍼. select 절에 is_member/member_count/my_role 별칭이 있어야 한다. */
  static ChannelResponse mapChannel(org.jooq.Record r) {
    OffsetDateTime created = r.get(CHANNEL.CREATED_AT);
    Integer mc = r.get("is_member", Integer.class);
    Integer total = r.get("member_count", Integer.class);
    return new ChannelResponse(
        r.get(CHANNEL.ID),
        r.get(CHANNEL.KIND),
        r.get(CHANNEL.NAME),
        r.get(CHANNEL.VISIBILITY),
        mc != null && mc > 0,
        r.get("my_role", String.class),
        r.get(CHANNEL.ARCHIVED_AT) != null,
        total == null ? 0 : total,
        created == null ? null : created.toInstant());
  }

  /** 공개 채널 생성(하위호환 래퍼) — visibility=PUBLIC 으로 insert 위임. */
  public long insertPublic(String name, long createdBy) {
    return insert(name, "PUBLIC", createdBy);
  }
```

`findOne` 은 그대로(내부적으로 `findAllWithMembership` 사용) 두되, 다음 Task 에서 `findDetail` 로 대체 예정이므로 변경 없음.

- [ ] **Step 5: `insert` 스텁 추가 (본체는 B4 에서 확정, 여기선 컴파일용 최소 구현)**

`insertPublic` 이 호출하는 `insert` 를 추가:
```java
  /** 채널 생성 후 id 반환. kind 는 DB default('CHANNEL'). */
  public long insert(String name, String visibility, long createdBy) {
    return dsl.insertInto(CHANNEL)
        .set(CHANNEL.NAME, name)
        .set(CHANNEL.VISIBILITY, visibility)
        .set(CHANNEL.CREATED_BY, createdBy)
        .returning(CHANNEL.ID)
        .fetchOne()
        .getId();
  }
```
`import java.time.OffsetDateTime;` 가 이미 있는지 확인(없으면 추가).

- [ ] **Step 6: 기존 테스트가 녹색인지 확인**

Run: `./gradlew test --tests "com.workplace.messaging.*"`
Expected: 기존 MessageServiceTest/MessageRepositoryTest/MessageControllerTest/MessageSseFanOutTest 전부 PASS (ChannelResponse 매핑 보정·insert 위임이 동작).

- [ ] **Step 7: Commit**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/messaging/dto src/main/java/com/workplace/messaging/repository/ChannelRepository.java
git commit --no-verify -m "feat(messaging): ChannelResponse 확장(role/archived/memberCount) + DTO 추가"
```

---

## Task B3: 예외 3종 + GlobalExceptionHandler 매핑

**Files:**
- Create: `exception/ChannelForbiddenException.java`, `exception/ChannelArchivedException.java`, `exception/OwnershipTransferRequiredException.java`
- Modify: `global/exception/GlobalExceptionHandler.java`

- [ ] **Step 1: 예외 클래스 3종 생성**

`exception/ChannelForbiddenException.java`:
```java
package com.workplace.messaging.exception;

/** 채널 역할 권한 부족(이름변경/멤버관리/아카이브/역할변경 등). → 403. */
public class ChannelForbiddenException extends RuntimeException {
  public ChannelForbiddenException(long channelId, long userId, String action) {
    super("user " + userId + " forbidden to " + action + " on channel " + channelId);
  }
}
```

`exception/ChannelArchivedException.java`:
```java
package com.workplace.messaging.exception;

/** 아카이브된 채널에 메시지 전송/수정 시도. → 409. */
public class ChannelArchivedException extends RuntimeException {
  public ChannelArchivedException(long channelId) {
    super("channel " + channelId + " is archived");
  }
}
```

`exception/OwnershipTransferRequiredException.java`:
```java
package com.workplace.messaging.exception;

/** OWNER 가 소유권을 넘기지 않고 나가려 함. → 409. */
public class OwnershipTransferRequiredException extends RuntimeException {
  public OwnershipTransferRequiredException(long channelId) {
    super("owner must transfer ownership before leaving channel " + channelId);
  }
}
```

- [ ] **Step 2: GlobalExceptionHandler 에 매핑 추가**

`global/exception/GlobalExceptionHandler.java` 상단 import 영역에 추가:
```java
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.OwnershipTransferRequiredException;
```

기존 `handleChannelNotMember` 메서드 뒤에 추가:
```java
  @ExceptionHandler(ChannelForbiddenException.class)
  public ResponseEntity<ErrorResponse> handleChannelForbidden(
      ChannelForbiddenException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
  }

  @ExceptionHandler({ChannelArchivedException.class, OwnershipTransferRequiredException.class})
  public ResponseEntity<ErrorResponse> handleChannelConflict(
      RuntimeException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.CONFLICT).body(response);
  }
```

- [ ] **Step 3: 컴파일 확인**

Run: `./gradlew compileJava`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/messaging/exception src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java
git commit --no-verify -m "feat(messaging): 채널 권한/아카이브/소유권 예외 + 403/409 매핑"
```

---

## Task B4: ChannelMemberRepository 멤버/역할 메서드

**Files:**
- Modify: `repository/ChannelMemberRepository.java`
- Test: `src/test/java/com/workplace/messaging/repository/ChannelMemberRepositoryTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`src/test/java/com/workplace/messaging/repository/ChannelMemberRepositoryTest.java`:
```java
package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** channel_member 역할/멤버 관리 통합 테스트. */
class ChannelMemberRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "cm_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Cm" + s)
        .set(USER.EMAIL, "cm_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void add_withRole_thenFindRole() {
    long owner = seedUser();
    long ch = channelRepo.insert("일반", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");

    assertThat(memberRepo.findRole(ch, owner)).contains("OWNER");
    assertThat(memberRepo.findRole(ch, seedUser())).isEmpty();
    assertThat(memberRepo.countMembers(ch)).isEqualTo(1);
  }

  @Test
  void add_isIdempotent_doesNotDowngradeRole() {
    long owner = seedUser();
    long ch = channelRepo.insert("일반", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");
    memberRepo.add(ch, owner, "MEMBER"); // 재합류 — 기존 OWNER 유지되어야 함

    assertThat(memberRepo.findRole(ch, owner)).contains("OWNER");
  }

  @Test
  void updateRole_and_remove() {
    long owner = seedUser();
    long m = seedUser();
    long ch = channelRepo.insert("일반", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");
    memberRepo.add(ch, m, "MEMBER");

    memberRepo.updateRole(ch, m, "ADMIN");
    assertThat(memberRepo.findRole(ch, m)).contains("ADMIN");

    memberRepo.remove(ch, m);
    assertThat(memberRepo.isMember(ch, m)).isFalse();
    assertThat(memberRepo.countMembers(ch)).isEqualTo(1);
  }

  @Test
  void listMembers_includesNameKindRole() {
    long owner = seedUser();
    long ch = channelRepo.insert("일반", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");

    List<ChannelMemberResponse> members = memberRepo.listMembers(ch);
    assertThat(members).hasSize(1);
    ChannelMemberResponse only = members.get(0);
    assertThat(only.userId()).isEqualTo(owner);
    assertThat(only.role()).isEqualTo("OWNER");
    assertThat(only.kind()).isEqualTo("HUMAN");
    assertThat(only.name()).isNotBlank();
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests "com.workplace.messaging.repository.ChannelMemberRepositoryTest"`
Expected: 컴파일 실패(`add`/`findRole`/`updateRole`/`remove`/`countMembers`/`listMembers` 미정의).

- [ ] **Step 3: 메서드 구현**

`repository/ChannelMemberRepository.java` — 기존 `join` 은 그대로 두고(하위호환), 아래 메서드 추가. import 보강: `import static com.workplace.jooq.Tables.USER;`, `import com.workplace.messaging.dto.ChannelMemberResponse;`, `import java.time.OffsetDateTime;`, `import java.util.Optional;`.

```java
  /** 멤버 추가(역할 지정). 이미 멤버면 무시 — 기존 역할 보존(DO NOTHING). */
  public void add(long channelId, long userId, String role) {
    dsl.execute(
        "INSERT INTO channel_member (channel_id, user_id, role) VALUES (?, ?, ?)"
            + " ON CONFLICT (channel_id, user_id) DO NOTHING",
        channelId,
        userId,
        role);
  }

  /** caller 의 채널 역할. 비멤버면 empty. */
  public Optional<String> findRole(long channelId, long userId) {
    return dsl.select(CHANNEL_MEMBER.ROLE)
        .from(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .fetchOptional(CHANNEL_MEMBER.ROLE);
  }

  /** 역할 변경(승격/강등/소유권 이전). */
  public void updateRole(long channelId, long userId, String role) {
    dsl.update(CHANNEL_MEMBER)
        .set(CHANNEL_MEMBER.ROLE, role)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /** 멤버 제거. */
  public void remove(long channelId, long userId) {
    dsl.deleteFrom(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /** 멤버 수. */
  public int countMembers(long channelId) {
    return dsl.fetchCount(
        dsl.selectOne().from(CHANNEL_MEMBER).where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId)));
  }

  /** 멤버 목록 — user 조인(name, kind). joined_at 오름차순. */
  public List<ChannelMemberResponse> listMembers(long channelId) {
    return dsl.select(
            CHANNEL_MEMBER.USER_ID,
            USER.NAME,
            USER.KIND,
            CHANNEL_MEMBER.ROLE,
            CHANNEL_MEMBER.JOINED_AT)
        .from(CHANNEL_MEMBER)
        .join(USER)
        .on(USER.ID.eq(CHANNEL_MEMBER.USER_ID))
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId))
        .orderBy(CHANNEL_MEMBER.JOINED_AT.asc(), CHANNEL_MEMBER.USER_ID.asc())
        .fetch(
            r -> {
              OffsetDateTime joined = r.get(CHANNEL_MEMBER.JOINED_AT);
              return new ChannelMemberResponse(
                  r.get(CHANNEL_MEMBER.USER_ID),
                  r.get(USER.NAME),
                  r.get(USER.KIND),
                  r.get(CHANNEL_MEMBER.ROLE),
                  joined == null ? null : joined.toInstant());
            });
  }
```

> `join(channelId, userId)`(2-인자, role 미지정)는 DB DEFAULT 'MEMBER' 로 들어가므로 그대로 둔다. ChannelService.create 는 B7 에서 `add(ch, owner, "OWNER")` 로 바꾼다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew test --tests "com.workplace.messaging.repository.ChannelMemberRepositoryTest"`
Expected: 4개 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/messaging/repository/ChannelMemberRepository.java src/test/java/com/workplace/messaging/repository/ChannelMemberRepositoryTest.java
git commit --no-verify -m "feat(messaging): ChannelMemberRepository 역할/멤버 관리 메서드"
```

---

## Task B5: ChannelRepository 조회/CRUD 메서드

**Files:**
- Modify: `repository/ChannelRepository.java`
- Test: `src/test/java/com/workplace/messaging/repository/ChannelRepositoryTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`src/test/java/com/workplace/messaging/repository/ChannelRepositoryTest.java`:
```java
package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** channel 리포지토리 조회/CRUD 통합 테스트. */
class ChannelRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "cr_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Cr" + s)
        .set(USER.EMAIL, "cr_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void findMyChannels_onlyMemberAndNotArchived() {
    long u = seedUser();
    long mine = channelRepo.insert("내채널", "PRIVATE", u);
    memberRepo.add(mine, u, "OWNER");
    long other = channelRepo.insert("남채널", "PUBLIC", seedUser()); // u 비멤버
    long archived = channelRepo.insert("보관됨", "PUBLIC", u);
    memberRepo.add(archived, u, "OWNER");
    channelRepo.setArchived(archived, true);

    List<ChannelResponse> result = channelRepo.findMyChannels(u);
    assertThat(result).extracting(ChannelResponse::id).containsExactly(mine);
    ChannelResponse only = result.get(0);
    assertThat(only.member()).isTrue();
    assertThat(only.role()).isEqualTo("OWNER");
    assertThat(only.memberCount()).isEqualTo(1);
    assertThat(only.archived()).isFalse();
    // 남채널/보관됨 미포함 검증
    assertThat(result).extracting(ChannelResponse::id).doesNotContain(other, archived);
  }

  @Test
  void searchDiscoverable_publicNotArchived_matchesName_excludesPrivate() {
    long owner = seedUser();
    long pub = channelRepo.insert("공개-개발팀", "PUBLIC", owner);
    long priv = channelRepo.insert("비공개-개발팀", "PRIVATE", owner);
    long arch = channelRepo.insert("공개-보관-개발팀", "PUBLIC", owner);
    channelRepo.setArchived(arch, true);

    List<ChannelResponse> result = channelRepo.searchDiscoverable(seedUser(), "개발팀");
    assertThat(result).extracting(ChannelResponse::id).containsExactly(pub);
    assertThat(result).extracting(ChannelResponse::id).doesNotContain(priv, arch);
    assertThat(result.get(0).member()).isFalse();
    assertThat(result.get(0).role()).isNull();
  }

  @Test
  void searchDiscoverable_blankQuery_returnsAllPublic() {
    long owner = seedUser();
    long pub = channelRepo.insert("아무거나", "PUBLIC", owner);
    List<ChannelResponse> result = channelRepo.searchDiscoverable(seedUser(), "");
    assertThat(result).extracting(ChannelResponse::id).contains(pub);
  }

  @Test
  void findDetail_returnsRoleAndCount() {
    long owner = seedUser();
    long ch = channelRepo.insert("상세", "PRIVATE", owner);
    memberRepo.add(ch, owner, "OWNER");

    ChannelResponse detail = channelRepo.findDetail(ch, owner).orElseThrow();
    assertThat(detail.role()).isEqualTo("OWNER");
    assertThat(detail.member()).isTrue();
    assertThat(detail.memberCount()).isEqualTo(1);
    assertThat(detail.visibility()).isEqualTo("PRIVATE");

    // 비멤버 시점: member=false, role=null, 그래도 채널 자체는 조회됨(접근제어는 서비스 책임)
    ChannelResponse asOutsider = channelRepo.findDetail(ch, seedUser()).orElseThrow();
    assertThat(asOutsider.member()).isFalse();
    assertThat(asOutsider.role()).isNull();
  }

  @Test
  void rename_archive_unarchive_hardDelete() {
    long owner = seedUser();
    long ch = channelRepo.insert("원래이름", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");

    channelRepo.rename(ch, "새이름");
    assertThat(channelRepo.findDetail(ch, owner).orElseThrow().name()).isEqualTo("새이름");

    channelRepo.setArchived(ch, true);
    assertThat(channelRepo.isArchived(ch)).isTrue();
    channelRepo.setArchived(ch, false);
    assertThat(channelRepo.isArchived(ch)).isFalse();

    channelRepo.hardDelete(ch);
    assertThat(channelRepo.exists(ch)).isFalse();
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests "com.workplace.messaging.repository.ChannelRepositoryTest"`
Expected: 컴파일 실패(`findMyChannels`/`searchDiscoverable`/`findDetail`/`rename`/`setArchived`/`isArchived`/`hardDelete` 미정의).

- [ ] **Step 3: 메서드 구현**

`repository/ChannelRepository.java` 에 추가(`import org.jooq.impl.DSL;`, `import org.jooq.Condition;` 필요):

```java
  /** caller 가 멤버이고 아카이브되지 않은 채널 — 사이드바용. role/memberCount 포함, 이름 오름차순. */
  public List<ChannelResponse> findMyChannels(long callerId) {
    return dsl.select(
            CHANNEL.ID,
            CHANNEL.KIND,
            CHANNEL.NAME,
            CHANNEL.VISIBILITY,
            CHANNEL.ARCHIVED_AT,
            CHANNEL.CREATED_AT,
            DSL.inline(1).as("is_member"),
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID))
                .asField("member_count"),
            CHANNEL_MEMBER.ROLE.as("my_role"))
        .from(CHANNEL)
        .join(CHANNEL_MEMBER)
        .on(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
        .where(CHANNEL.ARCHIVED_AT.isNull())
        .orderBy(CHANNEL.NAME.asc(), CHANNEL.ID.asc())
        .fetch(ChannelRepository::mapChannel);
  }

  /** 공개·비아카이브 채널 탐색 — 이름 ILIKE. q 가 비면 전체 공개 채널. */
  public List<ChannelResponse> searchDiscoverable(long callerId, String q) {
    Condition base = CHANNEL.VISIBILITY.eq("PUBLIC").and(CHANNEL.ARCHIVED_AT.isNull());
    Condition filtered =
        (q == null || q.isBlank()) ? base : base.and(CHANNEL.NAME.likeIgnoreCase("%" + q.trim() + "%"));
    return dsl.select(
            CHANNEL.ID,
            CHANNEL.KIND,
            CHANNEL.NAME,
            CHANNEL.VISIBILITY,
            CHANNEL.ARCHIVED_AT,
            CHANNEL.CREATED_AT,
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("is_member"),
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID))
                .asField("member_count"),
            dsl.select(CHANNEL_MEMBER.ROLE)
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("my_role"))
        .from(CHANNEL)
        .where(filtered)
        .orderBy(CHANNEL.NAME.asc(), CHANNEL.ID.asc())
        .fetch(ChannelRepository::mapChannel);
  }

  /** 단건 상세 — visibility 무관 조회(접근제어는 서비스). caller 역할/멤버수 포함. */
  public Optional<ChannelResponse> findDetail(long channelId, long callerId) {
    return dsl.select(
            CHANNEL.ID,
            CHANNEL.KIND,
            CHANNEL.NAME,
            CHANNEL.VISIBILITY,
            CHANNEL.ARCHIVED_AT,
            CHANNEL.CREATED_AT,
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("is_member"),
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID))
                .asField("member_count"),
            dsl.select(CHANNEL_MEMBER.ROLE)
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("my_role"))
        .from(CHANNEL)
        .where(CHANNEL.ID.eq(channelId))
        .fetchOptional(ChannelRepository::mapChannel);
  }

  /** 채널 이름 변경. */
  public void rename(long channelId, String name) {
    dsl.update(CHANNEL).set(CHANNEL.NAME, name).where(CHANNEL.ID.eq(channelId)).execute();
  }

  /** 아카이브 토글 — true 면 archived_at=NOW(), false 면 NULL. */
  public void setArchived(long channelId, boolean archived) {
    dsl.update(CHANNEL)
        .set(CHANNEL.ARCHIVED_AT, archived ? OffsetDateTime.now() : null)
        .where(CHANNEL.ID.eq(channelId))
        .execute();
  }

  /** 아카이브 여부. */
  public boolean isArchived(long channelId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(CHANNEL)
            .where(CHANNEL.ID.eq(channelId).and(CHANNEL.ARCHIVED_AT.isNotNull())));
  }

  /** 하드 삭제 — channel_member/message 는 FK ON DELETE CASCADE 로 함께 삭제. */
  public void hardDelete(long channelId) {
    dsl.deleteFrom(CHANNEL).where(CHANNEL.ID.eq(channelId)).execute();
  }
```

> `setArchived` 의 `OffsetDateTime.now()` 는 jOOQ `TIMESTAMPTZ` 매핑에 맞는다. import 확인.

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew test --tests "com.workplace.messaging.repository.ChannelRepositoryTest"`
Expected: 5개 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/messaging/repository/ChannelRepository.java src/test/java/com/workplace/messaging/repository/ChannelRepositoryTest.java
git commit --no-verify -m "feat(messaging): ChannelRepository 조회/CRUD(my/discover/detail/rename/archive/delete)"
```

---

## Task B6: ChannelPermissions 권한 헬퍼

**Files:**
- Create: `service/ChannelPermissions.java`
- Test: `src/test/java/com/workplace/messaging/service/ChannelPermissionsTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`src/test/java/com/workplace/messaging/service/ChannelPermissionsTest.java`:
```java
package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThatCode;

import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** ChannelPermissions 권한 판정 통합 테스트. */
class ChannelPermissionsTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired ChannelPermissions perms;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "cp_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Cp" + s)
        .set(USER.EMAIL, "cp_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void requireMember_nonMemberOfPrivate_throws404() {
    long owner = seedUser();
    long ch = channelRepo.insert("비공개", "PRIVATE", owner);
    memberRepo.add(ch, owner, "OWNER");
    assertThatThrownBy(() -> perms.requireMember(ch, seedUser()))
        .isInstanceOf(ChannelNotFoundException.class);
  }

  @Test
  void requireManage_memberRole_throws403_ownerOk() {
    long owner = seedUser();
    long member = seedUser();
    long ch = channelRepo.insert("일반", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");
    memberRepo.add(ch, member, "MEMBER");

    assertThatThrownBy(() -> perms.requireManage(ch, member, "rename"))
        .isInstanceOf(ChannelForbiddenException.class);
    assertThatCode(() -> perms.requireManage(ch, owner, "rename")).doesNotThrowAnyException();
  }

  @Test
  void requireOwner_adminThrows403() {
    long owner = seedUser();
    long admin = seedUser();
    long ch = channelRepo.insert("일반", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");
    memberRepo.add(ch, admin, "ADMIN");
    assertThatThrownBy(() -> perms.requireOwner(ch, admin, "archive"))
        .isInstanceOf(ChannelForbiddenException.class);
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests "com.workplace.messaging.service.ChannelPermissionsTest"`
Expected: 컴파일 실패(`ChannelPermissions` 미정의).

- [ ] **Step 3: 구현**

`service/ChannelPermissions.java`:
```java
package com.workplace.messaging.service;

import com.workplace.global.security.PermissionChecker;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 채널 권한 판정 일원화. 채널 역할(OWNER/ADMIN/MEMBER) + 시스템 ADMIN 오버라이드.
 *
 * <p>비공개 채널 비멤버는 존재 은닉을 위해 404(ChannelNotFoundException)로 처리한다.
 */
@Component
@RequiredArgsConstructor
public class ChannelPermissions {

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final PermissionChecker permissionChecker;

  /** 시스템 ADMIN 여부. */
  public boolean isSystemAdmin(long userId) {
    return permissionChecker.userHasRole(userId, "ADMIN");
  }

  /**
   * 멤버 접근 보장. 멤버면 통과. 비멤버일 때: 공개 채널은 호출처가 별도 처리하도록 false 반환이 아니라,
   * 여기서는 "멤버여야 하는 동작" 전용이므로 비공개·공개 모두 비멤버면 차단한다. 단 존재 은닉을 위해
   * 비공개·비멤버는 404, 공개·비멤버는 403(ChannelNotMember 는 호출처에서 사용) — 여기선 비공개 404 처리.
   */
  public void requireMember(long channelId, long userId) {
    if (memberRepo.isMember(channelId, userId)) return;
    // 비멤버 — 비공개면 존재 은닉(404), 공개면 채널 없음과 구분되도록 동일하게 404 로 은닉하지 않고
    // 채널이 존재하면 ChannelNotFound 가 아닌 NotMember 의미가 필요하나, requireMember 사용처는
    // 비공개 상세/메시지뿐이므로 404 로 은닉한다.
    throw new ChannelNotFoundException(channelId);
  }

  /** 관리 권한(OWNER/ADMIN 또는 시스템 ADMIN) 보장. */
  public void requireManage(long channelId, long userId, String action) {
    if (isSystemAdmin(userId)) return;
    String role = memberRepo.findRole(channelId, userId).orElse(null);
    if ("OWNER".equals(role) || "ADMIN".equals(role)) return;
    throw new ChannelForbiddenException(channelId, userId, action);
  }

  /** 소유자 권한(OWNER 또는 시스템 ADMIN) 보장. */
  public void requireOwner(long channelId, long userId, String action) {
    if (isSystemAdmin(userId)) return;
    if (memberRepo.findRole(channelId, userId).filter("OWNER"::equals).isPresent()) return;
    throw new ChannelForbiddenException(channelId, userId, action);
  }

  /** 시스템 ADMIN 보장. */
  public void requireSystemAdmin(long userId, String action) {
    if (!isSystemAdmin(userId)) throw new ChannelForbiddenException(0L, userId, action);
  }

  /** caller 의 역할 조회(없으면 empty). */
  public Optional<String> roleOf(long channelId, long userId) {
    return memberRepo.findRole(channelId, userId);
  }
}
```

> `requireMember` 의 주석은 사용 맥락(비공개 상세/메시지 조회)을 명확히 한다. 공개 채널 메시지 조회의 비멤버 차단은 기존 `MessageService.ensureMember`(403)가 담당하므로 충돌 없음.

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew test --tests "com.workplace.messaging.service.ChannelPermissionsTest"`
Expected: 3개 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/messaging/service/ChannelPermissions.java src/test/java/com/workplace/messaging/service/ChannelPermissionsTest.java
git commit --no-verify -m "feat(messaging): ChannelPermissions 권한 헬퍼(역할 + 시스템 ADMIN 오버라이드)"
```

---

## Task B7: ChannelService 확장

**Files:**
- Modify: `service/ChannelService.java`
- Test: `src/test/java/com/workplace/messaging/service/ChannelServiceTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`src/test/java/com/workplace/messaging/service/ChannelServiceTest.java`:
```java
package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** ChannelService 통합 테스트 — 생성/탐색/내채널/관리 권한. */
class ChannelServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "cs_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Cs" + s)
        .set(USER.EMAIL, "cs_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void create_makesCallerOwner() {
    long u = seedUser();
    ChannelResponse ch = channelService.create(u, "새채널", "PRIVATE");
    assertThat(ch.visibility()).isEqualTo("PRIVATE");
    assertThat(ch.role()).isEqualTo("OWNER");
    assertThat(ch.member()).isTrue();
    assertThat(memberRepo.findRole(ch.id(), u)).contains("OWNER");
  }

  @Test
  void create_nullVisibility_defaultsPublic() {
    long u = seedUser();
    ChannelResponse ch = channelService.create(u, "기본공개", null);
    assertThat(ch.visibility()).isEqualTo("PUBLIC");
  }

  @Test
  void list_returnsOnlyMyChannels() {
    long u = seedUser();
    ChannelResponse mine = channelService.create(u, "내것", "PUBLIC");
    channelService.create(seedUser(), "남의것", "PUBLIC");
    List<ChannelResponse> result = channelService.list(u);
    assertThat(result).extracting(ChannelResponse::id).containsExactly(mine.id());
  }

  @Test
  void join_privateChannel_throws403() {
    long owner = seedUser();
    ChannelResponse priv = channelService.create(owner, "비공개", "PRIVATE");
    assertThatThrownBy(() -> channelService.join(seedUser(), priv.id()))
        .isInstanceOf(ChannelForbiddenException.class);
  }

  @Test
  void join_publicChannel_addsMember() {
    long owner = seedUser();
    long joiner = seedUser();
    ChannelResponse pub = channelService.create(owner, "공개", "PUBLIC");
    channelService.join(joiner, pub.id());
    assertThat(memberRepo.isMember(pub.id(), joiner)).isTrue();
  }

  @Test
  void getDetail_privateNonMember_throws404_publicPreviewOk() {
    long owner = seedUser();
    ChannelResponse priv = channelService.create(owner, "비공개", "PRIVATE");
    ChannelResponse pub = channelService.create(owner, "공개", "PUBLIC");

    assertThatThrownBy(() -> channelService.getDetail(seedUser(), priv.id()))
        .isInstanceOf(ChannelNotFoundException.class);
    // 공개 채널은 비멤버도 미리보기 가능
    ChannelResponse preview = channelService.getDetail(seedUser(), pub.id());
    assertThat(preview.member()).isFalse();
  }

  @Test
  void rename_byMember_throws403_byOwnerOk() {
    long owner = seedUser();
    long member = seedUser();
    ChannelResponse ch = channelService.create(owner, "원래", "PUBLIC");
    channelService.join(member, ch.id());

    assertThatThrownBy(() -> channelService.rename(member, ch.id(), "바꿈"))
        .isInstanceOf(ChannelForbiddenException.class);
    ChannelResponse renamed = channelService.rename(owner, ch.id(), "바꿈");
    assertThat(renamed.name()).isEqualTo("바꿈");
  }

  @Test
  void archive_unarchive_byOwner() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "보관대상", "PUBLIC");
    channelService.archive(owner, ch.id());
    assertThat(channelRepo.isArchived(ch.id())).isTrue();
    assertThat(channelService.list(owner)).extracting(ChannelResponse::id).doesNotContain(ch.id());
    channelService.unarchive(owner, ch.id());
    assertThat(channelRepo.isArchived(ch.id())).isFalse();
  }

  @Test
  void hardDelete_byNonAdmin_throws403() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "삭제대상", "PUBLIC");
    assertThatThrownBy(() -> channelService.hardDelete(owner, ch.id()))
        .isInstanceOf(ChannelForbiddenException.class);
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests "com.workplace.messaging.service.ChannelServiceTest"`
Expected: 컴파일 실패(`create(.,.,visibility)`/`discover`/`getDetail`/`rename`/`archive`/`unarchive`/`hardDelete` 미정의, `list` 의미 변경).

- [ ] **Step 3: 구현**

`service/ChannelService.java` 전체 교체:
```java
package com.workplace.messaging.service;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 채널 목록/탐색/생성/상세/관리(이름변경·아카이브·삭제). */
@Service
@RequiredArgsConstructor
public class ChannelService {

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final ChannelPermissions perms;

  /** 사이드바 — caller 가 멤버이고 아카이브되지 않은 채널만. */
  public List<ChannelResponse> list(long callerId) {
    return channelRepo.findMyChannels(callerId);
  }

  /** 탐색 — 공개·비아카이브 채널 검색(q ILIKE). */
  public List<ChannelResponse> discover(long callerId, String q) {
    return channelRepo.searchDiscoverable(callerId, q);
  }

  /** 채널 생성 — 생성자를 OWNER 로 add. visibility null → PUBLIC. */
  @Transactional
  public ChannelResponse create(long callerId, String name, String visibility) {
    String vis = normalizeVisibility(visibility);
    long channelId = channelRepo.insert(name, vis, callerId);
    memberRepo.add(channelId, callerId, "OWNER");
    return channelRepo
        .findDetail(channelId, callerId)
        .orElseThrow(() -> new ChannelNotFoundException(channelId));
  }

  /** 상세 — 공개 채널은 누구나, 비공개는 멤버만(비멤버 404 은닉). */
  public ChannelResponse getDetail(long callerId, long channelId) {
    ChannelResponse ch =
        channelRepo
            .findDetail(channelId, callerId)
            .orElseThrow(() -> new ChannelNotFoundException(channelId));
    if (!"PUBLIC".equals(ch.visibility()) && !ch.member()) {
      throw new ChannelNotFoundException(channelId); // 비공개 존재 은닉
    }
    return ch;
  }

  /** 공개 채널 참여 — 비공개면 403. idempotent. */
  @Transactional
  public void join(long callerId, long channelId) {
    ChannelResponse ch =
        channelRepo
            .findDetail(channelId, callerId)
            .orElseThrow(() -> new ChannelNotFoundException(channelId));
    if (!"PUBLIC".equals(ch.visibility())) {
      throw new ChannelForbiddenException(channelId, callerId, "join-private");
    }
    memberRepo.add(channelId, callerId, "MEMBER");
  }

  /** 이름 변경 — OWNER/ADMIN 또는 시스템 ADMIN. */
  @Transactional
  public ChannelResponse rename(long callerId, long channelId, String name) {
    ensureExists(channelId);
    perms.requireManage(channelId, callerId, "rename");
    channelRepo.rename(channelId, name);
    return channelRepo
        .findDetail(channelId, callerId)
        .orElseThrow(() -> new ChannelNotFoundException(channelId));
  }

  /** 아카이브 — OWNER 또는 시스템 ADMIN. */
  @Transactional
  public void archive(long callerId, long channelId) {
    ensureExists(channelId);
    perms.requireOwner(channelId, callerId, "archive");
    channelRepo.setArchived(channelId, true);
  }

  /** 아카이브 해제 — OWNER 또는 시스템 ADMIN. */
  @Transactional
  public void unarchive(long callerId, long channelId) {
    ensureExists(channelId);
    perms.requireOwner(channelId, callerId, "unarchive");
    channelRepo.setArchived(channelId, false);
  }

  /** 하드 삭제 — 시스템 ADMIN 만. */
  @Transactional
  public void hardDelete(long callerId, long channelId) {
    ensureExists(channelId);
    perms.requireSystemAdmin(callerId, "delete-channel");
    channelRepo.hardDelete(channelId);
  }

  private void ensureExists(long channelId) {
    if (!channelRepo.exists(channelId)) throw new ChannelNotFoundException(channelId);
  }

  private String normalizeVisibility(String visibility) {
    if (visibility == null || visibility.isBlank()) return "PUBLIC";
    String v = visibility.trim().toUpperCase();
    if (!v.equals("PUBLIC") && !v.equals("PRIVATE")) {
      throw new IllegalArgumentException("invalid visibility: " + visibility);
    }
    return v;
  }
}
```

> `list` 의미가 "전체 공개"→"내 채널"로 바뀐다. 기존 `findAllWithMembership` 는 B2 에서 남겨뒀으나 더 이상 서비스에서 쓰이지 않는다(테스트 호환용). YAGNI: 남은 참조가 없으면 B10 마무리에서 제거 검토.

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew test --tests "com.workplace.messaging.service.ChannelServiceTest"`
Expected: 9개 테스트 PASS.

- [ ] **Step 5: 기존 메시지 테스트 회귀 확인**

Run: `./gradlew test --tests "com.workplace.messaging.service.MessageServiceTest"`
Expected: PASS (channelService.join 시그니처 유지, create 시그니처는 MessageServiceTest 가 `channelRepo.insertPublic` + `channelService.join` 사용 — 영향 없음).

- [ ] **Step 6: Commit**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/messaging/service/ChannelService.java src/test/java/com/workplace/messaging/service/ChannelServiceTest.java
git commit --no-verify -m "feat(messaging): ChannelService — 탐색/내채널/생성(visibility)/상세/관리 권한"
```

---

## Task B8: ChannelMemberService (초대/제거/나가기/역할이전)

**Files:**
- Create: `service/ChannelMemberService.java`
- Test: `src/test/java/com/workplace/messaging/service/ChannelMemberServiceTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`src/test/java/com/workplace/messaging/service/ChannelMemberServiceTest.java`:
```java
package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.OwnershipTransferRequiredException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** ChannelMemberService 통합 테스트 — 초대/제거/나가기/소유권 이전. */
class ChannelMemberServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired ChannelMemberService memberService;
  @Autowired ChannelMemberRepository memberRepo;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "cms_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Cms" + s)
        .set(USER.EMAIL, "cms_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void add_byOwner_succeeds_byMemberForbidden() {
    long owner = seedUser();
    long target = seedUser();
    long bystander = seedUser();
    ChannelResponse ch = channelService.create(owner, "비공개", "PRIVATE");

    memberService.add(owner, ch.id(), target);
    assertThat(memberRepo.isMember(ch.id(), target)).isTrue();
    assertThat(memberRepo.findRole(ch.id(), target)).contains("MEMBER");

    // 멤버(권한없음)가 추가 시도 → 403
    assertThatThrownBy(() -> memberService.add(target, ch.id(), bystander))
        .isInstanceOf(ChannelForbiddenException.class);
  }

  @Test
  void remove_ownerCannotBeRemoved() {
    long owner = seedUser();
    long admin = seedUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), admin);
    memberService.updateRole(owner, ch.id(), admin, "ADMIN");

    assertThatThrownBy(() -> memberService.remove(admin, ch.id(), owner))
        .isInstanceOf(ChannelForbiddenException.class);
  }

  @Test
  void listMembers_memberOnly() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "비공개", "PRIVATE");
    List<ChannelMemberResponse> members = memberService.listMembers(owner, ch.id());
    assertThat(members).hasSize(1);
    // 비멤버 조회 → 404 은닉
    assertThatThrownBy(() -> memberService.listMembers(seedUser(), ch.id()))
        .isInstanceOf(RuntimeException.class);
  }

  @Test
  void leave_ownerWithMembers_throws409_thenTransferThenLeave() {
    long owner = seedUser();
    long other = seedUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), other);

    // OWNER 가 멤버 남긴 채 나가기 → 409
    assertThatThrownBy(() -> memberService.leave(owner, ch.id()))
        .isInstanceOf(OwnershipTransferRequiredException.class);

    // 소유권 이전: other 를 OWNER 로 → 본인은 ADMIN 강등
    memberService.updateRole(owner, ch.id(), other, "OWNER");
    assertThat(memberRepo.findRole(ch.id(), other)).contains("OWNER");
    assertThat(memberRepo.findRole(ch.id(), owner)).contains("ADMIN");

    // 이제 나가기 가능
    memberService.leave(owner, ch.id());
    assertThat(memberRepo.isMember(ch.id(), owner)).isFalse();
  }

  @Test
  void leave_soleOwner_throws409() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "혼자", "PRIVATE");
    assertThatThrownBy(() -> memberService.leave(owner, ch.id()))
        .isInstanceOf(OwnershipTransferRequiredException.class);
  }

  @Test
  void leave_member_succeeds() {
    long owner = seedUser();
    long member = seedUser();
    ChannelResponse ch = channelService.create(owner, "공개", "PUBLIC");
    channelService.join(member, ch.id());
    memberService.leave(member, ch.id());
    assertThat(memberRepo.isMember(ch.id(), member)).isFalse();
  }

  @Test
  void updateRole_transferOwner_demotesPreviousOwner() {
    long owner = seedUser();
    long target = seedUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), target);
    memberService.updateRole(owner, ch.id(), target, "OWNER");
    assertThat(memberRepo.findRole(ch.id(), owner)).contains("ADMIN");
    assertThat(memberRepo.findRole(ch.id(), target)).contains("OWNER");
  }

  @Test
  void updateRole_byNonOwner_throws403() {
    long owner = seedUser();
    long admin = seedUser();
    long member = seedUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), admin);
    memberService.updateRole(owner, ch.id(), admin, "ADMIN");
    memberService.add(owner, ch.id(), member);

    assertThatThrownBy(() -> memberService.updateRole(admin, ch.id(), member, "ADMIN"))
        .isInstanceOf(ChannelForbiddenException.class);
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests "com.workplace.messaging.service.ChannelMemberServiceTest"`
Expected: 컴파일 실패(`ChannelMemberService` 미정의).

- [ ] **Step 3: 구현**

`service/ChannelMemberService.java`:
```java
package com.workplace.messaging.service;

import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.exception.OwnershipTransferRequiredException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 채널 멤버 관리 — 목록/초대/제거/나가기/역할변경(소유권 이전). */
@Service
@RequiredArgsConstructor
public class ChannelMemberService {

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final ChannelPermissions perms;

  private static final List<String> VALID_ROLES = List.of("OWNER", "ADMIN", "MEMBER");

  /** 멤버 목록 — 멤버만(비공개 비멤버 404 은닉). */
  public List<ChannelMemberResponse> listMembers(long callerId, long channelId) {
    ensureExists(channelId);
    perms.requireMember(channelId, callerId);
    return memberRepo.listMembers(channelId);
  }

  /** 멤버 추가 — OWNER/ADMIN 또는 시스템 ADMIN. MEMBER 역할로 add(idempotent). */
  @Transactional
  public void add(long callerId, long channelId, long targetUserId) {
    ensureExists(channelId);
    perms.requireManage(channelId, callerId, "add-member");
    memberRepo.add(channelId, targetUserId, "MEMBER");
  }

  /** 멤버 제거 — OWNER/ADMIN. OWNER 는 제거 불가. */
  @Transactional
  public void remove(long callerId, long channelId, long targetUserId) {
    ensureExists(channelId);
    perms.requireManage(channelId, callerId, "remove-member");
    if (memberRepo.findRole(channelId, targetUserId).filter("OWNER"::equals).isPresent()) {
      throw new ChannelForbiddenException(channelId, callerId, "remove-owner");
    }
    memberRepo.remove(channelId, targetUserId);
  }

  /** 나가기 — 본인. OWNER 는 소유권 이전 전엔 나갈 수 없음. */
  @Transactional
  public void leave(long callerId, long channelId) {
    ensureExists(channelId);
    String role = memberRepo.findRole(channelId, callerId).orElse(null);
    if (role == null) return; // 이미 비멤버 — idempotent
    if ("OWNER".equals(role)) {
      throw new OwnershipTransferRequiredException(channelId);
    }
    memberRepo.remove(channelId, callerId);
  }

  /**
   * 역할 변경 — OWNER 만. role=OWNER 면 소유권 이전(대상 OWNER 승격 + 호출자 ADMIN 강등).
   * 한 트랜잭션으로 OWNER 1명 불변식 유지.
   */
  @Transactional
  public void updateRole(long callerId, long channelId, long targetUserId, String role) {
    ensureExists(channelId);
    String normalized = normalizeRole(role);
    perms.requireOwner(channelId, callerId, "update-role");
    if (memberRepo.findRole(channelId, targetUserId).isEmpty()) {
      throw new ChannelForbiddenException(channelId, callerId, "update-role-of-nonmember");
    }
    if ("OWNER".equals(normalized)) {
      // 소유권 이전 — 대상 OWNER, 기존 OWNER(호출자) ADMIN 강등
      memberRepo.updateRole(channelId, targetUserId, "OWNER");
      if (callerId != targetUserId) {
        memberRepo.updateRole(channelId, callerId, "ADMIN");
      }
    } else {
      // 대상이 현재 OWNER 인데 비-OWNER 로 강등하려 하면 차단(소유권 공백 방지)
      if (memberRepo.findRole(channelId, targetUserId).filter("OWNER"::equals).isPresent()) {
        throw new ChannelForbiddenException(channelId, callerId, "demote-owner");
      }
      memberRepo.updateRole(channelId, targetUserId, normalized);
    }
  }

  private void ensureExists(long channelId) {
    if (!channelRepo.exists(channelId)) throw new ChannelNotFoundException(channelId);
  }

  private String normalizeRole(String role) {
    String r = role == null ? "" : role.trim().toUpperCase();
    if (!VALID_ROLES.contains(r)) {
      throw new IllegalArgumentException("invalid role: " + role);
    }
    return r;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew test --tests "com.workplace.messaging.service.ChannelMemberServiceTest"`
Expected: 8개 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/messaging/service/ChannelMemberService.java src/test/java/com/workplace/messaging/service/ChannelMemberServiceTest.java
git commit --no-verify -m "feat(messaging): ChannelMemberService — 초대/제거/나가기/소유권 이전"
```

---

## Task B9: MessageService 아카이브 가드

**Files:**
- Modify: `service/MessageService.java`
- Test: `src/test/java/com/workplace/messaging/service/MessageServiceTest.java` (테스트 추가)

- [ ] **Step 1: 실패 테스트 추가**

`MessageServiceTest.java` 에 import 추가:
```java
import com.workplace.messaging.exception.ChannelArchivedException;
```
그리고 테스트 메서드를 클래스 내부에 추가. 아카이브 *상태*만 만들면 되므로(권한 검증 아님) 리포지토리로 직접 `setArchived` 한다:
```java
  @Test
  void create_onArchivedChannel_throws409() {
    long uid = seedUser();
    long channelId = channelRepo.insertPublic("보관채널", uid);
    channelService.join(uid, channelId); // uid 를 멤버로
    channelRepo.setArchived(channelId, true); // 리포지토리로 직접 아카이브 상태 설정

    assertThatThrownBy(
            () -> messageService.create(uid, channelId, new CreateMessageRequest("막힘")))
        .isInstanceOf(ChannelArchivedException.class);
  }
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests "com.workplace.messaging.service.MessageServiceTest"`
Expected: `create_onArchivedChannel_throws409` FAIL(아직 가드 없음 → 정상 전송됨).

- [ ] **Step 3: 가드 구현**

`service/MessageService.java` — `ChannelRepository` 주입 추가 + `create` 에 가드 추가:
```java
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.repository.ChannelRepository;
```
필드 추가:
```java
  private final ChannelRepository channelRepo;
```
`create` 의 `ensureMember(...)` 직후에 추가:
```java
    if (channelRepo.isArchived(channelId)) throw new ChannelArchivedException(channelId);
```

- [ ] **Step 4: 테스트 통과 + 메시징 전체 회귀 확인**

Run: `./gradlew test --tests "com.workplace.messaging.*"`
Expected: 전체 메시징 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/messaging/service/MessageService.java src/test/java/com/workplace/messaging/service/MessageServiceTest.java
git commit --no-verify -m "feat(messaging): 아카이브 채널 메시지 전송 차단(409)"
```

---

## Task B10: 컨트롤러 — ChannelController 확장 + ChannelMemberController

**Files:**
- Modify: `controller/ChannelController.java`
- Create: `controller/ChannelMemberController.java`
- Test: `src/test/java/com/workplace/messaging/controller/ChannelCrudControllerTest.java`

- [ ] **Step 1: 실패 테스트 작성 (@WebMvcTest, 권한/엔드포인트 라우팅)**

`MessageControllerTest.java` 의 인증 패턴을 그대로 따른다: `@Import({SecurityConfig, JwtAuthenticationFilter, ApiKeyAuthenticationFilter})` + JWT/권한 MockitoBean + `@BeforeEach` 로 토큰 "v"→userId 1L 매핑 + 요청에 `Authorization: Bearer v` 헤더 → `@AuthenticationPrincipal Long callerId = 1L`.

`src/test/java/com/workplace/messaging/controller/ChannelCrudControllerTest.java`:
```java
package com.workplace.messaging.controller;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.service.ChannelMemberService;
import com.workplace.messaging.service.ChannelService;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** 채널 CRUD/멤버 컨트롤러 라우팅·상태코드 매핑 테스트. 서비스는 Mockito 로 대체. */
@SuppressWarnings("null")
@WebMvcTest(controllers = {ChannelController.class, ChannelMemberController.class})
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class ChannelCrudControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;

  @MockitoBean ChannelService channelService;
  @MockitoBean ChannelMemberService memberService;
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
  void archive_returns204() throws Exception {
    mockMvc
        .perform(post("/api/v1/messaging/channels/5/archive").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(channelService).archive(eq(1L), eq(5L));
  }

  @Test
  void delete_forbidden_returns403() throws Exception {
    doThrow(new ChannelForbiddenException(5L, 1L, "delete-channel"))
        .when(channelService)
        .hardDelete(eq(1L), eq(5L));
    mockMvc
        .perform(delete("/api/v1/messaging/channels/5").header("Authorization", "Bearer v"))
        .andExpect(status().isForbidden());
  }

  @Test
  void rename_returns200() throws Exception {
    mockMvc
        .perform(
            patch("/api/v1/messaging/channels/5")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"새이름\"}"))
        .andExpect(status().isOk());
    verify(channelService).rename(eq(1L), eq(5L), eq("새이름"));
  }

  @Test
  void addMember_returns204() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/messaging/channels/5/members")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"userId\":42}"))
        .andExpect(status().isNoContent());
    verify(memberService).add(eq(1L), eq(5L), eq(42L));
  }
}
```
> `rename` 은 `channelService.rename(...)` 가 mock 이라 null 을 반환하므로 200 본문은 비어있다(상태코드·위임 검증이 목적). 필요 시 `when(channelService.rename(...)).thenReturn(...)` 로 본문을 채울 수 있으나 라우팅 검증엔 불필요.

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests "com.workplace.messaging.controller.ChannelCrudControllerTest"`
Expected: 컴파일 실패(`ChannelMemberController` 미정의, 신규 엔드포인트 없음).

- [ ] **Step 3: ChannelController 확장**

`controller/ChannelController.java` 전체 교체:
```java
package com.workplace.messaging.controller;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.dto.CreateChannelRequest;
import com.workplace.messaging.dto.RenameChannelRequest;
import com.workplace.messaging.service.ChannelService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 채널 목록/탐색/생성/상세/관리. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class ChannelController {

  private final ChannelService channelService;

  /** 내 채널(사이드바). */
  @GetMapping("/channels")
  public ResponseEntity<List<ChannelResponse>> list(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(channelService.list(callerId));
  }

  /** 공개 채널 탐색. */
  @GetMapping("/channels/discover")
  public ResponseEntity<List<ChannelResponse>> discover(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "q", required = false) String q) {
    return ResponseEntity.ok(channelService.discover(callerId, q));
  }

  /** 채널 생성. */
  @PostMapping("/channels")
  public ResponseEntity<ChannelResponse> create(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody CreateChannelRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(channelService.create(callerId, req.name(), req.visibility()));
  }

  /** 채널 상세. */
  @GetMapping("/channels/{id}")
  public ResponseEntity<ChannelResponse> detail(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    return ResponseEntity.ok(channelService.getDetail(callerId, channelId));
  }

  /** 이름 변경. */
  @PatchMapping("/channels/{id}")
  public ResponseEntity<ChannelResponse> rename(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @Valid @RequestBody RenameChannelRequest req) {
    return ResponseEntity.ok(channelService.rename(callerId, channelId, req.name()));
  }

  /** 아카이브. */
  @PostMapping("/channels/{id}/archive")
  public ResponseEntity<Void> archive(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    channelService.archive(callerId, channelId);
    return ResponseEntity.noContent().build();
  }

  /** 아카이브 해제. */
  @PostMapping("/channels/{id}/unarchive")
  public ResponseEntity<Void> unarchive(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    channelService.unarchive(callerId, channelId);
    return ResponseEntity.noContent().build();
  }

  /** 하드 삭제(시스템 ADMIN). */
  @DeleteMapping("/channels/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    channelService.hardDelete(callerId, channelId);
    return ResponseEntity.noContent().build();
  }

  /** 공개 채널 참여. */
  @PostMapping("/channels/{id}/join")
  public ResponseEntity<Void> join(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    channelService.join(callerId, channelId);
    return ResponseEntity.noContent().build();
  }
}
```

- [ ] **Step 4: ChannelMemberController 생성**

`controller/ChannelMemberController.java`:
```java
package com.workplace.messaging.controller;

import com.workplace.messaging.dto.AddMemberRequest;
import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.dto.UpdateRoleRequest;
import com.workplace.messaging.service.ChannelMemberService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 채널 멤버 관리 — 목록/초대/제거/나가기/역할변경. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging/channels/{id}")
public class ChannelMemberController {

  private final ChannelMemberService memberService;

  /** 멤버 목록. */
  @GetMapping("/members")
  public ResponseEntity<List<ChannelMemberResponse>> members(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    return ResponseEntity.ok(memberService.listMembers(callerId, channelId));
  }

  /** 멤버 추가. */
  @PostMapping("/members")
  public ResponseEntity<Void> add(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @Valid @RequestBody AddMemberRequest req) {
    memberService.add(callerId, channelId, req.userId());
    return ResponseEntity.noContent().build();
  }

  /** 멤버 제거. */
  @DeleteMapping("/members/{userId}")
  public ResponseEntity<Void> remove(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @PathVariable("userId") long targetUserId) {
    memberService.remove(callerId, channelId, targetUserId);
    return ResponseEntity.noContent().build();
  }

  /** 나가기. */
  @PostMapping("/leave")
  public ResponseEntity<Void> leave(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    memberService.leave(callerId, channelId);
    return ResponseEntity.noContent().build();
  }

  /** 역할 변경 / 소유권 이전. */
  @PatchMapping("/members/{userId}")
  public ResponseEntity<Void> updateRole(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @PathVariable("userId") long targetUserId,
      @Valid @RequestBody UpdateRoleRequest req) {
    memberService.updateRole(callerId, channelId, targetUserId, req.role());
    return ResponseEntity.noContent().build();
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `./gradlew test --tests "com.workplace.messaging.controller.ChannelCrudControllerTest"`
Expected: PASS (principal 주입을 MessageControllerTest 패턴으로 맞춘 뒤).

- [ ] **Step 6: 메시징 전체 + 전체 빌드 회귀**

Run: `./gradlew test --tests "com.workplace.messaging.*"` 후 `./gradlew build -x spotlessCheck` (또는 `./gradlew check`)
Expected: BUILD SUCCESSFUL.

- [ ] **Step 7: Commit**

```bash
./gradlew spotlessApply
git add src/main/java/com/workplace/messaging/controller src/test/java/com/workplace/messaging/controller/ChannelCrudControllerTest.java
git commit --no-verify -m "feat(messaging): 채널 CRUD/멤버 컨트롤러 — discover/detail/rename/archive/delete/members"
```

---

## 최종 검증 (모든 Task 후)

- [ ] `./gradlew test --tests "com.workplace.messaging.*"` 전체 PASS
- [ ] `./gradlew spotlessCheck` 통과
- [ ] 신규 API 엔드포인트 수동 확인(선택): 앱 부팅 후 `POST /channels {visibility:PRIVATE}` → 생성자 OWNER, 비멤버 `GET /channels/{id}` → 404.
- [ ] dead code 정리 검토: `ChannelRepository.findAllWithMembership`/`findOne` 가 더 이상 참조되지 않으면 제거(참조 시 grep 확인 후).

## 2b(프론트) 핸드오프 메모

이 API 가 머지되면 2b 플랜에서 다룰 것:
- `types/messaging.ts`: `ChannelResponse` 에 `role`/`archived`/`memberCount`, `ChannelVisibility`/`ChannelRole`/`ChannelMemberResponse`/`RenameChannelRequest` 추가. `CreateChannelRequest` 에 `visibility`.
- `e2e/factories/messaging.factory.ts`: `createChannel` 기본값에 `role:'OWNER'`, `archived:false`, `memberCount:1` 추가(필수 필드).
- `e2e/pages/chat.spec.ts`: 사이드바가 "내 채널"만 보이고 join 버튼이 탐색으로 이동했으므로 기존 가정 점검.
- 신규 컴포넌트: CreateChannelModal, ChannelBrowser, ChannelHeader, ChannelMembersPanel(MemberSearchPopover 재사용), 아카이브 시 MessageComposer 비활성.
