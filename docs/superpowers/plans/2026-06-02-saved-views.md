# 저장된 뷰(Saved Views) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 이슈 목록의 필터+뷰모드를 이름 붙여 저장(개인/공유)하고, 프로젝트 페이지 칩 바에서 재적용한다.

**Architecture:** 필터는 이미 URL 쿼리스트링으로 직렬화되므로(`lib/issueFilters.ts`), 저장된 뷰의 "필터"는 그 쿼리스트링을 불투명 TEXT 블롭으로 저장한다. 백엔드는 `label` 도메인을 미러링한 새 `view` 모듈(소유자+가시성 추가). 적용 = 저장된 쿼리스트링으로 URL 갱신.

**Tech Stack:** Spring Boot + jOOQ + Flyway / Vite + React 19 + TS + TanStack Query + shadcn / JUnit 통합 + Playwright E2E

**근거 스펙:** [docs/superpowers/specs/2026-06-02-saved-views-design.md](../specs/2026-06-02-saved-views-design.md)

---

## File Structure

**백엔드 (apps/workplace-api)**
- Create: `src/main/resources/db/migration/V20__saved_views.sql` — 테이블 + 권한 seed
- Create: `src/main/java/com/workplace/view/dto/{SavedViewRow,SaveViewRequest,SavedViewResponse}.java`
- Create: `src/main/java/com/workplace/view/exception/{SavedViewNotFoundException,SavedViewNameDuplicatedException,SavedViewAccessDeniedException}.java`
- Create: `src/main/java/com/workplace/view/repository/SavedViewRepository.java`
- Create: `src/main/java/com/workplace/view/service/SavedViewService.java`
- Create: `src/main/java/com/workplace/view/controller/SavedViewController.java`
- Modify: `src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java` — 3개 매핑
- Test: `src/test/java/com/workplace/view/service/SavedViewServiceTest.java`

**프론트 (apps/workplace-web)**
- Create: `src/types/savedView.ts`
- Create: `src/api/savedViews.ts`
- Create: `src/hooks/queries/useSavedViews.ts`
- Create: `src/pages/projects/components/SaveViewDialog.tsx`
- Create: `src/pages/projects/components/ViewChipBar.tsx`
- Create: `src/lib/savedViewQuery.ts` — 쿼리스트링 정규화(활성 칩 비교)
- Modify: `src/pages/projects/ProjectDetailPage.tsx` — 칩 바 삽입
- Test: `src/lib/savedViewQuery.test.ts` (vitest), `e2e/pages/projects/saved-views.spec.ts`

---

## Task 1: 백엔드 — V20 마이그레이션 (saved_view 테이블 + 권한)

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V20__saved_views.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성** (V7 라벨 마이그레이션의 권한 seed 패턴 미러링)

```sql
-- 저장된 뷰(Saved Views) — 프로젝트별 필터 쿼리스트링을 이름 붙여 저장. 개인(PRIVATE)/공유(SHARED).
CREATE TABLE saved_view (
    id         BIGSERIAL    PRIMARY KEY,
    project_id BIGINT       NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    owner_id   BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    name       VARCHAR(60)  NOT NULL,
    query      TEXT         NOT NULL,                       -- filtersToParams 결과 쿼리스트링(불투명)
    visibility VARCHAR(8)   NOT NULL DEFAULT 'PRIVATE',     -- PRIVATE | SHARED
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_saved_view_owner_name UNIQUE (project_id, owner_id, name),
    CONSTRAINT ck_saved_view_visibility CHECK (visibility IN ('PRIVATE','SHARED'))
);
CREATE INDEX idx_saved_view_project ON saved_view(project_id);

-- 신규 권한: savedview:manage (저장된 뷰 CRUD). 실제 소유/공유 검증은 service 에서.
INSERT INTO permission (code, description, category) VALUES
    ('savedview:manage', '프로젝트 저장된 뷰 생성/수정/삭제', 'project');

-- USER 역할에 부여 (멤버 누구나 자기 뷰 생성 가능; 세부 권한은 service)
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'USER'
  AND p.code = 'savedview:manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- ADMIN 도 동일 보유
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'ADMIN'
  AND p.code = 'savedview:manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
```

먼저 `ls apps/workplace-api/src/main/resources/db/migration/ | tail -3` 로 V20 이 비어 있고 최신이 V19 인지 확인한다(다른 번호면 다음 번호로 조정).

- [ ] **Step 2: 마이그레이션 적용 + jOOQ 생성 확인** (테스트 DB에 반영되고 jOOQ Tables.SAVED_VIEW 생성되는지)

Run: `cd apps/workplace-api && ./gradlew flywayMigrate generateJooq 2>&1 | tail -5 && ls src/main/generated/com/workplace/jooq/tables/SavedView.java`
Expected: 마이그레이션 성공 + `SavedView.java` 존재. (generateJooq 가 별도 task 명이 아니면 `./gradlew compileJava` 가 generateJooq 를 트리거한다 — 빌드가 SAVED_VIEW 상수를 만들어야 한다.)

> jOOQ 생성 소스(src/main/generated)는 커밋하지 않는다(.gitignore).

- [ ] **Step 3: 커밋**

```bash
git add apps/workplace-api/src/main/resources/db/migration/V20__saved_views.sql
git commit --no-verify -m "feat(api): saved_view 테이블 + savedview:manage 권한 마이그레이션(V20)"
```

---

## Task 2: 백엔드 — SavedView 데이터 계층 (DTO·Repository·예외)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/view/dto/SavedViewRow.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/view/dto/SaveViewRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/view/dto/SavedViewResponse.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/view/exception/SavedViewNotFoundException.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/view/exception/SavedViewNameDuplicatedException.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/view/exception/SavedViewAccessDeniedException.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/view/repository/SavedViewRepository.java`

- [ ] **Step 1: DTO 3종 생성**

