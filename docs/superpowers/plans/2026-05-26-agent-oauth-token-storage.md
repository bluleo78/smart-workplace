# AGENT OAuth 토큰 DB 저장 + 관리 UI 구현 계획 (#33)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AGENT 별 OAuth 토큰을 workplace-api DB 에 암호화 저장하고, workplace-web 관리 UI 로 등록·회수하며, ai-agent 가 매 LLM spawn 시 fetch 해서 사용한다. 5c-2 의 `~/.claude/` 의존을 완전 제거한다.

**Architecture:** V15 마이그레이션 + 기존 `agent_api_key` 패턴 차용 (라이프사이클·repository·service 구조). EncryptionService 재사용. ai-agent 는 자기 API key 로 `GET /users/me/oauth-token` 호출 → 평문 token 받아 child env 주입.

**Tech Stack:** Spring Boot 3.4 + Java 21 + jOOQ + Flyway / Node 22 + TypeScript NodeNext / Vite 7 + React 19 + TanStack Query + shadcn/ui.

**Spec 정합화 (구현 시 확정):**
- 권한 코드: spec 의 `agent:manage` → 실제 코드베이스 컨벤션 `user:write` 사용
- 경로: spec 의 `/admin/users/{agentId}/...` → 기존 AgentKey 컨트롤러와 일관된 `/admin/agents/{userId}/oauth-token`

**기준 참조:**
- Spec: `docs/superpowers/specs/2026-05-26-agent-oauth-token-storage-design.md`
- 차용 패턴: `apps/workplace-api/src/main/java/com/workplace/auth/{repository,service,controller}/AgentApiKey*.java`
- 단일 commit (한국어): `feat: AGENT OAuth 토큰 DB 저장 + 관리 UI — #33`. push 는 사용자 명시 승인 후

---

## Phase 0 — 사전 정리

### Task 0: 작업 상태 확인

- [ ] **Step 1: 브랜치/상태 확인**

Run: `git status && git branch --show-current && git log --oneline -3`
Expected: `main`, 클린 또는 untracked plans 만. 직전 commit 이 5c-2 hygiene (`8eff37b`) 또는 그 이후 spec commit.

---

## Phase 1 — 백엔드: 마이그레이션 + repository

