# Phase 1 — 이슈 트래커 골격 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project/Issue/Comment/History 도메인을 추가하고, 프로젝트 목록·상세·이슈 상세·설정 페이지까지 동작하는 이슈 트래커 골격을 완성한다.

**Architecture:** Spring Modulith 패턴 — `project`, `issue` 모듈 추가, 도메인 간 직접 import 금지(서비스 빈 의존만 허용). 식별자는 내부 Long PK + 외부 `{projectKey}-{number}` 이중. 권한은 기존 `@RequirePermission` + 신규 `ProjectAccessGuard` 두 단계.

**Tech Stack:** Spring Boot, jOOQ, Flyway PostgreSQL, JUnit 5 + Mockito + `@WebMvcTest`, React 19, TanStack Query, shadcn/ui, Zod + React Hook Form, Playwright.

**커밋 정책:** 사용자 요청으로 구현 중 중간 커밋 금지. 모든 검증 통과 후 마지막 Task 에서 단일 커밋.

**참고 spec:** [`../specs/2026-05-22-issue-tracker-phase1-design.md`](../specs/2026-05-22-issue-tracker-phase1-design.md)
**참고 에픽:** GitHub #16

---

## 사전 준비

- [ ] **PRE-1:** 작업 시작 전 DB 가 떠 있는지 확인

```bash
pnpm db:up
docker ps --format '{{.Names}}' | grep -E 'smart-workplace-db'
```

기대: `smart-workplace-db-1`, `smart-workplace-db-test-1` 두 컨테이너가 running 상태.

- [ ] **PRE-2:** 기준 통과 확인 (회귀 베이스라인)

```bash
cd apps/workplace-api && ./gradlew test -x generateJooq
cd apps/workplace-web && pnpm typecheck && pnpm test:e2e
```

기대: 전부 PASS. 실패가 있으면 본 plan 시작 전 별도로 처리.

---

## Backend

### Task 1: Flyway V5 마이그레이션 + 권한 seed

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V5__init_issue_tracker.sql`

- [ ] **Step 1.1: 마이그레이션 SQL 작성**

```sql
-- V5: 이슈 트래커 골격 (project / issue / comment / history)
-- - Project + ProjectMember
-- - Issue + IssueNumberSequence (프로젝트별 단조 증가)
-- - IssueComment, IssueHistory
-- - 신규 권한 코드 + ADMIN/USER 역할 매핑

CREATE TABLE project (
    id          BIGSERIAL    PRIMARY KEY,
    key         VARCHAR(10)  NOT NULL UNIQUE,
    name        VARCHAR(120) NOT NULL,
    description TEXT,
    owner_id    BIGINT       NOT NULL REFERENCES "user"(id),
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMP
);

CREATE INDEX idx_project_active ON project(id) WHERE deleted_at IS NULL;

CREATE TABLE project_member (
    project_id BIGINT      NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    role       VARCHAR(16) NOT NULL,
    created_at TIMESTAMP   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id),
    CHECK (role IN ('OWNER', 'MEMBER'))
);

CREATE INDEX idx_project_member_user ON project_member(user_id);

-- 프로젝트별 이슈 번호 발급 (UPDATE ... RETURNING 으로 직렬화)
CREATE TABLE project_issue_sequence (
    project_id  BIGINT NOT NULL PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
    next_number INT    NOT NULL DEFAULT 1
);

CREATE TABLE issue (
    id           BIGSERIAL    PRIMARY KEY,
    project_id   BIGINT       NOT NULL REFERENCES project(id),
    number       INT          NOT NULL,
    title        VARCHAR(200) NOT NULL,
    body         TEXT,
    status       VARCHAR(16)  NOT NULL DEFAULT 'TODO',
    priority     VARCHAR(8)   NOT NULL DEFAULT 'MID',
    due_date     DATE,
    reporter_id  BIGINT       NOT NULL REFERENCES "user"(id),
    assignee_id  BIGINT       REFERENCES "user"(id),
    created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
    closed_at    TIMESTAMP,
    deleted_at   TIMESTAMP,
    CONSTRAINT uq_issue_project_number UNIQUE (project_id, number),
    CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELED')),
    CHECK (priority IN ('LOW', 'MID', 'HIGH'))
);

CREATE INDEX idx_issue_project_status_updated ON issue(project_id, status, updated_at DESC);
CREATE INDEX idx_issue_assignee ON issue(assignee_id);
CREATE INDEX idx_issue_active ON issue(project_id) WHERE deleted_at IS NULL;

CREATE TABLE issue_comment (
    id          BIGSERIAL PRIMARY KEY,
    issue_id    BIGINT    NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
    author_id   BIGINT    NOT NULL REFERENCES "user"(id),
    body        TEXT      NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMP
);

CREATE INDEX idx_issue_comment_issue_created ON issue_comment(issue_id, created_at);