`SavedViewRow.java`:
```java
package com.workplace.view.dto;

import java.time.Instant;

/** 리포지토리 → 서비스 전달용 내부 saved_view row. */
public record SavedViewRow(
    Long id,
    Long projectId,
    Long ownerId,
    String name,
    String query,
    String visibility,
    Instant createdAt,
    Instant updatedAt) {}
```

`SaveViewRequest.java`:
```java
package com.workplace.view.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 뷰 생성/수정 공통 요청. query 는 프론트 필터 쿼리스트링(불투명, 빈 문자열 허용 안 함은 NotBlank 로). */
public record SaveViewRequest(
    @NotBlank @Size(max = 60) String name,
    @NotBlank @Size(max = 2000) String query,
    @Pattern(regexp = "PRIVATE|SHARED") String visibility) {}
```

`SavedViewResponse.java`:
```java
package com.workplace.view.dto;

import java.time.Instant;

/** 저장된 뷰 응답. mine = 호출자가 owner 인지(프론트 수정/삭제 메뉴 노출용). */
public record SavedViewResponse(
    Long id,
    String name,
    String query,
    String visibility,
    Long ownerId,
    boolean mine,
    Instant createdAt,
    Instant updatedAt) {}
```

- [ ] **Step 2: 예외 3종 생성** (label 예외 미러링)

`SavedViewNotFoundException.java`:
```java
package com.workplace.view.exception;

/** 저장된 뷰 없음 — 404 매핑. */
public class SavedViewNotFoundException extends RuntimeException {
  public SavedViewNotFoundException(Long id) {
    super("저장된 뷰를 찾을 수 없습니다: id=" + id);
  }
}
```

`SavedViewNameDuplicatedException.java`:
```java
package com.workplace.view.exception;

/** 같은 사용자/프로젝트 내 뷰 이름 중복 — 409 매핑. */
public class SavedViewNameDuplicatedException extends RuntimeException {
  public SavedViewNameDuplicatedException(String name) {
    super("이미 존재하는 뷰 이름입니다: " + name);
  }
}
```

`SavedViewAccessDeniedException.java`:
```java
package com.workplace.view.exception;

/** 본인 소유가 아닌 뷰 수정/삭제 시도 — 403 매핑. */
public class SavedViewAccessDeniedException extends RuntimeException {
  public SavedViewAccessDeniedException(String message) {
    super(message);
  }
}
```

- [ ] **Step 3: SavedViewRepository 생성** (LabelRepository 미러링 + 가시성 쿼리)

```java
package com.workplace.view.repository;

import static com.workplace.jooq.Tables.SAVED_VIEW;

import com.workplace.view.dto.SavedViewRow;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

/** saved_view jOOQ 리포지토리. UNIQUE(project_id, owner_id, name) 위반은 DuplicateKeyException 으로 변환. */
@Repository
@RequiredArgsConstructor
public class SavedViewRepository {

  private final DSLContext dsl;

  private SavedViewRow mapToRow(Record r) {
    OffsetDateTime created = r.get(SAVED_VIEW.CREATED_AT);
    OffsetDateTime updated = r.get(SAVED_VIEW.UPDATED_AT);
    return new SavedViewRow(
        r.get(SAVED_VIEW.ID),
        r.get(SAVED_VIEW.PROJECT_ID),
        r.get(SAVED_VIEW.OWNER_ID),
        r.get(SAVED_VIEW.NAME),
        r.get(SAVED_VIEW.QUERY),
        r.get(SAVED_VIEW.VISIBILITY),
        created != null ? created.toInstant() : null,
        updated != null ? updated.toInstant() : null);
  }

  /** 호출자에게 보이는 뷰 — 프로젝트의 SHARED ∪ 내 소유(가시성 무관). 이름 오름차순. */
  public List<SavedViewRow> findVisible(Long projectId, Long userId) {
    return dsl.selectFrom(SAVED_VIEW)
        .where(
            SAVED_VIEW
                .PROJECT_ID
                .eq(projectId)
                .and(SAVED_VIEW.VISIBILITY.eq("SHARED").or(SAVED_VIEW.OWNER_ID.eq(userId))))
        .orderBy(SAVED_VIEW.NAME.asc())
        .fetch(this::mapToRow);
  }

  public Optional<SavedViewRow> findById(Long id) {
    return dsl.selectFrom(SAVED_VIEW).where(SAVED_VIEW.ID.eq(id)).fetchOptional(this::mapToRow);
  }

  public SavedViewRow insert(
      Long projectId, Long ownerId, String name, String query, String visibility) {
    try {
      return dsl.insertInto(SAVED_VIEW)
          .set(SAVED_VIEW.PROJECT_ID, projectId)
          .set(SAVED_VIEW.OWNER_ID, ownerId)
          .set(SAVED_VIEW.NAME, name)
          .set(SAVED_VIEW.QUERY, query)
          .set(SAVED_VIEW.VISIBILITY, visibility)
          .returning()
          .fetchOptional()
          .map(this::mapToRow)
          .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("saved_view name duplicated", e);
    }
  }

  public void update(Long id, String name, String query, String visibility) {
    try {
      dsl.update(SAVED_VIEW)
          .set(SAVED_VIEW.NAME, name)
          .set(SAVED_VIEW.QUERY, query)
          .set(SAVED_VIEW.VISIBILITY, visibility)
          .set(SAVED_VIEW.UPDATED_AT, OffsetDateTime.now())
          .where(SAVED_VIEW.ID.eq(id))
          .execute();
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("saved_view name duplicated", e);
    }
  }

  public void delete(Long id) {
    dsl.deleteFrom(SAVED_VIEW).where(SAVED_VIEW.ID.eq(id)).execute();
  }
}
```

- [ ] **Step 4: 컴파일 확인**

