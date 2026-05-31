# 홈 AI 비서(Assistant) 지정 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 compose 의 LLM 인증 AGENT 를 ai-agent 환경변수에서 떼어내고, DB 로 관리되는 "비서(Assistant)" 개념(공용 1개 + 개인 BYO, 각자 model·생각의 깊이 튜닝)으로 대체한다.

**Architecture:** workplace-api 가 caller 기준으로 개인→공용→에러 순으로 비서를 해석(`AssistantResolver`)해 `AssistantSpec`(agentUserId·model·thinkingDepth·maxTurns·timeoutMs)를 만들고, 그 값을 확장된 compose 요청으로 ai-agent 에 전달한다. ai-agent 는 `WORKPLACE_HOME_COMPOSER_AGENT_ID` env 를 제거하고 요청 필드로 동작하며, 생각의 깊이는 system-prompt 지시문으로 매핑한다(CLI thinking 플래그 부재). 공용·개인 비서 튜닝은 agent 단위 단일 테이블 `assistant_config` 로 통합한다.

**Tech Stack:** Spring Boot 3.4 + jOOQ + Flyway(JUnit 통합테스트) / Node22 + TS + Express + Zod(ai-agent) / React19 + TS + TanStack Query + Playwright(web).

**Spec:** `docs/superpowers/specs/2026-05-31-home-assistant-design.md`

---

## 중요 전제

- **표준 실행 모드:** main 브랜치에서 작업, 태스크별 로컬 커밋. push/PR/issue close 는 사용자 명시 승인 후에만.
- **jOOQ generated code 는 gitignored** (`src/main/generated/`) — 절대 `git add` 하지 말 것. 스키마 변경 후 `cd apps/workplace-api && ./gradlew generateJooq` 로 로컬 재생성.
- **api gradle 은 standalone:** 모든 gradle 명령은 `cd apps/workplace-api && ./gradlew ...`.
- **DB 기동 필요:** 루트에서 `pnpm db:up` (dev 5434 / test 5435).
- **토큰 평문 입력 금지(Claude):** 비서 토큰 등록 UI 는 사용자 본인이 입력. 자동화로 토큰을 넣지 말 것.
- **머지된 마이그레이션 수정 금지** — 정정은 V{n+1}.

---

## File Structure

### workplace-api (신규/수정)
- **Create** `src/main/resources/db/migration/V18__home_assistant.sql` — 스키마 3건 + 공용 비서 시드.
- **Create** `auth/repository/WorkspaceAssistantRepository.java` — `workspace_assistant` 싱글톤 CRUD.
- **Create** `auth/repository/AssistantConfigRepository.java` — `assistant_config` upsert/조회.
- **Create** `auth/service/AssistantDefaults.java` — 디폴트 상수(api 단일 출처).
- **Create** `auth/service/AssistantSpec.java` — resolve 결과 record.
- **Create** `auth/service/AssistantResolver.java` — 개인→공용→예외 해석.
- **Create** `auth/service/WorkspaceAssistantService.java` — 공용 비서 지정/설정.
- **Create** `auth/service/PersonalAssistantService.java` — 개인 비서 프로비저닝/토큰/설정/해제.
- **Create** `auth/exception/HomeAssistantNotConfiguredException.java` — 미설정 503.
- **Create** `auth/controller/WorkspaceAssistantController.java` — `/admin/workspace-assistant`.
- **Create** `auth/controller/MyAssistantController.java` — `/users/me/assistant`.
- **Create** `auth/dto/AssistantConfigResponse.java`, `auth/dto/AssistantStatusResponse.java`, `auth/dto/WorkspaceAssistantResponse.java`, 요청 DTO들.
- **Modify** `home/outbound/ComposeMessages.java` — `ComposeRequest` 5필드 확장.
- **Modify** `home/service/HomeComposeService.java` — resolver 호출 + 확장 요청.
- **Modify** `home/outbound/AiAgentComposeClient.java` — (시그니처 동일, 본문 변화 없음 — DTO 변경만 흡수).

### workplace-ai-agent (수정)
- **Modify** `src/agent/run-home-compose.ts` — env 제거, `ComposeInput` 확장, thinking 지시문, 요청 model/maxTurns/timeout 사용.
- **Modify** `src/routes/home.ts` — `composeSchema` 5필드 추가, `HomeComposerNotConfiguredError` 분기 제거.
- **Create** `src/agent/thinking.ts` — `thinkingDirective(depth)` 순수 함수.

### workplace-web (신규/수정)
- **Create** `src/types/assistant.ts` — 타입.
- **Create** `src/api/assistant.ts` — me/admin 비서 api 함수.
- **Create** `src/hooks/queries/useAssistant.ts` — TanStack 훅.
- **Create** `src/pages/profile/PersonalAssistantSection.tsx` — 프로필 개인 비서 섹션.
- **Create** `src/pages/admin/components/WorkspaceAssistantCard.tsx` — admin 공용 비서.
- **Modify** `src/pages/ProfilePage.tsx` — 섹션 삽입.
- **Modify** `src/pages/admin/AgentManagementPage.tsx` — 공용 비서 카드 삽입.
- **Create** `e2e/pages/personal-assistant.spec.ts`, `e2e/pages/workspace-assistant.spec.ts`.

---

# Phase A — DB + 백엔드 (workplace-api)

### Task 1: V18 마이그레이션 + 공용 비서 시드 + jOOQ 재생성

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V18__home_assistant.sql`

- [ ] **Step 1: 마이그레이션 작성**

`apps/workplace-api/src/main/resources/db/migration/V18__home_assistant.sql`:
```sql
-- V18__home_assistant.sql
-- 홈 AI 비서(Assistant) 지정 재설계 (#50 후속).
-- 공용 비서(싱글톤) + 개인 비서(user FK) + agent 단위 튜닝(assistant_config).

-- 1) 공용 비서: 워크스페이스 1개. id=1 싱글톤.
CREATE TABLE workspace_assistant (
  id             SMALLINT     PRIMARY KEY DEFAULT 1,
  agent_user_id  BIGINT       NOT NULL REFERENCES "user"(id),
  updated_by     BIGINT       NOT NULL REFERENCES "user"(id),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_assistant_singleton CHECK (id = 1)
);

-- 2) 개인 비서 지정: NULL=없음(공용 폴백). 가리키는 대상은 자동 생성된 개인 AGENT.
ALTER TABLE "user"
  ADD COLUMN personal_assistant_agent_id BIGINT REFERENCES "user"(id);

-- 3) 비서 튜닝(공용·개인 공통, agent 단위). 모든 컬럼 NULL=시스템 디폴트.
CREATE TABLE assistant_config (
  agent_user_id   BIGINT       PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  model           VARCHAR(64),
  thinking_depth  VARCHAR(16),
  max_turns       INT,
  timeout_ms      INT,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT assistant_config_thinking_depth_check
    CHECK (thinking_depth IS NULL OR thinking_depth IN ('NONE','NORMAL','DEEP'))
);

-- 4) 무중단 시드: 기존 운영의 홈 컴포저 AGENT(id=5, kind='AGENT')를 공용 비서로 등록.
--    해당 AGENT 가 없는 환경(신규)에서는 건너뛴다(서브쿼리가 0행이면 INSERT 0건).
INSERT INTO workspace_assistant (id, agent_user_id, updated_by)
SELECT 1, u.id, u.id
FROM "user" u
WHERE u.id = 5 AND u.kind = 'AGENT'
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: 마이그레이션 적용 + jOOQ 재생성**

```bash
cd /Users/bluleo78/git/smart-workplace && pnpm db:up
cd apps/workplace-api && ./gradlew bootRun --args='--spring.profiles.active=local' &
# 부팅 로그에 "Migrating schema ... to version 18" 확인 후 Ctrl-C 로 종료
./gradlew generateJooq
```
Expected: `src/main/generated/com/workplace/jooq/tables/` 아래 `WorkspaceAssistant.java`, `AssistantConfig.java` 생성, `User.java` 에 `PERSONAL_ASSISTANT_AGENT_ID` 필드 추가. (generated 는 커밋하지 않음)

- [ ] **Step 3: 테스트 DB 에도 적용**

```bash
cd apps/workplace-api && ./gradlew bootRun --args='--spring.profiles.active=test' &
# "to version 18" 확인 후 Ctrl-C
```
Expected: test DB(5435) 스키마 V18 반영 — 통합테스트가 신규 테이블 사용 가능.

- [ ] **Step 4: Commit**

```bash
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-api/src/main/resources/db/migration/V18__home_assistant.sql
git commit -m "feat(api): V18 홈 비서 스키마(공용·개인·튜닝) + 공용 비서 시드 — #50"
```

---

### Task 2: AssistantDefaults + AssistantSpec

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/service/AssistantDefaults.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/service/AssistantSpec.java`

- [ ] **Step 1: 디폴트 상수 작성**

`AssistantDefaults.java`:
```java
package com.workplace.auth.service;

/** 비서 튜닝 디폴트(단일 출처). ai-agent 의 DEFAULT_MODEL/MAX_TURNS/TIMEOUT 와 값이 일치해야 한다. */
public final class AssistantDefaults {
  private AssistantDefaults() {}

  public static final String MODEL = "claude-sonnet-4-6";
  public static final String THINKING_DEPTH = "NORMAL"; // NONE | NORMAL | DEEP
  public static final int MAX_TURNS = 8;
  public static final int TIMEOUT_MS = 60_000;
}
```

- [ ] **Step 2: AssistantSpec record 작성**

`AssistantSpec.java`:
```java
package com.workplace.auth.service;

/** AssistantResolver 가 caller 기준으로 해석한, compose 요청에 실릴 비서 사양. */
public record AssistantSpec(
    long agentUserId, String model, String thinkingDepth, int maxTurns, int timeoutMs) {}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-api/src/main/java/com/workplace/auth/service/AssistantDefaults.java \
        apps/workplace-api/src/main/java/com/workplace/auth/service/AssistantSpec.java