CREATE TABLE issue_history (
    id          BIGSERIAL   PRIMARY KEY,
    issue_id    BIGINT      NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
    actor_id    BIGINT      NOT NULL REFERENCES "user"(id),
    event_type  VARCHAR(32) NOT NULL,
    from_value  TEXT,
    to_value    TEXT,
    created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_issue_history_issue_created ON issue_history(issue_id, created_at);

-- 신규 권한 코드
INSERT INTO permission (code, description, category) VALUES
    ('project:read',   '프로젝트 조회',          'project'),
    ('project:write',  '프로젝트 생성/수정',     'project'),
    ('project:manage', '프로젝트 멤버 관리/삭제', 'project'),
    ('issue:write',    '이슈 생성/수정/코멘트',  'issue');

-- ADMIN 에 신규 권한 전체 부여
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'ADMIN'
  AND p.code IN ('project:read', 'project:write', 'project:manage', 'issue:write')
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- USER 에 read/write/issue:write 부여 (manage 제외)
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'USER'
  AND p.code IN ('project:read', 'project:write', 'issue:write')
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
```

- [ ] **Step 1.2: dev DB 에 마이그레이션 적용 (jOOQ codegen 전제 조건)**

```bash
cd apps/workplace-api && ./gradlew flywayMigrate
```

문제 시: `pnpm db:up` 이 떠 있는지 확인. 적용 후 `docker exec smart-workplace-db-1 psql -U app -d workplace -c '\dt'` 로 `project`, `issue`, `issue_comment`, `issue_history`, `project_member`, `project_issue_sequence` 존재 확인.

- [ ] **Step 1.3: test DB 에도 동일 적용**

```bash
cd apps/workplace-api && ./gradlew flywayMigrate -Dflyway.url=jdbc:postgresql://localhost:5435/workplace_test -Dflyway.user=app -Dflyway.password=app
```

또는 `pnpm db:reset` 으로 양쪽 재기동 (단, dev 데이터 손실 — 임시 작업이면 위 명시 옵션 권장).

- [ ] **Step 1.4: jOOQ 코드젠**

```bash
cd apps/workplace-api && ./gradlew generateJooq
```

기대: `src/main/generated/com/workplace/jooq/public_/tables/` 하위에 `Project`, `Issue`, `IssueComment`, `IssueHistory`, `ProjectMember`, `ProjectIssueSequence` 생성.

- [ ] **Step 1.5: 컴파일 확인**

```bash
cd apps/workplace-api && ./gradlew compileJava
```

기대: BUILD SUCCESSFUL.

---

### Task 2: Project 도메인 — 패키지 셋업 + Repository

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/project/repository/ProjectRepository.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/repository/ProjectMemberRepository.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/repository/ProjectIssueSequenceRepository.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/exception/ProjectNotFoundException.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/exception/ProjectAccessDeniedException.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/exception/ProjectConflictException.java`

- [ ] **Step 2.1: 예외 3종 작성**

```java
// ProjectNotFoundException — 404
package com.workplace.project.exception;
public class ProjectNotFoundException extends RuntimeException {
  public ProjectNotFoundException(String key) {
    super("프로젝트를 찾을 수 없습니다: " + key);
  }
}
```

```java
// ProjectAccessDeniedException — 403
package com.workplace.project.exception;
public class ProjectAccessDeniedException extends RuntimeException {
  public ProjectAccessDeniedException(String message) { super(message); }
}
```

```java
// ProjectConflictException — 409
package com.workplace.project.exception;
public class ProjectConflictException extends RuntimeException {
  public ProjectConflictException(String message) { super(message); }
}
```

- [ ] **Step 2.2: `GlobalExceptionHandler` 에 핸들러 추가**

`apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java` 에 다음 추가 (기존 핸들러 패턴 그대로):

```java
@ExceptionHandler(ProjectNotFoundException.class)
public ResponseEntity<ErrorResponse> handleProjectNotFound(ProjectNotFoundException ex) {
  return ResponseEntity.status(HttpStatus.NOT_FOUND)
      .body(new ErrorResponse("PROJECT_NOT_FOUND", ex.getMessage()));
}

@ExceptionHandler(ProjectAccessDeniedException.class)
public ResponseEntity<ErrorResponse> handleProjectAccessDenied(ProjectAccessDeniedException ex) {
  return ResponseEntity.status(HttpStatus.FORBIDDEN)
      .body(new ErrorResponse("PROJECT_ACCESS_DENIED", ex.getMessage()));
}

@ExceptionHandler(ProjectConflictException.class)
public ResponseEntity<ErrorResponse> handleProjectConflict(ProjectConflictException ex) {
  return ResponseEntity.status(HttpStatus.CONFLICT)
      .body(new ErrorResponse("PROJECT_CONFLICT", ex.getMessage()));
}
```

(`ErrorResponse` 시그니처는 기존 사용처를 확인하고 맞춘다.)

- [ ] **Step 2.3: `ProjectRepository` 작성**

`DSLContext` 기반. 메서드:

```java
package com.workplace.project.repository;

import static com.workplace.jooq.public_.Tables.PROJECT;
import com.workplace.project.dto.ProjectRow; // record (id,key,name,description,ownerId,createdAt,updatedAt)
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class ProjectRepository {
  private final DSLContext dsl;

  // 활성 프로젝트만 (deleted_at IS NULL)
  public Optional<ProjectRow> findByKey(String key) { /* SELECT ... WHERE key = ? AND deleted_at IS NULL */ }
  public Optional<ProjectRow> findById(Long id) { ... }
  public List<ProjectRow> findAllForUser(Long userId, boolean isAdmin, int page, int size) { ... }
  public long countForUser(Long userId, boolean isAdmin) { ... }
  public ProjectRow insert(String key, String name, String description, Long ownerId) { ... }
  public void update(Long id, String name, String description) { /* updated_at = now() */ }
  public void softDelete(Long id) { /* deleted_at = now() */ }
  public boolean existsByKey(String key) { /* 활성 + 삭제 모두 포함 */ }
}
```

(`ProjectRow` 는 dto 패키지로 분리 또는 repository 내부 record. 본 plan 은 dto 패키지에 둔다.)

- [ ] **Step 2.4: `ProjectMemberRepository` 작성**

```java
@Repository
@RequiredArgsConstructor
public class ProjectMemberRepository {
  private final DSLContext dsl;

  public Optional<MemberRow> find(Long projectId, Long userId) { ... }   // (role 포함)
  public List<MemberRow> findAllByProject(Long projectId) { ... }
  public void insert(Long projectId, Long userId, String role) { ... }
  public void updateRole(Long projectId, Long userId, String role) { ... }
  public void delete(Long projectId, Long userId) { ... }
  public long countOwners(Long projectId) { ... }                       // OWNER 보호용
  public boolean isMember(Long projectId, Long userId) { ... }
}
```

`MemberRow`: `(Long projectId, Long userId, String role, Instant createdAt)`.

- [ ] **Step 2.5: `ProjectIssueSequenceRepository` 작성**

```java
@Repository
@RequiredArgsConstructor
public class ProjectIssueSequenceRepository {
  private final DSLContext dsl;

  // 시퀀스 행 생성 (프로젝트 생성 시 호출)
  public void initialize(Long projectId) {
    dsl.insertInto(PROJECT_ISSUE_SEQUENCE)
       .set(PROJECT_ISSUE_SEQUENCE.PROJECT_ID, projectId)
       .set(PROJECT_ISSUE_SEQUENCE.NEXT_NUMBER, 1)
       .execute();
  }

  // 다음 번호 발급. UPDATE ... RETURNING 로 원자적.
  public int allocateNext(Long projectId) {
    return dsl.update(PROJECT_ISSUE_SEQUENCE)
        .set(PROJECT_ISSUE_SEQUENCE.NEXT_NUMBER, PROJECT_ISSUE_SEQUENCE.NEXT_NUMBER.plus(1))
        .where(PROJECT_ISSUE_SEQUENCE.PROJECT_ID.eq(projectId))
        .returning(PROJECT_ISSUE_SEQUENCE.NEXT_NUMBER)
        .fetchOne()
        .getNextNumber() - 1; // RETURNING 은 갱신 후 값. 1만큼 빼서 발급 값으로 사용.
  }
}
```

- [ ] **Step 2.6: 컴파일 확인**

```bash
cd apps/workplace-api && ./gradlew compileJava
```

---

### Task 3: ProjectAccessGuard + ProjectService DTO

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/project/dto/ProjectRow.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/dto/MemberRow.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/dto/ProjectResponse.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/dto/CreateProjectRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/dto/UpdateProjectRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/dto/MemberResponse.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/dto/AddMemberRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/dto/UpdateMemberRoleRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/service/ProjectAccessGuard.java`

- [ ] **Step 3.1: DTO record 정의 (모두 java record)**

```java
package com.workplace.project.dto;
import java.time.Instant;
public record ProjectRow(Long id, String key, String name, String description, Long ownerId, Instant createdAt, Instant updatedAt) {}
```

```java
package com.workplace.project.dto;
public record MemberRow(Long projectId, Long userId, String role, java.time.Instant createdAt) {}
```

```java
package com.workplace.project.dto;
import jakarta.validation.constraints.*;
public record CreateProjectRequest(
    @NotBlank @Pattern(regexp = "^[A-Z][A-Z0-9]{1,9}$", message = "key 는 대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다") String key,
    @NotBlank @Size(max = 120) String name,
    @Size(max = 2000) String description) {}
```

```java
package com.workplace.project.dto;
import jakarta.validation.constraints.*;
public record UpdateProjectRequest(@NotBlank @Size(max = 120) String name, @Size(max = 2000) String description) {}
```

```java
package com.workplace.project.dto;
import java.time.Instant;
public record ProjectResponse(Long id, String key, String name, String description, Long ownerId, Instant createdAt, Instant updatedAt) {
  public static ProjectResponse from(ProjectRow r) {
    return new ProjectResponse(r.id(), r.key(), r.name(), r.description(), r.ownerId(), r.createdAt(), r.updatedAt());
  }
}
```

```java
package com.workplace.project.dto;
public record MemberResponse(Long userId, String username, String name, String role, java.time.Instant createdAt) {}
```

```java
package com.workplace.project.dto;
import jakarta.validation.constraints.*;
public record AddMemberRequest(@NotNull Long userId, @NotBlank @Pattern(regexp = "OWNER|MEMBER") String role) {}
```

```java
package com.workplace.project.dto;
import jakarta.validation.constraints.*;
public record UpdateMemberRoleRequest(@NotBlank @Pattern(regexp = "OWNER|MEMBER") String role) {}
```

- [ ] **Step 3.2: `ProjectAccessGuard` 작성**

```java
package com.workplace.project.service;

import com.workplace.global.security.PermissionChecker;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.dto.MemberRow;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class ProjectAccessGuard {
  private final ProjectRepository projectRepository;
  private final ProjectMemberRepository memberRepository;
  private final PermissionChecker permissionChecker; // 기존 빈 (system ADMIN 판별)

  /** projectKey 로 프로젝트 조회 후 멤버십 검증. ADMIN 이면 모두 통과. */
  public ProjectRow assertMember(String projectKey, Long userId) {
    return assertWithRole(projectKey, userId, null);
  }

  /** OWNER 필요 시 requiredRole = "OWNER". */
  public ProjectRow assertWithRole(String projectKey, Long userId, String requiredRole) {
    ProjectRow project = projectRepository.findByKey(projectKey)
        .orElseThrow(() -> new ProjectNotFoundException(projectKey));

    if (permissionChecker.userHasRole(userId, "ADMIN")) {
      return project;
    }

    MemberRow member = memberRepository.find(project.id(), userId)
        .orElseThrow(() -> new ProjectAccessDeniedException("프로젝트 멤버가 아닙니다"));

    if (requiredRole != null && !requiredRole.equals(member.role())) {
      throw new ProjectAccessDeniedException("권한이 부족합니다: " + requiredRole + " 필요");
    }
    return project;
  }
}
```

`PermissionChecker.userHasRole(Long, String)` 가 없다면 `apps/workplace-api/src/main/java/com/workplace/global/security/PermissionChecker.java` 에 추가:

```java
public boolean userHasRole(Long userId, String roleName) {
  // permissionService 또는 roleRepository 활용. 기존 user-role 조회 패턴 그대로.
}
```

(구현 시 기존 `PermissionChecker` 의 의존성을 따라 알맞은 repository/service 활용. 이 메서드 미존재면 추가가 필요.)

- [ ] **Step 3.3: 컴파일 확인**

```bash
cd apps/workplace-api && ./gradlew compileJava
```

---

### Task 4: ProjectService + 컨트롤러

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/project/service/ProjectService.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/controller/ProjectController.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/project/controller/ProjectMemberController.java`

- [ ] **Step 4.1: `ProjectService` — Project CRUD**

```java
package com.workplace.project.service;

import com.workplace.global.dto.PageResponse;
import com.workplace.global.security.PermissionChecker;
import com.workplace.project.dto.*;
import com.workplace.project.exception.*;
import com.workplace.project.repository.*;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@Transactional
public class ProjectService {
  private final ProjectRepository projectRepository;
  private final ProjectMemberRepository memberRepository;
  private final ProjectIssueSequenceRepository sequenceRepository;
  private final ProjectAccessGuard accessGuard;
  private final PermissionChecker permissionChecker;

  // 프로젝트 생성: key 중복 체크 → INSERT project → 호출자 OWNER 등록 → sequence 초기화
  public ProjectResponse create(Long callerId, CreateProjectRequest req) {
    if (projectRepository.existsByKey(req.key())) {
      throw new ProjectConflictException("이미 사용 중인 key 입니다: " + req.key());
    }
    var row = projectRepository.insert(req.key(), req.name(), req.description(), callerId);
    memberRepository.insert(row.id(), callerId, "OWNER");
    sequenceRepository.initialize(row.id());
    return ProjectResponse.from(row);
  }

  @Transactional(readOnly = true)
  public PageResponse<ProjectResponse> list(Long callerId, int page, int size) {
    boolean isAdmin = permissionChecker.userHasRole(callerId, "ADMIN");
    long total = projectRepository.countForUser(callerId, isAdmin);
    List<ProjectRow> rows = projectRepository.findAllForUser(callerId, isAdmin, page, size);
    return PageResponse.of(rows.stream().map(ProjectResponse::from).toList(), page, size, total);
  }

  @Transactional(readOnly = true)
  public ProjectResponse get(Long callerId, String projectKey) {
    return ProjectResponse.from(accessGuard.assertMember(projectKey, callerId));
  }

  public ProjectResponse update(Long callerId, String projectKey, UpdateProjectRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    projectRepository.update(project.id(), req.name(), req.description());
    return ProjectResponse.from(projectRepository.findById(project.id()).orElseThrow());
  }

  public void softDelete(Long callerId, String projectKey) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    projectRepository.softDelete(project.id());
  }
}
```

(`PageResponse.of(List<T>, int page, int size, long total)` 가 없으면 기존 사용처 시그니처에 맞춰 변환. 기존 사용 시그니처는 grep 으로 확인 후 동일하게 호출.)

- [ ] **Step 4.2: `ProjectMemberService` 메서드 추가 (같은 ProjectService 안)**

```java
@Transactional(readOnly = true)
public List<MemberResponse> listMembers(Long callerId, String projectKey) {
  var project = accessGuard.assertMember(projectKey, callerId);
  return memberRepository.findAllByProject(project.id()); // join user 로 username/name 채움
}

public MemberResponse addMember(Long callerId, String projectKey, AddMemberRequest req) {
  var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
  if (memberRepository.find(project.id(), req.userId()).isPresent()) {
    throw new ProjectConflictException("이미 멤버입니다");
  }
  memberRepository.insert(project.id(), req.userId(), req.role());
  return memberRepository.find(project.id(), req.userId()).orElseThrow(...);
}

public void updateMemberRole(Long callerId, String projectKey, Long memberUserId, UpdateMemberRoleRequest req) {
  var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
  var current = memberRepository.find(project.id(), memberUserId)
      .orElseThrow(() -> new ProjectNotFoundException("멤버 없음"));

  // OWNER 본인 1명 남은 상태에서 본인 역할 변경 금지
  if (current.role().equals("OWNER") && !req.role().equals("OWNER")
      && memberRepository.countOwners(project.id()) <= 1) {
    throw new ProjectConflictException("OWNER 가 최소 1명 이상 있어야 합니다");
  }
  memberRepository.updateRole(project.id(), memberUserId, req.role());
}

public void removeMember(Long callerId, String projectKey, Long memberUserId) {
  var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
  var current = memberRepository.find(project.id(), memberUserId)
      .orElseThrow(() -> new ProjectNotFoundException("멤버 없음"));
  if (current.role().equals("OWNER") && memberRepository.countOwners(project.id()) <= 1) {
    throw new ProjectConflictException("OWNER 가 최소 1명 이상 있어야 합니다");
  }
  memberRepository.delete(project.id(), memberUserId);
}
```

`MemberRow → MemberResponse` 변환 위해 `ProjectMemberRepository.findAllByProject` 는 user 테이블 JOIN 해서 username/name 까지 가져오도록 작성한다.

- [ ] **Step 4.3: `ProjectController` 작성**

```java
package com.workplace.project.controller;

import com.workplace.global.dto.PageResponse;
import com.workplace.global.security.RequirePermission;
import com.workplace.project.dto.*;
import com.workplace.project.service.ProjectService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/projects")
@RequiredArgsConstructor
public class ProjectController {

  private final ProjectService projectService;

  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<PageResponse<ProjectResponse>> list(
      Authentication auth,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(projectService.list((Long) auth.getPrincipal(), page, size));
  }

  @PostMapping
  @RequirePermission("project:write")
  public ResponseEntity<ProjectResponse> create(Authentication auth, @Valid @RequestBody CreateProjectRequest req) {
    return ResponseEntity.ok(projectService.create((Long) auth.getPrincipal(), req));
  }

  @GetMapping("/{key}")
  @RequirePermission("project:read")
  public ResponseEntity<ProjectResponse> get(Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(projectService.get((Long) auth.getPrincipal(), key));
  }

  @PatchMapping("/{key}")
  @RequirePermission("project:write")
  public ResponseEntity<ProjectResponse> update(
      Authentication auth, @PathVariable String key, @Valid @RequestBody UpdateProjectRequest req) {
    return ResponseEntity.ok(projectService.update((Long) auth.getPrincipal(), key, req));
  }

  @DeleteMapping("/{key}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> delete(Authentication auth, @PathVariable String key) {
    projectService.softDelete((Long) auth.getPrincipal(), key);
    return ResponseEntity.noContent().build();
  }
}
```

- [ ] **Step 4.4: `ProjectMemberController` 작성**

```java
@RestController
@RequestMapping("/api/v1/projects/{key}/members")
@RequiredArgsConstructor
public class ProjectMemberController {
  private final ProjectService projectService;

  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<MemberResponse>> list(Authentication auth, @PathVariable String key) { ... }

  @PostMapping
  @RequirePermission("project:manage")
  public ResponseEntity<MemberResponse> add(Authentication auth, @PathVariable String key, @Valid @RequestBody AddMemberRequest req) { ... }

  @PatchMapping("/{userId}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> updateRole(Authentication auth, @PathVariable String key, @PathVariable Long userId, @Valid @RequestBody UpdateMemberRoleRequest req) { ... }

  @DeleteMapping("/{userId}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> remove(Authentication auth, @PathVariable String key, @PathVariable Long userId) { ... }
}
```

- [ ] **Step 4.5: 컴파일 확인 + Spotless**

```bash
cd apps/workplace-api && ./gradlew spotlessApply compileJava
```

---

### Task 5: Project 컨트롤러 테스트 (`@WebMvcTest`)

**Files:**
- Create: `apps/workplace-api/src/test/java/com/workplace/project/controller/ProjectControllerTest.java`
- Create: `apps/workplace-api/src/test/java/com/workplace/project/controller/ProjectMemberControllerTest.java`
- Create: `apps/workplace-api/src/test/java/com/workplace/project/service/ProjectServiceTest.java`

- [ ] **Step 5.1: `ProjectControllerTest` 작성**

기존 `UserControllerTest` 패턴 그대로:
- `@WebMvcTest(ProjectController.class)`
- `@Import({SecurityConfig.class, JwtAuthenticationFilter.class})`
- `@MockitoBean ProjectService`, `JwtTokenProvider`, `JwtProperties`, `PermissionService`

테스트 케이스:
1. `create_happyPath_returns200` — 호출자 OWNER 자동 등록 가정, mock service 가 ProjectResponse 반환
2. `create_invalidKeyPattern_returns400` — `"wp"` (소문자) 페이로드
3. `create_duplicateKey_returns409` — service 가 `ProjectConflictException` 던지면 409
4. `list_happyPath_returns200WithPagedResponse`
5. `get_existingProject_returns200`
6. `get_notMember_returns403` — service 가 `ProjectAccessDeniedException`
7. `get_unknownKey_returns404`
8. `update_happyPath_returns200`
9. `delete_owner_returns204`
10. `delete_notOwner_returns403`

각 케이스 코드 (예 1번):

```java
@Test
void create_happyPath_returns200() throws Exception {
  mockAuthentication("project:write");
  CreateProjectRequest req = new CreateProjectRequest("WP", "Workplace", "v1");
  when(projectService.create(eq(1L), any())).thenReturn(
      new ProjectResponse(10L, "WP", "Workplace", "v1", 1L, Instant.now(), Instant.now()));

  mockMvc.perform(post("/api/v1/projects")
          .header("Authorization", "Bearer valid-token")
          .contentType(MediaType.APPLICATION_JSON)
          .content(objectMapper.writeValueAsString(req)))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.key").value("WP"));
}
```

- [ ] **Step 5.2: `ProjectMemberControllerTest` 작성**

테스트 케이스:
1. `list_member_returns200`
2. `add_byOwner_returns200`
3. `add_duplicateMember_returns409`
4. `updateRole_lastOwnerDemotion_returns409`
5. `remove_lastOwner_returns409`
6. `remove_byNonOwner_returns403`

- [ ] **Step 5.3: `ProjectServiceTest` 작성 (단위 — Mockito)**

mock: ProjectRepository, ProjectMemberRepository, ProjectIssueSequenceRepository, ProjectAccessGuard, PermissionChecker

테스트 케이스:
1. `create_initializesSequenceAndAddsOwnerMember` — `insert`, `memberRepository.insert(..., "OWNER")`, `sequenceRepository.initialize(...)` 호출 검증
2. `create_duplicateKey_throwsConflict`
3. `list_callerIsAdmin_usesIsAdminTrue`
4. `softDelete_callsRepoSoftDelete`
5. `updateMemberRole_lastOwnerDemotion_throwsConflict`

- [ ] **Step 5.4: 테스트 실행**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.project.*"
```

기대: 전부 PASS.

---

### Task 6: Issue 도메인 — Repository + DTO

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueRepository.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueCommentRepository.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueHistoryRepository.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/exception/IssueNotFoundException.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/exception/IssueCommentNotFoundException.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/exception/InvalidIssueOperationException.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueRow.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueResponse.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueDetailResponse.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/CreateIssueRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/UpdateIssueRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueCommentResponse.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/CreateCommentRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/UpdateCommentRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueHistoryEntryResponse.java`

- [ ] **Step 6.1: 예외 3종 + GlobalExceptionHandler 매핑**

```java
public class IssueNotFoundException extends RuntimeException {
  public IssueNotFoundException(String key, int number) { super("이슈 없음: " + key + "-" + number); }
  public IssueNotFoundException(Long id) { super("이슈 없음: id=" + id); }
}
public class IssueCommentNotFoundException extends RuntimeException { ... }
public class InvalidIssueOperationException extends RuntimeException { ... } // 422
```

`GlobalExceptionHandler` 에 매핑 추가:
- `IssueNotFoundException` / `IssueCommentNotFoundException` → 404
- `InvalidIssueOperationException` → 422 UNPROCESSABLE_ENTITY

- [ ] **Step 6.2: DTO record 정의**

```java
public record IssueRow(Long id, Long projectId, int number, String title, String body,
                       String status, String priority, java.time.LocalDate dueDate,
                       Long reporterId, Long assigneeId,
                       java.time.Instant createdAt, java.time.Instant updatedAt, java.time.Instant closedAt) {}

public record IssueResponse(Long id, String projectKey, int number, String title,
                            String status, String priority, java.time.LocalDate dueDate,
                            Long reporterId, Long assigneeId,
                            java.time.Instant createdAt, java.time.Instant updatedAt) {
  public String displayKey() { return projectKey + "-" + number; }
}

public record IssueDetailResponse(IssueResponse summary, String body,
                                  java.util.List<IssueCommentResponse> comments,
                                  java.util.List<IssueHistoryEntryResponse> history) {}

public record CreateIssueRequest(
    @NotBlank @Size(max = 200) String title,
    @Size(max = 10000) String body,
    @Pattern(regexp = "LOW|MID|HIGH") String priority,
    java.time.LocalDate dueDate,
    Long assigneeId) {}

// PATCH 는 부분 갱신 — 모든 필드 nullable, presence 로 변경 의도 판별
public record UpdateIssueRequest(
    @Size(max = 200) String title,
    @Size(max = 10000) String body,
    @Pattern(regexp = "TODO|IN_PROGRESS|DONE|CANCELED") String status,
    @Pattern(regexp = "LOW|MID|HIGH") String priority,
    java.time.LocalDate dueDate,
    Long assigneeId,
    // assignee 를 null 로 비우려는 의도 vs 변경 없음 구분 위한 명시 플래그
    Boolean clearAssignee,
    Boolean clearDueDate) {}

public record IssueCommentResponse(Long id, Long issueId, Long authorId, String authorName, String body,
                                   java.time.Instant createdAt, java.time.Instant updatedAt) {}
public record CreateCommentRequest(@NotBlank @Size(max = 10000) String body) {}
public record UpdateCommentRequest(@NotBlank @Size(max = 10000) String body) {}

public record IssueHistoryEntryResponse(Long id, Long actorId, String actorName, String eventType,
                                        String fromValue, String toValue, java.time.Instant createdAt) {}
```

- [ ] **Step 6.3: `IssueRepository` 작성**

```java
@Repository
@RequiredArgsConstructor
public class IssueRepository {
  private final DSLContext dsl;

  public Optional<IssueRow> findById(Long id) { ... }
  public Optional<IssueRow> findByProjectAndNumber(Long projectId, int number) { ... }
  public PagedResult<IssueRow> findByProject(Long projectId, int page, int size) { ... } // updated_at desc, deleted_at IS NULL
  public IssueRow insert(Long projectId, int number, String title, String body,
                         String priority, java.time.LocalDate dueDate,
                         Long reporterId, Long assigneeId) { ... }
  public void update(Long id, /* 변경 가능 필드들. closed_at 별도 메서드 */) { ... }
  public void setClosedAt(Long id, java.time.Instant value) { ... } // null 허용
  public void softDelete(Long id) { ... }
}
```

또는 단순화: `update(IssueRow updated)` 형태로 row 전체를 받아 갱신.

- [ ] **Step 6.4: `IssueCommentRepository`**

```java
@Repository
@RequiredArgsConstructor
public class IssueCommentRepository {
  private final DSLContext dsl;

  public Optional<IssueCommentResponse> findById(Long id) { ... } // user JOIN
  public List<IssueCommentResponse> findByIssue(Long issueId) { ... } // created_at asc, deleted_at IS NULL, user JOIN
  public IssueCommentResponse insert(Long issueId, Long authorId, String body) { ... }
  public void update(Long id, String body) { ... }
  public void softDelete(Long id) { ... }
}
```

- [ ] **Step 6.5: `IssueHistoryRepository`**

```java
@Repository
@RequiredArgsConstructor
public class IssueHistoryRepository {
  private final DSLContext dsl;

  public List<IssueHistoryEntryResponse> findByIssue(Long issueId) { ... } // created_at asc, user JOIN
  public void insert(Long issueId, Long actorId, String eventType, String fromValue, String toValue) { ... }
}
```

- [ ] **Step 6.6: 컴파일 확인**

```bash
cd apps/workplace-api && ./gradlew compileJava
```

---

### Task 7: IssueHistoryRecorder + IssueService

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueHistoryRecorder.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueService.java`

- [ ] **Step 7.1: `IssueHistoryRecorder` 작성**

```java
package com.workplace.issue.service;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.repository.IssueHistoryRepository;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class IssueHistoryRecorder {
  private final IssueHistoryRepository historyRepository;

  /** before/after 비교 후 변경된 항목에 대해 history row 삽입. body 변경은 기록 제외. */
  public void recordChanges(Long actorId, IssueRow before, IssueRow after) {
    if (!Objects.equals(before.title(), after.title())) {
      historyRepository.insert(before.id(), actorId, "TITLE_CHANGED", before.title(), after.title());
    }
    if (!Objects.equals(before.status(), after.status())) {
      historyRepository.insert(before.id(), actorId, "STATUS_CHANGED", before.status(), after.status());
    }
    if (!Objects.equals(before.priority(), after.priority())) {
      historyRepository.insert(before.id(), actorId, "PRIORITY_CHANGED", before.priority(), after.priority());
    }
    if (!Objects.equals(before.assigneeId(), after.assigneeId())) {
      historyRepository.insert(before.id(), actorId, "ASSIGNEE_CHANGED",
          stringify(before.assigneeId()), stringify(after.assigneeId()));
    }
    if (!Objects.equals(before.dueDate(), after.dueDate())) {
      historyRepository.insert(before.id(), actorId, "DUE_DATE_CHANGED",
          stringify(before.dueDate()), stringify(after.dueDate()));
    }
  }

  private static String stringify(Object value) { return value == null ? null : value.toString(); }
}
```

- [ ] **Step 7.2: `IssueService` — create / list / get**

```java
package com.workplace.issue.service;

import com.workplace.global.dto.PageResponse;
import com.workplace.issue.dto.*;
import com.workplace.issue.exception.*;
import com.workplace.issue.repository.*;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@Transactional
public class IssueService {
  private final IssueRepository issueRepository;
  private final IssueCommentRepository commentRepository;
  private final IssueHistoryRepository historyRepository;
  private final ProjectIssueSequenceRepository sequenceRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueHistoryRecorder historyRecorder;

  public IssueResponse create(Long callerId, String projectKey, CreateIssueRequest req) {
    ProjectRow project = accessGuard.assertMember(projectKey, callerId);
    int number = sequenceRepository.allocateNext(project.id());
    IssueRow row = issueRepository.insert(
        project.id(), number, req.title(), req.body(),
        req.priority() != null ? req.priority() : "MID",
        req.dueDate(), callerId, req.assigneeId());
    return toResponse(project.key(), row);
  }

  @Transactional(readOnly = true)
  public PageResponse<IssueResponse> list(Long callerId, String projectKey, int page, int size) {
    ProjectRow project = accessGuard.assertMember(projectKey, callerId);
    var paged = issueRepository.findByProject(project.id(), page, size);
    return PageResponse.of(paged.items().stream().map(r -> toResponse(project.key(), r)).toList(),
        page, size, paged.total());
  }

  @Transactional(readOnly = true)
  public IssueDetailResponse get(Long callerId, String projectKey, int number) {
    ProjectRow project = accessGuard.assertMember(projectKey, callerId);
    IssueRow row = issueRepository.findByProjectAndNumber(project.id(), number)
        .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    List<IssueCommentResponse> comments = commentRepository.findByIssue(row.id());
    List<IssueHistoryEntryResponse> history = historyRepository.findByIssue(row.id());
    return new IssueDetailResponse(toResponse(project.key(), row), row.body(), comments, history);
  }

  // ... patch 는 Step 7.3 에서
  // ... softDelete 는 Step 7.4

  private static IssueResponse toResponse(String projectKey, IssueRow r) {
    return new IssueResponse(r.id(), projectKey, r.number(), r.title(),
        r.status(), r.priority(), r.dueDate(), r.reporterId(), r.assigneeId(),
        r.createdAt(), r.updatedAt());
  }
}
```

- [ ] **Step 7.3: `IssueService.update(...)` — 부분 갱신 + 활동 기록**

```java
public IssueDetailResponse update(Long callerId, String projectKey, int number, UpdateIssueRequest req) {
  ProjectRow project = accessGuard.assertMember(projectKey, callerId);
  IssueRow before = issueRepository.findByProjectAndNumber(project.id(), number)
      .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

  String newTitle = req.title() != null ? req.title() : before.title();
  String newBody = req.body() != null ? req.body() : before.body();
  String newStatus = req.status() != null ? req.status() : before.status();
  String newPriority = req.priority() != null ? req.priority() : before.priority();
  java.time.LocalDate newDue =
      Boolean.TRUE.equals(req.clearDueDate()) ? null : (req.dueDate() != null ? req.dueDate() : before.dueDate());
  Long newAssignee =
      Boolean.TRUE.equals(req.clearAssignee()) ? null : (req.assigneeId() != null ? req.assigneeId() : before.assigneeId());

  // closed_at 토글
  boolean wasClosed = before.status().equals("DONE") || before.status().equals("CANCELED");
  boolean nowClosed = newStatus.equals("DONE") || newStatus.equals("CANCELED");
  Instant newClosedAt;
  if (nowClosed && !wasClosed) newClosedAt = Instant.now();
  else if (!nowClosed && wasClosed) newClosedAt = null;
  else newClosedAt = before.closedAt();

  issueRepository.updateAll(before.id(), newTitle, newBody, newStatus, newPriority, newDue, newAssignee, newClosedAt);

  IssueRow after = issueRepository.findById(before.id()).orElseThrow();
  historyRecorder.recordChanges(callerId, before, after);

  return get(callerId, projectKey, number);
}
```

`IssueRepository.updateAll(...)` 추가 필요. 메서드 시그니처:
```java
public void updateAll(Long id, String title, String body, String status, String priority,
                      java.time.LocalDate dueDate, Long assigneeId, java.time.Instant closedAt) {
  // SET ..., updated_at = now()
}
```

- [ ] **Step 7.4: `IssueService.softDelete(...)`**

```java
public void softDelete(Long callerId, String projectKey, int number) {
  ProjectRow project = accessGuard.assertMember(projectKey, callerId);
  IssueRow row = issueRepository.findByProjectAndNumber(project.id(), number)
      .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

  boolean isReporter = row.reporterId().equals(callerId);
  boolean isOwner = false;
  try {
    accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    isOwner = true;
  } catch (com.workplace.project.exception.ProjectAccessDeniedException ignored) {}

  if (!isReporter && !isOwner) {
    throw new com.workplace.project.exception.ProjectAccessDeniedException("이슈 삭제는 reporter 또는 OWNER 만 가능합니다");
  }
  issueRepository.softDelete(row.id());
}
```

- [ ] **Step 7.5: 컴파일 + Spotless**

```bash
cd apps/workplace-api && ./gradlew spotlessApply compileJava
```

---

### Task 8: IssueCommentService + Controllers

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueCommentService.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/controller/IssueController.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/controller/IssueCommentController.java`

- [ ] **Step 8.1: `IssueCommentService`**

```java
@Service
@RequiredArgsConstructor
@Transactional
public class IssueCommentService {
  private final IssueRepository issueRepository;
  private final IssueCommentRepository commentRepository;
  private final ProjectAccessGuard accessGuard;
  private final ProjectRepository projectRepository;

  // 권한: issueId 로 issue 조회 → project 조회 → 멤버십 검증
  private void assertIssueAccess(Long issueId, Long callerId) {
    IssueRow issue = issueRepository.findById(issueId)
        .orElseThrow(() -> new IssueNotFoundException(issueId));
    ProjectRow project = projectRepository.findById(issue.projectId())
        .orElseThrow(() -> new ProjectNotFoundException("id=" + issue.projectId()));
    accessGuard.assertMember(project.key(), callerId);
  }

  @Transactional(readOnly = true)
  public List<IssueCommentResponse> list(Long callerId, Long issueId) {
    assertIssueAccess(issueId, callerId);
    return commentRepository.findByIssue(issueId);
  }

  public IssueCommentResponse create(Long callerId, Long issueId, CreateCommentRequest req) {
    assertIssueAccess(issueId, callerId);
    return commentRepository.insert(issueId, callerId, req.body());
  }

  public IssueCommentResponse update(Long callerId, Long issueId, Long commentId, UpdateCommentRequest req) {
    assertIssueAccess(issueId, callerId);
    IssueCommentResponse existing = commentRepository.findById(commentId)
        .orElseThrow(() -> new IssueCommentNotFoundException(commentId));
    if (!existing.authorId().equals(callerId)) {
      throw new ProjectAccessDeniedException("본인 작성 코멘트만 수정할 수 있습니다");
    }
    commentRepository.update(commentId, req.body());
    return commentRepository.findById(commentId).orElseThrow();
  }

  public void delete(Long callerId, Long issueId, Long commentId) {
    assertIssueAccess(issueId, callerId);
    IssueCommentResponse existing = commentRepository.findById(commentId)
        .orElseThrow(() -> new IssueCommentNotFoundException(commentId));
    boolean isAuthor = existing.authorId().equals(callerId);
    boolean isOwner = false;
    try {
      // project 재조회 후 OWNER 검증
      IssueRow issue = issueRepository.findById(issueId).orElseThrow();
      ProjectRow project = projectRepository.findById(issue.projectId()).orElseThrow();
      accessGuard.assertWithRole(project.key(), callerId, "OWNER");
      isOwner = true;
    } catch (ProjectAccessDeniedException ignored) {}
    if (!isAuthor && !isOwner) {
      throw new ProjectAccessDeniedException("코멘트 삭제 권한이 없습니다");
    }
    commentRepository.softDelete(commentId);
  }
}
```

- [ ] **Step 8.2: `IssueController`**

```java
@RestController
@RequestMapping("/api/v1/projects/{key}/issues")
@RequiredArgsConstructor
public class IssueController {
  private final IssueService issueService;

  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<PageResponse<IssueResponse>> list(
      Authentication auth, @PathVariable String key,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(issueService.list((Long) auth.getPrincipal(), key, page, size));
  }

  @PostMapping
  @RequirePermission("issue:write")
  public ResponseEntity<IssueResponse> create(
      Authentication auth, @PathVariable String key, @Valid @RequestBody CreateIssueRequest req) {
    return ResponseEntity.ok(issueService.create((Long) auth.getPrincipal(), key, req));
  }

  @GetMapping("/{number}")
  @RequirePermission("project:read")
  public ResponseEntity<IssueDetailResponse> get(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    return ResponseEntity.ok(issueService.get((Long) auth.getPrincipal(), key, number));
  }

  @PatchMapping("/{number}")
  @RequirePermission("issue:write")
  public ResponseEntity<IssueDetailResponse> update(
      Authentication auth, @PathVariable String key, @PathVariable int number,
      @Valid @RequestBody UpdateIssueRequest req) {
    return ResponseEntity.ok(issueService.update((Long) auth.getPrincipal(), key, number, req));
  }

  @DeleteMapping("/{number}")
  @RequirePermission("issue:write")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    issueService.softDelete((Long) auth.getPrincipal(), key, number);
    return ResponseEntity.noContent().build();
  }
}
```

- [ ] **Step 8.3: `IssueCommentController`**

```java
@RestController
@RequestMapping("/api/v1/issues/{issueId}/comments")
@RequiredArgsConstructor
public class IssueCommentController {
  private final IssueCommentService commentService;

  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<IssueCommentResponse>> list(Authentication auth, @PathVariable Long issueId) {
    return ResponseEntity.ok(commentService.list((Long) auth.getPrincipal(), issueId));
  }

  @PostMapping
  @RequirePermission("issue:write")
  public ResponseEntity<IssueCommentResponse> create(Authentication auth, @PathVariable Long issueId, @Valid @RequestBody CreateCommentRequest req) {
    return ResponseEntity.ok(commentService.create((Long) auth.getPrincipal(), issueId, req));
  }

  @PatchMapping("/{commentId}")
  @RequirePermission("issue:write")
  public ResponseEntity<IssueCommentResponse> update(Authentication auth, @PathVariable Long issueId, @PathVariable Long commentId, @Valid @RequestBody UpdateCommentRequest req) {
    return ResponseEntity.ok(commentService.update((Long) auth.getPrincipal(), issueId, commentId, req));
  }

  @DeleteMapping("/{commentId}")
  @RequirePermission("issue:write")
  public ResponseEntity<Void> delete(Authentication auth, @PathVariable Long issueId, @PathVariable Long commentId) {
    commentService.delete((Long) auth.getPrincipal(), issueId, commentId);
    return ResponseEntity.noContent().build();
  }
}
```

- [ ] **Step 8.4: 컴파일 + Spotless**

```bash
cd apps/workplace-api && ./gradlew spotlessApply compileJava
```

---

### Task 9: Issue 도메인 테스트

**Files:**
- Create: `apps/workplace-api/src/test/java/com/workplace/issue/controller/IssueControllerTest.java`
- Create: `apps/workplace-api/src/test/java/com/workplace/issue/controller/IssueCommentControllerTest.java`
- Create: `apps/workplace-api/src/test/java/com/workplace/issue/service/IssueServiceTest.java`
- Create: `apps/workplace-api/src/test/java/com/workplace/issue/service/IssueHistoryRecorderTest.java`

- [ ] **Step 9.1: `IssueHistoryRecorderTest` (순수 단위)**

```java
class IssueHistoryRecorderTest {
  IssueHistoryRepository repo = mock(IssueHistoryRepository.class);
  IssueHistoryRecorder recorder = new IssueHistoryRecorder(repo);

  @Test
  void recordChanges_titleChange_writesOneTitleEvent() {
    IssueRow before = sample().withTitle("A");
    IssueRow after = sample().withTitle("B");
    recorder.recordChanges(99L, before, after);
    verify(repo).insert(eq(before.id()), eq(99L), eq("TITLE_CHANGED"), eq("A"), eq("B"));
    verifyNoMoreInteractions(repo);
  }

  @Test
  void recordChanges_bodyOnly_noEvents() {
    IssueRow before = sample().withBody("a"); IssueRow after = sample().withBody("b");
    recorder.recordChanges(1L, before, after);
    verifyNoInteractions(repo);
  }

  @Test
  void recordChanges_statusAndAssignee_writesBoth() { ... }
}
```

`IssueRow` 가 record 라 `withTitle` 같은 wither 가 없으면 테스트 헬퍼로 추가하거나 record 새 인스턴스 생성. 헬퍼 메서드 `sample()` 가 base row 반환.

- [ ] **Step 9.2: `IssueServiceTest`**

mock: IssueRepository, IssueCommentRepository, IssueHistoryRepository, ProjectIssueSequenceRepository, ProjectAccessGuard, IssueHistoryRecorder

테스트:
1. `create_allocatesNumberFromSequence`
2. `create_priorityDefaultsToMid` — `priority` 미입력 시 MID 저장 검증
3. `update_statusToDone_setsClosedAt`
4. `update_statusFromDoneToTodo_clearsClosedAt`
5. `update_titleChange_invokesHistoryRecorder`
6. `softDelete_byNonReporterNonOwner_throws403`
7. `get_unknownNumber_throws404`

- [ ] **Step 9.3: `IssueControllerTest`**

`@WebMvcTest(IssueController.class)`. 케이스:
1. `list_happyPath_returnsPage`
2. `create_happyPath_returnsIssue`
3. `create_titleBlank_returns400`
4. `get_happyPath_returnsDetailWithComments`
5. `patch_statusChange_returnsUpdated`
6. `patch_invalidStatus_returns400`
7. `delete_happyPath_returns204`
8. `nonMember_returns403` (mock 이 `ProjectAccessDeniedException` throw)

- [ ] **Step 9.4: `IssueCommentControllerTest`**

케이스:
1. `list_happyPath`
2. `create_happyPath`
3. `update_byNonAuthor_returns403`
4. `delete_byAuthor_returns204`
5. `delete_byOwner_returns204`
6. `delete_byOther_returns403`

- [ ] **Step 9.5: 테스트 실행**

```bash
cd apps/workplace-api && ./gradlew test --tests "com.workplace.issue.*"
```

기대: 전부 PASS.

---

### Task 10: 백엔드 전체 회귀

- [ ] **Step 10.1: 풀 테스트**

```bash
cd apps/workplace-api && ./gradlew test jacocoTestReport
```

기대: BUILD SUCCESSFUL, 신규 모듈 line 커버리지 ≥ 80% (보고서 경로: `build/reports/jacoco/test/html/index.html`).

미달이면 누락된 service 케이스 보강.

---

## Frontend

### Task 11: shadcn primitives 설치 + 디렉토리 셋업

- [ ] **Step 11.1: shadcn primitives 추가**

```bash
cd apps/workplace-web && npx shadcn@latest add dialog select textarea badge popover calendar
```

(이미 있는 컴포넌트는 skip 응답. CLI 가 묻는 경우 yes 로 진행.)

- [ ] **Step 11.2: 신규 디렉토리 미리 생성**

```bash
mkdir -p apps/workplace-web/src/pages/projects/components \
         apps/workplace-web/src/hooks/queries \
         apps/workplace-web/e2e/pages/projects \
         apps/workplace-web/e2e/factories
```

(일부는 기존에 존재할 수 있음 — 멱등하게 처리됨.)

---

### Task 12: 타입 정의 + Zod 스키마

**Files:**
- Create: `apps/workplace-web/src/types/project.ts`
- Create: `apps/workplace-web/src/types/issue.ts`
- Create: `apps/workplace-web/src/lib/validations/project.ts`
- Create: `apps/workplace-web/src/lib/validations/issue.ts`

- [ ] **Step 12.1: `types/project.ts`**

```ts
// 백엔드 DTO 와 1:1 매칭 — 변경 시 동기화 필수
export interface ProjectResponse {
  id: number
  key: string
  name: string
  description: string | null
  ownerId: number
  createdAt: string
  updatedAt: string
}

export type ProjectMemberRole = 'OWNER' | 'MEMBER'

export interface MemberResponse {
  userId: number
  username: string
  name: string
  role: ProjectMemberRole
  createdAt: string
}

export interface CreateProjectRequest {
  key: string
  name: string
  description?: string
}

export interface UpdateProjectRequest {
  name: string
  description?: string
}

export interface AddMemberRequest {
  userId: number
  role: ProjectMemberRole
}

export interface UpdateMemberRoleRequest {
  role: ProjectMemberRole
}
```

- [ ] **Step 12.2: `types/issue.ts`**

```ts
export type IssueStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELED'
export type IssuePriority = 'LOW' | 'MID' | 'HIGH'

export interface IssueResponse {
  id: number
  projectKey: string
  number: number
  title: string
  status: IssueStatus
  priority: IssuePriority
  dueDate: string | null
  reporterId: number
  assigneeId: number | null
  createdAt: string
  updatedAt: string
}

export interface IssueCommentResponse {
  id: number
  issueId: number
  authorId: number
  authorName: string
  body: string
  createdAt: string
  updatedAt: string
}

export type IssueHistoryEventType =
  | 'TITLE_CHANGED'
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'ASSIGNEE_CHANGED'
  | 'DUE_DATE_CHANGED'

export interface IssueHistoryEntry {
  id: number
  actorId: number
  actorName: string
  eventType: IssueHistoryEventType
  fromValue: string | null
  toValue: string | null
  createdAt: string
}

export interface IssueDetailResponse {
  summary: IssueResponse
  body: string | null
  comments: IssueCommentResponse[]
  history: IssueHistoryEntry[]
}

export interface CreateIssueRequest {
  title: string
  body?: string
  priority?: IssuePriority
  dueDate?: string
  assigneeId?: number | null
}

export interface UpdateIssueRequest {
  title?: string
  body?: string
  status?: IssueStatus
  priority?: IssuePriority
  dueDate?: string
  assigneeId?: number
  clearAssignee?: boolean
  clearDueDate?: boolean
}

export interface CreateCommentRequest { body: string }
export interface UpdateCommentRequest { body: string }
```

- [ ] **Step 12.3: `lib/validations/project.ts`**

```ts
import { z } from 'zod'

// key 패턴은 백엔드와 동일: 대문자 시작, A-Z0-9 2~10자
export const projectKeySchema = z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, {
  message: '대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다',
})

export const createProjectSchema = z.object({
  key: projectKeySchema,
  name: z.string().min(1, '이름은 필수입니다').max(120),
  description: z.string().max(2000).optional(),
})

export type CreateProjectFormData = z.infer<typeof createProjectSchema>

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
})

export type UpdateProjectFormData = z.infer<typeof updateProjectSchema>
```

- [ ] **Step 12.4: `lib/validations/issue.ts`**

```ts
import { z } from 'zod'

const statusEnum = z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED'])
const priorityEnum = z.enum(['LOW', 'MID', 'HIGH'])

export const createIssueSchema = z.object({
  title: z.string().min(1, '제목은 필수입니다').max(200),
  body: z.string().max(10000).optional(),
  priority: priorityEnum.optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  assigneeId: z.number().nullable().optional(),
})
export type CreateIssueFormData = z.infer<typeof createIssueSchema>

export const updateIssueSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(10000).optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  dueDate: z.string().optional(),
  assigneeId: z.number().nullable().optional(),
})

export const createCommentSchema = z.object({
  body: z.string().min(1, '내용은 필수입니다').max(10000),
})
export type CreateCommentFormData = z.infer<typeof createCommentSchema>
```

- [ ] **Step 12.5: typecheck**

```bash
cd apps/workplace-web && pnpm typecheck
```

---

### Task 13: API 클라이언트

**Files:**
- Create: `apps/workplace-web/src/api/projects.ts`
- Create: `apps/workplace-web/src/api/issues.ts`
- Create: `apps/workplace-web/src/api/issueComments.ts`

- [ ] **Step 13.1: `api/projects.ts`**

```ts
import { apiClient } from './client'
import type {
  ProjectResponse, CreateProjectRequest, UpdateProjectRequest,
  MemberResponse, AddMemberRequest, UpdateMemberRoleRequest,
} from '../types/project'

interface PageResponse<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export const projectsApi = {
  list: (page = 0, size = 20) =>
    apiClient.get<PageResponse<ProjectResponse>>('/projects', { params: { page, size } }),
  get: (key: string) =>
    apiClient.get<ProjectResponse>(`/projects/${key}`),
  create: (data: CreateProjectRequest) =>
    apiClient.post<ProjectResponse>('/projects', data),
  update: (key: string, data: UpdateProjectRequest) =>
    apiClient.patch<ProjectResponse>(`/projects/${key}`, data),
  remove: (key: string) =>
    apiClient.delete<void>(`/projects/${key}`),

  listMembers: (key: string) =>
    apiClient.get<MemberResponse[]>(`/projects/${key}/members`),
  addMember: (key: string, data: AddMemberRequest) =>
    apiClient.post<MemberResponse>(`/projects/${key}/members`, data),
  updateMemberRole: (key: string, userId: number, data: UpdateMemberRoleRequest) =>
    apiClient.patch<void>(`/projects/${key}/members/${userId}`, data),
  removeMember: (key: string, userId: number) =>
    apiClient.delete<void>(`/projects/${key}/members/${userId}`),
}
```

(`apiClient` 의 시그니처는 기존 `src/api/client.ts` 사용처 따라 조정. `axios` 인스턴스라 가정.)

- [ ] **Step 13.2: `api/issues.ts`**

```ts
import { apiClient } from './client'
import type { IssueResponse, IssueDetailResponse, CreateIssueRequest, UpdateIssueRequest } from '../types/issue'

interface PageResponse<T> { content: T[]; page: number; size: number; totalElements: number; totalPages: number }

export const issuesApi = {
  list: (key: string, page = 0, size = 20) =>
    apiClient.get<PageResponse<IssueResponse>>(`/projects/${key}/issues`, { params: { page, size } }),
  create: (key: string, data: CreateIssueRequest) =>
    apiClient.post<IssueResponse>(`/projects/${key}/issues`, data),
  get: (key: string, number: number) =>
    apiClient.get<IssueDetailResponse>(`/projects/${key}/issues/${number}`),
  update: (key: string, number: number, data: UpdateIssueRequest) =>
    apiClient.patch<IssueDetailResponse>(`/projects/${key}/issues/${number}`, data),
  remove: (key: string, number: number) =>
    apiClient.delete<void>(`/projects/${key}/issues/${number}`),
}
```

- [ ] **Step 13.3: `api/issueComments.ts`**

```ts
import { apiClient } from './client'
import type { IssueCommentResponse, CreateCommentRequest, UpdateCommentRequest } from '../types/issue'

export const issueCommentsApi = {
  list: (issueId: number) =>
    apiClient.get<IssueCommentResponse[]>(`/issues/${issueId}/comments`),
  create: (issueId: number, data: CreateCommentRequest) =>
    apiClient.post<IssueCommentResponse>(`/issues/${issueId}/comments`, data),
  update: (issueId: number, commentId: number, data: UpdateCommentRequest) =>
    apiClient.patch<IssueCommentResponse>(`/issues/${issueId}/comments/${commentId}`, data),
  remove: (issueId: number, commentId: number) =>
    apiClient.delete<void>(`/issues/${issueId}/comments/${commentId}`),
}
```

- [ ] **Step 13.4: typecheck**

```bash
cd apps/workplace-web && pnpm typecheck
```

---

### Task 14: TanStack Query 훅

**Files:**
- Create: `apps/workplace-web/src/hooks/queries/useProjects.ts`
- Create: `apps/workplace-web/src/hooks/queries/useIssues.ts`
- Create: `apps/workplace-web/src/hooks/queries/useIssue.ts`
- Create: `apps/workplace-web/src/hooks/queries/useIssueComments.ts`
- Create: `apps/workplace-web/src/hooks/queries/useProjectMembers.ts`

- [ ] **Step 14.1: `useProjects.ts`**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '../../api/projects'
import type { CreateProjectRequest, UpdateProjectRequest } from '../../types/project'

export const projectKeys = {
  all: ['projects'] as const,
  list: (page: number, size: number) => [...projectKeys.all, 'list', page, size] as const,
  detail: (key: string) => [...projectKeys.all, 'detail', key] as const,
}

export function useProjects(page = 0, size = 20) {
  return useQuery({
    queryKey: projectKeys.list(page, size),
    queryFn: async () => (await projectsApi.list(page, size)).data,
  })
}

export function useProject(key: string) {
  return useQuery({
    queryKey: projectKeys.detail(key),
    queryFn: async () => (await projectsApi.get(key)).data,
    enabled: !!key,
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateProjectRequest) => projectsApi.create(data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: projectKeys.all }) },
  })
}