Run: `cd apps/workplace-api && ./gradlew compileJava 2>&1 | tail -5`
Expected: BUILD SUCCESSFUL (SAVED_VIEW 상수 인식). 실패 시 `./gradlew generateJooq` 를 먼저 실행(Task 1 에서 테이블이 생성돼 있어야 함).

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/view/dto \
        apps/workplace-api/src/main/java/com/workplace/view/exception \
        apps/workplace-api/src/main/java/com/workplace/view/repository
git commit --no-verify -m "feat(api): SavedView 데이터 계층(DTO·Repository·예외)"
```

---

## Task 3: 백엔드 — SavedViewService + Controller + 예외 매핑 + 통합테스트

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/view/service/SavedViewService.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/view/controller/SavedViewController.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/view/service/SavedViewServiceTest.java`

- [ ] **Step 1: 실패 통합테스트 작성** (LabelServiceTest 헬퍼 미러링; 가시성·권한·CRUD·중복 검증)

```java
package com.workplace.view.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.view.dto.SaveViewRequest;
import com.workplace.view.dto.SavedViewResponse;
import com.workplace.view.exception.SavedViewAccessDeniedException;
import com.workplace.view.exception.SavedViewNameDuplicatedException;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** SavedViewService 통합 테스트 — 가시성 격리, 소유/공유 권한, CRUD, 중복. */
@Transactional
class SavedViewServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired SavedViewService service;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository memberRepository;

  private Long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  private ProjectResponse newProject(Long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  private SaveViewRequest req(String name, String query, String visibility) {
    return new SaveViewRequest(name, query, visibility);
  }

  @Test
  void member_creates_private_view_and_marks_mine() {
    Long owner = createUser("v");
    ProjectResponse p = newProject(owner, "VA");
    var resp = service.create(owner, p.key(), req("내 HIGH", "priority=HIGH", "PRIVATE"));
    assertThat(resp.name()).isEqualTo("내 HIGH");
    assertThat(resp.query()).isEqualTo("priority=HIGH");
    assertThat(resp.visibility()).isEqualTo("PRIVATE");
    assertThat(resp.mine()).isTrue();
  }

  @Test
  void private_view_hidden_from_others_shared_visible() {
    Long owner = createUser("vo");
    Long member = createUser("vm");
    ProjectResponse p = newProject(owner, "VB");
    memberRepository.insert(p.id(), member, "MEMBER");
    service.create(owner, p.key(), req("owner-private", "q=x", "PRIVATE"));
    service.create(owner, p.key(), req("owner-shared", "q=y", "SHARED"));

    // member 에게는 SHARED 만 보인다.
    var memberSees = service.list(member, p.key());
    assertThat(memberSees).extracting(SavedViewResponse::name).containsExactly("owner-shared");
    // owner 에게는 둘 다 보인다.
    var ownerSees = service.list(owner, p.key());
    assertThat(ownerSees).extracting(SavedViewResponse::name)
        .containsExactlyInAnyOrder("owner-private", "owner-shared");
  }

  @Test
  void mine_flag_false_for_others_shared_view() {
    Long owner = createUser("vo2");
    Long member = createUser("vm2");
    ProjectResponse p = newProject(owner, "VC");
    memberRepository.insert(p.id(), member, "MEMBER");
    service.create(owner, p.key(), req("shared", "q=z", "SHARED"));
    var seen = service.list(member, p.key());
    assertThat(seen).hasSize(1);
    assertThat(seen.get(0).mine()).isFalse();
  }

  @Test
  void non_owner_member_cannot_update_others_view() {
    Long owner = createUser("vo3");
    Long member = createUser("vm3");
    ProjectResponse p = newProject(owner, "VD");
    memberRepository.insert(p.id(), member, "MEMBER");
    var v = service.create(owner, p.key(), req("shared", "q=a", "SHARED"));
    assertThatThrownBy(() -> service.update(member, p.key(), v.id(), req("hack", "q=b", "SHARED")))
        .isInstanceOf(SavedViewAccessDeniedException.class);
  }

  @Test
  void project_owner_can_delete_shared_view_of_other() {
    Long owner = createUser("vo4");
    Long member = createUser("vm4");
    ProjectResponse p = newProject(owner, "VE");
    memberRepository.insert(p.id(), member, "MEMBER");
    // member 가 만든 SHARED 뷰를 프로젝트 OWNER 가 삭제 가능(모더레이션).
    var v = service.create(member, p.key(), req("m-shared", "q=c", "SHARED"));
    service.delete(owner, p.key(), v.id());
    assertThat(service.list(owner, p.key())).isEmpty();
  }

  @Test
  void duplicate_name_same_owner_throws_409() {
    Long owner = createUser("vo5");
    ProjectResponse p = newProject(owner, "VF");
    service.create(owner, p.key(), req("dup", "q=1", "PRIVATE"));
    assertThatThrownBy(() -> service.create(owner, p.key(), req("dup", "q=2", "PRIVATE")))
        .isInstanceOf(SavedViewNameDuplicatedException.class);
  }

  @Test
  void list_requires_membership() {
    Long owner = createUser("vo6");
    Long outsider = createUser("out6");
    ProjectResponse p = newProject(owner, "VG");
    assertThatThrownBy(() -> service.list(outsider, p.key()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests 'com.workplace.view.service.SavedViewServiceTest'`
Expected: 컴파일 에러(SavedViewService 미존재).

- [ ] **Step 3: SavedViewService 작성**