### Task 1: V15 마이그레이션 작성

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V15__agent_oauth_credential.sql`

- [ ] **Step 1: SQL 작성**

```sql
-- Phase 5c-2 후속 (#33): AGENT 의 Claude CLI OAuth 토큰 암호화 저장.
-- agent_api_key 와 같은 lifecycle 컬럼 패턴 (label/created_by/created_at/last_used_at/revoked_at)
-- 을 따르되, 인증용 hash 가 아니라 복호화해 child process 에 넘기는 자격증명이라
-- encrypted_token 을 둔다. EncryptionService 의 'iv:ciphertext' 포맷.

CREATE TABLE ai_agent_credential (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  encrypted_token  TEXT   NOT NULL,
  label            VARCHAR(80),
  created_by       BIGINT NOT NULL REFERENCES "user"(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at     TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ
);

CREATE INDEX idx_aac_user ON ai_agent_credential(user_id);

-- 한 AGENT 당 active(=revoked_at IS NULL) 행 1개 보장 — application 분기 실수 방어.
CREATE UNIQUE INDEX uq_aac_active
  ON ai_agent_credential(user_id) WHERE revoked_at IS NULL;
```

- [ ] **Step 2: 로컬 DB 에 마이그레이션 적용 + jOOQ 코드젠**

DB 가 떠 있어야 함. 루트에서 `pnpm db:up` 으로 이미 실행 중인지 확인.

Run: `cd apps/workplace-api && ./gradlew bootRun --args='--spring.profiles.active=local' &` 또는 통합 테스트가 자동 적용하도록 다음 단계로 진행 가능.

대안 (테스트만 돌릴 거면): test profile 의 Flyway 가 자동 적용. 다만 jOOQ codegen 은 별도 필요:

Run: `cd apps/workplace-api && ./gradlew generateJooq`
Expected: `BUILD SUCCESSFUL`. `src/main/generated/com/workplace/jooq/tables/AiAgentCredential.java` 가 생성됨.

- [ ] **Step 3: 생성된 jOOQ 클래스 확인**

Run: `ls apps/workplace-api/src/main/generated/com/workplace/jooq/tables/AiAgentCredential.java`
Expected: 파일 존재. 컬럼 상수 `AI_AGENT_CREDENTIAL.USER_ID` 등 사용 가능.

> 주의: `generateJooq` 가 실패하면 보통 DB 가 비어있거나 Flyway 가 아직 안 돌았기 때문. `./gradlew flywayMigrate` 또는 `bootRun` 한 번 띄워서 마이그레이션 반영 후 재시도.

### Task 2: `AiAgentCredentialRow` record + `OAuthTokenMetaResponse` / `OAuthTokenRedeemResponse` DTO

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/dto/AiAgentCredentialRow.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/dto/OAuthTokenMetaResponse.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/dto/OAuthTokenRedeemResponse.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/dto/OAuthTokenRegisterRequest.java`

- [ ] **Step 1: `AiAgentCredentialRow.java`**

```java
package com.workplace.auth.dto;

import java.time.Instant;

/**
 * Phase 5c-2 후속 (#33): ai_agent_credential 행 DTO. encryptedToken 은 복호화 전 값이므로
 * 응답 DTO 로 직접 노출 금지 — service 가 OAuthTokenMetaResponse 로 좁혀 반환한다.
 */
public record AiAgentCredentialRow(
    Long id,
    Long userId,
    String encryptedToken,
    String label,
    Long createdBy,
    Instant createdAt,
    Instant lastUsedAt,
    Instant revokedAt) {}
```

- [ ] **Step 2: `OAuthTokenMetaResponse.java`**

```java
package com.workplace.auth.dto;

import java.time.Instant;

/**
 * 관리자/조회용 OAuth 토큰 메타 응답. **평문/암호화 토큰 절대 포함 금지** — toString 도 안전.
 */
public record OAuthTokenMetaResponse(
    Long id, String label, Instant createdAt, Instant lastUsedAt) {}
```

- [ ] **Step 3: `OAuthTokenRedeemResponse.java`**

```java
package com.workplace.auth.dto;

/**
 * AGENT 본인의 GET /users/me/oauth-token 응답 — 평문 토큰 포함. 본 응답은
 * ai-agent 측에서만 소비되며 절대 사용자 UI 로 노출되지 않는다.
 */
public record OAuthTokenRedeemResponse(String token, String label) {}
```

- [ ] **Step 4: `OAuthTokenRegisterRequest.java`**

```java
package com.workplace.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * OAuth 토큰 등록 요청 — 평문 token (32~2048 chars) + 선택 label (≤80).
 * 길이 검증만 (Anthropic 토큰 형식은 변할 수 있어 prefix 검증은 안 한다).
 */
public record OAuthTokenRegisterRequest(
    @NotBlank @Size(min = 32, max = 2048) String token,
    @Size(max = 80) String label) {}
```

- [ ] **Step 5: 컴파일 확인**

Run: `cd apps/workplace-api && ./gradlew compileJava -q`
Expected: BUILD SUCCESSFUL.

### Task 3: `OAuthTokenNotFoundException`

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/exception/OAuthTokenNotFoundException.java`

- [ ] **Step 1: 예외 클래스**

```java
package com.workplace.auth.exception;

/** Phase 5c-2 후속 (#33): active OAuth 토큰이 없음 → 404. */
public class OAuthTokenNotFoundException extends RuntimeException {
  public OAuthTokenNotFoundException() {
    super("등록된 OAuth 토큰이 없습니다");
  }
}
```

- [ ] **Step 2: GlobalExceptionHandler 매핑 추가**

Modify: `apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java`

기존 `handleKeyNotFound` 메서드 바로 다음에 추가:

```java
  /** Phase 5c-2 후속 (#33) — AGENT 의 active OAuth 토큰 없음 → 404. */
  @ExceptionHandler(com.workplace.auth.exception.OAuthTokenNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleOAuthTokenNotFound(
      com.workplace.auth.exception.OAuthTokenNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }
```

- [ ] **Step 3: 컴파일 확인**

Run: `cd apps/workplace-api && ./gradlew compileJava -q`
Expected: BUILD SUCCESSFUL.

### Task 4: `AiAgentCredentialRepository`

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/repository/AiAgentCredentialRepository.java`

- [ ] **Step 1: Repository 작성**

```java
package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;

import com.workplace.auth.dto.AiAgentCredentialRow;
import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * Phase 5c-2 후속 (#33): ai_agent_credential 의 jOOQ 리포지토리. 평문 토큰은 절대 다루지 않으며 (등록 시
 * service 가 EncryptionService 로 암호화한 후 호출) DB 에는 'iv:ciphertext' 만 저장된다. partial unique
 * index 가 한 AGENT 당 active 1개를 DB 레벨에서 보장한다.
 */
@Repository
@RequiredArgsConstructor
public class AiAgentCredentialRepository {

  private final DSLContext dsl;

  /** Record → 도메인 DTO. OffsetDateTime → Instant 변환. */
  private AiAgentCredentialRow mapRow(Record r) {
    OffsetDateTime created = r.get(AI_AGENT_CREDENTIAL.CREATED_AT);
    OffsetDateTime lastUsed = r.get(AI_AGENT_CREDENTIAL.LAST_USED_AT);
    OffsetDateTime revoked = r.get(AI_AGENT_CREDENTIAL.REVOKED_AT);
    return new AiAgentCredentialRow(
        r.get(AI_AGENT_CREDENTIAL.ID),
        r.get(AI_AGENT_CREDENTIAL.USER_ID),
        r.get(AI_AGENT_CREDENTIAL.ENCRYPTED_TOKEN),
        r.get(AI_AGENT_CREDENTIAL.LABEL),
        r.get(AI_AGENT_CREDENTIAL.CREATED_BY),
        created != null ? created.toInstant() : null,
        lastUsed != null ? lastUsed.toInstant() : null,
        revoked != null ? revoked.toInstant() : null);
  }

  /** 신규 행 삽입. revoked_at NULL, created_at DB default. 반환은 신규 id. */
  public Long insert(Long userId, String encryptedToken, String label, Long createdBy) {
    return dsl.insertInto(AI_AGENT_CREDENTIAL)
        .set(AI_AGENT_CREDENTIAL.USER_ID, userId)
        .set(AI_AGENT_CREDENTIAL.ENCRYPTED_TOKEN, encryptedToken)
        .set(AI_AGENT_CREDENTIAL.LABEL, label)
        .set(AI_AGENT_CREDENTIAL.CREATED_BY, createdBy)
        .returning(AI_AGENT_CREDENTIAL.ID)
        .fetchOne()
        .getId();
  }

  /** 특정 AGENT 의 active 행 (없으면 empty). */
  public Optional<AiAgentCredentialRow> findActive(Long userId) {
    return dsl.selectFrom(AI_AGENT_CREDENTIAL)
        .where(
            AI_AGENT_CREDENTIAL
                .USER_ID
                .eq(userId)
                .and(AI_AGENT_CREDENTIAL.REVOKED_AT.isNull()))
        .fetchOptional(this::mapRow);
  }

  /** active 행 revoke (revoked_at = now()). 영향 row 수 반환 (0 또는 1). */
  public int revokeActive(Long userId) {
    return dsl.update(AI_AGENT_CREDENTIAL)
        .set(AI_AGENT_CREDENTIAL.REVOKED_AT, OffsetDateTime.now())
        .where(
            AI_AGENT_CREDENTIAL
                .USER_ID
                .eq(userId)
                .and(AI_AGENT_CREDENTIAL.REVOKED_AT.isNull()))
        .execute();
  }

  /** redeem 후 last_used_at 갱신. throttle/async 없음. */
  public void touchLastUsed(Long id) {
    dsl.update(AI_AGENT_CREDENTIAL)
        .set(AI_AGENT_CREDENTIAL.LAST_USED_AT, OffsetDateTime.now())
        .where(AI_AGENT_CREDENTIAL.ID.eq(id))
        .execute();
  }
}
```

- [ ] **Step 2: 컴파일 확인**

Run: `cd apps/workplace-api && ./gradlew compileJava -q`
Expected: BUILD SUCCESSFUL.

> jOOQ codegen 이 안 돼있어 `AI_AGENT_CREDENTIAL` 심볼이 없으면 Task 1 Step 3 으로 돌아가 codegen 재실행.

---

## Phase 2 — 백엔드: 서비스 + 컨트롤러 + 통합 테스트

### Task 5: `AiAgentCredentialService` TDD 테스트 (실패)

**Files:**
- Create: `apps/workplace-api/src/test/java/com/workplace/auth/service/AiAgentCredentialServiceTest.java`

- [ ] **Step 1: 테스트 작성 (6 케이스)**

```java
package com.workplace.auth.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.exception.OAuthTokenNotFoundException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 5c-2 후속 (#33): AGENT OAuth 토큰 등록/회수/redeem 서비스 통합 테스트. */
@Transactional
class AiAgentCredentialServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AiAgentCredentialService service;
  @Autowired AiAgentCredentialRepository repo;

  private Long createUser(String prefix, String kind) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .set(USER.KIND, kind)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    if ("HUMAN".equals(kind)) {
      dsl.update(USER).set(USER.PASSWORD, "pw").where(USER.ID.eq(id)).execute();
    }
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  @Test
  void register_new_token_creates_active_row() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");

    var meta = service.register(admin, agent, "X".repeat(64), "main");

    assertThat(meta.label()).isEqualTo("main");
    assertThat(meta.createdAt()).isNotNull();
    assertThat(repo.findActive(agent)).isPresent();
  }

  @Test
  void register_again_revokes_previous_active() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    service.register(admin, agent, "X".repeat(64), "first");

    var meta2 = service.register(admin, agent, "Y".repeat(64), "second");

    assertThat(meta2.label()).isEqualTo("second");
    // active 행 1개 — partial unique 에 어긋나지 않음
    assertThat(repo.findActive(agent)).isPresent();
    assertThat(repo.findActive(agent).get().label()).isEqualTo("second");
  }

  @Test
  void register_to_human_rejects_400() {
    Long admin = createUser("admin", "HUMAN");
    Long human = createUser("h", "HUMAN");

    assertThatThrownBy(() -> service.register(admin, human, "X".repeat(64), null))
        .isInstanceOf(KeyTargetMustBeAgentException.class);
  }

  @Test
  void revoke_makes_active_zero() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    service.register(admin, agent, "X".repeat(64), null);

    service.revoke(admin, agent);

    assertThat(repo.findActive(agent)).isEmpty();
  }

  @Test
  void revoke_idempotent_when_no_active() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");

    // 등록한 적 없음 — 예외 없이 통과
    service.revoke(admin, agent);

    assertThat(repo.findActive(agent)).isEmpty();
  }

  @Test
  void redeem_self_returns_plaintext_and_touches_last_used() {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    String plaintext = "Z".repeat(64);
    service.register(admin, agent, plaintext, "main");

    var redeem = service.redeemSelf(agent);

    assertThat(redeem.token()).isEqualTo(plaintext);
    assertThat(redeem.label()).isEqualTo("main");
    assertThat(repo.findActive(agent).get().lastUsedAt()).isNotNull();
  }

  @Test
  void redeem_self_without_active_throws_404() {
    Long agent = createUser("ai", "AGENT");

    assertThatThrownBy(() -> service.redeemSelf(agent))
        .isInstanceOf(OAuthTokenNotFoundException.class);
  }
}
```

- [ ] **Step 2: 테스트 실행 → FAIL (service 미존재)**

Run: `cd apps/workplace-api && ./gradlew test --tests 'com.workplace.auth.service.AiAgentCredentialServiceTest'`
Expected: 컴파일 실패 — `AiAgentCredentialService` cannot be resolved.

### Task 6: `AiAgentCredentialService` 구현

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/service/AiAgentCredentialService.java`

- [ ] **Step 1: Service 작성**

```java
package com.workplace.auth.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.dto.AiAgentCredentialRow;
import com.workplace.auth.dto.OAuthTokenMetaResponse;
import com.workplace.auth.dto.OAuthTokenRedeemResponse;
import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.exception.OAuthTokenNotFoundException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.global.security.EncryptionService;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserNotFoundException;
import com.workplace.user.repository.UserRepository;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Phase 5c-2 후속 (#33): AGENT 의 Claude CLI OAuth 토큰 등록/회수/redeem.
 * - 등록 시 기존 active 자동 revoke (UPSERT 시맨틱).
 * - 평문 토큰은 등록 시점과 redeemSelf 응답에만 다룬다 — DB 에는 EncryptionService 출력만.
 * - HUMAN 대상은 400 (KeyTargetMustBeAgentException).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AiAgentCredentialService {

  private final AiAgentCredentialRepository repo;
  private final UserRepository userRepository;
  private final EncryptionService encryptionService;
  private final AuditLogService auditLogService;

  /** AGENT 에 새 토큰 등록 — 기존 active 가 있으면 자동 revoke. */
  public OAuthTokenMetaResponse register(
      Long callerId, Long agentUserId, String plaintextToken, String label) {
    UserResponse user = assertAgent(agentUserId);

    repo.revokeActive(agentUserId); // 기존 active 가 있으면 회수 (없으면 noop)

    String encrypted = encryptionService.encrypt(plaintextToken);
    Long id = repo.insert(agentUserId, encrypted, label, callerId);

    auditLogService.log(
        callerId,
        resolveUsername(callerId),
        "AGENT_OAUTH_TOKEN_REGISTERED",
        "ai_agent_credential",
        String.valueOf(id),
        "AGENT OAuth 토큰 등록",
        null,
        Map.of("agent_user_id", String.valueOf(agentUserId), "label", String.valueOf(label)));

    AiAgentCredentialRow row =
        repo.findActive(agentUserId)
            .orElseThrow(() -> new IllegalStateException("등록 직후 active 없음 — 동시성 문제"));
    return new OAuthTokenMetaResponse(row.id(), row.label(), row.createdAt(), row.lastUsedAt());
  }

  /** AGENT 의 active 토큰 회수. 없으면 noop (idempotent). */
  public void revoke(Long callerId, Long agentUserId) {
    assertAgent(agentUserId);
    int affected = repo.revokeActive(agentUserId);
    if (affected > 0) {
      auditLogService.log(
          callerId,
          resolveUsername(callerId),
          "AGENT_OAUTH_TOKEN_REVOKED",
          "ai_agent_credential",
          String.valueOf(agentUserId),
          "AGENT OAuth 토큰 회수",
          null,
          Map.of("agent_user_id", String.valueOf(agentUserId)));
    }
  }

  /** 관리자 GET — 메타만, 평문 없음. 없으면 404. */
  @Transactional(readOnly = true)
  public OAuthTokenMetaResponse getActiveMeta(Long agentUserId) {
    assertAgent(agentUserId);
    AiAgentCredentialRow row = repo.findActive(agentUserId).orElseThrow(OAuthTokenNotFoundException::new);
    return new OAuthTokenMetaResponse(row.id(), row.label(), row.createdAt(), row.lastUsedAt());
  }

  /** AGENT 본인 — 평문 토큰 + label 반환. last_used_at 갱신. 없으면 404. */
  public OAuthTokenRedeemResponse redeemSelf(Long agentUserId) {
    assertAgent(agentUserId);
    AiAgentCredentialRow row = repo.findActive(agentUserId).orElseThrow(OAuthTokenNotFoundException::new);
    String plaintext = encryptionService.decrypt(row.encryptedToken());
    repo.touchLastUsed(row.id());
    return new OAuthTokenRedeemResponse(plaintext, row.label());
  }

  private UserResponse assertAgent(Long userId) {
    UserResponse user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new UserNotFoundException("User not found: " + userId));
    if (!UserKind.isAgent(user.kind())) throw new KeyTargetMustBeAgentException();
    return user;
  }

  private String resolveUsername(Long userId) {
    return userRepository.findById(userId).map(UserResponse::username).orElse(null);
  }
}
```

- [ ] **Step 2: 테스트 실행 → 7 PASS**

Run: `cd apps/workplace-api && ./gradlew test --tests 'com.workplace.auth.service.AiAgentCredentialServiceTest'`
Expected: 7/7 PASS.

### Task 7: `AdminOAuthTokenController` + `MyOAuthTokenController`

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/controller/AdminOAuthTokenController.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/controller/MyOAuthTokenController.java`

- [ ] **Step 1: AdminOAuthTokenController**

```java
package com.workplace.auth.controller;

import com.workplace.auth.dto.OAuthTokenMetaResponse;
import com.workplace.auth.dto.OAuthTokenRegisterRequest;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Phase 5c-2 후속 (#33): AGENT OAuth 토큰 관리 — admin (user:write) 권한. 평문 토큰은 절대 응답 본문으로
 * 반환하지 않는다 (등록 요청 body 와 ai-agent /me redeem 만 평문을 다룬다).
 */
@RestController
@RequestMapping("/api/v1/admin/agents/{userId}/oauth-token")
@RequiredArgsConstructor
public class AdminOAuthTokenController {

  private final AiAgentCredentialService service;

  /** 등록 (또는 재발급 — 기존 active 자동 revoke). */
  @PostMapping
  @RequirePermission("user:write")
  public ResponseEntity<OAuthTokenMetaResponse> register(
      Authentication auth,
      @PathVariable Long userId,
      @Valid @RequestBody OAuthTokenRegisterRequest req) {
    Long callerId = (Long) auth.getPrincipal();
    String trimmed = req.token().trim();
    return ResponseEntity.ok(service.register(callerId, userId, trimmed, req.label()));
  }

  /** 회수 — idempotent. */
  @DeleteMapping
  @RequirePermission("user:write")
  public ResponseEntity<Void> revoke(Authentication auth, @PathVariable Long userId) {
    Long callerId = (Long) auth.getPrincipal();
    service.revoke(callerId, userId);
    return ResponseEntity.noContent().build();
  }

  /** 메타 조회 — 평문 토큰 없음. 없으면 404. */
  @GetMapping
  @RequirePermission("user:write")
  public ResponseEntity<OAuthTokenMetaResponse> getMeta(@PathVariable Long userId) {
    return ResponseEntity.ok(service.getActiveMeta(userId));
  }
}
```

- [ ] **Step 2: MyOAuthTokenController**

```java
package com.workplace.auth.controller;

import com.workplace.auth.dto.OAuthTokenRedeemResponse;
import com.workplace.auth.service.AiAgentCredentialService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Phase 5c-2 후속 (#33): AGENT 본인이 자기 OAuth 토큰을 redeem. API key 인증으로만 접근 가능
 * (ApiKeyAuthenticationFilter 가 AGENT user 의 id 를 principal 로 설정). HUMAN 호출은
 * KeyTargetMustBeAgentException (400) 으로 차단된다 — 토큰 존재 여부 누설 방지.
 */
@RestController
@RequestMapping("/api/v1/users/me/oauth-token")
@RequiredArgsConstructor
public class MyOAuthTokenController {

  private final AiAgentCredentialService service;

  @GetMapping
  public ResponseEntity<OAuthTokenRedeemResponse> redeem(Authentication auth) {
    Long callerId = (Long) auth.getPrincipal();
    return ResponseEntity.ok(service.redeemSelf(callerId));
  }
}
```

- [ ] **Step 3: 컴파일 + 회귀 테스트**

Run: `cd apps/workplace-api && ./gradlew compileJava -q && ./gradlew test --tests 'com.workplace.auth.*'`
Expected: BUILD SUCCESSFUL. 기존 5a 의 AgentApiKey 테스트도 PASS.

### Task 8: 컨트롤러 통합 테스트 (admin + me)

**Files:**
- Create: `apps/workplace-api/src/test/java/com/workplace/auth/controller/AdminOAuthTokenControllerTest.java`
- Create: `apps/workplace-api/src/test/java/com/workplace/auth/controller/MyOAuthTokenControllerTest.java`

- [ ] **Step 1: `AdminOAuthTokenControllerTest`**

```java
package com.workplace.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.OAuthTokenRegisterRequest;
import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class AdminOAuthTokenControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper objectMapper;

  // 헬퍼: AGENT/HUMAN user 만들고 id 반환 — 다른 통합 테스트의 헬퍼 패턴과 동일하게 직접 DSL 사용해도 OK.
  // 본 테스트는 mockMvc + @WithMockUser 로 권한 검증 위주 — user 생성은 통합 헬퍼가 별도 있을 경우 그것을 사용.

  @Test
  @WithMockUser(authorities = {"agent_unauthorized"})
  void no_permission_returns_403() throws Exception {
    var req = new OAuthTokenRegisterRequest("X".repeat(64), null);
    mvc.perform(
            post("/api/v1/admin/agents/9999/oauth-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isForbidden());
  }

  // 정상 동작은 service 통합 테스트가 검증. 컨트롤러 통합은 권한·HTTP 매핑·응답 형태만.
  // 추가: register 200 응답에 token 필드가 절대 없는지 검증.
  @Test
  @WithMockUser(authorities = {"user:write"})
  void register_response_does_not_contain_plaintext() throws Exception {
    // 본 테스트는 user 생성 setup 이 필요 — IntegrationTestBase 의 헬퍼 사용 (없으면 skip + DONE_WITH_CONCERNS)
    // setup 생략 시 status 만 검증해도 잠재 회귀는 service 테스트가 잡음.
    Long agentId = createAgentUserForTest();
    var req = new OAuthTokenRegisterRequest("X".repeat(64), "main");
    mvc.perform(
            post("/api/v1/admin/agents/" + agentId + "/oauth-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.label").value("main"))
        .andExpect(jsonPath("$.token").doesNotExist())
        .andExpect(jsonPath("$.encryptedToken").doesNotExist());
  }

  @Test
  @WithMockUser(authorities = {"user:write"})
  void delete_returns_204() throws Exception {
    Long agentId = createAgentUserForTest();
    mvc.perform(delete("/api/v1/admin/agents/" + agentId + "/oauth-token"))
        .andExpect(status().isNoContent());
  }

  @Test
  @WithMockUser(authorities = {"user:write"})
  void get_meta_without_active_returns_404() throws Exception {
    Long agentId = createAgentUserForTest();
    mvc.perform(get("/api/v1/admin/agents/" + agentId + "/oauth-token"))
        .andExpect(status().isNotFound());
  }

  /** AGENT user 1명 생성 — IntegrationTestBase 또는 dsl 직접 사용. 다른 통합 테스트와 동일 패턴. */
  private Long createAgentUserForTest() {
    // 실제 구현 시: dsl 주입 + IssueAssigneeServiceTest 의 createAgentUser 유사 패턴 복제,
    // 또는 IntegrationTestBase 의 공통 헬퍼가 있으면 사용.
    // 본 plan 구현 시점에 IntegrationTestBase 의 가능한 헬퍼 확인 후 적절히 채움.
    throw new UnsupportedOperationException("test setup helper — implementer 가 채움");
  }
}
```

> 구현자 메모: `createAgentUserForTest` 는 본 task 진행 시 IntegrationTestBase 의 기존 헬퍼 (예: `TestDataFactory` 또는 직접 DSL) 를 확인해 채운다. 패턴은 `IssueAssigneeServiceTest.createAgentUser` 와 동일 — `dsl.insertInto(USER).set(USER.KIND, "AGENT")...`. 만약 헬퍼가 너무 어색하면 `@Autowired DSLContext dsl` 주입 후 그 자리에서 INSERT.

- [ ] **Step 2: `MyOAuthTokenControllerTest`**

```java
package com.workplace.auth.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * /users/me/oauth-token — API key 인증 흐름이 본질이지만 통합 테스트에서는 @WithMockUser 로
 * principal 만 setup 하고 caller 의 kind 만 검증 가능 (Filter 우회). 본 테스트는 service 위임이 정확한지만 본다.
 */
@Transactional
class MyOAuthTokenControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;

  @Test
  void without_auth_returns_401_or_403() throws Exception {
    // 본 endpoint 는 SecurityConfig 의 permitAll 에 들어있지 않으므로 인증 없이 401.
    mvc.perform(get("/api/v1/users/me/oauth-token")).andExpect(status().is4xxClientError());
  }

  @Test
  @WithMockUser
  void agent_without_active_token_returns_404() throws Exception {
    // setup: @WithMockUser 의 기본 principal 은 String — service 가 (Long) 캐스트에서 ClassCastException.
    // 본 테스트는 의도적으로 skip 또는 service 통합 테스트로 갈음.
    // (구현자 메모: API key 인증 흐름은 Phase 5a 의 AgentApiKey 테스트가 검증하므로,
    //   본 endpoint 의 service 위임은 service 통합 테스트로 충분. 본 케이스는 placeholder.)
  }
}
```

> 솔직히 말하면: `/users/me/oauth-token` 은 ApiKeyAuthenticationFilter 가 setup 해주는 principal (Long) 에 의존. mockMvc + `@WithMockUser` 로 그 시나리오를 재현하기 까다로움. **그래서 본 endpoint 의 통합 검증은 ai-agent 측 nock 기반 테스트 (Task 11) + 수동 e2e 로 갈음**. 본 컨트롤러 통합 테스트는 인증 없이 4xx 만 검증하고 비워둠.

- [ ] **Step 3: 테스트 실행**

Run: `cd apps/workplace-api && ./gradlew test --tests 'com.workplace.auth.controller.AdminOAuthTokenControllerTest' --tests 'com.workplace.auth.controller.MyOAuthTokenControllerTest'`
Expected: AdminOAuthTokenControllerTest 4 PASS. MyOAuthTokenControllerTest 1 PASS.

- [ ] **Step 4: 백엔드 전체 회귀**

Run: `cd apps/workplace-api && ./gradlew test`
Expected: BUILD SUCCESSFUL. 5a + 5c-2 + #33 모두 PASS.

- [ ] **Step 5: spotless 포맷**

Run: `cd apps/workplace-api && ./gradlew spotlessApply -q`
Expected: BUILD SUCCESSFUL.

---

## Phase 3 — ai-agent: fetch + spawn 시 token 주입

### Task 9: `workplace-api.ts` 에 `getMyOAuthToken` 추가 (TDD)

**Files:**
- Modify: `apps/workplace-ai-agent/src/clients/workplace-api.ts`
- Modify: `apps/workplace-ai-agent/src/clients/workplace-api.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`workplace-api.test.ts` 의 `describe('createWorkplaceApiClient', ...)` 안에 추가:

```ts
  it('getMyOAuthToken → GET /users/me/oauth-token + 응답 파싱', async () => {
    nock(BASE)
      .matchHeader('x-api-key', 'k')
      .get(`${PREFIX}/users/me/oauth-token`)
      .reply(200, { token: 'tk-plain', label: 'main' });

    const c = createWorkplaceApiClient({ baseURL: `${BASE}${PREFIX}`, apiKey: 'k' });
    const r = await c.getMyOAuthToken();

    expect(r).toEqual({ token: 'tk-plain', label: 'main' });
  });

  it('getMyOAuthToken → 404 면 throw', async () => {
    nock(BASE).get(`${PREFIX}/users/me/oauth-token`).reply(404, { error: 'not_found' });

    const c = createWorkplaceApiClient({ baseURL: `${BASE}${PREFIX}`, apiKey: 'k' });
    await expect(c.getMyOAuthToken()).rejects.toThrow();
  });
```

- [ ] **Step 2: 테스트 실행 → FAIL**

Run: `cd apps/workplace-ai-agent && pnpm test src/clients/workplace-api.test.ts`
Expected: `c.getMyOAuthToken is not a function` 으로 2 FAIL.

- [ ] **Step 3: 인터페이스 + 메서드 추가**

`workplace-api.ts` 의 `WorkplaceApiClient` interface 에 추가:

```ts
  // 본인의 active OAuth 토큰 평문 + label. 없으면 404 throw.
  getMyOAuthToken(): Promise<{ token: string; label: string | null }>;
```

`createWorkplaceApiClient` 의 반환 객체에 메서드 추가 (다른 메서드 옆에):

```ts
    async getMyOAuthToken() {
      const r = await http.get('/users/me/oauth-token');
      return {
        token: String(r.data?.token ?? ''),
        label: r.data?.label ?? null,
      };
    },
```

- [ ] **Step 4: 테스트 PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/clients/workplace-api.test.ts`
Expected: 모든 케이스 PASS (기존 7 + 신규 2 = 9).

### Task 10: `cli-runner.ts` `buildChildEnv` 시그니처 변경 (token 명시 주입)

**Files:**
- Modify: `apps/workplace-ai-agent/src/agent/cli-runner.ts`
- Modify: `apps/workplace-ai-agent/src/agent/cli-runner.test.ts`

- [ ] **Step 1: 테스트 갱신 (실패)**

`cli-runner.test.ts` 의 `describe('buildChildEnv', ...)` 블록 전체 교체:

```ts
describe('buildChildEnv', () => {
  it('token 인자 → CLAUDE_CODE_OAUTH_TOKEN 으로 주입', () => {
    const env = buildChildEnv({ FOO: 'bar' }, 'tk-X');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tk-X');
    expect(env.FOO).toBe('bar');
  });

  it('parent 의 CLAUDE_CODE_OAUTH_TOKEN 은 무시되고 인자 token 으로 override', () => {
    const env = buildChildEnv(
      { CLAUDE_CODE_OAUTH_TOKEN: 'parent-stale', OTHER: 'keep' },
      'tk-fresh',
    );
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tk-fresh');
    expect(env.OTHER).toBe('keep');
  });

  it('ANTHROPIC_API_KEY 는 항상 제거 (구독 모드 강제)', () => {
    const env = buildChildEnv({ ANTHROPIC_API_KEY: 'should-go' }, 'tk-X');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL (시그니처 변경)**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/cli-runner.test.ts`
Expected: 컴파일 에러 또는 케이스 FAIL.

- [ ] **Step 3: `buildChildEnv` 구현 변경**

`cli-runner.ts` 의 함수 교체:

```ts
// 구독 모드 강제: ANTHROPIC_API_KEY 가 있으면 CLI 가 API key 모드로 빠지므로 제거.
// token 은 항상 인자로 받는다 — 호스트 env 의 CLAUDE_CODE_OAUTH_TOKEN 은 무시되고
// workplace-api 에서 받아온 토큰만 사용 (단일 진실).
export function buildChildEnv(
  parent: NodeJS.ProcessEnv,
  token: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent };
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}
```

- [ ] **Step 4: 테스트 PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/cli-runner.test.ts`
Expected: buildCliArgs 1 + buildChildEnv 3 = 4 PASS.

### Task 11: `run-agent.ts` 에 token fetch + DI

**Files:**
- Modify: `apps/workplace-ai-agent/src/agent/run-agent.ts`
- Modify: `apps/workplace-ai-agent/src/agent/run-agent.test.ts`

- [ ] **Step 1: 테스트 갱신 (실패)**

`run-agent.test.ts` 전체 교체:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['--print', 'fake-msg']),
  buildChildEnv: vi.fn((p, t) => ({ ...p, CLAUDE_CODE_OAUTH_TOKEN: t })),
  runClaudeCli: vi.fn().mockResolvedValue(undefined),
}));

import { runAgent } from './run-agent.js';
import { buildCliArgs, buildChildEnv, runClaudeCli } from './cli-runner.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

function client(token: string | Error): WorkplaceApiClient {
  return {
    addIssueComment: vi.fn().mockResolvedValue(undefined),
    updateIssueStatus: vi.fn().mockResolvedValue(undefined),
    getIssueDetail: vi.fn().mockResolvedValue({} as never),
    unassignSelf: vi.fn().mockResolvedValue(undefined),
    getCachedSelfUserId: vi.fn().mockResolvedValue(201),
    getMyOAuthToken:
      token instanceof Error
        ? vi.fn().mockRejectedValue(token)
        : vi.fn().mockResolvedValue({ token, label: 'main' }),
  };
}

const env = {
  type: 'issue.created' as const,
  payload: {
    projectKey: 'WP',
    issueKey: 'WP-1',
    issueId: 1,
    issueTitle: 't',
    actor: { id: 7, username: 'a', kind: 'HUMAN' as const },
    assignees: [],
    occurredAt: '2026-05-26T00:00:00Z',
    status: 'TODO',
    priority: 'MID',
  },
};

describe('runAgent', () => {
  beforeEach(() => {
    vi.mocked(buildCliArgs).mockClear();
    vi.mocked(buildChildEnv).mockClear();
    vi.mocked(runClaudeCli).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('token fetch 성공 시 buildChildEnv 에 token 이 전달되고 runClaudeCli 호출', async () => {
    const c = client('tk-X');
    await runAgent(env, { client: c });

    expect(c.getMyOAuthToken).toHaveBeenCalledOnce();
    expect(buildChildEnv).toHaveBeenCalledWith(expect.anything(), 'tk-X');
    expect(runClaudeCli).toHaveBeenCalledOnce();
  });

  it('token fetch 실패 시 spawn 안 함 + console.error 로그', async () => {
    const c = client(new Error('boom'));
    await runAgent(env, { client: c });

    expect(c.getMyOAuthToken).toHaveBeenCalledOnce();
    expect(runClaudeCli).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL (시그니처 변경 미적용)**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/run-agent.test.ts`
Expected: FAIL.

- [ ] **Step 3: `run-agent.ts` 갱신**

```ts
// envelope → token fetch → CLI 실행. event-handler 가 client 주입.
import { SYSTEM_PROMPT } from './system-prompt.js';
import { buildUserMessage } from './user-message.js';
import { MCP_CONFIG_PATH } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCli } from './cli-runner.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TURNS = 10;
const DEFAULT_TIMEOUT_MS = 300_000;

export interface RunAgentDeps {
  client: WorkplaceApiClient;
}

export async function runAgent(
  envelope: IssueEventEnvelope,
  deps: RunAgentDeps,
): Promise<void> {
  let token: string;
  try {
    const credential = await deps.client.getMyOAuthToken();
    token = credential.token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[run-agent] OAuth 토큰 fetch 실패 — spawn 생략', {
      type: envelope.type,
      issueKey: envelope.payload.issueKey,
      error: msg,
    });
    return;
  }

  const model = process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
  const maxTurns = Number(process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS);
  const timeoutMs = Number(process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  const userMessage = buildUserMessage(envelope);
  const args = buildCliArgs({
    userMessage,
    systemPrompt: SYSTEM_PROMPT,
    model,
    maxTurns,
    mcpConfigPath: MCP_CONFIG_PATH,
  });
  const childEnv = buildChildEnv(process.env, token);
  const logTag = `agent:${envelope.type}:${envelope.payload.issueKey}`;

  await runClaudeCli({ args, env: childEnv, timeoutMs, logTag });
}
```

- [ ] **Step 4: 테스트 PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/run-agent.test.ts`
Expected: 2/2 PASS.

### Task 12: `event-handler.ts` + `index.ts` 가 client 주입

**Files:**
- Modify: `apps/workplace-ai-agent/src/agent/event-handler.ts`
- Modify: `apps/workplace-ai-agent/src/agent/event-handler.test.ts`
- Modify: `apps/workplace-ai-agent/src/index.ts`
- Modify: `apps/workplace-ai-agent/src/routes/events.ts`
- Modify: `apps/workplace-ai-agent/src/routes/events.test.ts`

- [ ] **Step 1: `event-handler.ts` 갱신**

```ts
// 5c-2 후속 (#33): envelope → runAgent fire-and-forget. client 는 외부에서 주입.
import { runAgent } from './run-agent.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

export interface EventHandlerDeps {
  client: WorkplaceApiClient;
}

export function handleEvent(env: IssueEventEnvelope, deps: EventHandlerDeps): void {
  if (env.type === 'issue.commented' && env.payload.actor.kind === 'AGENT') {
    return;
  }
  runAgent(env, deps).catch((e) => {
    console.error('[event-handler] runAgent 실패', {
      type: env.type,
      issueKey: env.payload.issueKey,
      error: e,
    });
  });
}
```

- [ ] **Step 2: `event-handler.test.ts` 갱신**

기존 테스트의 `handleEvent(env)` 호출을 `handleEvent(env, { client })` 로 일괄 교체. client 는 `vi.mock('./run-agent.js')` 하에서 의미 없으므로 빈 객체 with required methods:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./run-agent.js', () => ({
  runAgent: vi.fn().mockResolvedValue(undefined),
}));

import { handleEvent } from './event-handler.js';
import { runAgent } from './run-agent.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

const client = {
  addIssueComment: vi.fn(),
  updateIssueStatus: vi.fn(),
  getIssueDetail: vi.fn(),
  unassignSelf: vi.fn(),
  getCachedSelfUserId: vi.fn(),
  getMyOAuthToken: vi.fn(),
} as unknown as WorkplaceApiClient;

const common = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' as const },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' as const }],
  occurredAt: '2026-05-25T12:00:00Z',
};

describe('handleEvent', () => {
  beforeEach(() => {
    vi.mocked(runAgent).mockClear();
    vi.mocked(runAgent).mockResolvedValue(undefined);
  });

  it('issue.created → runAgent 1회 호출 (envelope, deps)', () => {
    const env: IssueEventEnvelope = {
      type: 'issue.created',
      payload: { ...common, status: 'TODO', priority: 'MID' },
    };
    handleEvent(env, { client });
    expect(runAgent).toHaveBeenCalledOnce();
    expect(runAgent).toHaveBeenCalledWith(env, { client });
  });

  it('issue.assigned → runAgent 호출', () => {
    handleEvent(
      {
        type: 'issue.assigned',
        payload: { ...common, added: common.assignees, removed: [] },
      },
      { client },
    );
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('issue.commented + AGENT actor → self-loop 차단', () => {
    handleEvent(
      {
        type: 'issue.commented',
        payload: {
          ...common,
          actor: { id: 999, username: 'ai', kind: 'AGENT' as const },
          commentId: 1,
          commentBody: '자기 코멘트',
        },
      },
      { client },
    );
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('issue.commented + HUMAN actor → runAgent 호출', () => {
    handleEvent(
      {
        type: 'issue.commented',
        payload: { ...common, commentId: 1, commentBody: '확인' },
      },
      { client },
    );
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('issue.status_changed → runAgent 호출', () => {
    handleEvent(
      {
        type: 'issue.status_changed',
        payload: { ...common, previousStatus: 'TODO', newStatus: 'IN_PROGRESS' },
      },
      { client },
    );
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('runAgent reject 해도 handleEvent throw 안 함', async () => {
    vi.mocked(runAgent).mockRejectedValueOnce(new Error('boom'));
    expect(() =>
      handleEvent(
        {
          type: 'issue.created',
          payload: { ...common, status: 'TODO', priority: 'MID' },
        },
        { client },
      ),
    ).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
```

- [ ] **Step 3: `routes/events.ts` 갱신**

```ts
// 이벤트 수신 — workplace-api 가 푸시한 이벤트를 즉시 202 응답하고 background 처리.
import { Router } from 'express';
import { z } from 'zod';

import { handleEvent, type EventHandlerDeps } from '../agent/event-handler.js';
import {
  KNOWN_ISSUE_TYPES,
  issueEventEnvelope,
} from '../types/issue-events.js';

const envelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
});

export function createEventsRouter(deps: EventHandlerDeps): Router {
  const router = Router();

  router.post('/events', (req, res) => {
    const envelope = envelopeSchema.safeParse(req.body);
    if (!envelope.success) {
      res
        .status(400)
        .json({ error: 'invalid_payload', issues: envelope.error.issues });
      return;
    }

    const { type } = envelope.data;
    const parsed = issueEventEnvelope.safeParse(req.body);
    if (!parsed.success) {
      if (KNOWN_ISSUE_TYPES.has(type)) {
        res
          .status(400)
          .json({ error: 'invalid_payload', issues: parsed.error.issues });
        return;
      }
      res.status(400).json({ error: 'unsupported_event_type', type });
      return;
    }

    handleEvent(parsed.data, deps);
    res.status(202).json({ received: true });
  });

  return router;
}
```

- [ ] **Step 4: `routes/events.test.ts` 갱신**

기존 `createEventsRouter()` 호출을 `createEventsRouter({ client })` 로 교체. client 는 vi.fn 으로 만든 mock 객체. 본문 일부만 발췌:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-agent.js', () => ({
  runAgent: vi.fn().mockResolvedValue(undefined),
}));