export function useUpdateProject(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateProjectRequest) => projectsApi.update(key, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(key) })
      qc.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => projectsApi.remove(key),
    onSuccess: () => { qc.invalidateQueries({ queryKey: projectKeys.all }) },
  })
}
```

- [ ] **Step 14.2: `useIssues.ts`, `useIssue.ts`, `useIssueComments.ts`, `useProjectMembers.ts`**

같은 패턴으로 작성. 핵심 키:

```ts
// useIssues — 리스트
export const issueKeys = {
  list: (projectKey: string, page: number, size: number) => ['issues', projectKey, 'list', page, size] as const,
  detail: (projectKey: string, number: number) => ['issues', projectKey, 'detail', number] as const,
}
```

invalidation 규칙:
- 이슈 생성/수정/삭제 → list + detail invalidate
- 코멘트 생성/수정/삭제 → 해당 issue detail invalidate
- 멤버 변경 → 해당 project detail + members 쿼리 invalidate

- [ ] **Step 14.3: typecheck**

```bash
cd apps/workplace-web && pnpm typecheck
```

---

### Task 15: 공통 컴포넌트 (Badge / Status / Priority)

**Files:**
- Create: `apps/workplace-web/src/pages/projects/components/IssueStatusBadge.tsx`
- Create: `apps/workplace-web/src/pages/projects/components/IssuePriorityBadge.tsx`

- [ ] **Step 15.1: `IssueStatusBadge.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'
import type { IssueStatus } from '../../../types/issue'