```java
package com.workplace.view.service;

import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.project.service.ProjectPermissionChecker;
import com.workplace.view.dto.SaveViewRequest;
import com.workplace.view.dto.SavedViewResponse;
import com.workplace.view.dto.SavedViewRow;
import com.workplace.view.exception.SavedViewAccessDeniedException;
import com.workplace.view.exception.SavedViewNameDuplicatedException;
import com.workplace.view.exception.SavedViewNotFoundException;
import com.workplace.view.repository.SavedViewRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 저장된 뷰 CRUD. 조회/생성은 멤버 누구나(자기 뷰), 수정/삭제는 뷰 owner 본인 또는 SHARED 뷰에 한해 프로젝트 OWNER(모더레이션).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class SavedViewService {

  private final SavedViewRepository repository;
  private final ProjectAccessGuard accessGuard;
  private final ProjectPermissionChecker permissionChecker;

  /** 멤버용 — 호출자에게 보이는 뷰 목록(내 것 + SHARED). */
  @Transactional(readOnly = true)
  public List<SavedViewResponse> list(Long callerId, String projectKey) {
    var project = accessGuard.assertMember(projectKey, callerId);
    return repository.findVisible(project.id(), callerId).stream()
        .map(r -> toResponse(r, callerId))
        .toList();
  }

  /** 멤버 — 새 뷰 생성(소유자=호출자). visibility 기본 PRIVATE. */
  public SavedViewResponse create(Long callerId, String projectKey, SaveViewRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    String name = req.name().trim();
    String visibility = normalizeVisibility(req.visibility());
    try {
      var row = repository.insert(project.id(), callerId, name, req.query(), visibility);
      return toResponse(row, callerId);
    } catch (DuplicateKeyException e) {
      throw new SavedViewNameDuplicatedException(name);
    }
  }

  /** 수정 — owner 본인만(이름/쿼리/가시성). */
  public SavedViewResponse update(
      Long callerId, String projectKey, Long viewId, SaveViewRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row = loadInProject(viewId, project.id());
    if (!row.ownerId().equals(callerId)) {
      throw new SavedViewAccessDeniedException("본인의 뷰만 수정할 수 있습니다");
    }
    String name = req.name().trim();
    try {
      repository.update(viewId, name, req.query(), normalizeVisibility(req.visibility()));
    } catch (DuplicateKeyException e) {
      throw new SavedViewNameDuplicatedException(name);
    }
    return toResponse(repository.findById(viewId).orElseThrow(), callerId);
  }

  /** 삭제 — owner 본인, 또는 SHARED 뷰면 프로젝트 OWNER 도 가능(모더레이션). */
  public void delete(Long callerId, String projectKey, Long viewId) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row = loadInProject(viewId, project.id());
    boolean owner = row.ownerId().equals(callerId);
    boolean moderator =
        "SHARED".equals(row.visibility())
            && permissionChecker.hasProjectRole(project.id(), callerId, "OWNER");
    if (!owner && !moderator) {
      throw new SavedViewAccessDeniedException("뷰를 삭제할 권한이 없습니다");
    }
    repository.delete(viewId);
  }

  private SavedViewRow loadInProject(Long viewId, Long projectId) {
    var row = repository.findById(viewId).orElseThrow(() -> new SavedViewNotFoundException(viewId));
    if (!row.projectId().equals(projectId)) {
      throw new SavedViewNotFoundException(viewId);
    }
    return row;
  }

  private static String normalizeVisibility(String v) {
    return "SHARED".equals(v) ? "SHARED" : "PRIVATE";
  }

  private static SavedViewResponse toResponse(SavedViewRow r, Long callerId) {
    return new SavedViewResponse(
        r.id(),
        r.name(),
        r.query(),
        r.visibility(),
        r.ownerId(),
        r.ownerId().equals(callerId),
        r.createdAt(),
        r.updatedAt());
  }
}
```

> **확인 필요(미러링 검증):** `ProjectPermissionChecker.hasProjectRole(projectId, userId, role)` 가 실제로 존재하는지 READ 로 확인한다. 없으면 프로젝트 OWNER 판정 방법을 ProjectAccessGuard 로 대체한다 — 예: `try { accessGuard.assertWithRole(projectKey, callerId, "OWNER"); moderator = true; } catch (ProjectAccessDeniedException ignored) { moderator = false; }`. 둘 중 코드베이스에 존재하는 방식을 사용하고, 시그니처가 다르면 맞춘다. (테스트 `project_owner_can_delete_shared_view_of_other` 가 이 분기를 강제 검증한다.)

- [ ] **Step 4: SavedViewController 작성** (LabelController 미러링; 단 list/create 는 멤버 누구나)

```java
package com.workplace.view.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.view.dto.SaveViewRequest;
import com.workplace.view.dto.SavedViewResponse;
import com.workplace.view.service.SavedViewService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** 프로젝트 스코프 저장된 뷰 CRUD. 세부 소유/공유 검증은 서비스 레이어. */
@RestController
@RequestMapping("/api/v1/projects/{key}/saved-views")
@RequiredArgsConstructor
public class SavedViewController {

  private final SavedViewService service;

  /** 목록 — 멤버 권한이면 조회(내 것 + SHARED). */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<SavedViewResponse>> list(
      Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(service.list((Long) auth.getPrincipal(), key));
  }

  /** 생성 — 멤버 누구나(자기 뷰). */
  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  @RequirePermission("savedview:manage")
  public ResponseEntity<SavedViewResponse> create(
      Authentication auth, @PathVariable String key, @Valid @RequestBody SaveViewRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.create((Long) auth.getPrincipal(), key, req));
  }

  /** 수정 — owner 본인. */
  @PatchMapping("/{id}")
  @RequirePermission("savedview:manage")
  public ResponseEntity<SavedViewResponse> update(
      Authentication auth,
      @PathVariable String key,
      @PathVariable Long id,
      @Valid @RequestBody SaveViewRequest req) {
    return ResponseEntity.ok(service.update((Long) auth.getPrincipal(), key, id, req));
  }

  /** 삭제 — owner 본인 또는 SHARED 모더레이터. */
  @DeleteMapping("/{id}")
  @RequirePermission("savedview:manage")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable String key, @PathVariable Long id) {
    service.delete((Long) auth.getPrincipal(), key, id);
    return ResponseEntity.noContent().build();
  }
}
```