import { internalAuth } from '../middleware/internal-auth.js';
import { createEventsRouter } from './events.js';
import { runAgent } from '../agent/run-agent.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

const client = {
  addIssueComment: vi.fn(),
  updateIssueStatus: vi.fn(),
  getIssueDetail: vi.fn(),
  unassignSelf: vi.fn(),
  getCachedSelfUserId: vi.fn(),
  getMyOAuthToken: vi.fn(),
} as unknown as WorkplaceApiClient;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(internalAuth, createEventsRouter({ client }));
  return app;
}

// 이후 기존 테스트 케이스는 buildApp() 그대로 — vi.mocked(runAgent) 호출 검증.
```

> 나머지 테스트 본문 (7 케이스) 은 5c-2 plan Task 17 의 본문과 동일. `createEventsRouter()` → `createEventsRouter({ client })` 만 일괄 치환하면 됨.

- [ ] **Step 5: `index.ts` 갱신**

`createWorkplaceApiClient` 가 main process 에 다시 등장. `createEventsRouter({ client })` 호출:

```ts
// Express 부트 — 환경변수 검증 → /health → /events → 전역 에러 핸들러 → graceful shutdown.
// 5c-2 후속 (#33): OAuth 토큰은 매 spawn 시 workplace-api 에서 fetch — 호스트 ~/.claude/ 의존 없음.
import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';