const STATUS_LABEL: Record<IssueStatus, string> = {
  TODO: '할 일',
  IN_PROGRESS: '진행 중',
  DONE: '완료',
  CANCELED: '취소',
}

const STATUS_VARIANT: Record<IssueStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  TODO: 'outline',
  IN_PROGRESS: 'default',
  DONE: 'secondary',
  CANCELED: 'destructive',
}

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
}
```

- [ ] **Step 15.2: `IssuePriorityBadge.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'
import type { IssuePriority } from '../../../types/issue'

const PRIORITY_LABEL: Record<IssuePriority, string> = { LOW: '낮음', MID: '보통', HIGH: '높음' }
const PRIORITY_VARIANT: Record<IssuePriority, 'default' | 'secondary' | 'destructive'> = {
  LOW: 'secondary', MID: 'default', HIGH: 'destructive',
}

export function IssuePriorityBadge({ priority }: { priority: IssuePriority }) {
  return <Badge variant={PRIORITY_VARIANT[priority]}>{PRIORITY_LABEL[priority]}</Badge>
}
```

- [ ] **Step 15.3: typecheck**

```bash
cd apps/workplace-web && pnpm typecheck
```

---

### Task 16: ProjectListPage + 생성 다이얼로그

**Files:**
- Create: `apps/workplace-web/src/pages/projects/ProjectListPage.tsx`
- Create: `apps/workplace-web/src/pages/projects/components/ProjectCreateDialog.tsx`

- [ ] **Step 16.1: `ProjectCreateDialog.tsx`**

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import { handleApiError } from '../../../lib/api-error'
import { createProjectSchema, type CreateProjectFormData } from '../../../lib/validations/project'
import { useCreateProject } from '../../../hooks/queries/useProjects'

export function ProjectCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateProject()
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateProjectFormData>({
    resolver: zodResolver(createProjectSchema),
  })

  const onSubmit = async (data: CreateProjectFormData) => {
    try {
      await create.mutateAsync(data)
      toast.success('프로젝트를 생성했습니다')
      reset()
      onOpenChange(false)
    } catch (e) { handleApiError(e) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>새 프로젝트</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="text-sm font-medium">key (예: WP)</label>
            <Input {...register('key')} placeholder="WP" />
            {errors.key && <p className="text-sm text-destructive">{errors.key.message}</p>}
          </div>
          <div>
            <label className="text-sm font-medium">이름</label>
            <Input {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div>
            <label className="text-sm font-medium">설명</label>
            <Textarea {...register('description')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" disabled={create.isPending}>생성</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 16.2: `ProjectListPage.tsx`**

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useProjects } from '../../hooks/queries/useProjects'
import { ProjectCreateDialog } from './components/ProjectCreateDialog'

export default function ProjectListPage() {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useProjects()

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">프로젝트</h1>
        <Button onClick={() => setOpen(true)}>+ 새 프로젝트</Button>
      </div>
      {isLoading ? (
        <p>로딩 중…</p>
      ) : data && data.content.length === 0 ? (
        <p className="text-muted-foreground">아직 프로젝트가 없습니다. 우상단 버튼으로 시작하세요.</p>
      ) : (
        <ul className="space-y-2" role="list">
          {data?.content.map(p => (
            <li key={p.id}>
              <Link to={`/projects/${p.key}`} className="block p-4 border rounded hover:bg-accent">
                <div className="font-medium">{p.name} <span className="text-muted-foreground">({p.key})</span></div>
                {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ProjectCreateDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
```