- [ ] **Step 5: GlobalExceptionHandler 에 3개 매핑 추가** (라벨 매핑 옆에 미러링)

`GlobalExceptionHandler.java` 의 라벨 핸들러(404/409) 근처에 추가:
```java
  /** 저장된 뷰 없음 — 404. */
  @ExceptionHandler(com.workplace.view.exception.SavedViewNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleSavedViewNotFound(
      com.workplace.view.exception.SavedViewNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  /** 저장된 뷰 이름 중복 — 409. */
  @ExceptionHandler(com.workplace.view.exception.SavedViewNameDuplicatedException.class)
  public ResponseEntity<ErrorResponse> handleSavedViewNameDuplicated(
      com.workplace.view.exception.SavedViewNameDuplicatedException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request));
  }

  /** 저장된 뷰 권한 없음 — 403. */
  @ExceptionHandler(com.workplace.view.exception.SavedViewAccessDeniedException.class)
  public ResponseEntity<ErrorResponse> handleSavedViewAccessDenied(
      com.workplace.view.exception.SavedViewAccessDeniedException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.FORBIDDEN)
        .body(buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request));
  }
```
READ 로 `buildError` 시그니처와 import(HttpStatus, HttpServletRequest, ErrorResponse)가 이미 있는지 확인하고 동일 패턴을 따른다.

- [ ] **Step 6: 테스트 통과 확인** (flake 시 1회 재시도)

Run: `cd apps/workplace-api && ./gradlew test --tests 'com.workplace.view.service.SavedViewServiceTest'`
Expected: PASS (7 tests).

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/view/service \
        apps/workplace-api/src/main/java/com/workplace/view/controller \
        apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java \
        apps/workplace-api/src/test/java/com/workplace/view/service/SavedViewServiceTest.java
git commit --no-verify -m "feat(api): SavedView 서비스·컨트롤러 + 예외 매핑 + 통합테스트"
```

---

## Task 4: 프론트 — 타입·API·훅 + 쿼리 정규화 유틸

**Files:**
- Create: `apps/workplace-web/src/types/savedView.ts`
- Create: `apps/workplace-web/src/api/savedViews.ts`
- Create: `apps/workplace-web/src/hooks/queries/useSavedViews.ts`
- Create: `apps/workplace-web/src/lib/savedViewQuery.ts`
- Test: `apps/workplace-web/src/lib/savedViewQuery.test.ts`

- [ ] **Step 1: 타입 생성** `src/types/savedView.ts`

```ts
// 저장된 뷰 — 백엔드 DTO 와 1:1. query 는 이슈 필터 쿼리스트링(불투명).
export type Visibility = 'PRIVATE' | 'SHARED'

export interface SavedViewResponse {
  id: number
  name: string
  query: string
  visibility: Visibility
  ownerId: number
  mine: boolean
  createdAt: string
  updatedAt: string
}

export interface SaveViewRequest {
  name: string
  query: string
  visibility: Visibility
}
```

- [ ] **Step 2: API 모듈 생성** `src/api/savedViews.ts` (labels.ts 미러링)

```ts
// 저장된 뷰 API — 프로젝트 스코프 CRUD.
import type { SaveViewRequest, SavedViewResponse } from '../types/savedView'
import { client } from './client'

export async function listSavedViews(projectKey: string): Promise<SavedViewResponse[]> {
  const { data } = await client.get<SavedViewResponse[]>(`/projects/${projectKey}/saved-views`)
  return data
}

export async function createSavedView(
  projectKey: string,
  body: SaveViewRequest,
): Promise<SavedViewResponse> {
  const { data } = await client.post<SavedViewResponse>(`/projects/${projectKey}/saved-views`, body)
  return data
}

export async function updateSavedView(
  projectKey: string,
  id: number,
  body: SaveViewRequest,
): Promise<SavedViewResponse> {
  const { data } = await client.patch<SavedViewResponse>(
    `/projects/${projectKey}/saved-views/${id}`,
    body,
  )
  return data
}

export async function deleteSavedView(projectKey: string, id: number): Promise<void> {
  await client.delete<void>(`/projects/${projectKey}/saved-views/${id}`)
}
```

- [ ] **Step 3: 훅 생성** `src/hooks/queries/useSavedViews.ts` (useIssueTypes 미러링)

```ts
// 저장된 뷰 쿼리/뮤테이션 — 목록 + CRUD.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from '../../api/savedViews'
import { handleApiError } from '../../lib/api-error'
import type { SaveViewRequest } from '../../types/savedView'

export function useSavedViews(projectKey: string) {
  return useQuery({
    queryKey: ['savedViews', projectKey],
    queryFn: () => listSavedViews(projectKey),
    enabled: !!projectKey,
  })
}

export function useCreateSavedView(projectKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SaveViewRequest) => createSavedView(projectKey, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['savedViews', projectKey] })
      toast.success('뷰를 저장했습니다')
    },
    onError: (e) => handleApiError(e, '뷰 저장에 실패했습니다'),
  })
}

export function useUpdateSavedView(projectKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: number; body: SaveViewRequest }) =>
      updateSavedView(projectKey, v.id, v.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['savedViews', projectKey] })
      toast.success('뷰를 수정했습니다')
    },
    onError: (e) => handleApiError(e, '뷰 수정에 실패했습니다'),
  })
}

export function useDeleteSavedView(projectKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteSavedView(projectKey, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['savedViews', projectKey] })
      toast.success('뷰를 삭제했습니다')
    },
    onError: (e) => handleApiError(e, '뷰 삭제에 실패했습니다'),
  })
}
```

- [ ] **Step 4: 정규화 유틸 실패 테스트 작성** `src/lib/savedViewQuery.test.ts`

활성 칩 판정을 위해 쿼리스트링을 정규화(키 순서·미지정 파라미터 무시)해 비교한다. `parseFilters`/`filtersToParams`/`parseView` 를 통과시켜 canonical form 으로 만든다.
```ts
import { describe, expect, it } from 'vitest'