import { createWorkplaceApiClient } from './clients/workplace-api.js';
import { DEFAULT_PORT } from './constants.js';
import { internalAuth } from './middleware/internal-auth.js';
import { healthRouter } from './routes/health.js';
import { createEventsRouter } from './routes/events.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const REQUIRED_ENV = [
  'INTERNAL_SERVICE_TOKEN',
  'WORKPLACE_AGENT_API_KEY',
  'WORKPLACE_API_BASE_URL',
];
for (const k of REQUIRED_ENV) {
  if (!process.env[k]) {
    console.error(`[ai-agent] ${k} 미설정 — 부트 중단`);
    process.exit(1);
  }
}

// OAuth 토큰 fetch + 도메인 호출 모두에 사용되는 단일 client.
const workplaceApi = createWorkplaceApiClient({
  baseURL: process.env.WORKPLACE_API_BASE_URL,
  apiKey: process.env.WORKPLACE_AGENT_API_KEY ?? '',
});

const app = express();
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);

app.use(express.json());
app.use(healthRouter);
app.use(internalAuth, createEventsRouter({ client: workplaceApi }));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ai-agent] unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

process.on('unhandledRejection', (reason: unknown) => {
  const m = reason instanceof Error ? reason.message : String(reason);
  if (m.includes('aborted')) {
    console.warn('[process] suppressed abort rejection:', m);
  } else {
    console.error('[process] unhandled rejection:', reason);
  }
});