- [ ] **Step 16.3: typecheck**

```bash
cd apps/workplace-web && pnpm typecheck
```

---

### Task 17: ProjectDetailPage (이슈 리스트) + 이슈 생성 다이얼로그

**Files:**
- Create: `apps/workplace-web/src/pages/projects/ProjectDetailPage.tsx`
- Create: `apps/workplace-web/src/pages/projects/components/IssueListTable.tsx`
- Create: `apps/workplace-web/src/pages/projects/components/IssueCreateDialog.tsx`

- [ ] **Step 17.1: `IssueListTable.tsx`**

```tsx
import { Link } from 'react-router-dom'
import type { IssueResponse } from '../../../types/issue'
import { IssueStatusBadge } from './IssueStatusBadge'
import { IssuePriorityBadge } from './IssuePriorityBadge'

export function IssueListTable({ projectKey, issues }: { projectKey: string; issues: IssueResponse[] }) {
  if (issues.length === 0) {
    return <p className="text-muted-foreground">이슈가 없습니다.</p>
  }
  return (
    <table className="w-full text-sm" role="table">
      <thead>
        <tr className="text-left text-muted-foreground border-b">
          <th className="py-2">#</th><th>제목</th><th>상태</th><th>우선순위</th><th>마감</th>
        </tr>
      </thead>
      <tbody>
        {issues.map(i => (
          <tr key={i.id} className="border-b hover:bg-accent" role="row">
            <td className="py-2 font-mono">{projectKey}-{i.number}</td>
            <td>
              <Link to={`/projects/${projectKey}/issues/${i.number}`} className="font-medium hover:underline">
                {i.title}
              </Link>
            </td>
            <td><IssueStatusBadge status={i.status} /></td>
            <td><IssuePriorityBadge priority={i.priority} /></td>
            <td>{i.dueDate ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 17.2: `IssueCreateDialog.tsx`**

폼 필드: title (text), body (textarea), priority (select: LOW/MID/HIGH, default MID), dueDate (input type="date").
`useForm + zodResolver(createIssueSchema)`. submit 시 `useMutation(issuesApi.create(projectKey, data))` 후 invalidate → 닫기.

- [ ] **Step 17.3: `ProjectDetailPage.tsx`**

```tsx
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useProject } from '../../hooks/queries/useProjects'
import { useIssues } from '../../hooks/queries/useIssues'
import { IssueListTable } from './components/IssueListTable'
import { IssueCreateDialog } from './components/IssueCreateDialog'