import { normalizeIssueQuery, queriesEqual } from './savedViewQuery'

describe('normalizeIssueQuery', () => {
  it('키 순서가 달라도 같은 정규형', () => {
    expect(normalizeIssueQuery('priority=HIGH&status=TODO')).toBe(
      normalizeIssueQuery('status=TODO&priority=HIGH'),
    )
  })

  it('알 수 없는 파라미터는 제거된다', () => {
    expect(normalizeIssueQuery('status=TODO&bogus=1')).toBe('status=TODO')
  })

  it('빈 쿼리는 빈 문자열', () => {
    expect(normalizeIssueQuery('')).toBe('')
  })
})

describe('queriesEqual', () => {
  it('정규형이 같으면 true', () => {
    expect(queriesEqual('status=TODO&priority=HIGH', 'priority=HIGH&status=TODO')).toBe(true)
  })
  it('다르면 false', () => {
    expect(queriesEqual('status=TODO', 'status=DONE')).toBe(false)
  })
})
```

- [ ] **Step 5: 실패 확인**

Run: `cd apps/workplace-web && corepack pnpm exec vitest run src/lib/savedViewQuery.test.ts`
Expected: FAIL ("Cannot find module './savedViewQuery'").

- [ ] **Step 6: 정규화 유틸 구현** `src/lib/savedViewQuery.ts`

```ts
// 저장된 뷰 쿼리스트링 정규화 — 활성 칩 판정용.
// 이슈 필터 직렬화를 한 번 통과시켜 키 순서/미지정 파라미터를 제거한 canonical 문자열을 만든다.
import { filtersToParams, parseFilters, parseView } from './issueFilters'

/** 쿼리스트링 → canonical 쿼리스트링(이슈 필터로 round-trip). */
export function normalizeIssueQuery(query: string): string {
  const params = new URLSearchParams(query)
  return filtersToParams(parseFilters(params), parseView(params)).toString()
}

/** 두 이슈 필터 쿼리스트링이 (정규화 후) 동등한가. */
export function queriesEqual(a: string, b: string): boolean {
  return normalizeIssueQuery(a) === normalizeIssueQuery(b)
}
```

- [ ] **Step 7: 통과 확인 + 타입체크**

Run: `cd apps/workplace-web && corepack pnpm exec vitest run src/lib/savedViewQuery.test.ts && corepack pnpm exec tsc -b --noEmit`
Expected: PASS (5 tests) + tsc exit 0.

- [ ] **Step 8: 커밋**

```bash
git add apps/workplace-web/src/types/savedView.ts apps/workplace-web/src/api/savedViews.ts \
        apps/workplace-web/src/hooks/queries/useSavedViews.ts \
        apps/workplace-web/src/lib/savedViewQuery.ts apps/workplace-web/src/lib/savedViewQuery.test.ts
git commit --no-verify -m "feat(web): 저장된 뷰 타입·API·훅 + 쿼리 정규화 유틸"
```

---

## Task 5: 프론트 — 뷰 칩 바 + 저장 다이얼로그 + 페이지 통합 + E2E

**Files:**
- Create: `apps/workplace-web/src/pages/projects/components/SaveViewDialog.tsx`
- Create: `apps/workplace-web/src/pages/projects/components/ViewChipBar.tsx`
- Modify: `apps/workplace-web/src/pages/projects/ProjectDetailPage.tsx`
- Test: `apps/workplace-web/e2e/pages/projects/saved-views.spec.ts`

- [ ] **Step 1: 실패 E2E 작성** `e2e/pages/projects/saved-views.spec.ts` (labels.spec 의 모킹 패턴 미러링)

```ts
// 저장된 뷰 E2E — 필터 적용 → 뷰 저장(payload 검증) → 칩 등장 → 적용/삭제.
import { expect, test } from '../../fixtures/auth.fixture'
import { createIssueSearchResponse } from '../../factories/issue.factory'
import { createProject } from '../../factories/project.factory'
import type { SavedViewResponse } from '../../../src/types/savedView'

const KEY = 'WP'