git commit -m "feat(api): AssistantDefaults + AssistantSpec — #50"
```

---

### Task 3: WorkspaceAssistantRepository

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/repository/WorkspaceAssistantRepository.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/auth/repository/WorkspaceAssistantRepositoryTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`WorkspaceAssistantRepositoryTest.java`:
```java
package com.workplace.auth.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class WorkspaceAssistantRepositoryTest extends IntegrationTestBase {

  @Autowired WorkspaceAssistantRepository repo;

  @Test
  void upsert_후_조회하면_지정한_agent_가_나온다() {
    // user id 1/2 는 IntegrationTestBase 시드(관리자 등) 가정 — 없으면 테스트 시드로 보강.
    repo.upsert(2L, 1L);
    assertThat(repo.findAgentId()).hasValue(2L);

    repo.upsert(1L, 1L); // 싱글톤 갱신
    assertThat(repo.findAgentId()).hasValue(1L);
  }

  @Test
  void 미지정이면_empty() {
    assertThat(repo.findAgentId()).isEmpty();
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.auth.repository.WorkspaceAssistantRepositoryTest"`
Expected: FAIL — `WorkspaceAssistantRepository` 클래스 없음(컴파일 에러).

- [ ] **Step 3: 리포지토리 구현**

`WorkspaceAssistantRepository.java`:
```java
package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.WORKSPACE_ASSISTANT;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** 공용 비서(싱글톤 id=1) 지정 저장/조회. */
@Repository
@RequiredArgsConstructor
public class WorkspaceAssistantRepository {

  private final DSLContext dsl;

  /** 공용 비서로 지정된 AGENT user id. 미지정이면 empty. */
  public Optional<Long> findAgentId() {
    return dsl.select(WORKSPACE_ASSISTANT.AGENT_USER_ID)
        .from(WORKSPACE_ASSISTANT)
        .where(WORKSPACE_ASSISTANT.ID.eq((short) 1))
        .fetchOptional(WORKSPACE_ASSISTANT.AGENT_USER_ID);
  }

  /** 싱글톤 upsert — 항상 id=1 한 행만 유지. */
  public void upsert(long agentUserId, long updatedBy) {
    dsl.insertInto(WORKSPACE_ASSISTANT)
        .set(WORKSPACE_ASSISTANT.ID, (short) 1)
        .set(WORKSPACE_ASSISTANT.AGENT_USER_ID, agentUserId)
        .set(WORKSPACE_ASSISTANT.UPDATED_BY, updatedBy)
        .onConflict(WORKSPACE_ASSISTANT.ID)
        .doUpdate()
        .set(WORKSPACE_ASSISTANT.AGENT_USER_ID, agentUserId)
        .set(WORKSPACE_ASSISTANT.UPDATED_BY, updatedBy)
        .set(WORKSPACE_ASSISTANT.UPDATED_AT, org.jooq.impl.DSL.now())
        .execute();
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.auth.repository.WorkspaceAssistantRepositoryTest"`
Expected: PASS (2 tests). 만약 user id 1/2 시드가 없어 FK 위반이면, 테스트 `@BeforeEach` 에서 `dsl.insertInto(USER)...` 로 AGENT/HUMAN 한 명씩 만들고 그 id 를 사용하도록 보강.

- [ ] **Step 5: Commit**

```bash
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-api/src/main/java/com/workplace/auth/repository/WorkspaceAssistantRepository.java \
        apps/workplace-api/src/test/java/com/workplace/auth/repository/WorkspaceAssistantRepositoryTest.java
git commit -m "feat(api): WorkspaceAssistantRepository 싱글톤 upsert — #50"
```

---

### Task 4: AssistantConfigRepository

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/repository/AssistantConfigRepository.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/auth/repository/AssistantConfigRepositoryTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`AssistantConfigRepositoryTest.java`:
```java
package com.workplace.auth.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class AssistantConfigRepositoryTest extends IntegrationTestBase {

  @Autowired AssistantConfigRepository repo;

  @Test
  void upsert_후_조회하면_값이_나오고_재upsert_로_갱신된다() {
    long agentId = 5L; // 시드 AGENT 가정. 없으면 @BeforeEach 로 생성.
    repo.upsert(agentId, "claude-opus-4-8", "DEEP", null, null);

    var row = repo.find(agentId).orElseThrow();
    assertThat(row.model()).isEqualTo("claude-opus-4-8");
    assertThat(row.thinkingDepth()).isEqualTo("DEEP");
    assertThat(row.maxTurns()).isNull();

    repo.upsert(agentId, "claude-sonnet-4-6", "NORMAL", 10, 70000);
    var updated = repo.find(agentId).orElseThrow();
    assertThat(updated.model()).isEqualTo("claude-sonnet-4-6");
    assertThat(updated.maxTurns()).isEqualTo(10);
  }

  @Test
  void 미설정이면_empty() {
    assertThat(repo.find(999_999L)).isEmpty();
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.auth.repository.AssistantConfigRepositoryTest"`
Expected: FAIL — 클래스 없음.

- [ ] **Step 3: 리포지토리 구현**

`AssistantConfigRepository.java`:
```java
package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.ASSISTANT_CONFIG;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** 비서 튜닝(agent 단위) 저장/조회. 모든 값 nullable = 시스템 디폴트. */
@Repository
@RequiredArgsConstructor
public class AssistantConfigRepository {

  private final DSLContext dsl;

  /** assistant_config 한 행(원시값, nullable 보존). */
  public record ConfigRow(String model, String thinkingDepth, Integer maxTurns, Integer timeoutMs) {}

  public Optional<ConfigRow> find(long agentUserId) {
    return dsl.select(
            ASSISTANT_CONFIG.MODEL,
            ASSISTANT_CONFIG.THINKING_DEPTH,
            ASSISTANT_CONFIG.MAX_TURNS,
            ASSISTANT_CONFIG.TIMEOUT_MS)
        .from(ASSISTANT_CONFIG)
        .where(ASSISTANT_CONFIG.AGENT_USER_ID.eq(agentUserId))
        .fetchOptional(
            r ->
                new ConfigRow(
                    r.get(ASSISTANT_CONFIG.MODEL),
                    r.get(ASSISTANT_CONFIG.THINKING_DEPTH),
                    r.get(ASSISTANT_CONFIG.MAX_TURNS),
                    r.get(ASSISTANT_CONFIG.TIMEOUT_MS)));
  }

  /** upsert — null 인자는 그대로 NULL 저장(=디폴트 사용 의미). */
  public void upsert(
      long agentUserId, String model, String thinkingDepth, Integer maxTurns, Integer timeoutMs) {
    dsl.insertInto(ASSISTANT_CONFIG)
        .set(ASSISTANT_CONFIG.AGENT_USER_ID, agentUserId)
        .set(ASSISTANT_CONFIG.MODEL, model)
        .set(ASSISTANT_CONFIG.THINKING_DEPTH, thinkingDepth)
        .set(ASSISTANT_CONFIG.MAX_TURNS, maxTurns)
        .set(ASSISTANT_CONFIG.TIMEOUT_MS, timeoutMs)
        .onConflict(ASSISTANT_CONFIG.AGENT_USER_ID)
        .doUpdate()
        .set(ASSISTANT_CONFIG.MODEL, model)
        .set(ASSISTANT_CONFIG.THINKING_DEPTH, thinkingDepth)
        .set(ASSISTANT_CONFIG.MAX_TURNS, maxTurns)
        .set(ASSISTANT_CONFIG.TIMEOUT_MS, timeoutMs)
        .set(ASSISTANT_CONFIG.UPDATED_AT, DSL.now())
        .execute();
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.auth.repository.AssistantConfigRepositoryTest"`
Expected: PASS (2 tests). FK 위반 시 `@BeforeEach` 로 AGENT user 생성 후 그 id 사용.

- [ ] **Step 5: Commit**

```bash
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-api/src/main/java/com/workplace/auth/repository/AssistantConfigRepository.java \
        apps/workplace-api/src/test/java/com/workplace/auth/repository/AssistantConfigRepositoryTest.java
git commit -m "feat(api): AssistantConfigRepository upsert/find — #50"
```

---

### Task 5: HomeAssistantNotConfiguredException + 핸들러

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/exception/HomeAssistantNotConfiguredException.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/auth/exception/HomeAssistantNotConfiguredExceptionTest.java`

- [ ] **Step 1: 예외 클래스 작성**

`HomeAssistantNotConfiguredException.java`:
```java
package com.workplace.auth.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 개인·공용 비서가 모두 미설정(또는 active 토큰 없음)일 때. 명확한 503 으로 노출. */
@ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
public class HomeAssistantNotConfiguredException extends RuntimeException {
  public HomeAssistantNotConfiguredException(String message) {
    super(message);
  }
}
```

- [ ] **Step 2: 핸들러 추가**

`GlobalExceptionHandler.java` 에 기존 `handleHomeComposeUnavailable` 바로 아래에 추가:
```java
  @ExceptionHandler(com.workplace.auth.exception.HomeAssistantNotConfiguredException.class)
  public ResponseEntity<ErrorResponse> handleHomeAssistantNotConfigured(
      com.workplace.auth.exception.HomeAssistantNotConfiguredException ex,
      HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
        .body(buildError(HttpStatus.SERVICE_UNAVAILABLE, ex.getMessage(), null, request));
  }
```

- [ ] **Step 3: 테스트 작성 + 실행**

`HomeAssistantNotConfiguredExceptionTest.java`:
```java
package com.workplace.auth.exception;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.core.annotation.AnnotationUtils;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

class HomeAssistantNotConfiguredExceptionTest {
  @Test
  void 메시지보존_그리고_503_매핑() {
    var ex = new HomeAssistantNotConfiguredException("미설정");
    assertThat(ex.getMessage()).isEqualTo("미설정");
    var rs = AnnotationUtils.findAnnotation(HomeAssistantNotConfiguredException.class, ResponseStatus.class);
    assertThat(rs.value()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
  }
}
```
Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.auth.exception.HomeAssistantNotConfiguredExceptionTest"`
Expected: PASS.

- [ ] **Step 4: spotless + Commit**

```bash
cd apps/workplace-api && ./gradlew spotlessApply
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-api/src/main/java/com/workplace/auth/exception/HomeAssistantNotConfiguredException.java \
        apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java \
        apps/workplace-api/src/test/java/com/workplace/auth/exception/HomeAssistantNotConfiguredExceptionTest.java
git commit -m "feat(api): HomeAssistantNotConfiguredException 503 핸들러 — #50"
```
> spotlessApply 가 무관 파일을 건드리면 `git checkout -- <그 파일>` 로 되돌린 뒤 위 3개만 add.

---

### Task 6: AssistantResolver (개인→공용→예외)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/repository/PersonalAssistantRepository.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/service/AssistantResolver.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/auth/service/AssistantResolverTest.java`

> `AiAgentCredentialService` 는 active 토큰 존재 여부를 직접 노출하지 않으므로, 존재 확인용 경량 메서드를 리포지토리에 추가한다. 기존 `AiAgentCredentialRepository.findActive(agentId)` 를 재사용한다(있으면 active).

- [ ] **Step 1: 개인 비서 FK 조회 리포지토리**

`PersonalAssistantRepository.java`:
```java
package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.USER;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** user.personal_assistant_agent_id 조회/설정. */
@Repository
@RequiredArgsConstructor
public class PersonalAssistantRepository {

  private final DSLContext dsl;

  /** caller 의 개인 비서 AGENT id. 없으면 empty. */
  public Optional<Long> findAgentId(long userId) {
    return dsl.select(USER.PERSONAL_ASSISTANT_AGENT_ID)
        .from(USER)
        .where(USER.ID.eq(userId))
        .fetchOptional(USER.PERSONAL_ASSISTANT_AGENT_ID)
        .filter(java.util.Objects::nonNull);
  }

  /** 개인 비서 지정/해제(null). */
  public void setAgentId(long userId, Long agentId) {
    dsl.update(USER)
        .set(USER.PERSONAL_ASSISTANT_AGENT_ID, agentId)
        .set(USER.UPDATED_AT, java.time.LocalDateTime.now())
        .where(USER.ID.eq(userId))
        .execute();
  }
}
```

- [ ] **Step 2: 실패 테스트 작성**

`AssistantResolverTest.java`:
```java
package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.HomeAssistantNotConfiguredException;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class AssistantResolverTest extends IntegrationTestBase {

  @Autowired AssistantResolver resolver;
  @Autowired WorkspaceAssistantRepository workspaceRepo;
  @Autowired PersonalAssistantRepository personalRepo;
  @Autowired AssistantConfigRepository configRepo;
  @Autowired com.workplace.auth.service.AiAgentCredentialService credentialService;

  // 헬퍼: AGENT 생성 + active 토큰 등록은 각 테스트에서 fixture 메서드로. (아래 구현 참고)

  @Test
  void 둘다_미설정이면_예외() {
    long human = TestFixtures.createHuman(); // IntegrationTestBase 제공 헬퍼 또는 직접 insert
    assertThatThrownBy(() -> resolver.resolve(human))
        .isInstanceOf(HomeAssistantNotConfiguredException.class);
  }

  @Test
  void 공용만_있으면_공용_그리고_디폴트_튜닝() {
    long human = TestFixtures.createHuman();
    long agent = TestFixtures.createAgentWithToken(credentialService, human);
    workspaceRepo.upsert(agent, human);

    AssistantSpec spec = resolver.resolve(human);
    assertThat(spec.agentUserId()).isEqualTo(agent);
    assertThat(spec.model()).isEqualTo(AssistantDefaults.MODEL);
    assertThat(spec.thinkingDepth()).isEqualTo(AssistantDefaults.THINKING_DEPTH);
    assertThat(spec.maxTurns()).isEqualTo(AssistantDefaults.MAX_TURNS);
  }

  @Test
  void 개인이_있으면_공용보다_우선_그리고_config_override() {
    long human = TestFixtures.createHuman();
    long workspaceAgent = TestFixtures.createAgentWithToken(credentialService, human);
    workspaceRepo.upsert(workspaceAgent, human);

    long personalAgent = TestFixtures.createAgentWithToken(credentialService, human);
    personalRepo.setAgentId(human, personalAgent);
    configRepo.upsert(personalAgent, "claude-opus-4-8", "DEEP", null, null);

    AssistantSpec spec = resolver.resolve(human);
    assertThat(spec.agentUserId()).isEqualTo(personalAgent);
    assertThat(spec.model()).isEqualTo("claude-opus-4-8");
    assertThat(spec.thinkingDepth()).isEqualTo("DEEP");
    assertThat(spec.maxTurns()).isEqualTo(AssistantDefaults.MAX_TURNS); // null override → default
  }

  @Test
  void 개인_지정됐지만_토큰없으면_공용으로_폴백() {
    long human = TestFixtures.createHuman();
    long workspaceAgent = TestFixtures.createAgentWithToken(credentialService, human);
    workspaceRepo.upsert(workspaceAgent, human);

    long personalAgentNoToken = TestFixtures.createAgentNoToken();
    personalRepo.setAgentId(human, personalAgentNoToken);

    AssistantSpec spec = resolver.resolve(human);
    assertThat(spec.agentUserId()).isEqualTo(workspaceAgent);
  }
}
```
> **테스트 fixture:** 같은 패키지에 `TestFixtures` 헬퍼를 만들거나, 각 테스트에서 인라인으로 작성. 인라인 버전 예:
> ```java
> // AGENT user insert (kind='AGENT', password null) → id 반환, 그 후 credentialService.register(callerId, agentId, "sk-ant-oat-"+"x".repeat(40), "t")
> ```
> `createAgentWithToken` = AGENT insert + `credentialService.register(adminId, agentId, "sk-ant-oat-"+"x".repeat(40), "label")`. `createAgentNoToken` = AGENT insert 만. `createHuman` = HUMAN insert. 모두 `@Autowired DSLContext` 로 직접 insert (USER 테이블, `USER.KIND` 에 `UserKind.AGENT`/`HUMAN`).

- [ ] **Step 3: 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.auth.service.AssistantResolverTest"`
Expected: FAIL — `AssistantResolver` 없음.

- [ ] **Step 4: Resolver 구현**

`AssistantResolver.java`:
```java
package com.workplace.auth.service;

import com.workplace.auth.exception.HomeAssistantNotConfiguredException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.AssistantConfigRepository.ConfigRow;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 홈을 담당할 비서를 caller 기준으로 해석한다. 개인 비서(토큰 있으면) → 공용 비서(토큰 있으면) → 미설정 예외. 해석된 AGENT 의
 * assistant_config 를 디폴트와 병합해 AssistantSpec 으로 만든다.
 */
@Service
@RequiredArgsConstructor
public class AssistantResolver {

  private final PersonalAssistantRepository personalRepo;
  private final WorkspaceAssistantRepository workspaceRepo;
  private final AssistantConfigRepository configRepo;
  private final AiAgentCredentialRepository credentialRepo;

  @Transactional(readOnly = true)
  public AssistantSpec resolve(long callerId) {
    Long agentId =
        pickWithActiveToken(personalRepo.findAgentId(callerId))
            .or(() -> pickWithActiveToken(workspaceRepo.findAgentId()))
            .orElseThrow(
                () ->
                    new HomeAssistantNotConfiguredException(
                        "홈 비서가 아직 설정되지 않았어요. 관리자에게 문의해주세요."));
    return buildSpec(agentId);
  }

  /** 후보 AGENT 에 active OAuth 토큰이 있을 때만 통과. */
  private Optional<Long> pickWithActiveToken(Optional<Long> candidate) {
    return candidate.filter(id -> credentialRepo.findActive(id).isPresent());
  }

  /** config 를 디폴트와 병합. */
  private AssistantSpec buildSpec(long agentId) {
    ConfigRow c = configRepo.find(agentId).orElse(new ConfigRow(null, null, null, null));
    return new AssistantSpec(
        agentId,
        c.model() != null ? c.model() : AssistantDefaults.MODEL,
        c.thinkingDepth() != null ? c.thinkingDepth() : AssistantDefaults.THINKING_DEPTH,
        c.maxTurns() != null ? c.maxTurns() : AssistantDefaults.MAX_TURNS,
        c.timeoutMs() != null ? c.timeoutMs() : AssistantDefaults.TIMEOUT_MS);
  }
}
```
> `AiAgentCredentialRepository.findActive(long)` 가 `Optional<AiAgentCredentialRow>` 를 반환함(서브에이전트 확인). 시그니처가 다르면 active 존재 확인용 `boolean existsActive(long)` 를 리포지토리에 추가하고 그걸 사용.

- [ ] **Step 5: 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.auth.service.AssistantResolverTest"`
Expected: PASS (4 tests).

- [ ] **Step 6: spotless + Commit**

```bash
cd apps/workplace-api && ./gradlew spotlessApply
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-api/src/main/java/com/workplace/auth/repository/PersonalAssistantRepository.java \
        apps/workplace-api/src/main/java/com/workplace/auth/service/AssistantResolver.java \
        apps/workplace-api/src/test/java/com/workplace/auth/service/AssistantResolverTest.java
git commit -m "feat(api): AssistantResolver 개인→공용→미설정 해석 — #50"
```

---

### Task 7: compose 요청 확장 + HomeComposeService resolver 연동

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/home/outbound/ComposeMessages.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/home/service/HomeComposeService.java`
- Modify: `apps/workplace-api/src/test/java/com/workplace/home/outbound/AiAgentComposeClientTest.java` (jsonPath 확장)
- Test: `apps/workplace-api/src/test/java/com/workplace/home/service/HomeComposeServiceAssistantTest.java`

- [ ] **Step 1: ComposeRequest 확장**

`ComposeMessages.java` 의 `ComposeRequest` 레코드를 교체:
```java
  public record ComposeRequest(
      String query,
      java.util.List<ContextMessage> recentContext,
      long assistantAgentId,
      String model,
      String thinkingDepth,
      int maxTurns,
      int timeoutMs) {}
```
(`ContextMessage`, `ComposeResult` 는 그대로.)

- [ ] **Step 2: HomeComposeService 에 resolver 주입 + 사용**

`HomeComposeService.java` 수정:
- 필드 추가: `private final com.workplace.auth.service.AssistantResolver assistantResolver;`
- `compose()` 내 `recentContext` 구성 직후, `composeClient.compose(...)` 호출부를 교체:
```java
    com.workplace.auth.service.AssistantSpec spec = assistantResolver.resolve(callerId);

    sessionService.appendMessage(callerId, sid, "USER", query, null);

    ComposeResult result =
        composeClient.compose(
            new ComposeRequest(
                query,
                recentContext,
                spec.agentUserId(),
                spec.model(),
                spec.thinkingDepth(),
                spec.maxTurns(),
                spec.timeoutMs()));
```
> 주: 도메인 간 직접 import 금지 원칙이 있으나, 본 프로젝트는 모놀리스이며 `auth` 의 비서 해석을 `home` 이 사용하는 것은 의도된 의존이다(이벤트로 대체할 비동기 흐름 아님). 단순 서비스 주입으로 진행.

- [ ] **Step 3: 서비스 통합 테스트 작성**

`HomeComposeServiceAssistantTest.java`:
```java
package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.HomeAssistantNotConfiguredException;
import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class HomeComposeServiceAssistantTest extends IntegrationTestBase {

  @Autowired HomeComposeService service;

  @Test
  void 비서_미설정_caller_는_compose_시_미설정예외() {
    long human = TestFixtures.createHuman();
    assertThatThrownBy(() -> service.compose(human, null, "안녕"))
        .isInstanceOf(HomeAssistantNotConfiguredException.class);
  }
}
```
> ai-agent 실제 호출이 일어나는 happy-path 통합은 ai-agent 가 떠야 하므로 여기선 미설정 분기만 검증(외부 호출 전에 resolve 가 던짐). happy-path 계약 검증은 Step 5(클라이언트 jsonPath)에서.

- [ ] **Step 4: 기존 컴파일 깨짐 수정 — AiAgentComposeClientTest**

`AiAgentComposeClientTest.java` 의 모든 `new ComposeRequest(...)` 호출을 새 시그니처로 갱신하고, 정상 테스트에 신규 필드 jsonPath 단언 추가. 예: 정상 테스트의 생성자/단언을:
```java
    server
        .expect(requestTo("http://ai-agent.test/home/compose"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, "Internal tok-123"))
        .andExpect(jsonPath("$.query").value("내 할 일"))
        .andExpect(jsonPath("$.assistantAgentId").value(5))
        .andExpect(jsonPath("$.model").value("claude-sonnet-4-6"))
        .andExpect(jsonPath("$.thinkingDepth").value("NORMAL"))
        .andRespond(/* 기존과 동일 */);

    ComposeResult res =
        client.compose(
            new ComposeRequest("내 할 일", List.of(), 5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
```
나머지 두 테스트의 `new ComposeRequest("x", List.of())` / `new ComposeRequest("안녕", List.of())` 도 `new ComposeRequest("x", List.of(), 5L, "claude-sonnet-4-6", "NORMAL", 8, 60000)` 형태로 갱신.

- [ ] **Step 5: 테스트 실행**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.home.*"`
Expected: PASS — `AiAgentComposeClientTest`(3), `HomeComposeServiceAssistantTest`(1) 및 기존 home 테스트 통과.

- [ ] **Step 6: spotless + Commit**

```bash
cd apps/workplace-api && ./gradlew spotlessApply
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-api/src/main/java/com/workplace/home/outbound/ComposeMessages.java \
        apps/workplace-api/src/main/java/com/workplace/home/service/HomeComposeService.java \
        apps/workplace-api/src/test/java/com/workplace/home/outbound/AiAgentComposeClientTest.java \
        apps/workplace-api/src/test/java/com/workplace/home/service/HomeComposeServiceAssistantTest.java
git commit -m "feat(api): compose 요청에 비서 사양(agentId·model·thinking·turns·timeout) 적재 + resolver 연동 — #50"
```

---

### Task 8: PersonalAssistantService + MyAssistantController (개인 비서 self-service)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/service/PersonalAssistantService.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/controller/MyAssistantController.java`
- Create DTOs: `apps/workplace-api/src/main/java/com/workplace/auth/dto/AssistantStatusResponse.java`, `RegisterAssistantTokenRequest.java`, `UpdateAssistantSettingsRequest.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/auth/service/PersonalAssistantServiceTest.java`

- [ ] **Step 1: DTO 작성**

`AssistantStatusResponse.java`:
```java
package com.workplace.auth.dto;

import java.time.OffsetDateTime;

/** 개인 비서 상태(없으면 configured=false). 토큰 평문/암호문 미포함. */
public record AssistantStatusResponse(
    boolean configured,
    String tokenLabel,
    OffsetDateTime tokenLastUsedAt,
    String model,
    String thinkingDepth) {}
```
`RegisterAssistantTokenRequest.java`:
```java
package com.workplace.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterAssistantTokenRequest(
    @NotBlank @Size(min = 32) String token, String label) {}
```
`UpdateAssistantSettingsRequest.java`:
```java
package com.workplace.auth.dto;

import jakarta.validation.constraints.Pattern;

/** null = 디폴트로 되돌림. */
public record UpdateAssistantSettingsRequest(
    String model,
    @Pattern(regexp = "NONE|NORMAL|DEEP") String thinkingDepth) {}
```

- [ ] **Step 2: 실패 테스트 작성**

`PersonalAssistantServiceTest.java`:
```java
package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class PersonalAssistantServiceTest extends IntegrationTestBase {

  @Autowired PersonalAssistantService service;
  @Autowired PersonalAssistantRepository personalRepo;
  @Autowired AiAgentCredentialRepository credentialRepo;

  @Test
  void 최초_토큰등록시_개인AGENT_자동생성_그리고_상태조회() {
    long human = TestFixtures.createHuman();

    service.registerToken(human, "sk-ant-oat-" + "x".repeat(40), "내 토큰");

    Long agentId = personalRepo.findAgentId(human).orElseThrow();
    assertThat(credentialRepo.findActive(agentId)).isPresent();

    var status = service.getStatus(human);
    assertThat(status.configured()).isTrue();
    assertThat(status.model()).isEqualTo(AssistantDefaults.MODEL); // config 없음 → 디폴트 표시
  }

  @Test
  void 설정변경_후_상태에_반영() {
    long human = TestFixtures.createHuman();
    service.registerToken(human, "sk-ant-oat-" + "x".repeat(40), "t");
    service.updateSettings(human, "claude-opus-4-8", "DEEP");

    var status = service.getStatus(human);
    assertThat(status.model()).isEqualTo("claude-opus-4-8");
    assertThat(status.thinkingDepth()).isEqualTo("DEEP");
  }

  @Test
  void 해제하면_토큰revoke_그리고_FK_null() {
    long human = TestFixtures.createHuman();
    service.registerToken(human, "sk-ant-oat-" + "x".repeat(40), "t");
    Long agentId = personalRepo.findAgentId(human).orElseThrow();

    service.disable(human);

    assertThat(personalRepo.findAgentId(human)).isEmpty();
    assertThat(credentialRepo.findActive(agentId)).isEmpty();
  }

  @Test
  void 미설정이면_configured_false() {
    long human = TestFixtures.createHuman();
    assertThat(service.getStatus(human).configured()).isFalse();
  }
}
```

- [ ] **Step 3: 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.auth.service.PersonalAssistantServiceTest"`
Expected: FAIL — `PersonalAssistantService` 없음.

- [ ] **Step 4: 서비스 구현**

`PersonalAssistantService.java`:
```java
package com.workplace.auth.service;

import com.workplace.auth.dto.AssistantStatusResponse;
import com.workplace.auth.dto.OAuthTokenMetaResponse;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.AssistantConfigRepository.ConfigRow;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.user.repository.UserRepository;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개인 비서 self-service. 최초 토큰 등록 시 그 사용자 전용 개인 AGENT 를 자동 생성하고, 이후 토큰/설정/해제를 그 AGENT 기준으로 처리한다.
 */
@Service
@RequiredArgsConstructor
@Transactional
public class PersonalAssistantService {

  private final PersonalAssistantRepository personalRepo;
  private final AssistantConfigRepository configRepo;
  private final AiAgentCredentialService credentialService;
  private final UserRepository userRepository;

  /** 토큰 등록/교체. 개인 AGENT 가 없으면 자동 생성 후 FK 연결. */
  public void registerToken(long callerId, String plaintextToken, String label) {
    long agentId = ensurePersonalAgent(callerId);
    credentialService.register(callerId, agentId, plaintextToken, label); // 내부에서 기존 active revoke 후 insert
  }

  /** model/thinking_depth 변경(개인 AGENT 의 assistant_config upsert). 개인 비서 미설정이면 IllegalState. */
  public void updateSettings(long callerId, String model, String thinkingDepth) {
    long agentId =
        personalRepo
            .findAgentId(callerId)
            .orElseThrow(() -> new IllegalStateException("개인 비서가 설정되지 않았어요."));
    ConfigRow cur = configRepo.find(agentId).orElse(new ConfigRow(null, null, null, null));
    configRepo.upsert(agentId, model, thinkingDepth, cur.maxTurns(), cur.timeoutMs());
  }

  /** 해제: 토큰 revoke + FK null. 개인 AGENT row 는 보존(감사/재사용). */
  public void disable(long callerId) {
    personalRepo
        .findAgentId(callerId)
        .ifPresent(
            agentId -> {
              credentialService.revoke(callerId, agentId);
              personalRepo.setAgentId(callerId, null);
            });
  }

  @Transactional(readOnly = true)
  public AssistantStatusResponse getStatus(long callerId) {
    Optional<Long> agentIdOpt = personalRepo.findAgentId(callerId);
    if (agentIdOpt.isEmpty()) {
      return new AssistantStatusResponse(false, null, null, null, null);
    }
    long agentId = agentIdOpt.get();
    ConfigRow c = configRepo.find(agentId).orElse(new ConfigRow(null, null, null, null));
    String model = c.model() != null ? c.model() : AssistantDefaults.MODEL;
    String depth = c.thinkingDepth() != null ? c.thinkingDepth() : AssistantDefaults.THINKING_DEPTH;
    OAuthTokenMetaResponse meta = credentialService.getActiveMeta(agentId);
    return new AssistantStatusResponse(
        true, meta.label(), meta.lastUsedAt(), model, depth);
  }

  /** 개인 AGENT 보장 — 없으면 생성 후 FK 연결. */
  private long ensurePersonalAgent(long callerId) {
    return personalRepo
        .findAgentId(callerId)
        .orElseGet(
            () -> {
              long agentId =
                  userRepository.createPersonalAssistantAgent(
                      callerId,
                      "__assistant_u" + callerId,
                      "assistant.u" + callerId + "@workplace.local");
              personalRepo.setAgentId(callerId, agentId);
              return agentId;
            });
  }
}
```
> **`OAuthTokenMetaResponse.lastUsedAt()` 타입**: 서브에이전트 보고상 `OAuthTokenMetaResponse(id, label, createdAt, lastUsedAt)`. `lastUsedAt` 의 실제 타입(LocalDateTime vs OffsetDateTime)에 맞춰 `AssistantStatusResponse.tokenLastUsedAt` 타입을 통일할 것(불일치 시 컴파일 에러로 즉시 드러남 — 같은 타입으로 맞춘다).

- [ ] **Step 5: UserRepository 에 개인 AGENT 생성 메서드 추가**

`UserRepository.java` 에 메서드 추가:
```java
  /** 개인 비서용 AGENT user 생성(로그인 불가, password NULL). 생성된 id 반환. */
  public long createPersonalAssistantAgent(long ownerId, String username, String email) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.EMAIL, email)
        .set(USER.NAME, "개인 비서")
        .set(USER.KIND, com.workplace.user.dto.UserKind.AGENT)
        .setNull(USER.PASSWORD)
        .returning(USER.ID)
        .fetchOne(USER.ID);
  }
```
> `USER.NAME` 에 소유자명을 넣고 싶으면 `ownerId` 로 조회해 `{name}의 개인 비서` 로. v1 은 고정 "개인 비서" 로 단순화(YAGNI). `username`/`email` 은 결정적이라 재생성 충돌 없음(이미 있으면 ensurePersonalAgent 가 FK 로 먼저 가로챔).

- [ ] **Step 6: 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.auth.service.PersonalAssistantServiceTest"`
Expected: PASS (4 tests).

- [ ] **Step 7: 컨트롤러 작성**

`MyAssistantController.java`:
```java
package com.workplace.auth.controller;

import com.workplace.auth.dto.AssistantStatusResponse;
import com.workplace.auth.dto.RegisterAssistantTokenRequest;
import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.auth.service.PersonalAssistantService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** 개인 비서 self-service(본인 JWT). 토큰 평문은 본인이 입력한다. */
@RestController
@RequestMapping("/api/v1/users/me/assistant")
@RequiredArgsConstructor
public class MyAssistantController {

  private final PersonalAssistantService service;

  @GetMapping
  public AssistantStatusResponse status(@AuthenticationPrincipal Long callerId) {
    return service.getStatus(callerId);
  }

  @PutMapping("/token")
  public ResponseEntity<Void> registerToken(
      @AuthenticationPrincipal Long callerId,
      @Valid @RequestBody RegisterAssistantTokenRequest req) {
    service.registerToken(callerId, req.token(), req.label());
    return ResponseEntity.noContent().build();
  }

  @PutMapping("/settings")
  public ResponseEntity<Void> updateSettings(
      @AuthenticationPrincipal Long callerId,
      @Valid @RequestBody UpdateAssistantSettingsRequest req) {
    service.updateSettings(callerId, req.model(), req.thinkingDepth());
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping
  public ResponseEntity<Void> disable(@AuthenticationPrincipal Long callerId) {
    service.disable(callerId);
    return ResponseEntity.noContent().build();
  }
}
```

- [ ] **Step 8: spotless + 전체 auth 테스트 + Commit**

```bash
cd apps/workplace-api && ./gradlew spotlessApply && ./gradlew test --tests "com.workplace.auth.*"
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-api/src/main/java/com/workplace/auth/service/PersonalAssistantService.java \
        apps/workplace-api/src/main/java/com/workplace/auth/controller/MyAssistantController.java \
        apps/workplace-api/src/main/java/com/workplace/auth/dto/AssistantStatusResponse.java \
        apps/workplace-api/src/main/java/com/workplace/auth/dto/RegisterAssistantTokenRequest.java \
        apps/workplace-api/src/main/java/com/workplace/auth/dto/UpdateAssistantSettingsRequest.java \
        apps/workplace-api/src/main/java/com/workplace/user/repository/UserRepository.java \
        apps/workplace-api/src/test/java/com/workplace/auth/service/PersonalAssistantServiceTest.java
git commit -m "feat(api): 개인 비서 self-service(토큰·설정·해제) + 개인 AGENT 자동 프로비저닝 — #50"
```

---

### Task 9: WorkspaceAssistantService + Controller (공용 비서 admin)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/service/WorkspaceAssistantService.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/controller/WorkspaceAssistantController.java`
- Create DTOs: `apps/workplace-api/src/main/java/com/workplace/auth/dto/WorkspaceAssistantResponse.java`, `SetWorkspaceAssistantRequest.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/auth/service/WorkspaceAssistantServiceTest.java`

- [ ] **Step 1: DTO 작성**

`WorkspaceAssistantResponse.java`:
```java
package com.workplace.auth.dto;

/** 공용 비서 상태. 미지정이면 agentUserId=null. */
public record WorkspaceAssistantResponse(
    Long agentUserId, String agentName, boolean hasActiveToken, String model, String thinkingDepth) {}
```
`SetWorkspaceAssistantRequest.java`:
```java
package com.workplace.auth.dto;

import jakarta.validation.constraints.NotNull;

public record SetWorkspaceAssistantRequest(@NotNull Long agentUserId) {}
```

- [ ] **Step 2: 실패 테스트 작성**

`WorkspaceAssistantServiceTest.java`:
```java
package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class WorkspaceAssistantServiceTest extends IntegrationTestBase {

  @Autowired WorkspaceAssistantService service;

  @Test
  void HUMAN_을_공용비서로_지정하면_거부() {
    long admin = TestFixtures.createHuman();
    long human = TestFixtures.createHuman();
    assertThatThrownBy(() -> service.setAgent(admin, human))
        .isInstanceOf(com.workplace.auth.exception.KeyTargetMustBeAgentException.class);
  }

  @Test
  void AGENT_지정후_조회_그리고_설정변경() {
    long admin = TestFixtures.createHuman();
    long agent = TestFixtures.createAgentNoToken();
    service.setAgent(admin, agent);

    var res = service.get();
    assertThat(res.agentUserId()).isEqualTo(agent);
    assertThat(res.hasActiveToken()).isFalse(); // 토큰 없음 경고용

    service.updateSettings(admin, "claude-opus-4-8", "DEEP");
    assertThat(service.get().model()).isEqualTo("claude-opus-4-8");
  }
}
```

- [ ] **Step 3: 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.auth.service.WorkspaceAssistantServiceTest"`
Expected: FAIL — 클래스 없음.

- [ ] **Step 4: 서비스 구현**

`WorkspaceAssistantService.java`:
```java
package com.workplace.auth.service;

import com.workplace.auth.dto.WorkspaceAssistantResponse;
import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.AssistantConfigRepository.ConfigRow;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 공용 비서 지정/설정(admin). AGENT 만 지정 가능. */
@Service
@RequiredArgsConstructor
@Transactional
public class WorkspaceAssistantService {

  private final WorkspaceAssistantRepository workspaceRepo;
  private final AssistantConfigRepository configRepo;
  private final AiAgentCredentialRepository credentialRepo;
  private final UserRepository userRepository;

  /** 공용 비서 AGENT 지정/변경. HUMAN 이면 거부. */
  public void setAgent(long adminId, long agentUserId) {
    var user =
        userRepository
            .findKind(agentUserId)
            .orElseThrow(() -> new com.workplace.user.exception.UserNotFoundException(agentUserId));
    if (!UserKind.isAgent(user)) {
      throw new KeyTargetMustBeAgentException();
    }
    workspaceRepo.upsert(agentUserId, adminId);
  }

  public void updateSettings(long adminId, String model, String thinkingDepth) {
    long agentId =
        workspaceRepo
            .findAgentId()
            .orElseThrow(() -> new IllegalStateException("공용 비서가 설정되지 않았어요."));
    ConfigRow cur = configRepo.find(agentId).orElse(new ConfigRow(null, null, null, null));
    configRepo.upsert(agentId, model, thinkingDepth, cur.maxTurns(), cur.timeoutMs());
  }

  @Transactional(readOnly = true)
  public WorkspaceAssistantResponse get() {
    var agentIdOpt = workspaceRepo.findAgentId();
    if (agentIdOpt.isEmpty()) {
      return new WorkspaceAssistantResponse(null, null, false, null, null);
    }
    long agentId = agentIdOpt.get();
    ConfigRow c = configRepo.find(agentId).orElse(new ConfigRow(null, null, null, null));
    return new WorkspaceAssistantResponse(
        agentId,
        userRepository.findNameById(agentId).orElse(null),
        credentialRepo.findActive(agentId).isPresent(),
        c.model() != null ? c.model() : AssistantDefaults.MODEL,
        c.thinkingDepth() != null ? c.thinkingDepth() : AssistantDefaults.THINKING_DEPTH);
  }
}
```
> **UserRepository 의존 메서드**: `findKind(long)`(kind 조회용 — 없으면 기존 `findById` 로 kind 확인하도록 조정), `findNameById(long)`(이름 표시용). 기존에 동등 메서드가 있으면 그것을 사용. 없으면 두 메서드를 UserRepository 에 추가:
> ```java
> public Optional<String> findKind(long id) {            // "HUMAN"/"AGENT" 또는 UserKind
>   return dsl.select(USER.KIND).from(USER).where(USER.ID.eq(id)).fetchOptional(USER.KIND).map(Object::toString);
> }
> public Optional<String> findNameById(long id) {
>   return dsl.select(USER.NAME).from(USER).where(USER.ID.eq(id)).fetchOptional(USER.NAME);
> }
> ```
> 그리고 `UserKind.isAgent(...)` 가 String 을 받게(또는 `"AGENT".equals(kind)` 비교로) 테스트와 일치시킨다. **타입은 컴파일러가 강제** — 위 시그니처와 service 호출부를 일치시킬 것.

- [ ] **Step 5: 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.auth.service.WorkspaceAssistantServiceTest"`
Expected: PASS (2 tests).

- [ ] **Step 6: 컨트롤러 작성**

`WorkspaceAssistantController.java`:
```java
package com.workplace.auth.controller;

import com.workplace.auth.dto.SetWorkspaceAssistantRequest;
import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.auth.dto.WorkspaceAssistantResponse;
import com.workplace.auth.service.WorkspaceAssistantService;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/** 공용 비서 admin. 기존 agent 관리 권한(user:write) 사용. */
@RestController
@RequestMapping("/api/v1/admin/workspace-assistant")
@RequiredArgsConstructor
@RequirePermission("user:write")
public class WorkspaceAssistantController {

  private final WorkspaceAssistantService service;

  @GetMapping
  public WorkspaceAssistantResponse get() {
    return service.get();
  }

  @PutMapping
  public ResponseEntity<Void> set(
      Authentication auth, @Valid @RequestBody SetWorkspaceAssistantRequest req) {
    service.setAgent((Long) auth.getPrincipal(), req.agentUserId());
    return ResponseEntity.noContent().build();
  }

  @PutMapping("/settings")
  public ResponseEntity<Void> updateSettings(
      Authentication auth, @Valid @RequestBody UpdateAssistantSettingsRequest req) {
    service.updateSettings((Long) auth.getPrincipal(), req.model(), req.thinkingDepth());
    return ResponseEntity.noContent().build();
  }
}
```

- [ ] **Step 7: spotless + 전체 auth 테스트 + Commit**

```bash
cd apps/workplace-api && ./gradlew spotlessApply && ./gradlew test --tests "com.workplace.auth.*"
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-api/src/main/java/com/workplace/auth/service/WorkspaceAssistantService.java \
        apps/workplace-api/src/main/java/com/workplace/auth/controller/WorkspaceAssistantController.java \
        apps/workplace-api/src/main/java/com/workplace/auth/dto/WorkspaceAssistantResponse.java \
        apps/workplace-api/src/main/java/com/workplace/auth/dto/SetWorkspaceAssistantRequest.java \
        apps/workplace-api/src/main/java/com/workplace/user/repository/UserRepository.java
git commit -m "feat(api): 공용 비서 admin(지정·설정, AGENT 검증) — #50"
```

---

# Phase B — ai-agent

### Task 10: thinkingDirective 순수 함수

**Files:**
- Create: `apps/workplace-ai-agent/src/agent/thinking.ts`
- Test: `apps/workplace-ai-agent/src/agent/thinking.test.ts`

> CLI 에 thinking 예산 플래그가 없으므로(확인됨), 생각의 깊이는 **system-prompt 에 덧붙는 지시문**으로 매핑한다. 관찰 가능하고 테스트 가능하며 CLI 의존이 없다.

- [ ] **Step 1: 실패 테스트 작성**

`thinking.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { thinkingDirective } from './thinking';

describe('thinkingDirective', () => {
  it('NONE 은 빈 문자열', () => {
    expect(thinkingDirective('NONE')).toBe('');
  });
  it('NORMAL 은 단계적 사고 지시', () => {
    expect(thinkingDirective('NORMAL')).toContain('단계');
  });
  it('DEEP 는 깊은 추론 지시(NORMAL 보다 강함)', () => {
    expect(thinkingDirective('DEEP').length).toBeGreaterThan(thinkingDirective('NORMAL').length);
  });
  it('알 수 없는 값은 NORMAL 로 폴백', () => {
    expect(thinkingDirective('WAT' as never)).toBe(thinkingDirective('NORMAL'));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/workplace-ai-agent && pnpm vitest run src/agent/thinking.test.ts`
Expected: FAIL — `thinking.ts` 없음.

- [ ] **Step 3: 구현**

`thinking.ts`:
```ts
// 생각의 깊이(thinking depth) → system-prompt 지시문 매핑.
// CLI 에 thinking 예산 플래그가 없어 프롬프트 지시로 근사한다. NONE/NORMAL/DEEP.

export type ThinkingDepth = 'NONE' | 'NORMAL' | 'DEEP';

const DIRECTIVES: Record<ThinkingDepth, string> = {
  NONE: '',
  NORMAL: '\n\n답하기 전에 필요한 만큼 단계적으로 생각하세요.',
  DEEP: '\n\n답하기 전에 충분히 깊게, 여러 가능성을 단계적으로 따져 추론한 뒤 신중하게 답하세요.',
};

/** depth 에 해당하는 system-prompt 접미 지시문. 알 수 없으면 NORMAL. */
export function thinkingDirective(depth: ThinkingDepth): string {
  return DIRECTIVES[depth] ?? DIRECTIVES.NORMAL;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/workplace-ai-agent && pnpm vitest run src/agent/thinking.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-ai-agent/src/agent/thinking.ts apps/workplace-ai-agent/src/agent/thinking.test.ts
git commit -m "feat(ai-agent): thinkingDirective(생각의 깊이→프롬프트 지시) — #50"
```

---

### Task 11: run-home-compose — env 제거 + 요청 필드 사용

**Files:**
- Modify: `apps/workplace-ai-agent/src/agent/run-home-compose.ts`
- Test: `apps/workplace-ai-agent/src/agent/run-home-compose.test.ts` (있으면 갱신, 없으면 생성)

- [ ] **Step 1: ComposeInput 확장 + env 제거**

`run-home-compose.ts` 수정:
1. `ComposeInput` 인터페이스에 필드 추가:
```ts
export interface ComposeInput {
  query: string;
  recentContext?: ContextMessage[];
  assistantAgentId: number;
  model: string;
  thinkingDepth: 'NONE' | 'NORMAL' | 'DEEP';
  maxTurns: number;
  timeoutMs: number;
}
```
2. `HomeComposerNotConfiguredError` 의 export 와 throw 제거(또는 deprecated 주석 후 미사용). `process.env.WORKPLACE_HOME_COMPOSER_AGENT_ID` 읽는 블록 삭제.
3. 본문에서 값 출처를 env → input 으로:
```ts
import { thinkingDirective } from './thinking';
// ...
export async function runHomeCompose(input: ComposeInput, deps: RunAgentDeps): Promise<ComposeResult> {
  const agentId = input.assistantAgentId;
  const token = (await deps.client.getOAuthToken(agentId)).token;
  const mcpConfigPath = await writeTempMcpConfig({
    agentId,
    baseURL: WORKPLACE_API_BASE_URL,
    internalToken: INTERNAL_SERVICE_TOKEN,
    profile: 'home',
  });
  try {
    const systemPrompt = HOME_SYSTEM_PROMPT + thinkingDirective(input.thinkingDepth);
    const args = buildCliArgs({
      userMessage: buildComposeUserMessage(input),
      systemPrompt,
      model: input.model,
      maxTurns: input.maxTurns,
      mcpConfigPath,
      includePartialMessages: false,
    });
    const env = buildChildEnv(process.env, token, agentId);
    const lines = await runClaudeCliCollect({
      args,
      env,
      timeoutMs: input.timeoutMs,
      logTag: 'home-compose',
    });
    return parseComposeLines(lines);
  } finally {
    await cleanupTempMcpConfig(mcpConfigPath);
  }
}
```
> 기존 `DEFAULT_MODEL`/`DEFAULT_MAX_TURNS`/`DEFAULT_TIMEOUT_MS` 상수와 env override 로직은 제거(요청이 항상 채워 보냄). 상수는 참고용으로 남겨도 되나 미사용 경고를 피하려면 삭제.

- [ ] **Step 2: 테스트 작성/갱신**

`run-home-compose.test.ts` (deps 모킹 — 기존 패턴 따름):
```ts
import { describe, it, expect, vi } from 'vitest';
import { runHomeCompose } from './run-home-compose';

describe('runHomeCompose', () => {
  it('input.assistantAgentId 로 토큰을 조회하고 input.model 로 동작한다', async () => {
    const getOAuthToken = vi.fn().mockResolvedValue({ token: 'tok', label: null });
    // runClaudeCliCollect 등은 모듈 모킹. 여기서는 getOAuthToken 이 agentId=7 로 호출되는지에 집중.
    const deps: any = { client: { getOAuthToken } };
    try {
      await runHomeCompose(
        { query: '안녕', assistantAgentId: 7, model: 'claude-sonnet-4-6', thinkingDepth: 'NORMAL', maxTurns: 8, timeoutMs: 60000 },
        deps,
      );
    } catch {
      /* CLI spawn 은 테스트 환경에서 실패할 수 있음 — 토큰 조회 호출 검증이 목적 */
    }
    expect(getOAuthToken).toHaveBeenCalledWith(7);
  });
});
```
> 기존 테스트가 `runClaudeCliCollect` 를 vi.mock 으로 스텁하는 패턴이 있으면 그것을 재사용해 happy-path 까지 검증. 없으면 위처럼 토큰 조회 인자만 단언(최소 검증)하고, CLI 스텁은 가능하면 추가.

- [ ] **Step 3: 테스트 실행**

Run: `cd apps/workplace-ai-agent && pnpm vitest run src/agent/run-home-compose.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-ai-agent/src/agent/run-home-compose.ts apps/workplace-ai-agent/src/agent/run-home-compose.test.ts
git commit -m "feat(ai-agent): run-home-compose env 제거, 요청 필드(agentId·model·thinking·turns·timeout)로 동작 — #50"
```

---

### Task 12: routes/home — composeSchema 확장 + 503 분기 제거

**Files:**
- Modify: `apps/workplace-ai-agent/src/routes/home.ts`
- Test: `apps/workplace-ai-agent/src/routes/home.test.ts` (있으면 갱신, 없으면 생성)

- [ ] **Step 1: 스키마 확장 + 분기 정리**

`home.ts` 수정:
```ts
const composeSchema = z.object({
  query: z.string().min(1),
  recentContext: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
  assistantAgentId: z.number().int().positive(),
  model: z.string().min(1),
  thinkingDepth: z.enum(['NONE', 'NORMAL', 'DEEP']),
  maxTurns: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
});
```
핸들러 내 `runHomeCompose(parsed.data, deps)` 호출은 동일. `HomeComposerNotConfiguredError` import/`instanceof` 분기(503 `home_composer_not_configured`)는 **제거**(api 가 미설정을 책임지므로 도달 불가). 나머지 에러 → 502 `compose_failed` 유지. 400 `invalid_payload` 유지.

- [ ] **Step 2: 테스트 작성/갱신**

`home.test.ts` (supertest 또는 기존 패턴):
```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHomeRouter } from './home';

describe('POST /home/compose validation', () => {
  const app = express().use(express.json()).use(createHomeRouter({ client: {} } as any));

  it('신규 필수 필드(assistantAgentId 등) 누락 시 400', async () => {
    const res = await request(app).post('/home/compose').send({ query: '안녕' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('thinkingDepth 가 enum 밖이면 400', async () => {
    const res = await request(app)
      .post('/home/compose')
      .send({ query: '안녕', assistantAgentId: 5, model: 'm', thinkingDepth: 'X', maxTurns: 8, timeoutMs: 60000 });
    expect(res.status).toBe(400);
  });
});
```
> `supertest` 미설치면 기존 라우트 테스트 방식에 맞춤. 없으면 `composeSchema.safeParse(...)` 를 직접 단언하는 단위 테스트로 대체(스키마를 export 하여).

- [ ] **Step 3: 테스트 실행**

Run: `cd apps/workplace-ai-agent && pnpm vitest run src/routes/home.test.ts`
Expected: PASS.

- [ ] **Step 4: 빌드/타입체크 + Commit**

```bash
cd apps/workplace-ai-agent && pnpm typecheck
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-ai-agent/src/routes/home.ts apps/workplace-ai-agent/src/routes/home.test.ts
git commit -m "feat(ai-agent): composeSchema 비서 필드 확장 + 미설정 503 분기 제거 — #50"
```

---

# Phase C — web

### Task 13: 비서 타입 + api 클라이언트

**Files:**
- Create: `apps/workplace-web/src/types/assistant.ts`
- Create: `apps/workplace-web/src/api/assistant.ts`

- [ ] **Step 1: 타입 작성**

`assistant.ts` (types):
```ts
// 비서(Assistant) 관련 타입. 백엔드 DTO 와 1:1.
export type ThinkingDepth = 'NONE' | 'NORMAL' | 'DEEP';

export interface AssistantStatus {
  configured: boolean;
  tokenLabel: string | null;
  tokenLastUsedAt: string | null;
  model: string | null;
  thinkingDepth: ThinkingDepth | null;
}

export interface WorkspaceAssistant {
  agentUserId: number | null;
  agentName: string | null;
  hasActiveToken: boolean;
  model: string | null;
  thinkingDepth: ThinkingDepth | null;
}

export interface UpdateAssistantSettings {
  model?: string | null;
  thinkingDepth?: ThinkingDepth | null;
}
```

- [ ] **Step 2: api 함수 작성**

`assistant.ts` (api):
```ts
import { client } from './client';
import type { AssistantStatus, UpdateAssistantSettings, WorkspaceAssistant } from '../types/assistant';

// 개인 비서(본인)
export const myAssistantApi = {
  getStatus: () => client.get<AssistantStatus>('/users/me/assistant').then((r) => r.data),
  registerToken: (token: string, label?: string) =>
    client.put<void>('/users/me/assistant/token', { token, label }).then((r) => r.data),
  updateSettings: (body: UpdateAssistantSettings) =>
    client.put<void>('/users/me/assistant/settings', body).then((r) => r.data),
  disable: () => client.delete<void>('/users/me/assistant').then((r) => r.data),
};

// 공용 비서(admin)
export const workspaceAssistantApi = {
  get: () => client.get<WorkspaceAssistant>('/admin/workspace-assistant').then((r) => r.data),
  setAgent: (agentUserId: number) =>
    client.put<void>('/admin/workspace-assistant', { agentUserId }).then((r) => r.data),
  updateSettings: (body: UpdateAssistantSettings) =>
    client.put<void>('/admin/workspace-assistant/settings', body).then((r) => r.data),
};
```

- [ ] **Step 3: typecheck + Commit**

```bash
cd apps/workplace-web && pnpm typecheck
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-web/src/types/assistant.ts apps/workplace-web/src/api/assistant.ts
git commit -m "feat(web): 비서 타입 + api 클라이언트(개인/공용) — #50"
```

---

### Task 14: TanStack Query 훅

**Files:**
- Create: `apps/workplace-web/src/hooks/queries/useAssistant.ts`

- [ ] **Step 1: 훅 작성**

`useAssistant.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { myAssistantApi, workspaceAssistantApi } from '../../api/assistant';
import type { UpdateAssistantSettings } from '../../types/assistant';

export const assistantKeys = {
  me: ['assistant', 'me'] as const,
  workspace: ['assistant', 'workspace'] as const,
};

// 개인 비서
export function useMyAssistant() {
  return useQuery({ queryKey: assistantKeys.me, queryFn: myAssistantApi.getStatus });
}
export function useRegisterMyAssistantToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ token, label }: { token: string; label?: string }) =>
      myAssistantApi.registerToken(token, label),
    onSuccess: () => qc.invalidateQueries({ queryKey: assistantKeys.me }),
  });
}
export function useUpdateMyAssistantSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAssistantSettings) => myAssistantApi.updateSettings(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: assistantKeys.me }),
  });
}
export function useDisableMyAssistant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => myAssistantApi.disable(),
    onSuccess: () => qc.invalidateQueries({ queryKey: assistantKeys.me }),
  });
}

// 공용 비서(admin)
export function useWorkspaceAssistant() {
  return useQuery({ queryKey: assistantKeys.workspace, queryFn: workspaceAssistantApi.get });
}
export function useSetWorkspaceAssistant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentUserId: number) => workspaceAssistantApi.setAgent(agentUserId),
    onSuccess: () => qc.invalidateQueries({ queryKey: assistantKeys.workspace }),
  });
}
export function useUpdateWorkspaceAssistantSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAssistantSettings) => workspaceAssistantApi.updateSettings(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: assistantKeys.workspace }),
  });
}
```

- [ ] **Step 2: typecheck + Commit**

```bash
cd apps/workplace-web && pnpm typecheck
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-web/src/hooks/queries/useAssistant.ts
git commit -m "feat(web): 비서 TanStack 훅(개인/공용 조회·변경) — #50"
```

---

### Task 15: 프로필 개인 비서 섹션 + ProfilePage 삽입

**Files:**
- Create: `apps/workplace-web/src/pages/profile/PersonalAssistantSection.tsx`
- Modify: `apps/workplace-web/src/pages/ProfilePage.tsx`
- Test: `apps/workplace-web/e2e/pages/personal-assistant.spec.ts`

- [ ] **Step 1: 섹션 컴포넌트 작성**

`PersonalAssistantSection.tsx`:
```tsx
import { useState } from 'react';
import {
  useMyAssistant,
  useRegisterMyAssistantToken,
  useUpdateMyAssistantSettings,
  useDisableMyAssistant,
} from '../../hooks/queries/useAssistant';
import type { ThinkingDepth } from '../../types/assistant';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { toast } from 'sonner';

const MODELS = ['claude-sonnet-4-6', 'claude-opus-4-8'];
const DEPTHS: { value: ThinkingDepth; label: string }[] = [
  { value: 'NONE', label: '없음' },
  { value: 'NORMAL', label: '보통' },
  { value: 'DEEP', label: '깊게' },
];

/** 프로필의 "개인 비서" 섹션. 토큰은 사용자 본인이 입력한다. */
export function PersonalAssistantSection() {
  const { data: status } = useMyAssistant();
  const register = useRegisterMyAssistantToken();
  const updateSettings = useUpdateMyAssistantSettings();
  const disable = useDisableMyAssistant();
  const [token, setToken] = useState('');

  const submitToken = async () => {
    const t = token.trim();
    if (t.length < 32) return toast.error('토큰 형식이 올바르지 않아요.');
    await register.mutateAsync({ token: t });
    setToken('');
    toast.success('개인 비서 토큰을 저장했어요.');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>개인 비서</CardTitle>
        <p className="text-sm text-muted-foreground">
          개인 비서를 설정하면 홈을 공용 비서 대신 내 비서가 담당해요.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.configured ? (
          <>
            <div className="text-sm" data-testid="assistant-configured">
              설정됨 · 토큰 {status.tokenLabel ?? '(라벨 없음)'}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm w-20">모델</label>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={status.model ?? ''}
                onChange={(e) => updateSettings.mutate({ model: e.target.value })}
              >
                {MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm w-20">생각의 깊이</label>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={status.thinkingDepth ?? 'NORMAL'}
                onChange={(e) => updateSettings.mutate({ thinkingDepth: e.target.value as ThinkingDepth })}
              >
                {DEPTHS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            <Button
              variant="destructive"
              onClick={async () => {
                await disable.mutateAsync();
                toast.success('개인 비서를 해제했어요.');
              }}
            >
              해제
            </Button>
          </>
        ) : (
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="sk-ant-oat-..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              data-testid="assistant-token-input"
            />
            <Button onClick={submitToken} disabled={register.isPending}>
              토큰 등록
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```
> import 경로(`../../components/ui/*`, `sonner`)는 ProfilePage 의 기존 import 와 일치시킬 것. ProfilePage 가 다른 toast/카드 경로를 쓰면 그걸 따른다.

- [ ] **Step 2: ProfilePage 에 삽입**

`ProfilePage.tsx` 의 마지막 Card 뒤(또는 적절한 위치)에 `<Separator />` 와 함께 추가:
```tsx
import { PersonalAssistantSection } from './profile/PersonalAssistantSection';
// ... JSX 내 마지막 섹션 다음:
        <Separator />
        <PersonalAssistantSection />
```

- [ ] **Step 3: E2E 작성 (page.route 모킹)**

`personal-assistant.spec.ts`:
```ts
import { test, expect } from '../fixtures/auth.fixture';

test.describe('프로필 개인 비서', () => {
  test('미설정 → 토큰 등록 → 설정됨', async ({ page }) => {
    let configured = false;
    await page.route('**/api/v1/users/me/assistant', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          json: configured
            ? { configured: true, tokenLabel: null, tokenLastUsedAt: null, model: 'claude-sonnet-4-6', thinkingDepth: 'NORMAL' }
            : { configured: false, tokenLabel: null, tokenLastUsedAt: null, model: null, thinkingDepth: null },
        });
      }
      return route.fallback();
    });
    await page.route('**/api/v1/users/me/assistant/token', async (route) => {
      configured = true;
      return route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/profile');
    await page.getByTestId('assistant-token-input').fill('x'.repeat(40));
    await page.getByRole('button', { name: '토큰 등록' }).click();
    await expect(page.getByTestId('assistant-configured')).toBeVisible();
  });
});
```
> 인증 fixture(`../fixtures/auth.fixture`)는 기존 home E2E 에서 쓰던 것 재사용. `/profile` 라우트가 인증 필요하면 fixture 가 처리.

- [ ] **Step 4: E2E 실행**

Run: `cd apps/workplace-web && pnpm exec playwright test e2e/pages/personal-assistant.spec.ts`
Expected: PASS.

- [ ] **Step 5: typecheck + Commit**

```bash
cd apps/workplace-web && pnpm typecheck
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-web/src/pages/profile/PersonalAssistantSection.tsx \
        apps/workplace-web/src/pages/ProfilePage.tsx \
        apps/workplace-web/e2e/pages/personal-assistant.spec.ts
git commit -m "feat(web): 프로필 개인 비서 섹션(토큰·모델·생각의 깊이·해제) + E2E — #50"
```

---

### Task 16: admin 공용 비서 카드 + AgentManagementPage 삽입

**Files:**
- Create: `apps/workplace-web/src/pages/admin/components/WorkspaceAssistantCard.tsx`
- Modify: `apps/workplace-web/src/pages/admin/AgentManagementPage.tsx`
- Test: `apps/workplace-web/e2e/pages/workspace-assistant.spec.ts`

- [ ] **Step 1: 카드 컴포넌트 작성**

`WorkspaceAssistantCard.tsx`:
```tsx
import {
  useWorkspaceAssistant,
  useSetWorkspaceAssistant,
  useUpdateWorkspaceAssistantSettings,
} from '../../../hooks/queries/useAssistant';
import { useAgents } from '../../../hooks/queries/useAgents';
import type { ThinkingDepth } from '../../../types/assistant';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';

const MODELS = ['claude-sonnet-4-6', 'claude-opus-4-8'];
const DEPTHS: { value: ThinkingDepth; label: string }[] = [
  { value: 'NONE', label: '없음' },
  { value: 'NORMAL', label: '보통' },
  { value: 'DEEP', label: '깊게' },
];

/** 워크스페이스 공용 비서 지정/설정(admin). */
export function WorkspaceAssistantCard() {
  const { data } = useWorkspaceAssistant();
  const { data: agents } = useAgents();
  const setAgent = useSetWorkspaceAssistant();
  const updateSettings = useUpdateWorkspaceAssistantSettings();

  return (
    <Card>
      <CardHeader>
        <CardTitle>공용 비서</CardTitle>
        <p className="text-sm text-muted-foreground">홈을 기본으로 담당하는 워크스페이스 비서예요.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <label className="text-sm w-24">비서 AGENT</label>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={data?.agentUserId ?? ''}
            onChange={(e) => setAgent.mutate(Number(e.target.value))}
            data-testid="workspace-assistant-agent"
          >
            <option value="" disabled>선택…</option>
            {(agents ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        {data?.agentUserId && !data.hasActiveToken && (
          <div className="text-sm text-amber-600" data-testid="workspace-assistant-warn">
            지정된 비서에 활성 토큰이 없어요. OAuth 토큰을 등록해야 홈이 동작해요.
          </div>
        )}
        {data?.agentUserId && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-sm w-24">모델</label>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={data.model ?? ''}
                onChange={(e) => updateSettings.mutate({ model: e.target.value })}
              >
                {MODELS.map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm w-24">생각의 깊이</label>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={data.thinkingDepth ?? 'NORMAL'}
                onChange={(e) => updateSettings.mutate({ thinkingDepth: e.target.value as ThinkingDepth })}
              >
                {DEPTHS.map((d) => (<option key={d.value} value={d.value}>{d.label}</option>))}
              </select>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```
> `useAgents` 의 반환 항목 필드명(`id`/`name`)은 기존 `AgentManagementPage` 가 쓰는 것과 일치시킬 것(서브에이전트 보고: `useAgents` 사용 중). 다르면 그 필드명으로.

- [ ] **Step 2: AgentManagementPage 에 삽입**

`AgentManagementPage.tsx` 상단(또는 우측 섹션 위)에 카드 추가:
```tsx
import { WorkspaceAssistantCard } from './components/WorkspaceAssistantCard';
// ... 페이지 최상단 영역에:
        <WorkspaceAssistantCard />
```

- [ ] **Step 3: E2E 작성**

`workspace-assistant.spec.ts`:
```ts
import { test, expect } from '../fixtures/auth.fixture';

test.describe('admin 공용 비서', () => {
  test('지정 + 토큰 없음 경고', async ({ page }) => {
    await page.route('**/api/v1/admin/workspace-assistant', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          json: { agentUserId: 5, agentName: 'AI', hasActiveToken: false, model: 'claude-sonnet-4-6', thinkingDepth: 'NORMAL' },
        });
      }
      return route.fulfill({ status: 204, body: '' });
    });
    await page.route('**/api/v1/admin/agents**', (route) =>
      route.fulfill({ json: [{ id: 5, name: 'AI' }] }),
    );

    await page.goto('/admin/agents');
    await expect(page.getByTestId('workspace-assistant-warn')).toBeVisible();
  });
});
```
> admin 경로/권한은 기존 admin E2E 패턴을 따름. 라우트 glob 은 실제 호출 URL 에 맞게 조정.

- [ ] **Step 4: E2E 실행**

Run: `cd apps/workplace-web && pnpm exec playwright test e2e/pages/workspace-assistant.spec.ts`
Expected: PASS.

- [ ] **Step 5: typecheck + Commit**

```bash
cd apps/workplace-web && pnpm typecheck
cd /Users/bluleo78/git/smart-workplace
git add apps/workplace-web/src/pages/admin/components/WorkspaceAssistantCard.tsx \
        apps/workplace-web/src/pages/admin/AgentManagementPage.tsx \
        apps/workplace-web/e2e/pages/workspace-assistant.spec.ts
git commit -m "feat(web): admin 공용 비서 카드(지정·토큰경고·설정) + E2E — #50"
```

---

# Phase D — 통합 검증 + env 정리

### Task 17: 라이브 스모크 + env 제거

**Files:**
- Modify: `apps/workplace-ai-agent/.env.local` (gitignored — 커밋 안 됨)

- [ ] **Step 1: 전체 스택 기동**

```bash
cd /Users/bluleo78/git/smart-workplace && pnpm db:up && pnpm dev
```
(api 9090 / web 6173 / ai-agent 7070 기동)

- [ ] **Step 2: 공용 비서 시드 확인**

```bash
docker exec smart-workplace-db-1 psql -U app -d workplace -c 'SELECT * FROM workspace_assistant;'
```
Expected: id=1, agent_user_id=5 (V18 시드). 없으면 admin UI 또는 `PUT /admin/workspace-assistant {agentUserId:5}` 로 지정.

- [ ] **Step 3: 홈에서 "안녕" 라이브 검증 (브라우저)**

홈(`/`)에서 채팅에 "안녕" 입력 → 200 + 위젯/메시지 응답. (#50 의 원래 증상이 사라졌는지 확인)
- 개인 비서를 프로필에서 등록한 계정으로도 동일 검증 → 개인 토큰으로 동작.

- [ ] **Step 4: env 제거**

`apps/workplace-ai-agent/.env.local` 에서 `WORKPLACE_HOME_COMPOSER_AGENT_ID=5` 줄 삭제 후 ai-agent 재기동 → 여전히 정상 동작(요청 필드 기반). 
Expected: env 없이도 홈 compose 정상 — env 의존 완전 제거 확인.

- [ ] **Step 5: 회귀 — 비서 미설정 에러 UX**

(임시) `workspace_assistant` 를 비우고 개인 비서도 없는 계정으로 "안녕" → 503 + "홈 비서가 아직 설정되지 않았어요…" 토스트. 확인 후 시드 복구.

> 이 태스크는 커밋 산출물이 없음(.env.local 은 gitignored). 검증 결과만 기록.

---

## 최종 리뷰 (모든 태스크 후)

- [ ] **api 전체 테스트:** `cd apps/workplace-api && ./gradlew test` — 전부 통과.
- [ ] **ai-agent 전체:** `cd apps/workplace-ai-agent && pnpm test && pnpm typecheck`.
- [ ] **web 전체:** `cd apps/workplace-web && pnpm typecheck && pnpm exec playwright test`.
- [ ] **최종 코드 리뷰** 후, 사용자 승인 하에 push/PR/#50 처리.

---

## Self-Review (작성자 체크 — 완료)

**Spec coverage:**
- §2 개념·우선순위 → Task 6 (AssistantResolver). ✅
- §3.1 workspace_assistant → Task 1+3. §3.2 user FK → Task 1+6. §3.3 assistant_config → Task 1+4. §3.4 개인 AGENT 자동 프로비저닝 → Task 8. ✅
- §4.1 Resolver → Task 6. §4.2 compose 확장 → Task 7. §4.3 self-service → Task 8. §4.4 admin → Task 9. ✅
- §5 ai-agent env 제거·요청 필드·thinking 매핑 → Task 10/11/12. ✅
- §6 web 프로필·admin → Task 13~16. ✅
- §7 에러 처리 → Task 5(503), 기존 #50 502, Pattern/Size 검증. ✅
- §8 테스트 → 각 태스크 TDD. ✅
- §9 롤아웃 순서(시드→…→env 제거) → Task 1 시드, Task 17 env 제거. ✅
- §10 비범위(max_turns/timeout UI 미노출, 페르소나 후속) → 준수. ✅

**Type consistency:** `AssistantSpec(agentUserId, model, thinkingDepth, maxTurns, timeoutMs)` 가 Task 2 정의 → Task 6 생성 → Task 7 ComposeRequest 매핑까지 동일. `ConfigRow(model, thinkingDepth, maxTurns, timeoutMs)` Task 4 정의 → Task 6/8/9 사용 동일. ai-agent `ComposeInput`/`composeSchema` 5필드 Task 11/12 동일. web 타입 Task 13 → 훅 14 → UI 15/16 동일. ✅

**알려진 구현시 확정 사항(플레이스홀더 아님):**
- `AiAgentCredentialRepository.findActive` 시그니처 / `OAuthTokenMetaResponse.lastUsedAt` 타입 / `UserRepository` 보조 메서드 존재 여부 — 컴파일러가 강제하며 본문에 대체 지침 명시.
- 테스트 fixture(`TestFixtures`/인라인) — IntegrationTestBase 의 기존 시드 헬퍼 유무에 따라 택1, 지침 명시.