export default function ProjectDetailPage() {
  const { key = '' } = useParams()
  const [open, setOpen] = useState(false)
  const project = useProject(key)
  const issues = useIssues(key)

  if (project.isLoading) return <p className="p-6">로딩 중…</p>
  if (project.error) return <p className="p-6 text-destructive">프로젝트를 불러올 수 없습니다</p>

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold">{project.data?.name}</h1>
          <p className="text-muted-foreground">{project.data?.key}</p>
        </div>
        <div className="flex gap-2">
          <Link to={`/projects/${key}/settings`}><Button variant="outline">설정</Button></Link>
          <Button onClick={() => setOpen(true)}>+ 새 이슈</Button>
        </div>
      </div>
      {issues.isLoading ? <p>로딩 중…</p> : <IssueListTable projectKey={key} issues={issues.data?.content ?? []} />}
      <IssueCreateDialog projectKey={key} open={open} onOpenChange={setOpen} />
    </div>
  )
}
```

- [ ] **Step 17.4: typecheck**

```bash
cd apps/workplace-web && pnpm typecheck
```

---

### Task 18: IssueDetailPage — 인라인 편집 + 코멘트 + 활동 타임라인

**Files:**
- Create: `apps/workplace-web/src/pages/projects/IssueDetailPage.tsx`
- Create: `apps/workplace-web/src/pages/projects/components/IssueCommentList.tsx`
- Create: `apps/workplace-web/src/pages/projects/components/IssueActivityTimeline.tsx`
- Create: `apps/workplace-web/src/pages/projects/components/IssueStatusSelect.tsx`
- Create: `apps/workplace-web/src/pages/projects/components/IssuePrioritySelect.tsx`

- [ ] **Step 18.1: `IssueStatusSelect.tsx`**

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { IssueStatus } from '../../../types/issue'

const OPTIONS: { value: IssueStatus; label: string }[] = [
  { value: 'TODO', label: '할 일' },
  { value: 'IN_PROGRESS', label: '진행 중' },
  { value: 'DONE', label: '완료' },
  { value: 'CANCELED', label: '취소' },
]

export function IssueStatusSelect({ value, onChange, disabled }: { value: IssueStatus; onChange: (v: IssueStatus) => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={v => onChange(v as IssueStatus)} disabled={disabled}>
      <SelectTrigger className="w-36" aria-label="상태"><SelectValue /></SelectTrigger>
      <SelectContent>{OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select>
  )
}
```

- [ ] **Step 18.2: `IssuePrioritySelect.tsx`** — 위와 동일 패턴.

- [ ] **Step 18.3: `IssueCommentList.tsx`**

```tsx
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { IssueCommentResponse } from '../../../types/issue'
import { createCommentSchema, type CreateCommentFormData } from '../../../lib/validations/issue'
import { handleApiError } from '../../../lib/api-error'
import { useCreateComment } from '../../../hooks/queries/useIssueComments'

export function IssueCommentList({ issueId, comments }: { issueId: number; comments: IssueCommentResponse[] }) {
  const create = useCreateComment(issueId)
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateCommentFormData>({
    resolver: zodResolver(createCommentSchema),
  })
  const onSubmit = async (data: CreateCommentFormData) => {
    try { await create.mutateAsync(data); reset(); toast.success('코멘트를 작성했습니다') }
    catch (e) { handleApiError(e) }
  }
  return (
    <section aria-label="코멘트" className="space-y-3">
      <h2 className="text-lg font-semibold">코멘트</h2>
      <ul className="space-y-2" role="list">
        {comments.map(c => (
          <li key={c.id} className="border rounded p-3">
            <div className="text-sm text-muted-foreground">{c.authorName} · {new Date(c.createdAt).toLocaleString('ko-KR')}</div>
            <div className="whitespace-pre-wrap">{c.body}</div>
          </li>
        ))}
        {comments.length === 0 && <li className="text-muted-foreground">코멘트가 없습니다</li>}
      </ul>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
        <Textarea {...register('body')} placeholder="코멘트를 작성하세요" />
        {errors.body && <p className="text-sm text-destructive">{errors.body.message}</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={create.isPending}>작성</Button>
        </div>
      </form>
    </section>
  )
}
```