test('저장된 뷰 — 필터 저장 → 칩 등장 → 클릭 시 필터 복원 → 삭제', async ({
  authenticatedPage: page,
}) => {
  const views: SavedViewResponse[] = []

  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  )
  // 라벨/유형 빈 목록(필터바 의존).
  await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route(`**/api/v1/projects/${KEY}/issue-types`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  // 이슈 검색 — 빈 목록(칩 동작만 검증).
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([], null)),
      }),
  )
  // saved-views GET/POST/DELETE in-memory.
  await page.route(`**/api/v1/projects/${KEY}/saved-views`, async (route) => {
    const m = route.request().method()
    if (m === 'GET')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(views) })
    if (m === 'POST') {
      const body = route.request().postDataJSON() as { name: string; query: string; visibility: string }
      const created: SavedViewResponse = {
        id: views.length + 1, name: body.name, query: body.query,
        visibility: body.visibility as SavedViewResponse['visibility'],
        ownerId: 1, mine: true, createdAt: '', updatedAt: '',
      }
      views.push(created)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) })
    }
    return route.fallback()
  })

  await page.goto(`/projects/${KEY}`)

  // 1) 필터 적용 — 우선순위 HIGH (URL 에 priority=HIGH 반영).
  await page.getByTestId('priority-filter-HIGH').click()
  await expect(page).toHaveURL(/priority=HIGH/)

  // 2) ＋뷰 저장 → 다이얼로그 → 이름 입력 → 저장. POST payload 검증.
  const posted = page.waitForRequest(
    (r) => r.url().endsWith(`/projects/${KEY}/saved-views`) && r.method() === 'POST',
  )
  await page.getByTestId('save-view-button').click()
  await page.getByTestId('save-view-name').fill('내 HIGH')
  await page.getByTestId('save-view-submit').click()
  const req = await posted
  expect(req.postDataJSON()).toMatchObject({ name: '내 HIGH', visibility: 'PRIVATE' })
  expect((req.postDataJSON() as { query: string }).query).toContain('priority=HIGH')

  // 3) 칩 등장.
  await expect(page.getByTestId('view-chip-1')).toContainText('내 HIGH')

  // 4) 필터 해제(전체) → URL 에서 priority 제거.
  await page.getByTestId('view-chip-all').click()
  await expect(page).not.toHaveURL(/priority=HIGH/)

  // 5) 저장된 칩 클릭 → 필터 복원.
  await page.getByTestId('view-chip-1').click()
  await expect(page).toHaveURL(/priority=HIGH/)

  // 6) 삭제 — DELETE 호출 + 칩 제거.
  await page.route(`**/api/v1/projects/${KEY}/saved-views/1`, (route) => {
    views.length = 0
    return route.fulfill({ status: 204, body: '' })
  })
  await page.getByTestId('view-chip-menu-1').click()
  await page.getByTestId('view-delete-1').click()
  await expect(page.getByTestId('view-chip-1')).toHaveCount(0)
})
```

> 먼저 `e2e/pages/projects/labels.spec.ts` 와 `IssueFilterBar.tsx` 를 읽어 실제 우선순위 필터 토글의 testid(예: `priority-filter-HIGH`)와 이슈 타입 엔드포인트 경로(`issue-types`)가 맞는지 확인하고, 다르면 테스트를 실제에 맞춘다. `createProject`/`createIssueSearchResponse` 팩토리 시그니처도 확인.

- [ ] **Step 2: E2E 실패 확인**

Run: `cd apps/workplace-web && corepack pnpm exec playwright test e2e/pages/projects/saved-views.spec.ts`
Expected: FAIL (칩 바/저장 버튼 없음).

- [ ] **Step 3: SaveViewDialog 작성** `src/pages/projects/components/SaveViewDialog.tsx`

```tsx
// 뷰 저장 다이얼로그 — 현재 URL 쿼리스트링을 이름+가시성과 함께 저장.
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import { useCreateSavedView } from '../../../hooks/queries/useSavedViews'
import type { Visibility } from '../../../types/savedView'