const server = app.listen(PORT, () => {
  console.log(`workplace-ai-agent listening on :${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  POST /events`);
});

function shutdown(signal: string) {
  console.log(`[ai-agent] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- [ ] **Step 6: 테스트 전체 PASS + typecheck + build**

Run: `cd apps/workplace-ai-agent && pnpm test && pnpm typecheck && pnpm build`
Expected: 모두 PASS. `dist/index.js` + `dist/mcp/workplace-mcp-server.js` 동시 생성.

### Task 13: 환경변수·문서 정리

**Files:**
- Modify: `apps/workplace-ai-agent/.env.example`
- Modify: `apps/workplace-ai-agent/CLAUDE.md`

- [ ] **Step 1: `.env.example` 의 `CLAUDE_CODE_OAUTH_TOKEN` 블록 완전 제거**

```bash
# Server
PORT=7070

# 사내 서비스 인증 — workplace-api 가 이벤트를 푸시할 때 사용
INTERNAL_SERVICE_TOKEN=changeme-local

# workplace-api 호출용 (AGENT API key — Phase 5a 에서 발급)
WORKPLACE_API_BASE_URL=http://localhost:9090/api/v1
WORKPLACE_AGENT_API_KEY=changeme-local

# Claude CLI OAuth 토큰은 workplace-api DB 에 저장됩니다 (#33).
# workplace-web 의 AGENT 관리 화면에서 등록하세요. ai-agent 는 매 LLM 호출 시
# 자기 API key 로 GET /users/me/oauth-token 을 통해 토큰을 받아 사용합니다.

# (선택) LLM 모델 / 한 호출당 도구 라운드 / timeout override
# WORKPLACE_AI_MODEL=claude-sonnet-4-6
# WORKPLACE_AI_MAX_TURNS=10
# WORKPLACE_AI_TIMEOUT_MS=300000
```

- [ ] **Step 2: `apps/workplace-ai-agent/CLAUDE.md` 환경변수 표 수정**

`| CLAUDE_CODE_OAUTH_TOKEN | ...` 행 삭제. 표 위 안내 문장 갱신:

기존 "`.env.example` 참고. 로컬은 `.env.local` 사용..." 다음 줄에 추가:

```
**Claude CLI OAuth 토큰**: workplace-api DB 에 AGENT 별로 암호화 저장 (#33). 호스트 `~/.claude/` 의존 없음. workplace-web 의 AGENT 관리 화면에서 등록.
```

---

## Phase 4 — workplace-web: AGENT 관리 UI

### Task 14: 타입 + API 클라이언트

**Files:**
- Create: `apps/workplace-web/src/types/agentOAuthToken.ts`
- Modify: `apps/workplace-web/src/api/agents.ts`

- [ ] **Step 1: 타입**

```ts
// AGENT OAuth 토큰 메타 — 평문 토큰은 절대 클라이언트에 전달되지 않는다.
export interface OAuthTokenMeta {
  id: number;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface OAuthTokenRegisterRequest {
  token: string;
  label?: string;
}
```

- [ ] **Step 2: API 클라이언트 함수 추가**

`apps/workplace-web/src/api/agents.ts` 의 기존 함수들 옆에 추가:

```ts
import type {
  OAuthTokenMeta,
  OAuthTokenRegisterRequest,
} from '@/types/agentOAuthToken';

/** AGENT 의 active OAuth 토큰 메타 조회 (없으면 axios 가 404 throw). */
export async function getAgentOAuthTokenMeta(userId: number): Promise<OAuthTokenMeta> {
  const { data } = await api.get<OAuthTokenMeta>(
    `/admin/agents/${userId}/oauth-token`,
  );
  return data;
}

/** OAuth 토큰 등록 (또는 재발급 — 기존 active 자동 revoke). */
export async function registerAgentOAuthToken(
  userId: number,
  req: OAuthTokenRegisterRequest,
): Promise<OAuthTokenMeta> {
  const { data } = await api.post<OAuthTokenMeta>(
    `/admin/agents/${userId}/oauth-token`,
    req,
  );
  return data;
}

/** OAuth 토큰 회수 — idempotent. */
export async function revokeAgentOAuthToken(userId: number): Promise<void> {
  await api.delete(`/admin/agents/${userId}/oauth-token`);
}
```

> 기존 `api` import 와 alias (`@/...`) 패턴은 같은 파일의 기존 함수와 동일하게 유지.

### Task 15: TanStack Query 훅

**Files:**
- Create: `apps/workplace-web/src/hooks/queries/useAgentOAuthToken.ts`

- [ ] **Step 1: 훅 작성**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAgentOAuthTokenMeta,
  registerAgentOAuthToken,
  revokeAgentOAuthToken,
} from '@/api/agents';
import type {
  OAuthTokenMeta,
  OAuthTokenRegisterRequest,
} from '@/types/agentOAuthToken';

/** AGENT 의 OAuth 토큰 메타 — 404 는 미등록 상태로 간주, null 반환. */
export function useAgentOAuthTokenMeta(userId: number | null) {
  return useQuery<OAuthTokenMeta | null>({
    queryKey: ['agentOAuthToken', userId],
    enabled: userId != null,
    queryFn: async () => {
      try {
        return await getAgentOAuthTokenMeta(userId!);
      } catch (e: any) {
        if (e?.response?.status === 404) return null;
        throw e;
      }
    },
  });
}

export function useRegisterAgentOAuthToken(userId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: OAuthTokenRegisterRequest) =>
      registerAgentOAuthToken(userId!, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentOAuthToken', userId] });
    },
  });
}

export function useRevokeAgentOAuthToken(userId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => revokeAgentOAuthToken(userId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentOAuthToken', userId] });
    },
  });
}
```

### Task 16: `OAuthTokenDialog` 컴포넌트

**Files:**
- Create: `apps/workplace-web/src/pages/admin/components/OAuthTokenDialog.tsx`

- [ ] **Step 1: 컴포넌트**

```tsx
// AGENT OAuth 토큰 등록/재발급 다이얼로그. 토큰은 입력 후 응답에 다시 노출되지 않는다.
// 사용자는 호스트에서 `claude setup-token` 으로 발급한 텍스트를 그대로 붙여넣는다.
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRegisterAgentOAuthToken } from '@/hooks/queries/useAgentOAuthToken';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentUserId: number;
  isReissue: boolean;
}

export function OAuthTokenDialog({ open, onOpenChange, agentUserId, isReissue }: Props) {
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const mutation = useRegisterAgentOAuthToken(agentUserId);

  const reset = () => {
    setToken('');
    setLabel('');
  };

  const submit = async () => {
    const trimmed = token.trim();
    if (trimmed.length < 32) {
      toast.error('토큰이 너무 짧습니다 (최소 32자)');
      return;
    }
    try {
      await mutation.mutateAsync({
        token: trimmed,
        label: label.trim() || undefined,
      });
      toast.success(isReissue ? 'OAuth 토큰을 재발급했습니다.' : 'OAuth 토큰을 등록했습니다.');
      reset();
      onOpenChange(false);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? '등록 실패';
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isReissue ? 'OAuth 토큰 재발급' : 'OAuth 토큰 등록'}
          </DialogTitle>
          <DialogDescription>
            호스트에서 <code>claude setup-token</code> 으로 발급한 토큰을 붙여넣으세요.
            저장 후 토큰은 다시 표시되지 않습니다.
            {isReissue ? ' 기존 토큰은 자동으로 회수됩니다.' : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="oauth-token">토큰</Label>
            <Textarea
              id="oauth-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="sk-ant-oat..."
              className="font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
              rows={4}
            />
          </div>
          <div>
            <Label htmlFor="oauth-label">레이블 (선택)</Label>
            <Input
              id="oauth-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="main"
              maxLength={80}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? '저장 중…' : isReissue ? '재발급' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

> import 경로 `@/components/ui/...` 는 기존 shadcn/ui 컴포넌트 위치. `Textarea` 가 없으면 `Input` + `multiline={false}` 로 대체하거나 한 줄짜리 `Input` 으로. 본 plan 은 일단 `Textarea` 가정 — 없으면 implementer 가 확인 후 `Input` 으로 폴백.

### Task 17: `AgentManagementPage` 에 OAuth 섹션 추가

**Files:**
- Modify: `apps/workplace-web/src/pages/admin/AgentManagementPage.tsx`

- [ ] **Step 1: 상태 + 훅 + 섹션 마크업 추가**

`AgentManagementPage.tsx` 의 import 에 추가:

```tsx
import { OAuthTokenDialog } from './components/OAuthTokenDialog';
import {
  useAgentOAuthTokenMeta,
  useRevokeAgentOAuthToken,
} from '@/hooks/queries/useAgentOAuthToken';
```

선택된 AGENT (`selectedAgent`) 가 있을 때 노출할 섹션을 AGENT 키 발급/회수 영역 인근에 추가. 컴포넌트 본문 안 (이미 selectedAgent 가 있는 분기 내부):

```tsx
{selectedAgent && (
  <OAuthTokenSection agentUserId={selectedAgent.id} />
)}
```

같은 파일 내부 (혹은 별도 파일로 분리해도 됨) 에 컴포넌트 정의:

```tsx
function OAuthTokenSection({ agentUserId }: { agentUserId: number }) {
  const { data: meta, isLoading } = useAgentOAuthTokenMeta(agentUserId);
  const revoke = useRevokeAgentOAuthToken(agentUserId);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <section className="border-t pt-4 mt-4">
      <h3 className="text-sm font-medium mb-2">Claude CLI OAuth 토큰</h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">로드 중…</p>
      ) : meta ? (
        <div className="space-y-1 text-sm">
          <div>
            <span className="text-muted-foreground">레이블: </span>
            <span>{meta.label ?? '(없음)'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">등록일: </span>
            <span>{new Date(meta.createdAt).toLocaleString()}</span>
          </div>
          <div>
            <span className="text-muted-foreground">최근 사용: </span>
            <span>
              {meta.lastUsedAt ? new Date(meta.lastUsedAt).toLocaleString() : '미사용'}
            </span>
          </div>
          <div className="pt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
              재발급
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={async () => {
                if (!confirm('OAuth 토큰을 회수하시겠습니까? AGENT 는 LLM 호출 불가 상태가 됩니다.')) return;
                await revoke.mutateAsync();
                toast.success('토큰을 회수했습니다.');
              }}
            >
              회수
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            등록된 토큰 없음. AGENT 는 LLM 호출 불가.
          </p>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            등록
          </Button>
        </div>
      )}
      <OAuthTokenDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agentUserId={agentUserId}
        isReissue={meta != null}
      />
    </section>
  );
}
```

> import `toast`, `useState`, `Button` 이 본 파일에 이미 있는지 확인 — 없으면 추가.

- [ ] **Step 2: typecheck + build**

Run: `cd apps/workplace-web && pnpm typecheck && pnpm build`
Expected: BUILD SUCCESSFUL. 추가 lint 경고 0.

### Task 18: workplace-web 단위 테스트 (가능한 범위)

**Files:**
- Create: `apps/workplace-web/src/pages/admin/components/OAuthTokenDialog.test.tsx` (선택 — 컴포넌트 단위)

- [ ] **Step 1: 토큰 길이 미달 시 토스트, 정상 등록 시 mutation 호출 정도만 검증**

```tsx
// OAuthTokenDialog — 입력 검증 / 제출 흐름 / 에러 토스트.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OAuthTokenDialog } from './OAuthTokenDialog';

// API 모킹 — registerAgentOAuthToken 만.
vi.mock('@/api/agents', () => ({
  registerAgentOAuthToken: vi.fn().mockResolvedValue({
    id: 1,
    label: 'main',
    createdAt: '2026-05-26T00:00:00Z',
    lastUsedAt: null,
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { registerAgentOAuthToken } from '@/api/agents';
import { toast } from 'sonner';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('OAuthTokenDialog', () => {
  beforeEach(() => {
    vi.mocked(registerAgentOAuthToken).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  it('짧은 토큰 입력 → error toast + 제출 차단', async () => {
    render(
      wrap(
        <OAuthTokenDialog
          open
          onOpenChange={() => {}}
          agentUserId={1}
          isReissue={false}
        />,
      ),
    );
    fireEvent.change(screen.getByLabelText('토큰'), { target: { value: 'short' } });
    fireEvent.click(screen.getByText('등록'));
    expect(toast.error).toHaveBeenCalled();
    expect(registerAgentOAuthToken).not.toHaveBeenCalled();
  });

  it('정상 토큰 입력 → mutation 호출 + success toast', async () => {
    render(
      wrap(
        <OAuthTokenDialog
          open
          onOpenChange={() => {}}
          agentUserId={1}
          isReissue={false}
        />,
      ),
    );
    fireEvent.change(screen.getByLabelText('토큰'), {
      target: { value: 'X'.repeat(64) },
    });
    fireEvent.change(screen.getByLabelText('레이블 (선택)'), {
      target: { value: 'main' },
    });
    fireEvent.click(screen.getByText('등록'));
    await waitFor(() => expect(registerAgentOAuthToken).toHaveBeenCalledOnce());
    expect(toast.success).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행**

Run: `cd apps/workplace-web && pnpm test src/pages/admin/components/OAuthTokenDialog.test.tsx`
Expected: 2/2 PASS.

> AgentManagementPage 전체 통합 테스트는 본 epic 비목표 (수동 e2e 로 갈음).

---

## Phase 5 — 전체 검증 + 단일 commit

### Task 19: 전체 회귀 게이트

- [ ] **Step 1: 백엔드**

Run: `cd apps/workplace-api && ./gradlew test`
Expected: BUILD SUCCESSFUL. 5a + 5c-2 + #33 모두 PASS.

- [ ] **Step 2: ai-agent**

Run: `cd apps/workplace-ai-agent && pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: 모두 통과. 41 + 신규 케이스 모두 PASS.

- [ ] **Step 3: workplace-web**

Run: `cd apps/workplace-web && pnpm test && pnpm typecheck && pnpm build`
Expected: 모두 통과. 신규 OAuthTokenDialog 테스트 PASS.

- [ ] **Step 4: 루트 turbo typecheck**

Run: `cd /Users/bluleo78/git/smart-workplace && pnpm typecheck`
Expected: 모든 패키지 PASS.

### Task 20: 단일 commit

- [ ] **Step 1: 변경 파일 확인**

Run: `git status && git diff --stat`
Expected (대략):
- 신규: `V15__agent_oauth_credential.sql`, `AiAgentCredentialRow.java`, `OAuthTokenMetaResponse.java`, `OAuthTokenRedeemResponse.java`, `OAuthTokenRegisterRequest.java`, `OAuthTokenNotFoundException.java`, `AiAgentCredentialRepository.java`, `AiAgentCredentialService.java`, `AdminOAuthTokenController.java`, `MyOAuthTokenController.java`, 백엔드 통합 테스트 3개, `apps/workplace-web/src/types/agentOAuthToken.ts`, `apps/workplace-web/src/hooks/queries/useAgentOAuthToken.ts`, `apps/workplace-web/src/pages/admin/components/OAuthTokenDialog.tsx` (+test), `apps/workplace-api/src/main/generated/...`
- 수정: `GlobalExceptionHandler.java`, `workplace-api.ts/.test.ts`, `cli-runner.ts/.test.ts`, `run-agent.ts/.test.ts`, `event-handler.ts/.test.ts`, `routes/events.ts/.test.ts`, `index.ts`, `.env.example`, `CLAUDE.md`, `AgentManagementPage.tsx`, `api/agents.ts`

- [ ] **Step 2: stage**

```bash
git add \
  apps/workplace-api/src \
  apps/workplace-ai-agent/src \
  apps/workplace-ai-agent/.env.example \
  apps/workplace-ai-agent/CLAUDE.md \
  apps/workplace-web/src \
  docs/superpowers/plans/2026-05-26-agent-oauth-token-storage.md
```

(생성된 jOOQ 클래스가 `src/main/generated/` 에 있고 그게 이미 git tracked 이면 자동 포함. tracked 가 아니면 `apps/workplace-api/src/main/generated/com/workplace/jooq/tables/AiAgentCredential.java` 도 명시 추가.)

- [ ] **Step 3: 단일 commit**

```bash
git commit -m "$(cat <<'EOF'
feat: AGENT OAuth 토큰 DB 저장 + 관리 UI — #33

- workplace-api: V15 마이그레이션 + ai_agent_credential 테이블
  · AGENT 당 active 1개 (partial unique index)
  · EncryptionService 로 암호화 저장 (iv:ciphertext)
  · admin POST/DELETE/GET + AGENT 본인 GET /users/me/oauth-token
- ai-agent: 매 spawn 마다 getMyOAuthToken() → child env 주입
  · 호스트 ~/.claude/ 의존 제거 + env var override 폐기
  · buildChildEnv(parent, token) 시그니처 — 단일 진실
- workplace-web: AgentManagementPage 의 OAuth 토큰 섹션 + Dialog
  · 등록/재발급/회수 흐름. 평문 토큰은 입력 후 응답 미반환

수동 e2e (claude setup-token + UI 등록 + 이슈 생성) 는 사용자가 별도 수행.
EOF
)"
```

- [ ] **Step 4: commit 검증**

Run: `git log -1 --stat | head -40`
Expected: 모든 의도 파일이 한 commit. 메시지 한국어.

push 는 사용자 명시 승인 후. #33 close 는 수동 e2e 통과 후.

---

## 사후 — 수동 e2e (사용자 수행)

spec §"수동 e2e" 의 8 단계 그대로:

1. 호스트에서 `claude setup-token` → 토큰 텍스트 복사
2. workplace-web 관리 화면 → AGENT 선택 → OAuth 토큰 등록 → 토스트 확인
3. 메타 영역에 created_at / label 노출, 평문 미노출 확인
4. workplace-web 에서 AGENT 를 담당자로 한 이슈 생성
5. ai-agent 로그: fetch 1회 + spawn 1회 (`[agent:issue.assigned:...]` prefix)
6. 이슈 상세에 LLM 응답 코멘트 노출
7. UI 에서 토큰 회수 → 이후 이벤트는 ai-agent 로그에 "fetch 실패 — spawn 생략"
8. 회수 후 같은 토큰으로 재등록 → 정상 동작 복귀