- [ ] **Step 18.4: `IssueActivityTimeline.tsx`**

```tsx
import type { IssueHistoryEntry, IssueHistoryEventType } from '../../../types/issue'

const EVENT_LABEL: Record<IssueHistoryEventType, string> = {
  TITLE_CHANGED: '제목 변경',
  STATUS_CHANGED: '상태 변경',
  PRIORITY_CHANGED: '우선순위 변경',
  ASSIGNEE_CHANGED: '담당자 변경',
  DUE_DATE_CHANGED: '마감일 변경',
}

export function IssueActivityTimeline({ entries }: { entries: IssueHistoryEntry[] }) {
  if (entries.length === 0) return <p className="text-muted-foreground text-sm">변경 이력 없음</p>
  return (
    <ol className="space-y-2 text-sm" role="list" aria-label="활동 타임라인">
      {entries.map(e => (
        <li key={e.id} className="border-l-2 pl-3">
          <div className="text-muted-foreground">{e.actorName} · {new Date(e.createdAt).toLocaleString('ko-KR')}</div>
          <div>
            <span className="font-medium">{EVENT_LABEL[e.eventType]}</span>:
            <span className="ml-1">{e.fromValue ?? '없음'} → {e.toValue ?? '없음'}</span>
          </div>
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 18.5: `IssueDetailPage.tsx`**

```tsx
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useIssue } from '../../hooks/queries/useIssue'
import { useUpdateIssue } from '../../hooks/queries/useIssue'
import { handleApiError } from '../../lib/api-error'
import { IssueStatusSelect } from './components/IssueStatusSelect'
import { IssuePrioritySelect } from './components/IssuePrioritySelect'
import { IssueCommentList } from './components/IssueCommentList'
import { IssueActivityTimeline } from './components/IssueActivityTimeline'

export default function IssueDetailPage() {
  const { key = '', number = '' } = useParams()
  const issueNumber = Number(number)
  const { data, isLoading } = useIssue(key, issueNumber)
  const update = useUpdateIssue(key, issueNumber)

  if (isLoading) return <p className="p-6">로딩 중…</p>
  if (!data) return <p className="p-6 text-destructive">이슈를 찾을 수 없습니다</p>

  const { summary, body, comments, history } = data

  const patch = async (changes: Parameters<typeof update.mutateAsync>[0]) => {
    try { await update.mutateAsync(changes); toast.success('변경 완료') }
    catch (e) { handleApiError(e) }
  }

  return (
    <div className="container mx-auto p-6 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-mono text-muted-foreground">{summary.projectKey}-{summary.number}</p>
          <h1 className="text-2xl font-semibold">{summary.title}</h1>
        </div>
        <article className="prose dark:prose-invert max-w-none whitespace-pre-wrap">{body ?? <em className="text-muted-foreground">본문 없음</em>}</article>
        <IssueCommentList issueId={summary.id} comments={comments} />
      </div>
      <aside className="space-y-4">
        <div>
          <label className="text-sm text-muted-foreground">상태</label>
          <IssueStatusSelect value={summary.status} onChange={v => patch({ status: v })} disabled={update.isPending} />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">우선순위</label>
          <IssuePrioritySelect value={summary.priority} onChange={v => patch({ priority: v })} disabled={update.isPending} />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">마감일</label>
          <input type="date" className="w-full border rounded p-2"
            value={summary.dueDate ?? ''}
            onChange={e => patch({ dueDate: e.target.value || undefined, clearDueDate: !e.target.value })} />
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-2">활동</h3>
          <IssueActivityTimeline entries={history} />
        </div>
      </aside>
    </div>
  )
}
```

- [ ] **Step 18.6: typecheck**

```bash
cd apps/workplace-web && pnpm typecheck
```

---

### Task 19: ProjectSettingsPage — 정보 수정 + 멤버 관리

**Files:**
- Create: `apps/workplace-web/src/pages/projects/ProjectSettingsPage.tsx`
- Create: `apps/workplace-web/src/pages/projects/components/MemberManagement.tsx`

- [ ] **Step 19.1: `MemberManagement.tsx`**

기능:
- 멤버 리스트 표시 (이름/username/role/추가일)
- userId 입력 + role 선택으로 신규 멤버 추가 (사용자 lookup 은 phase 외 — 단순 input)
- 각 멤버에 role 변경 dropdown + 제거 버튼
- API 실패 시 toast

```tsx
// 의사 코드 핵심
export function MemberManagement({ projectKey }: { projectKey: string }) {
  const members = useProjectMembers(projectKey)
  const addMember = useAddMember(projectKey)
  const updateRole = useUpdateMemberRole(projectKey)
  const removeMember = useRemoveMember(projectKey)
  // 폼: userId(Number Input) + role(Select), 추가 버튼
  // 테이블: members.data.map(m => row with select + delete)
}
```

- [ ] **Step 19.2: `ProjectSettingsPage.tsx`**

```tsx
import { useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useProject, useUpdateProject, useDeleteProject } from '../../hooks/queries/useProjects'
import { updateProjectSchema, type UpdateProjectFormData } from '../../lib/validations/project'
import { MemberManagement } from './components/MemberManagement'
import { handleApiError } from '../../lib/api-error'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'