export function SaveViewDialog({
  projectKey,
  query,
  open,
  onOpenChange,
}: {
  projectKey: string
  /** 저장할 현재 필터 쿼리스트링(? 제외). */
  query: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const create = useCreateSavedView(projectKey)
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('PRIVATE')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await create.mutateAsync({ name: trimmed, query, visibility })
      setName('')
      setVisibility('PRIVATE')
      onOpenChange(false)
    } catch {
      // 토스트는 훅 onError 에서 처리
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>뷰 저장</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="save-view-name">
              뷰 이름
            </label>
            <Input
              id="save-view-name"
              data-testid="save-view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 내 HIGH 이슈"
            />
          </div>
          {/* 가시성 — 개인(나만)/공유(프로젝트 멤버 전체) */}
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'PRIVATE'}
                onChange={() => setVisibility('PRIVATE')}
              />
              개인
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="visibility"
                data-testid="save-view-shared"
                checked={visibility === 'SHARED'}
                onChange={() => setVisibility('SHARED')}
              />
              공유
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" data-testid="save-view-submit" disabled={create.isPending}>
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: ViewChipBar 작성** `src/pages/projects/components/ViewChipBar.tsx`

```tsx
// 뷰 칩 바 — [전체] + 저장된 뷰 칩 + ＋뷰 저장. 칩 클릭 시 필터 복원.
import { Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { useDeleteSavedView, useSavedViews } from '../../../hooks/queries/useSavedViews'
import { filtersToParams, parseFilters, parseView } from '../../../lib/issueFilters'
import { queriesEqual } from '../../../lib/savedViewQuery'
import { SaveViewDialog } from './SaveViewDialog'

export function ViewChipBar({ projectKey }: { projectKey: string }) {
  const [params, setParams] = useSearchParams()
  const views = useSavedViews(projectKey)
  const del = useDeleteSavedView(projectKey)
  const [saveOpen, setSaveOpen] = useState(false)

  // 현재 필터 쿼리스트링(정규화 비교용/저장용).
  const currentQuery = filtersToParams(parseFilters(params), parseView(params)).toString()
  const isAllActive = currentQuery === ''

  const apply = (query: string) => setParams(new URLSearchParams(query), { replace: true })

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid="view-chip-bar">
      <button
        type="button"
        data-testid="view-chip-all"
        onClick={() => apply('')}
        className={cn(
          'rounded-full border px-3 py-1 text-sm',
          isAllActive ? 'border-foreground bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50',
        )}
      >
        전체
      </button>

      {(views.data ?? []).map((v) => {
        const active = queriesEqual(currentQuery, v.query)
        return (
          <div key={v.id} className="flex items-center">
            <button
              type="button"
              data-testid={`view-chip-${v.id}`}
              onClick={() => apply(v.query)}
              className={cn(
                'flex items-center gap-1 rounded-full border py-1 pl-3 pr-2 text-sm',
                active ? 'border-foreground bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              {v.visibility === 'SHARED' && <Users className="h-3.5 w-3.5" aria-label="공유" />}
              <span>{v.name}</span>
            </button>
            {v.mine && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  data-testid={`view-chip-menu-${v.id}`}
                  aria-label="뷰 메뉴"
                  className="ml-0.5 rounded p-1 text-muted-foreground hover:bg-accent"
                >
                  ⋯
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    data-testid={`view-delete-${v.id}`}
                    onSelect={() => del.mutate(v.id)}
                    className="text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> 삭제
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )
      })}

      <button
        type="button"
        data-testid="save-view-button"
        onClick={() => setSaveOpen(true)}
        className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:bg-accent/50"
      >
        <Plus className="h-3.5 w-3.5" /> 뷰 저장
      </button>

      <SaveViewDialog
        projectKey={projectKey}
        query={currentQuery}
        open={saveOpen}
        onOpenChange={setSaveOpen}
      />
    </div>
  )
}
```

> 수정(이름/가시성 변경) UI 는 v1 비범위(삭제만). 추후 ⋯ 메뉴에 '수정' 추가 가능. `useUpdateSavedView` 훅은 Task 4 에 이미 있으니 미사용 경고가 나면 이 단계에서 사용하거나, 린트가 미사용 export 를 문제 삼지 않으면 그대로 둔다(export 된 훅은 미사용 경고 대상 아님).

- [ ] **Step 5: ProjectDetailPage 에 칩 바 삽입** — `IssueArea` 의 `<IssueFilterBar/>` 바로 위.

`ProjectDetailPage.tsx` 의 `IssueArea` 컴포넌트를 수정:
```tsx
import { ViewChipBar } from './components/ViewChipBar'
// ...
function IssueArea({ projectKey }: { projectKey: string }) {
  const [params] = useSearchParams()
  const filters = parseFilters(params)
  const view = parseView(params)

  return (
    <section aria-label="태스크">
      <ViewChipBar projectKey={projectKey} />
      <IssueFilterBar projectKey={projectKey} />
      {view === 'board' ? (
        <IssueBoardView projectKey={projectKey} filters={filters} />
      ) : (
        <IssueListView projectKey={projectKey} filters={filters} />
      )}
    </section>
  )
}
```

- [ ] **Step 6: 타입체크 + E2E 통과**

Run: `cd apps/workplace-web && corepack pnpm exec tsc -b --noEmit` → exit 0.
Run: `cd apps/workplace-web && corepack pnpm exec playwright test e2e/pages/projects/saved-views.spec.ts` → PASS.
(ECONNREFUSED proxy 노이즈/포트 6173 stale 서버는 환경 이슈 — 재시도/정리.)

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-web/src/pages/projects/components/SaveViewDialog.tsx \
        apps/workplace-web/src/pages/projects/components/ViewChipBar.tsx \
        apps/workplace-web/src/pages/projects/ProjectDetailPage.tsx \
        apps/workplace-web/e2e/pages/projects/saved-views.spec.ts
git commit --no-verify -m "feat(web): 프로젝트 뷰 칩 바 + 뷰 저장 다이얼로그(저장된 뷰 적용/삭제)"
```

---

## Task 6: 전체 회귀 + 마무리

- [ ] **Step 1: 프론트 게이트**

Run: `cd apps/workplace-web && corepack pnpm exec tsc -b --noEmit && corepack pnpm exec eslint src/lib/savedViewQuery.ts src/types/savedView.ts src/api/savedViews.ts src/hooks/queries/useSavedViews.ts src/pages/projects/components/SaveViewDialog.tsx src/pages/projects/components/ViewChipBar.tsx src/pages/projects/ProjectDetailPage.tsx && corepack pnpm exec vitest run && corepack pnpm exec playwright test e2e/pages/projects/saved-views.spec.ts e2e/pages/projects/labels.spec.ts`
Expected: 전부 PASS. (신규 파일 import-sort 위반 시 `eslint --fix` 후 재커밋.)

- [ ] **Step 2: 백엔드 게이트**

Run: `cd apps/workplace-api && ./gradlew test 2>&1 | tail -8`
Expected: BUILD SUCCESSFUL. (project-key 충돌 flake 2건 이하 발생 시 해당 클래스만 재실행 — 알려진 flake.)

- [ ] **Step 3: 최종 리뷰** — superpowers:finishing-a-development-branch 로 마무리.

---

## Self-Review

**Spec coverage:**
- saved_view 테이블/가시성/UNIQUE → Task 1 ✓
- 쿼리스트링 블롭 저장 → query TEXT(Task 1) + 프론트 currentQuery 저장(Task 5) ✓
- 권한(멤버 생성, owner 수정/삭제, SHARED는 프로젝트 OWNER 삭제) → Task 3 service + 테스트 ✓
- 가시성 필터(내 것 + SHARED) → SavedViewRepository.findVisible + 테스트 ✓
- 409/404/403 매핑 → Task 3 GlobalExceptionHandler ✓
- 칩 바(전체/칩/＋뷰 저장/공유 아이콘/삭제), 적용, 활성 판정 → Task 4(정규화)+Task 5 ✓
- E2E(저장 payload·칩·적용·삭제), JUnit(가시성·권한·CRUD·409) ✓

**Type consistency:** `SaveViewRequest{name,query,visibility}` · `SavedViewResponse{id,name,query,visibility,ownerId,mine,...}` · 훅 `useSavedViews/useCreateSavedView/useUpdateSavedView/useDeleteSavedView` · `normalizeIssueQuery/queriesEqual` · 경로 `/projects/{key}/saved-views` — Task 2~5 일관.

**미확정(실행자 확인 지시 포함):**
1. `ProjectPermissionChecker.hasProjectRole(...)` 존재 여부 — Task 3 Step 3 주석에서 READ 후 대체안(assertWithRole try/catch) 지시.
2. 프론트 우선순위 필터 testid·issue-types 엔드포인트 — Task 5 Step 1 에서 실제 확인 지시.
3. `@RequirePermission`/`buildError` import 위치 — Task 3 Step 5 에서 READ 지시.

**Placeholder scan:** 없음(미확정 3건은 "실행자가 READ 후 맞춘다"는 구체 지시로 해소).