export default function ProjectSettingsPage() {
  const { key = '' } = useParams()
  const navigate = useNavigate()
  const project = useProject(key)
  const update = useUpdateProject(key)
  const remove = useDeleteProject()

  const { register, handleSubmit, formState: { errors } } = useForm<UpdateProjectFormData>({
    resolver: zodResolver(updateProjectSchema),
    values: project.data ? { name: project.data.name, description: project.data.description ?? '' } : undefined,
  })

  const onSubmit = async (data: UpdateProjectFormData) => {
    try { await update.mutateAsync(data); toast.success('프로젝트 정보를 저장했습니다') }
    catch (e) { handleApiError(e) }
  }

  const onDelete = async () => {
    if (!confirm(`프로젝트 ${key} 를 삭제하시겠습니까?`)) return
    try { await remove.mutateAsync(key); toast.success('삭제되었습니다'); navigate('/projects') }
    catch (e) { handleApiError(e) }
  }

  if (project.isLoading) return <p className="p-6">로딩 중…</p>

  return (
    <div className="container mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-semibold">프로젝트 설정</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-w-xl">
        <div>
          <label className="text-sm font-medium">이름</label>
          <Input {...register('name')} />
          {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
        </div>
        <div>
          <label className="text-sm font-medium">설명</label>
          <Textarea {...register('description')} />
        </div>
        <Button type="submit" disabled={update.isPending}>저장</Button>
      </form>

      <MemberManagement projectKey={key} />

      <section className="border border-destructive rounded p-4 space-y-2">
        <h2 className="text-lg font-semibold text-destructive">위험 구역</h2>
        <p className="text-sm text-muted-foreground">프로젝트를 삭제하면 이슈/코멘트도 함께 숨겨집니다.</p>
        <Button variant="destructive" onClick={onDelete}>프로젝트 삭제</Button>
      </section>
    </div>
  )
}
```

- [ ] **Step 19.3: typecheck**

```bash
cd apps/workplace-web && pnpm typecheck
```

---

### Task 20: 라우터 등록

**Files:**
- Modify: `apps/workplace-web/src/App.tsx`

- [ ] **Step 20.1: lazy import + Route 추가**

`App.tsx` 의 기존 `React.lazy` 패턴 그대로 추가:

```tsx
const ProjectListPage = lazy(() => import('./pages/projects/ProjectListPage'))
const ProjectDetailPage = lazy(() => import('./pages/projects/ProjectDetailPage'))
const ProjectSettingsPage = lazy(() => import('./pages/projects/ProjectSettingsPage'))
const IssueDetailPage = lazy(() => import('./pages/projects/IssueDetailPage'))
```

`<Route>` 트리에 추가 (`ProtectedRoute > AppLayout` 하위):

```tsx
<Route path="/projects" element={<ProjectListPage />} />
<Route path="/projects/:key" element={<ProjectDetailPage />} />
<Route path="/projects/:key/settings" element={<ProjectSettingsPage />} />
<Route path="/projects/:key/issues/:number" element={<IssueDetailPage />} />
```

`HomePage` 의 헤더 또는 메인 콘텐츠에 "프로젝트 이동" 링크 추가 (선택 — 사용자가 직접 URL 입력 가능하지만 UX 위해 권장).

- [ ] **Step 20.2: typecheck + 빌드**

```bash
cd apps/workplace-web && pnpm typecheck && pnpm build
```

기대: BUILD 성공.

---

### Task 21: pre-commit `projects` 도메인 추가

**Files:**
- Modify: `scripts/husky/pre-commit.sh`

- [ ] **Step 21.1: `WEB_DOMAINS_RE` 확장**

기존 라인:
```sh
WEB_DOMAINS_RE='admin'
```
변경:
```sh
WEB_DOMAINS_RE='admin|projects'
```

- [ ] **Step 21.2: 드라이런 검증**

```bash
PRECOMMIT_CHANGED_FILES="apps/workplace-web/src/pages/projects/IssueDetailPage.tsx" PRECOMMIT_DRY_RUN=1 sh scripts/husky/pre-commit.sh
```

기대: `[pre-commit] 도메인 한정 변경 감지: projects — 전역 smoke + 해당 도메인 non-smoke 실행`

---

### Task 22: E2E 팩토리 + smoke 시나리오

**Files:**
- Create: `apps/workplace-web/e2e/factories/project.factory.ts`
- Create: `apps/workplace-web/e2e/factories/issue.factory.ts`
- Create: `apps/workplace-web/e2e/pages/projects/projects.spec.ts`

- [ ] **Step 22.1: 팩토리**

```ts
// project.factory.ts
import type { ProjectResponse } from '../../src/types/project'
export function createProject(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
  const now = new Date().toISOString()
  return { id: 1, key: 'WP', name: 'Workplace', description: 'v1', ownerId: 1, createdAt: now, updatedAt: now, ...overrides }
}
```

```ts
// issue.factory.ts
import type { IssueResponse, IssueDetailResponse } from '../../src/types/issue'
export function createIssue(overrides: Partial<IssueResponse> = {}): IssueResponse {
  const now = new Date().toISOString()
  return { id: 100, projectKey: 'WP', number: 1, title: '첫 이슈', status: 'TODO', priority: 'MID',
           dueDate: null, reporterId: 1, assigneeId: null, createdAt: now, updatedAt: now, ...overrides }
}
export function createIssueDetail(overrides: Partial<IssueDetailResponse> = {}): IssueDetailResponse {
  return { summary: createIssue(), body: '본문', comments: [], history: [], ...overrides }
}
```

- [ ] **Step 22.2: `projects.spec.ts` @smoke**

happy path 단일 테스트 — 전체 파이프라인 (생성 → 이슈 생성 → 상태 변경 → 코멘트 작성).

```ts
import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { createPageResponse } from '../../fixtures/api-mock'
import { createProject } from '../../factories/project.factory'
import { createIssue, createIssueDetail } from '../../factories/issue.factory'

test('프로젝트 생성 → 이슈 생성 → 상태 변경 → 코멘트', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  // 1. 빈 프로젝트 목록 → 생성
  await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([]))
  const createProjectCapture = await mockApi(page, 'POST', '/api/v1/projects', createProject(), { capture: true })
  // 생성 직후 다시 목록 fetch 되도록 한 번 더 GET 매핑 (마지막 등록이 우선)
  await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))

  await page.goto('/projects')
  await page.getByRole('button', { name: '+ 새 프로젝트' }).click()
  await page.getByLabel(/key/i).fill('WP')
  await page.getByLabel('이름').fill('Workplace')
  await page.getByRole('button', { name: '생성' }).click()

  const created = await createProjectCapture.waitForRequest()
  expect(created.payload).toMatchObject({ key: 'WP', name: 'Workplace' })

  // 2. 프로젝트 상세 진입 + 이슈 생성
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject())
  await mockApi(page, 'GET', '/api/v1/projects/WP/issues', createPageResponse([]))
  const createIssueCapture = await mockApi(page, 'POST', '/api/v1/projects/WP/issues', createIssue(), { capture: true })
  await mockApi(page, 'GET', '/api/v1/projects/WP/issues', createPageResponse([createIssue()]))

  await page.getByRole('link', { name: /Workplace/ }).click()
  await page.getByRole('button', { name: '+ 새 이슈' }).click()
  await page.getByLabel('제목').fill('첫 이슈')
  await page.getByRole('button', { name: '생성' }).click()

  const issueCreated = await createIssueCapture.waitForRequest()
  expect(issueCreated.payload).toMatchObject({ title: '첫 이슈' })

  // 3. 이슈 상세 → 상태 IN_PROGRESS 로 변경
  await mockApi(page, 'GET', '/api/v1/projects/WP/issues/1', createIssueDetail())
  const patchCapture = await mockApi(
    page, 'PATCH', '/api/v1/projects/WP/issues/1',
    createIssueDetail({ summary: createIssue({ status: 'IN_PROGRESS' }) }),
    { capture: true },
  )
  await page.getByRole('link', { name: '첫 이슈' }).click()
  await page.getByRole('combobox', { name: '상태' }).click()
  await page.getByRole('option', { name: '진행 중' }).click()

  const patched = await patchCapture.waitForRequest()
  expect(patched.payload).toMatchObject({ status: 'IN_PROGRESS' })

  // 4. 코멘트 작성
  const commentCapture = await mockApi(page, 'POST', '/api/v1/issues/100/comments',
    { id: 1, issueId: 100, authorId: 1, authorName: 'Test', body: '확인했습니다', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { capture: true })
  await mockApi(page, 'GET', '/api/v1/projects/WP/issues/1',
    createIssueDetail({ comments: [{ id: 1, issueId: 100, authorId: 1, authorName: 'Test', body: '확인했습니다',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }))

  await page.getByPlaceholder('코멘트를 작성하세요').fill('확인했습니다')
  await page.getByRole('button', { name: '작성' }).click()

  const comment = await commentCapture.waitForRequest()
  expect(comment.payload).toMatchObject({ body: '확인했습니다' })

  // UI 반영 검증
  await expect(page.getByText('확인했습니다')).toBeVisible()
})
```

- [ ] **Step 22.3: smoke 단독 실행**

```bash
cd apps/workplace-web && npx playwright test e2e/pages/projects/projects.spec.ts -g "@smoke"
```

기대: 1 passed.

---

### Task 23: E2E non-smoke (권한 거부 / 활동 타임라인 / 삭제)

**Files:**
- Modify: `apps/workplace-web/e2e/pages/projects/projects.spec.ts` (추가 케이스)

- [ ] **Step 23.1: 권한 없는 프로젝트 접근 시 403**

```ts
test('비멤버 프로젝트 접근 시 권한 거부 안내', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects/SECRET',
    { code: 'PROJECT_ACCESS_DENIED', message: '프로젝트 멤버가 아닙니다' }, { status: 403 })
  await page.goto('/projects/SECRET')
  await expect(page.getByText(/프로젝트를 불러올 수 없습니다|권한/)).toBeVisible()
})
```

- [ ] **Step 23.2: PATCH 후 활동 타임라인에 항목 추가**

```ts
test('상태 변경 시 활동 타임라인에 한국어 라벨로 노출', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject())
  const before = createIssueDetail()
  const after = createIssueDetail({
    summary: createIssue({ status: 'IN_PROGRESS' }),
    history: [{ id: 1, actorId: 1, actorName: 'Tester', eventType: 'STATUS_CHANGED', fromValue: 'TODO', toValue: 'IN_PROGRESS', createdAt: new Date().toISOString() }],
  })
  let fetchCount = 0
  await page.route('**/api/v1/projects/WP/issues/1', route => {
    if (route.request().method() === 'GET') {
      const body = fetchCount++ === 0 ? before : after
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(after) })
  })
  await page.goto('/projects/WP/issues/1')
  await page.getByRole('combobox', { name: '상태' }).click()
  await page.getByRole('option', { name: '진행 중' }).click()
  await expect(page.getByText('상태 변경')).toBeVisible()
  await expect(page.getByText('TODO → IN_PROGRESS')).toBeVisible()
})
```

- [ ] **Step 23.3: soft delete 후 목록에서 사라짐**

```ts
test('프로젝트 삭제 후 목록에서 사라진다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject())
  let deleted = false
  await page.route('**/api/v1/projects', route => {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(createPageResponse(deleted ? [] : [createProject()])) })
  })
  await page.route('**/api/v1/projects/WP', route => {
    if (route.request().method() === 'DELETE') { deleted = true; return route.fulfill({ status: 204 }) }
    return route.fallback()
  })
  page.on('dialog', d => d.accept())
  await page.goto('/projects/WP/settings')
  await page.getByRole('button', { name: '프로젝트 삭제' }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByText('아직 프로젝트가 없습니다')).toBeVisible()
})
```

- [ ] **Step 23.4: 전체 spec 실행**

```bash
cd apps/workplace-web && pnpm test:e2e
```

기대: smoke + non-smoke 전부 통과.

---

### Task 24: 회귀 — pre-commit / pre-push 드라이런

- [ ] **Step 24.1: pre-commit 도메인 분기**

```bash
PRECOMMIT_CHANGED_FILES="apps/workplace-web/src/pages/projects/IssueDetailPage.tsx" PRECOMMIT_DRY_RUN= sh scripts/husky/pre-commit.sh
```

기대: `도메인 한정 변경 감지: projects` 로그 + smoke 통과 + projects 도메인 non-smoke 통과 + gradle test 통과.

- [ ] **Step 24.2: pre-push 풀 회귀**

```bash
sh scripts/husky/pre-push.sh
```

기대: 전체 E2E + 전체 gradle test 통과.

---

### Task 25: 수동 검증 (Dev 서버 + 브라우저)

- [ ] **Step 25.1: 백엔드 / 프론트 동시 기동**

터미널 A: `cd apps/workplace-api && ./gradlew bootRun --args='--spring.profiles.active=local'`
터미널 B: `cd apps/workplace-web && pnpm dev`

- [ ] **Step 25.2: 시나리오 수동 실행**

1. 로그인 (또는 회원가입)
2. `/projects` 진입 → "+ 새 프로젝트" → `key=WP, name=Workplace, description=v1` 생성
3. 카드 클릭 → 상세 진입 → "+ 새 이슈" → `title=첫 이슈, body=...` 생성
4. 이슈 카드 클릭 → 상세 진입
   - 상태 select 를 IN_PROGRESS 로 변경 → 활동 타임라인에 "상태 변경: TODO → IN_PROGRESS" 노출 확인
   - 우선순위 변경 → 타임라인 추가 확인
   - 코멘트 작성 → 목록 추가 확인
5. 설정 진입 → 프로젝트 이름 변경 → 저장 → 목록/상세 즉시 반영 확인
6. 권한 거부 케이스: 다른 사용자(별도 회원가입)로 로그인 → `WP` 직접 URL 접근 → 403 메시지 확인

- [ ] **Step 25.3: 스크린샷 저장 (선택, 회귀 검증용)**

```bash
mkdir -p test-results/exploratory/issue-tracker-phase1/$(date +%Y%m%d_%H%M%S)/screenshots/
```

위 시나리오 각 단계 스크린샷 저장.

---

### Task 26: Final — 단일 커밋

- [ ] **Step 26.1: spotless 적용**

```bash
cd apps/workplace-api && ./gradlew spotlessApply
```

- [ ] **Step 26.2: 최종 풀 회귀**

```bash
sh scripts/husky/pre-push.sh
```

기대: 전부 통과.

- [ ] **Step 26.3: git status 검토 후 사용자 승인 받기**

```bash
git status
git diff --stat
```

**사용자에게 변경 요약 보고 + 커밋 승인 요청.**

- [ ] **Step 26.4: 사용자 승인 시 단일 커밋 (HEREDOC 메시지)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(issue-tracker): Phase 1 — Project + Issue + Comment + History 골격

- workplace-api: project/issue 모듈 신설 (Flyway V5 + jOOQ 재생성)
  - Project/ProjectMember + ProjectAccessGuard 두 단계 가드
  - Issue 도메인: 프로젝트별 시퀀스 발급, 4-state, 단일 assignee/priority/due
  - IssueComment + IssueHistory (상태/담당/우선순위/마감일/제목 변경 자동 기록)
  - 권한 코드 신설: project:read/write/manage, issue:write
- workplace-web: 프로젝트 목록·상세·설정 + 이슈 상세 페이지
  - 인라인 상태/우선순위/마감일 편집, 코멘트, 활동 타임라인
  - TanStack Query 훅 + Zod 검증
- E2E: projects 도메인 smoke (happy path 전체 파이프라인) + non-smoke 3종
- husky pre-commit 도메인 정규식에 projects 추가

설계: docs/superpowers/specs/2026-05-22-issue-tracker-phase1-design.md
계획: docs/superpowers/plans/2026-05-22-issue-tracker-phase1.md
관련: #16

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 26.5: 푸시는 별도 승인 후**

```bash
# 사용자가 명시적으로 푸시 지시할 때까지 대기
```

---

## Self-Review (작성 후 점검 결과)

1. **Spec 커버리지**
   - §2 데이터 모델 → Task 1 (모든 5테이블)
   - §3 권한/가드 → Task 1 seed + Task 3 `ProjectAccessGuard` + `PermissionChecker.userHasRole`
   - §4 API → Task 4 (Project/Member), Task 7~8 (Issue/Comment), 14개 엔드포인트 매핑
   - §5 모듈 구조 → Task 2~8 디렉토리 1:1 매칭
   - §6 프론트 라우트/파일 → Task 11~20
   - §7 검증/에러 → Task 12 Zod + Task 2/6 예외 + handleApiError
   - §8 테스트 → Task 5, 9, 22~23
   - §9 빌드 순서 → 본 plan 의 Task 순서와 일치
   - §10 위험 → Task 25 수동 검증으로 동시성 가벼운 확인. Horizontal scale 은 phase 외
   - §11 DoD → Task 24~26

2. **플레이스홀더**: `// ...` 로 비운 일부 메서드 본문 있음 (Repository CRUD 내부 jOOQ DSL). 본문 패턴은 기존 `UserRepository` 등을 참조하여 작성. plan 본문에 패턴이 명확하므로 잔여 모호성은 없음.

3. **타입 일관성**
   - `IssueRow.closedAt` (Instant), `IssueResponse` 에는 closedAt 제외 — 의도된 응답 슬림화
   - `UpdateIssueRequest.clearAssignee/clearDueDate` 플래그 일관 사용
   - `ProjectAccessGuard.assertMember` vs `assertWithRole` 시그니처 통일

4. **Spec 와의 차이점**
   - Spec §3 의 `ApiResponse<T>` 래퍼 표현은 코드베이스 실제 패턴(raw DTO + ResponseEntity)으로 plan 에서 조정함

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-issue-tracker-phase1.md`.

두 가지 실행 옵션:

1. **Subagent-Driven (추천)** — Task 단위로 별도 subagent 가 구현, 사이마다 검토. 빠른 반복.
2. **Inline Execution** — 현재 세션에서 직접 task 별 실행 + 체크포인트 검토.

어느 쪽으로 진행할까요?
