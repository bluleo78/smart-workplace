# 이슈 유형 (Issue Type) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 이슈에 유형 메타 (TASK/BUG/STORY/CHORE + 프로젝트별 CUSTOM) 를 NOT NULL 로 부여하고, OWNER 가 CUSTOM 정의 CRUD, 멤버가 이슈별 변경 가능.

**Architecture:** `issue_type_def` 테이블 + `issue.type_id` NOT NULL. 12색 라벨 팔레트 재사용 + lucide 8종 아이콘 화이트리스트. V10 이 기존 프로젝트에 시스템 4종 시드 + 기존 이슈 TASK 로 backfill. 신규 프로젝트는 `ProjectService.create` 가 코드 시드. 응답에는 `IssueResponse.type` 신규 필드, 검색은 `type=` CSV OR + N+1 batch.

**Tech Stack:** Spring Boot + jOOQ + Flyway V10 / Vite + React 19 + TS + Playwright.

**Spec:** `docs/superpowers/specs/2026-05-24-issue-tracker-issue-type-design.md`

**커밋 정책**: Phase 1·2·3a·3b·3c 와 동일 — 모든 작업 완료 후 단일 커밋. 각 Task 마지막은 `git add` 만. Task 15 (최종) 가 한 번에 커밋.

**브랜치**: `main` (사용자 명시적 승인 — Phase 1·2·3 연속 정책).

---

## 파일 구조

### 백엔드 (apps/workplace-api)

| 파일 | 책임 |
|---|---|
| `src/main/resources/db/migration/V10__issue_type.sql` (new) | 테이블 + 시드 + backfill + NOT NULL |
| `src/main/java/com/workplace/issue/dto/IssueTypeSummary.java` (new) | (id, name, colorToken, icon) |
| `src/main/java/com/workplace/issue/dto/IssueTypeResponse.java` (new) | 정의 응답 (+ isSystem, position, timestamps) |
| `src/main/java/com/workplace/issue/dto/IssueTypeRow.java` (new) | 내부 row |
| `src/main/java/com/workplace/issue/dto/CreateIssueTypeRequest.java` (new) | POST/PATCH body |
| `src/main/java/com/workplace/issue/dto/IssueTypeIcon.java` (new) | 8종 화이트리스트 |
| `src/main/java/com/workplace/issue/exception/{TypeNotFound,TypeNameDuplicated,SystemTypeImmutable,TypeInUse,InvalidTypeForProject,InvalidTypeIcon}Exception.java` (new) | 6종 예외 |
| `src/main/java/com/workplace/issue/repository/IssueTypeRepository.java` (new) | jOOQ CRUD + seed + findByIds(batch) + countIssuesByType |
| `src/main/java/com/workplace/issue/service/IssueTypeService.java` (new) | OWNER 가드 + CRUD + 시스템 보호 + 시드 |
| `src/main/java/com/workplace/issue/controller/IssueTypeController.java` (new) | `/api/v1/projects/{key}/types` |
| `src/main/java/com/workplace/project/service/ProjectService.java` (modify) | create 끝에 `issueTypeService.seedSystemTypes(...)` 호출 |
| `src/main/java/com/workplace/issue/dto/IssueRow.java` (modify) | `typeId: Long` 추가 |
| `src/main/java/com/workplace/issue/dto/IssueResponse.java` (modify) | `type: IssueTypeSummary` 추가 + `fromWithType` factory 시리즈 |
| `src/main/java/com/workplace/issue/dto/CreateIssueRequest.java` (modify) | `typeId: Long?` 추가 |
| `src/main/java/com/workplace/issue/dto/IssueSearchQuery.java` (modify) | `typeIds: List<Long>` 추가 |
| `src/main/java/com/workplace/issue/dto/IssueHistoryEventType.java` (modify) | `TYPE_CHANGED` 추가 |
| `src/main/java/com/workplace/issue/repository/IssueRepository.java` (modify) | mapToRow / insert / search / updateType 신설 |
| `src/main/java/com/workplace/issue/service/IssueService.java` (modify) | create typeId fallback/검증, setType 신설, get/list 의 type 채우기 |
| `src/main/java/com/workplace/issue/service/IssueSearchService.java` (modify) | type CSV 파싱 + N+1 batch |
| `src/main/java/com/workplace/issue/service/IssueHistoryRecorder.java` (modify) | `recordTypeChanged(...)` |
| `src/main/java/com/workplace/issue/controller/IssueController.java` (modify) | `PATCH /{number}/type` 추가 |
| `src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java` (modify) | 6개 신규 예외 매핑 |
| `src/test/...` (new/modify) | IssueType 서비스 + Project seed + Issue search/set type 테스트 |

### 프론트엔드 (apps/workplace-web)

| 파일 | 책임 |
|---|---|
| `src/types/issueType.ts` (new) | IssueTypeSummary, IssueTypeResponse, ICON_NAMES |
| `src/lib/issueTypeIcons.ts` (new) | lucide 8종 컴포넌트 정적 매핑 |
| `src/api/issueTypes.ts` (new) | CRUD + 이슈 유형 변경 |
| `src/hooks/queries/useIssueTypes.ts` (new) | 목록 + CRUD mutations |
| `src/hooks/queries/useUpdateIssueType.ts` (new) | mutation |
| `src/components/issueTypes/IssueTypeBadge.tsx` (new) | 아이콘+색상+이름 |
| `src/components/issueTypes/IssueTypeSelectPopover.tsx` (new) | 단일 선택 (즉시 PATCH) |
| `src/pages/projects/components/IssueTypeManagement.tsx` (new) | 설정 페이지 섹션 |
| `src/types/issue.ts` (modify) | IssueResponse.type, IssueFilters.typeIds |
| `src/lib/issueFilters.ts` (modify) | typeIds 직렬화 |
| `src/api/issues.ts` (modify) | searchIssues 가 type 파라미터 송신 |
| `src/pages/projects/IssueDetailPage.tsx` (modify) | 제목 옆 배지 + 픽커 |
| `src/pages/projects/components/IssueCard.tsx` (modify) | 제목 앞 아이콘 |
| `src/pages/projects/components/IssueListView.tsx` (modify) | 제목 셀 좌측 배지 |
| `src/pages/projects/components/IssueCreateDialog.tsx` (modify) | 유형 select |
| `src/pages/projects/components/IssueFilterBar.tsx` (modify) | 유형 다중 토글 popover |
| `src/pages/projects/ProjectSettingsPage.tsx` (modify) | IssueTypeManagement 섹션 삽입 |
| `src/pages/projects/components/IssueActivityTimeline.tsx` (modify) | TYPE_CHANGED 렌더링 |
| `src/pages/me/WatchedIssuesPage.tsx` (modify, optional) | 배지 표시 |
| `e2e/factories/issue.factory.ts` (modify) | type default `TASK` |
| `e2e/factories/issueType.factory.ts` (new) | mock 팩토리 |
| `e2e/pages/projects/issue-types.spec.ts` (new) | E2E |

---

## Task 1: Flyway V10 + jOOQ codegen

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V10__issue_type.sql`

- [ ] **Step 1: V10 작성**

```sql
-- V10__issue_type.sql
-- 이슈 유형 정의 (프로젝트별) + 모든 이슈 type_id NOT NULL.

CREATE TABLE issue_type_def (
  id              BIGSERIAL PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name            VARCHAR(40) NOT NULL,
  color_token     VARCHAR(16) NOT NULL,
  icon            VARCHAR(32) NOT NULL,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  position        INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE INDEX idx_issue_type_def_project ON issue_type_def(project_id);

ALTER TABLE issue ADD COLUMN type_id BIGINT REFERENCES issue_type_def(id) ON DELETE RESTRICT;

INSERT INTO issue_type_def (project_id, name, color_token, icon, is_system, position)
SELECT id, 'TASK',  'BLUE',   'Circle',   true, 0 FROM project
UNION ALL SELECT id, 'BUG',   'RED',    'Bug',      true, 1 FROM project
UNION ALL SELECT id, 'STORY', 'PURPLE', 'BookOpen', true, 2 FROM project
UNION ALL SELECT id, 'CHORE', 'GRAY',   'Wrench',   true, 3 FROM project;

UPDATE issue SET type_id = td.id
FROM issue_type_def td
WHERE td.project_id = issue.project_id AND td.name = 'TASK';

ALTER TABLE issue ALTER COLUMN type_id SET NOT NULL;
CREATE INDEX idx_issue_type ON issue(type_id);
```

- [ ] **Step 2: bootRun 으로 적용**

Run: `cd apps/workplace-api && ./gradlew bootRun --args='--spring.profiles.active=local --spring.main.web-application-type=none'`
20초 후 종료. 로그 `Successfully applied 1 migration` 확인.

- [ ] **Step 3: jOOQ 재생성**

Run: `./gradlew generateJooq`
Expected: `IssueTypeDef.java` 생성, `Issue.java` 에 `TYPE_ID` 컬럼 추가됨.

- [ ] **Step 4: Stage**

```bash
git add apps/workplace-api/src/main/resources/db/migration/V10__issue_type.sql
```

---

## Task 2: DTOs + 아이콘 화이트리스트 + 예외 + GlobalExceptionHandler 매핑

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueTypeSummary.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueTypeResponse.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueTypeRow.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/CreateIssueTypeRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueTypeIcon.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/exception/{6종}.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/dto/IssueTypeIconTest.java`

- [ ] **Step 1: 아이콘 화이트리스트 테스트**

```java
// IssueTypeIconTest.java
package com.workplace.issue.dto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.exception.InvalidTypeIconException;
import org.junit.jupiter.api.Test;

class IssueTypeIconTest {
  @Test
  void all_8_icons_accepted() {
    for (String n : new String[]{"Circle","Bug","BookOpen","Wrench","Star","Zap","Flag","Target"}) {
      assertThat(IssueTypeIcon.validate(n)).isEqualTo(n);
    }
  }
  @Test
  void unknown_icon_throws() {
    assertThatThrownBy(() -> IssueTypeIcon.validate("Heart"))
        .isInstanceOf(InvalidTypeIconException.class);
  }
  @Test
  void null_or_blank_throws() {
    assertThatThrownBy(() -> IssueTypeIcon.validate(null)).isInstanceOf(InvalidTypeIconException.class);
    assertThatThrownBy(() -> IssueTypeIcon.validate("")).isInstanceOf(InvalidTypeIconException.class);
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.issue.dto.IssueTypeIconTest"`
Expected: COMPILATION FAILURE.

- [ ] **Step 3: 예외 6종 작성**

```java
// InvalidTypeIconException.java
package com.workplace.issue.exception;

/** 화이트리스트 외 아이콘 — 400. */
public class InvalidTypeIconException extends RuntimeException {
  public InvalidTypeIconException(String icon) { super("허용되지 않은 아이콘: " + icon); }
}
```

```java
// TypeNotFoundException.java
package com.workplace.issue.exception;

public class TypeNotFoundException extends RuntimeException {
  public TypeNotFoundException(Long id) { super("유형을 찾을 수 없습니다: id=" + id); }
}
```

```java
// TypeNameDuplicatedException.java
package com.workplace.issue.exception;

public class TypeNameDuplicatedException extends RuntimeException {
  public TypeNameDuplicatedException(String name) { super("이미 존재하는 유형 이름입니다: " + name); }
}
```

```java
// SystemTypeImmutableException.java
package com.workplace.issue.exception;

/** 시스템 유형 수정/삭제 시도 — 409. */
public class SystemTypeImmutableException extends RuntimeException {
  public SystemTypeImmutableException() { super("시스템 유형은 수정/삭제할 수 없습니다"); }
}
```

```java
// TypeInUseException.java
package com.workplace.issue.exception;

/** 사용 중인 CUSTOM 유형 삭제 시도 — 409. */
public class TypeInUseException extends RuntimeException {
  public TypeInUseException(int count) { super("사용 중인 유형은 삭제할 수 없습니다 (이슈 " + count + "개)"); }
}
```

```java
// InvalidTypeForProjectException.java
package com.workplace.issue.exception;

/** 다른 프로젝트의 유형 id — 400. */
public class InvalidTypeForProjectException extends RuntimeException {
  public InvalidTypeForProjectException() { super("프로젝트에 속하지 않은 유형입니다"); }
}
```

- [ ] **Step 4: IssueTypeIcon + DTOs 작성**

```java
// IssueTypeIcon.java
package com.workplace.issue.dto;

import com.workplace.issue.exception.InvalidTypeIconException;
import java.util.Set;

/** lucide 아이콘 화이트리스트 8종. */
public final class IssueTypeIcon {
  private IssueTypeIcon() {}
  public static final Set<String> ALL = Set.of(
      "Circle","Bug","BookOpen","Wrench","Star","Zap","Flag","Target");
  public static String validate(String icon) {
    if (icon == null || icon.isBlank() || !ALL.contains(icon)) {
      throw new InvalidTypeIconException(icon);
    }
    return icon;
  }
}
```

```java
// IssueTypeSummary.java
package com.workplace.issue.dto;

/** 이슈 응답에 임베드되는 유형 요약. */
public record IssueTypeSummary(Long id, String name, String colorToken, String icon) {}
```

```java
// IssueTypeResponse.java
package com.workplace.issue.dto;

import java.time.Instant;

/** 정의 단건 응답. */
public record IssueTypeResponse(
    Long id, Long projectId, String name, String colorToken, String icon,
    boolean isSystem, int position,
    Instant createdAt, Instant updatedAt) {}
```

```java
// IssueTypeRow.java
package com.workplace.issue.dto;

import java.time.Instant;

public record IssueTypeRow(
    Long id, Long projectId, String name, String colorToken, String icon,
    boolean isSystem, int position,
    Instant createdAt, Instant updatedAt) {}
```

```java
// CreateIssueTypeRequest.java
package com.workplace.issue.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** POST/PATCH 본문. PATCH 도 동일 record. */
public record CreateIssueTypeRequest(
    @NotBlank @Size(max = 40) String name,
    @NotBlank String colorToken,
    @NotBlank String icon) {}
```

- [ ] **Step 5: GlobalExceptionHandler 매핑 추가**

기존 Phase 3 예외 핸들러 옆에 6개 추가:

```java
@ExceptionHandler(com.workplace.issue.exception.TypeNotFoundException.class)
public ResponseEntity<ErrorResponse> handleTypeNotFound(
    com.workplace.issue.exception.TypeNotFoundException ex, HttpServletRequest req) {
  return buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, req);
}

@ExceptionHandler(com.workplace.issue.exception.TypeNameDuplicatedException.class)
public ResponseEntity<ErrorResponse> handleTypeNameDup(
    com.workplace.issue.exception.TypeNameDuplicatedException ex, HttpServletRequest req) {
  return buildError(HttpStatus.CONFLICT, ex.getMessage(), null, req);
}

@ExceptionHandler(com.workplace.issue.exception.SystemTypeImmutableException.class)
public ResponseEntity<ErrorResponse> handleSystemTypeImmutable(
    com.workplace.issue.exception.SystemTypeImmutableException ex, HttpServletRequest req) {
  return buildError(HttpStatus.CONFLICT, ex.getMessage(), null, req);
}

@ExceptionHandler(com.workplace.issue.exception.TypeInUseException.class)
public ResponseEntity<ErrorResponse> handleTypeInUse(
    com.workplace.issue.exception.TypeInUseException ex, HttpServletRequest req) {
  return buildError(HttpStatus.CONFLICT, ex.getMessage(), null, req);
}

@ExceptionHandler(com.workplace.issue.exception.InvalidTypeForProjectException.class)
public ResponseEntity<ErrorResponse> handleInvalidTypeForProject(
    com.workplace.issue.exception.InvalidTypeForProjectException ex, HttpServletRequest req) {
  return buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, req);
}

@ExceptionHandler(com.workplace.issue.exception.InvalidTypeIconException.class)
public ResponseEntity<ErrorResponse> handleInvalidTypeIcon(
    com.workplace.issue.exception.InvalidTypeIconException ex, HttpServletRequest req) {
  return buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, req);
}
```

- [ ] **Step 6: 테스트 통과 + Stage**

Run: `./gradlew test --tests "com.workplace.issue.dto.IssueTypeIconTest"` → 3 PASS.

```bash
git add apps/workplace-api/src/main/java/com/workplace/issue/dto/{IssueTypeIcon,IssueTypeSummary,IssueTypeResponse,IssueTypeRow,CreateIssueTypeRequest}.java \
        apps/workplace-api/src/main/java/com/workplace/issue/exception/ \
        apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java \
        apps/workplace-api/src/test/java/com/workplace/issue/dto/IssueTypeIconTest.java
```

---

## Task 3: IssueTypeRepository

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueTypeRepository.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/repository/IssueTypeRepositoryTest.java`

- [ ] **Step 1: 실패 테스트**

```java
// IssueTypeRepositoryTest.java
package com.workplace.issue.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.IntegrationTestBase;
import com.workplace.issue.dto.IssueTypeRow;
// Phase 3a/3b/3c 시드 패턴 (직접 DSL USER + projectService.create)
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class IssueTypeRepositoryTest extends IntegrationTestBase {

  @Autowired IssueTypeRepository repo;
  // ... 의존성 (Phase 3a 동일)

  @Test
  void find_by_project_returns_4_system_seeded() {
    // 시드 후: projectService.create(...) 가 시스템 4종을 코드로 추가하므로 4개 반환
  }

  @Test
  void insert_custom_and_find_by_name() {
    // OWNER 가 CUSTOM 추가 → findByProjectAndName 정확
  }

  @Test
  void count_issues_by_type_returns_zero_for_unused() {
    // 사용 안 한 CUSTOM → 0
  }

  @Test
  void find_by_ids_returns_summaries_with_user_join() {
    // CUSTOM 2개 추가 → findByIds([a,b]) → 2개 IssueTypeSummary
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests "com.workplace.issue.repository.IssueTypeRepositoryTest"`
Expected: COMPILATION FAILURE.

- [ ] **Step 3: Repository 작성**

```java
// IssueTypeRepository.java
package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static org.jooq.impl.DSL.count;

import com.workplace.issue.dto.IssueTypeRow;
import com.workplace.issue.dto.IssueTypeSummary;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

/** 이슈 유형 정의 jOOQ 리포지토리. */
@Repository
@RequiredArgsConstructor
public class IssueTypeRepository {

  private final DSLContext dsl;

  private IssueTypeRow mapToRow(Record r) {
    OffsetDateTime c = r.get(ISSUE_TYPE_DEF.CREATED_AT);
    OffsetDateTime u = r.get(ISSUE_TYPE_DEF.UPDATED_AT);
    return new IssueTypeRow(
        r.get(ISSUE_TYPE_DEF.ID),
        r.get(ISSUE_TYPE_DEF.PROJECT_ID),
        r.get(ISSUE_TYPE_DEF.NAME),
        r.get(ISSUE_TYPE_DEF.COLOR_TOKEN),
        r.get(ISSUE_TYPE_DEF.ICON),
        r.get(ISSUE_TYPE_DEF.IS_SYSTEM),
        r.get(ISSUE_TYPE_DEF.POSITION),
        c != null ? c.toInstant() : null,
        u != null ? u.toInstant() : null);
  }

  public Optional<IssueTypeRow> findById(Long id) {
    return dsl.selectFrom(ISSUE_TYPE_DEF).where(ISSUE_TYPE_DEF.ID.eq(id))
        .fetchOptional(this::mapToRow);
  }

  public Optional<IssueTypeRow> findByProjectAndName(Long projectId, String name) {
    return dsl.selectFrom(ISSUE_TYPE_DEF)
        .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(projectId).and(ISSUE_TYPE_DEF.NAME.eq(name)))
        .fetchOptional(this::mapToRow);
  }

  public List<IssueTypeRow> findByProject(Long projectId) {
    return dsl.selectFrom(ISSUE_TYPE_DEF)
        .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(projectId))
        .orderBy(ISSUE_TYPE_DEF.POSITION.asc(), ISSUE_TYPE_DEF.ID.asc())
        .fetch(this::mapToRow);
  }

  /** N+1 회피 batch — id 집합 → Map<id, summary>. */
  public Map<Long, IssueTypeSummary> findByIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return Map.of();
    Map<Long, IssueTypeSummary> result = new HashMap<>();
    dsl.select(ISSUE_TYPE_DEF.ID, ISSUE_TYPE_DEF.NAME,
              ISSUE_TYPE_DEF.COLOR_TOKEN, ISSUE_TYPE_DEF.ICON)
        .from(ISSUE_TYPE_DEF).where(ISSUE_TYPE_DEF.ID.in(ids))
        .fetch()
        .forEach(r -> result.put(r.value1(),
            new IssueTypeSummary(r.value1(), r.value2(), r.value3(), r.value4())));
    return result;
  }

  /** 사용 중 이슈 카운트 — 삭제 가드용. */
  public int countIssuesByType(Long typeId) {
    return dsl.select(count()).from(ISSUE)
        .where(ISSUE.TYPE_ID.eq(typeId).and(ISSUE.DELETED_AT.isNull()))
        .fetchOne(0, Integer.class);
  }

  /** INSERT — UNIQUE 위반은 DuplicateKeyException 으로 변환. */
  public IssueTypeRow insert(Long projectId, String name, String colorToken, String icon,
                              boolean isSystem, int position) {
    try {
      return dsl.insertInto(ISSUE_TYPE_DEF)
          .set(ISSUE_TYPE_DEF.PROJECT_ID, projectId)
          .set(ISSUE_TYPE_DEF.NAME, name)
          .set(ISSUE_TYPE_DEF.COLOR_TOKEN, colorToken)
          .set(ISSUE_TYPE_DEF.ICON, icon)
          .set(ISSUE_TYPE_DEF.IS_SYSTEM, isSystem)
          .set(ISSUE_TYPE_DEF.POSITION, position)
          .returning()
          .fetchOptional().map(this::mapToRow)
          .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("type name duplicated", e);
    }
  }

  public void update(Long id, String name, String colorToken, String icon) {
    try {
      dsl.update(ISSUE_TYPE_DEF)
          .set(ISSUE_TYPE_DEF.NAME, name)
          .set(ISSUE_TYPE_DEF.COLOR_TOKEN, colorToken)
          .set(ISSUE_TYPE_DEF.ICON, icon)
          .set(ISSUE_TYPE_DEF.UPDATED_AT, OffsetDateTime.now())
          .where(ISSUE_TYPE_DEF.ID.eq(id))
          .execute();
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("type name duplicated", e);
    }
  }

  public void delete(Long id) {
    dsl.deleteFrom(ISSUE_TYPE_DEF).where(ISSUE_TYPE_DEF.ID.eq(id)).execute();
  }
}
```

- [ ] **Step 4: 테스트 시드 채우고 통과**

Run: `./gradlew test --tests "com.workplace.issue.repository.IssueTypeRepositoryTest"`
Expected: 4 PASS.

- [ ] **Step 5: Stage**

```bash
git add apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueTypeRepository.java \
        apps/workplace-api/src/test/java/com/workplace/issue/repository/IssueTypeRepositoryTest.java
```

---

## Task 4: IssueTypeService — OWNER CRUD + seedSystemTypes

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueTypeService.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/service/IssueTypeServiceTest.java`

- [ ] **Step 1: 실패 테스트**

```java
// IssueTypeServiceTest.java
package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.IntegrationTestBase;
import com.workplace.issue.dto.CreateIssueTypeRequest;
import com.workplace.issue.exception.*;
import com.workplace.project.exception.ProjectAccessDeniedException;
// 시드 패턴 (Phase 3a 동일)
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class IssueTypeServiceTest extends IntegrationTestBase {

  @Autowired IssueTypeService service;
  // ... 의존성

  @Test
  void owner_creates_custom_type() {
    // var resp = service.create(owner, "K", new CreateIssueTypeRequest("디자인","PURPLE","Star"));
    // assertThat(resp.isSystem()).isFalse();
  }

  @Test
  void member_create_forbidden() {
    // assertThatThrownBy(...).isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void system_type_patch_throws_409() {
    // 시스템 TASK 찾기 → patch → SystemTypeImmutableException
  }

  @Test
  void system_type_delete_throws_409() {
    // 시스템 TASK delete → SystemTypeImmutableException
  }

  @Test
  void delete_custom_in_use_throws_409() {
    // CUSTOM 만들고 issue 에 부여 후 delete → TypeInUseException
  }

  @Test
  void duplicate_name_throws_409() {
    // 동일 프로젝트 동일 이름 두번 create → TypeNameDuplicatedException
  }

  @Test
  void invalid_icon_throws_400() {
    // icon="Heart" → InvalidTypeIconException
  }

  @Test
  void invalid_color_throws_400() {
    // colorToken="MAGENTA" → InvalidColorTokenException (재사용)
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests "com.workplace.issue.service.IssueTypeServiceTest"`
Expected: COMPILATION FAILURE.

- [ ] **Step 3: Service 작성**

```java
// IssueTypeService.java
package com.workplace.issue.service;

import com.workplace.issue.dto.CreateIssueTypeRequest;
import com.workplace.issue.dto.IssueTypeIcon;
import com.workplace.issue.dto.IssueTypeResponse;
import com.workplace.issue.exception.SystemTypeImmutableException;
import com.workplace.issue.exception.TypeInUseException;
import com.workplace.issue.exception.TypeNameDuplicatedException;
import com.workplace.issue.exception.TypeNotFoundException;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.label.dto.ColorToken;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 이슈 유형 정의 CRUD. 변경은 OWNER, 조회는 멤버. 시스템 유형 보호. */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueTypeService {

  private final IssueTypeRepository repo;
  private final ProjectAccessGuard accessGuard;

  /** 신규 프로젝트 생성 직후 시스템 4종 시드. ProjectService.create 에서 호출. */
  public void seedSystemTypes(Long projectId) {
    repo.insert(projectId, "TASK",  "BLUE",   "Circle",   true, 0);
    repo.insert(projectId, "BUG",   "RED",    "Bug",      true, 1);
    repo.insert(projectId, "STORY", "PURPLE", "BookOpen", true, 2);
    repo.insert(projectId, "CHORE", "GRAY",   "Wrench",   true, 3);
  }

  @Transactional(readOnly = true)
  public List<IssueTypeResponse> list(Long callerId, String projectKey) {
    var project = accessGuard.assertMember(projectKey, callerId);
    return repo.findByProject(project.id()).stream()
        .map(r -> new IssueTypeResponse(r.id(), r.projectId(), r.name(), r.colorToken(), r.icon(),
            r.isSystem(), r.position(), r.createdAt(), r.updatedAt()))
        .toList();
  }

  public IssueTypeResponse create(Long callerId, String projectKey, CreateIssueTypeRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    String color = ColorToken.validate(req.colorToken());
    String icon = IssueTypeIcon.validate(req.icon());
    String name = req.name().trim();
    try {
      var row = repo.insert(project.id(), name, color, icon, false, 99);
      return toResponse(row);
    } catch (DuplicateKeyException e) {
      throw new TypeNameDuplicatedException(name);
    }
  }

  public IssueTypeResponse update(Long callerId, String projectKey, Long typeId,
                                   CreateIssueTypeRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    var row = repo.findById(typeId).orElseThrow(() -> new TypeNotFoundException(typeId));
    if (!row.projectId().equals(project.id())) throw new TypeNotFoundException(typeId);
    if (row.isSystem()) throw new SystemTypeImmutableException();
    String color = ColorToken.validate(req.colorToken());
    String icon = IssueTypeIcon.validate(req.icon());
    String name = req.name().trim();
    try {
      repo.update(typeId, name, color, icon);
    } catch (DuplicateKeyException e) {
      throw new TypeNameDuplicatedException(name);
    }
    return toResponse(repo.findById(typeId).orElseThrow());
  }

  public void delete(Long callerId, String projectKey, Long typeId) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    var row = repo.findById(typeId).orElseThrow(() -> new TypeNotFoundException(typeId));
    if (!row.projectId().equals(project.id())) throw new TypeNotFoundException(typeId);
    if (row.isSystem()) throw new SystemTypeImmutableException();
    int inUse = repo.countIssuesByType(typeId);
    if (inUse > 0) throw new TypeInUseException(inUse);
    repo.delete(typeId);
  }

  private IssueTypeResponse toResponse(com.workplace.issue.dto.IssueTypeRow r) {
    return new IssueTypeResponse(r.id(), r.projectId(), r.name(), r.colorToken(), r.icon(),
        r.isSystem(), r.position(), r.createdAt(), r.updatedAt());
  }
}
```

- [ ] **Step 4: 테스트 시드 + 통과**

Run: `./gradlew test --tests "com.workplace.issue.service.IssueTypeServiceTest"`
Expected: 8 PASS.

- [ ] **Step 5: Stage**

```bash
git add apps/workplace-api/src/main/java/com/workplace/issue/service/IssueTypeService.java \
        apps/workplace-api/src/test/java/com/workplace/issue/service/IssueTypeServiceTest.java
```

---

## Task 5: IssueTypeController + ProjectService 시드 통합

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/controller/IssueTypeController.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/project/service/ProjectService.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/service/IssueTypeSystemSeedTest.java`

- [ ] **Step 1: Controller 작성**

```java
// IssueTypeController.java
package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.CreateIssueTypeRequest;
import com.workplace.issue.dto.IssueTypeResponse;
import com.workplace.issue.service.IssueTypeService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/** 프로젝트 이슈 유형 정의 CRUD. OWNER 만 변경. */
@RestController
@RequestMapping("/api/v1/projects/{key}/types")
@RequiredArgsConstructor
public class IssueTypeController {

  private final IssueTypeService service;

  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<IssueTypeResponse>> list(Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(service.list((Long) auth.getPrincipal(), key));
  }

  @PostMapping
  @RequirePermission("project:manage")
  public ResponseEntity<IssueTypeResponse> create(
      Authentication auth, @PathVariable String key, @Valid @RequestBody CreateIssueTypeRequest req) {
    return ResponseEntity.ok(service.create((Long) auth.getPrincipal(), key, req));
  }

  @PatchMapping("/{typeId}")
  @RequirePermission("project:manage")
  public ResponseEntity<IssueTypeResponse> update(
      Authentication auth, @PathVariable String key, @PathVariable Long typeId,
      @Valid @RequestBody CreateIssueTypeRequest req) {
    return ResponseEntity.ok(service.update((Long) auth.getPrincipal(), key, typeId, req));
  }

  @DeleteMapping("/{typeId}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable String key, @PathVariable Long typeId) {
    service.delete((Long) auth.getPrincipal(), key, typeId);
    return ResponseEntity.noContent().build();
  }
}
```

(권한 코드 `project:manage` 는 Phase 1 에서 이미 존재. 라벨 패턴과 정합.)

- [ ] **Step 2: ProjectService 통합**

`ProjectService.create(...)` 끝에 추가:

```java
private final IssueTypeService issueTypeService;  // 의존성 주입

public ProjectResponse create(Long callerId, CreateProjectRequest req) {
  // 기존 로직 그대로...
  sequenceRepository.initialize(row.id());
  issueTypeService.seedSystemTypes(row.id());  // 신규
  return ProjectResponse.from(row);
}
```

- [ ] **Step 3: 시드 통합 테스트**

```java
// IssueTypeSystemSeedTest.java
package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.IntegrationTestBase;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
// 시드 패턴
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class IssueTypeSystemSeedTest extends IntegrationTestBase {

  @Autowired ProjectService projectService;
  @Autowired IssueTypeRepository typeRepository;
  // ... user 시드 헬퍼

  @Test
  void create_project_seeds_4_system_types() {
    Long ownerId = seedUser();
    var project = projectService.create(ownerId, new CreateProjectRequest("SD", "Seed", ""));
    var types = typeRepository.findByProject(project.id());
    assertThat(types).hasSize(4);
    assertThat(types).extracting("name")
        .containsExactlyInAnyOrder("TASK", "BUG", "STORY", "CHORE");
    assertThat(types).allMatch(t -> t.isSystem());
  }
}
```

- [ ] **Step 4: 전체 회귀**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Stage**

```bash
git add apps/workplace-api/src/main/java/com/workplace/issue/controller/IssueTypeController.java \
        apps/workplace-api/src/main/java/com/workplace/project/service/ProjectService.java \
        apps/workplace-api/src/test/java/com/workplace/issue/service/IssueTypeSystemSeedTest.java
```

---

## Task 6: IssueRow + IssueResponse + IssueRepository 갱신

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueRow.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueResponse.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/dto/CreateIssueRequest.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueSearchQuery.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueHistoryEventType.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueRepository.java`

- [ ] **Step 1: IssueRow + IssueSearchQuery + IssueHistoryEventType**

`IssueRow` 에 `Long typeId` 마지막 필드 추가.

`IssueSearchQuery` 에 `List<Long> typeIds` 마지막 필드 추가.

`IssueHistoryEventType` 에 `TYPE_CHANGED` enum 값 추가.

- [ ] **Step 2: CreateIssueRequest 에 typeId 추가**

```java
public record CreateIssueRequest(
    @NotBlank @Size(max = 200) String title,
    String body,
    @Pattern(regexp = "LOW|MID|HIGH") String priority,
    LocalDate dueDate,
    List<Long> assigneeIds,
    Long typeId) {}
```

- [ ] **Step 3: IssueResponse 에 type 추가 + fromWithType 시리즈**

```java
public record IssueResponse(
    Long id, String projectKey, int number, String title, String status, String priority,
    LocalDate dueDate, Long reporterId,
    Instant createdAt, Instant updatedAt,
    List<LabelSummary> labels,
    int attachmentCount,
    IssueTypeSummary type,
    List<UserSummary> assignees) {

  // 기존 from / fromWithLabels / fromWithDetails / fromWithFullDetails — type=null default
  public static IssueResponse from(String projectKey, IssueRow r) {
    return new IssueResponse(/* ... */, List.of(), 0, null, List.of());
  }
  // ... fromWithLabels (count=0, type=null, assignees=[])
  // ... fromWithDetails (type=null, assignees=[])
  // ... fromWithFullDetails (type=null) — Phase 3c

  /** 신규 — type 까지 채워서 반환 (현 검색/get 경로). */
  public static IssueResponse fromWithType(
      String projectKey, IssueRow r,
      List<LabelSummary> labels, int attachmentCount,
      IssueTypeSummary type, List<UserSummary> assignees) {
    return new IssueResponse(
        r.id(), projectKey, r.number(), r.title(), r.status(), r.priority(),
        r.dueDate(), r.reporterId(),
        r.createdAt(), r.updatedAt(),
        labels, attachmentCount, type, assignees);
  }
}
```

- [ ] **Step 4: IssueRepository 갱신**

`mapToRow` / 모든 SELECT 컬럼 목록에 `ISSUE.TYPE_ID` 추가, `IssueRow` 생성자 마지막에 `r.get(ISSUE.TYPE_ID)` 전달.

`insert(...)` 시그니처 마지막에 `Long typeId` 추가 + INSERT 본문에 `.set(ISSUE.TYPE_ID, typeId)`.

`search(...)` 안에 type 필터 추가 (다른 IN 필터 옆):
```java
if (query.typeIds() != null && !query.typeIds().isEmpty()) {
  where = where.and(ISSUE.TYPE_ID.in(query.typeIds()));
}
```

신규 `updateType(id, newTypeId)`:
```java
public void updateType(Long id, Long newTypeId) {
  dsl.update(ISSUE)
      .set(ISSUE.TYPE_ID, newTypeId)
      .set(ISSUE.UPDATED_AT, OffsetDateTime.now())
      .where(ISSUE.ID.eq(id))
      .execute();
}
```

- [ ] **Step 5: 컴파일 (호출자 에러 OK)**

Run: `./gradlew compileJava`
Expected: `IssueService` / 테스트 등 호출자 컴파일 에러 — 다음 Task 에서 해결.

- [ ] **Step 6: Stage**

```bash
git add apps/workplace-api/src/main/java/com/workplace/issue/dto/{IssueRow,IssueResponse,CreateIssueRequest,IssueSearchQuery,IssueHistoryEventType}.java \
        apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueRepository.java
```

---

## Task 7: IssueService — create typeId fallback + setType + get type 채우기

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueService.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueHistoryRecorder.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/controller/IssueController.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/service/IssueSetTypeTest.java`

- [ ] **Step 1: IssueHistoryRecorder.recordTypeChanged**

```java
/** 유형 변경 한 건 기록. 동일 유형은 호출 안 됨 보장(서비스). */
public void recordTypeChanged(
    Long actorId, Long issueId,
    com.workplace.issue.dto.IssueTypeSummary from,
    com.workplace.issue.dto.IssueTypeSummary to) {
  String payload;
  try {
    payload = objectMapper.writeValueAsString(java.util.Map.of(
        "from", java.util.Map.of("id", from.id(), "name", from.name()),
        "to",   java.util.Map.of("id", to.id(),   "name", to.name())));
  } catch (Exception e) {
    payload = "{}";
  }
  historyRepository.insert(issueId, actorId, "TYPE_CHANGED", null, payload);
}
```

- [ ] **Step 2: IssueService.create — typeId fallback + 검증**

```java
private final IssueTypeRepository typeRepository;  // 의존성

public IssueResponse create(Long callerId, String projectKey, CreateIssueRequest req) {
  var project = accessGuard.assertMember(projectKey, callerId);

  // assigneeIds 검증 (Phase 3c 그대로)...

  // typeId 결정
  Long typeId;
  if (req.typeId() != null) {
    var t = typeRepository.findById(req.typeId())
        .orElseThrow(() -> new com.workplace.issue.exception.InvalidTypeForProjectException());
    if (!t.projectId().equals(project.id())) {
      throw new com.workplace.issue.exception.InvalidTypeForProjectException();
    }
    typeId = t.id();
  } else {
    typeId = typeRepository.findByProjectAndName(project.id(), "TASK")
        .orElseThrow(() -> new IllegalStateException("프로젝트에 TASK 유형이 없음"))
        .id();
  }

  int number = sequenceRepository.allocateNext(project.id());
  var row = issueRepository.insert(
      project.id(), number, req.title(), req.body(),
      req.priority() != null ? req.priority() : "MID",
      req.dueDate(),
      callerId,
      typeId);  // 신규 인자

  // 매핑 / watcher (Phase 3c) 그대로...
  return IssueResponse.from(project.key(), row);
}
```

- [ ] **Step 3: IssueService.setType**

```java
public IssueDetailResponse setType(Long callerId, String projectKey, int number, Long typeId) {
  var project = accessGuard.assertMember(projectKey, callerId);
  var issue = issueRepository.findByProjectAndNumber(project.id(), number)
      .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
  var newType = typeRepository.findById(typeId)
      .orElseThrow(() -> new com.workplace.issue.exception.InvalidTypeForProjectException());
  if (!newType.projectId().equals(project.id())) {
    throw new com.workplace.issue.exception.InvalidTypeForProjectException();
  }
  if (newType.id().equals(issue.typeId())) {
    return get(callerId, projectKey, number);
  }
  var oldType = typeRepository.findById(issue.typeId()).orElseThrow();
  issueRepository.updateType(issue.id(), newType.id());
  historyRecorder.recordTypeChanged(callerId, issue.id(),
      new com.workplace.issue.dto.IssueTypeSummary(
          oldType.id(), oldType.name(), oldType.colorToken(), oldType.icon()),
      new com.workplace.issue.dto.IssueTypeSummary(
          newType.id(), newType.name(), newType.colorToken(), newType.icon()));
  return get(callerId, projectKey, number);
}
```

- [ ] **Step 4: IssueService.get — type 채우기**

```java
@Transactional(readOnly = true)
public IssueDetailResponse get(Long callerId, String projectKey, int number) {
  var project = accessGuard.assertMember(projectKey, callerId);
  var row = issueRepository.findByProjectAndNumber(project.id(), number)
      .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
  var labels = issueLabelRepository.findLabelsByIssue(row.id());
  var attachments = attachmentRepository.findByIssue(row.id());
  var assignees = assigneeRepository.findByIssue(row.id());
  var typeMap = typeRepository.findByIds(java.util.List.of(row.typeId()));
  var type = typeMap.get(row.typeId());  // null-safe; 데이터 일관성 보장상 항상 존재
  var comments = commentRepository.findByIssue(row.id());
  var history = historyRepository.findByIssue(row.id());
  return new IssueDetailResponse(
      IssueResponse.fromWithType(project.key(), row, labels, attachments.size(), type, assignees),
      row.body(), comments, history, attachments);
}
```

- [ ] **Step 5: IssueController — PATCH /type 엔드포인트**

```java
public record UpdateTypeRequest(@jakarta.validation.constraints.NotNull Long typeId) {}

@PatchMapping("/{number}/type")
@RequirePermission("issue:write")
public ResponseEntity<IssueDetailResponse> updateType(
    Authentication auth, @PathVariable String key, @PathVariable int number,
    @Valid @RequestBody UpdateTypeRequest req) {
  return ResponseEntity.ok(
      issueService.setType((Long) auth.getPrincipal(), key, number, req.typeId()));
}
```

- [ ] **Step 6: setType 통합 테스트**

```java
// IssueSetTypeTest.java
package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
// ...

class IssueSetTypeTest extends IntegrationTestBase {

  @Test
  void member_changes_type_records_history() {
    // setType(member, key, 1, customTypeId) → history TYPE_CHANGED 1건
  }

  @Test
  void same_type_does_not_record() {
    // setType 동일 유형 재호출 → history 미증가
  }

  @Test
  void foreign_type_throws_400() {
    // 다른 프로젝트 typeId → InvalidTypeForProjectException
  }

  @Test
  void non_member_forbidden() {
    // 비멤버 → ProjectAccessDeniedException
  }
}
```

- [ ] **Step 7: 전체 회귀**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL. 기존 IssueServiceTest / IssueControllerTest 가 `IssueRow` / `IssueResponse` / `insert(...)` 새 인자 때문에 깨졌다면 같이 갱신 (typeId 필드/인자 추가).

- [ ] **Step 8: Stage**

```bash
git add apps/workplace-api/src/main/java/com/workplace/issue/service/{IssueService,IssueHistoryRecorder}.java \
        apps/workplace-api/src/main/java/com/workplace/issue/controller/IssueController.java \
        apps/workplace-api/src/test/java/com/workplace/issue/
```

---

## Task 8: IssueSearchService — type CSV + N+1 batch

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueSearchService.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/service/IssueSearchServiceTypesTest.java`

- [ ] **Step 1: 실패 테스트**

```java
// IssueSearchServiceTypesTest.java
package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;
import java.util.Map;
import org.junit.jupiter.api.Test;

class IssueSearchServiceTypesTest extends IntegrationTestBase {

  @Test
  void search_result_includes_type_summary() {
    // 시드 후 검색 → items[].type 가 비어있지 않고 정확한 name/icon
  }

  @Test
  void type_csv_filter_or_matches() {
    // type=<bugId>,<storyId> → BUG 또는 STORY 만
  }
}
```

- [ ] **Step 2: parse 에 typeIds 추가 + batch 채우기**

`IssueSearchService.parse(...)`:
```java
List<Long> typeIds = new ArrayList<>();
for (String tok : csv(p.get("type"))) {
  try { typeIds.add(Long.parseLong(tok)); } catch (NumberFormatException ignored) {}
}
return new IssueSearchQuery(/* ... */, labelIds, typeIds);  // 마지막 인자
```

`search(...)` 본문 items 조립:
```java
private final IssueTypeRepository typeRepository;  // 신규

// search 안:
var typeIdsToFetch = rows.stream().map(IssueRow::typeId).distinct().toList();
var typesById = typeRepository.findByIds(typeIdsToFetch);
var items = rows.stream()
    .map(r -> IssueResponse.fromWithType(
        project.key(), r,
        labelsByIssue.getOrDefault(r.id(), List.of()),
        countsByIssue.getOrDefault(r.id(), 0),
        typesById.get(r.typeId()),
        assigneesByIssue.getOrDefault(r.id(), List.of())))
    .toList();
```

- [ ] **Step 3: 테스트 통과**

Run: `./gradlew test --tests "com.workplace.issue.service.IssueSearchServiceTypesTest"`
Expected: 2 PASS.

- [ ] **Step 4: Spotless + Stage**

```bash
cd apps/workplace-api && ./gradlew spotlessApply && cd -
git add apps/workplace-api/src/main/java/com/workplace/issue/service/IssueSearchService.java \
        apps/workplace-api/src/test/java/com/workplace/issue/service/IssueSearchServiceTypesTest.java
```

---

## Task 9: 프론트 — 타입 + 아이콘 + API

**Files:**
- Create: `apps/workplace-web/src/types/issueType.ts`
- Create: `apps/workplace-web/src/lib/issueTypeIcons.ts`
- Create: `apps/workplace-web/src/api/issueTypes.ts`
- Modify: `apps/workplace-web/src/types/issue.ts`
- Modify: `apps/workplace-web/src/lib/issueFilters.ts`
- Modify: `apps/workplace-web/src/api/issues.ts`

- [ ] **Step 1: 타입**

```ts
// src/types/issueType.ts
export const ICON_NAMES = [
  'Circle','Bug','BookOpen','Wrench','Star','Zap','Flag','Target',
] as const
export type IconName = (typeof ICON_NAMES)[number]

export interface IssueTypeSummary {
  id: number
  name: string
  colorToken: string
  icon: IconName
}

export interface IssueTypeResponse {
  id: number
  projectId: number
  name: string
  colorToken: string
  icon: IconName
  isSystem: boolean
  position: number
  createdAt: string
  updatedAt: string
}
```

```ts
// src/lib/issueTypeIcons.ts
import { BookOpen, Bug, Circle, Flag, Star, Target, Wrench, Zap } from 'lucide-react'
import type { IconName } from '../types/issueType'

// lucide 컴포넌트 정적 매핑 — Tailwind purge 와 무관 (아이콘은 JSX 컴포넌트)
export const ISSUE_TYPE_ICONS: Record<IconName, typeof Circle> = {
  Circle, Bug, BookOpen, Wrench, Star, Zap, Flag, Target,
}
```

- [ ] **Step 2: types/issue.ts**

`IssueResponse` 와 `IssueFilters` 보강:
```ts
import type { IssueTypeSummary } from './issueType'

export interface IssueResponse {
  // ... 기존
  type: IssueTypeSummary
}

export interface IssueFilters {
  // ... 기존
  typeIds: number[]
}
```

CreateIssueInput 에 `typeId?: number | null` 추가.

- [ ] **Step 3: issueFilters.ts**

`parseFilters`:
```ts
const typeIds = csv(params.get('type'))
  .map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0)
return { /* ... */, typeIds }
```

`filtersToParams`:
```ts
if (f.typeIds.length) p.set('type', f.typeIds.join(','))
```

- [ ] **Step 4: api/issues.ts**

`searchIssues` 안:
```ts
if (filters.typeIds.length) params.set('type', filters.typeIds.join(','))
```

- [ ] **Step 5: api/issueTypes.ts**

```ts
// src/api/issueTypes.ts
import { client } from './client'
import type { IssueDetailResponse } from '../types/issue'
import type { IssueTypeResponse } from '../types/issueType'

export async function listIssueTypes(projectKey: string): Promise<IssueTypeResponse[]> {
  const { data } = await client.get<IssueTypeResponse[]>(`/projects/${projectKey}/types`)
  return data
}
export async function createIssueType(projectKey: string, body: { name: string; colorToken: string; icon: string }) {
  const { data } = await client.post<IssueTypeResponse>(`/projects/${projectKey}/types`, body)
  return data
}
export async function updateIssueType(projectKey: string, id: number, body: { name: string; colorToken: string; icon: string }) {
  const { data } = await client.patch<IssueTypeResponse>(`/projects/${projectKey}/types/${id}`, body)
  return data
}
export async function deleteIssueType(projectKey: string, id: number) {
  await client.delete<void>(`/projects/${projectKey}/types/${id}`)
}
export async function updateIssueTypeOf(projectKey: string, number: number, typeId: number) {
  const { data } = await client.patch<IssueDetailResponse>(
    `/projects/${projectKey}/issues/${number}/type`, { typeId })
  return data
}
```

- [ ] **Step 6: typecheck + Stage**

Run: `cd apps/workplace-web && pnpm typecheck`

```bash
git add apps/workplace-web/src/types/issueType.ts \
        apps/workplace-web/src/lib/issueTypeIcons.ts \
        apps/workplace-web/src/api/issueTypes.ts \
        apps/workplace-web/src/types/issue.ts \
        apps/workplace-web/src/lib/issueFilters.ts \
        apps/workplace-web/src/api/issues.ts
```

---

## Task 10: 프론트 — hooks + IssueTypeBadge + Popover

**Files:**
- Create: `apps/workplace-web/src/hooks/queries/useIssueTypes.ts`
- Create: `apps/workplace-web/src/hooks/queries/useUpdateIssueType.ts`
- Create: `apps/workplace-web/src/components/issueTypes/IssueTypeBadge.tsx`
- Create: `apps/workplace-web/src/components/issueTypes/IssueTypeSelectPopover.tsx`

- [ ] **Step 1: hooks**

```ts
// useIssueTypes.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createIssueType, deleteIssueType, listIssueTypes, updateIssueType,
} from '../../api/issueTypes'
import { handleApiError } from '../../lib/api-error'

export function useIssueTypes(projectKey: string) {
  return useQuery({
    queryKey: ['issueTypes', projectKey],
    queryFn: () => listIssueTypes(projectKey),
    enabled: !!projectKey,
  })
}

export function useCreateIssueType(projectKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { name: string; colorToken: string; icon: string }) => createIssueType(projectKey, b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['issueTypes', projectKey] }); toast.success('유형을 추가했습니다') },
    onError: (e) => handleApiError(e, '유형 추가에 실패했습니다'),
  })
}
export function useUpdateIssueTypeDef(projectKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: number; body: { name: string; colorToken: string; icon: string } }) =>
      updateIssueType(projectKey, v.id, v.body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['issueTypes', projectKey] }); toast.success('유형을 수정했습니다') },
    onError: (e) => handleApiError(e, '유형 수정에 실패했습니다'),
  })
}
export function useDeleteIssueType(projectKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteIssueType(projectKey, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issueTypes', projectKey] })
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] })
      toast.success('유형을 삭제했습니다')
    },
    onError: (e) => handleApiError(e, '유형 삭제에 실패했습니다'),
  })
}
```

```ts
// useUpdateIssueType.ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { updateIssueTypeOf } from '../../api/issueTypes'
import { handleApiError } from '../../lib/api-error'

export function useUpdateIssueType(projectKey: string, number: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (typeId: number) => updateIssueTypeOf(projectKey, number, typeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] })
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] })
      toast.success('유형을 변경했습니다')
    },
    onError: (e) => handleApiError(e, '유형 변경에 실패했습니다'),
  })
}
```

- [ ] **Step 2: IssueTypeBadge**

```tsx
// IssueTypeBadge.tsx
import { ISSUE_TYPE_ICONS } from '../../lib/issueTypeIcons'
import { LABEL_COLORS } from '../../lib/labelColors'
import type { IssueTypeSummary } from '../../types/issueType'
import type { ColorToken } from '../../types/label'

// 색상은 Phase 3a LABEL_COLORS 재사용, 아이콘은 정적 매핑.
// fallback: 잘못된 토큰/아이콘에 대해 GRAY + Circle.
export function IssueTypeBadge({
  type, size = 'md', iconOnly = false,
}: { type: IssueTypeSummary; size?: 'sm' | 'md'; iconOnly?: boolean }) {
  const c = LABEL_COLORS[type.colorToken as ColorToken] ?? LABEL_COLORS.GRAY
  const Icon = ISSUE_TYPE_ICONS[type.icon] ?? ISSUE_TYPE_ICONS.Circle
  const padding = size === 'sm' ? 'px-1 py-0 text-[10px]' : 'px-2 py-0.5 text-xs'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded ${padding} ${c.bg} ${c.text}`}
      aria-label={type.name}
      title={type.name}
      data-testid={`issue-type-badge-${type.id}`}
    >
      <Icon className="h-3 w-3" />
      {!iconOnly && type.name}
    </span>
  )
}
```

- [ ] **Step 3: IssueTypeSelectPopover**

```tsx
// IssueTypeSelectPopover.tsx
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useState } from 'react'

import { useIssueTypes } from '../../hooks/queries/useIssueTypes'
import { useUpdateIssueType } from '../../hooks/queries/useUpdateIssueType'
import type { IssueTypeSummary } from '../../types/issueType'
import { IssueTypeBadge } from './IssueTypeBadge'

// 단일 선택 픽커 — 항목 클릭 즉시 PATCH 후 close.
export function IssueTypeSelectPopover({
  projectKey, issueNumber, current,
}: { projectKey: string; issueNumber: number; current: IssueTypeSummary }) {
  const types = useIssueTypes(projectKey)
  const update = useUpdateIssueType(projectKey, issueNumber)
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="issue-type-trigger" aria-label="유형 변경">
          <IssueTypeBadge type={current} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" data-testid="issue-type-picker">
        <ul className="space-y-0.5">
          {(types.data ?? []).map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-accent ${
                  t.id === current.id ? 'bg-accent/50' : ''
                }`}
                data-testid={`issue-type-option-${t.id}`}
                onClick={() => {
                  if (t.id !== current.id) update.mutate(t.id)
                  setOpen(false)
                }}
              >
                <IssueTypeBadge type={{ id: t.id, name: t.name, colorToken: t.colorToken, icon: t.icon }} />
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 4: typecheck + Stage**

```bash
git add apps/workplace-web/src/hooks/queries/{useIssueTypes,useUpdateIssueType}.ts \
        apps/workplace-web/src/components/issueTypes/
```

---

## Task 11: 프론트 — IssueTypeManagement + ProjectSettingsPage

**Files:**
- Create: `apps/workplace-web/src/pages/projects/components/IssueTypeManagement.tsx`
- Modify: `apps/workplace-web/src/pages/projects/ProjectSettingsPage.tsx`

- [ ] **Step 1: IssueTypeManagement**

```tsx
// IssueTypeManagement.tsx
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge'
import { ISSUE_TYPE_ICONS } from '../../../lib/issueTypeIcons'
import { LABEL_COLORS } from '../../../lib/labelColors'
import {
  useCreateIssueType, useDeleteIssueType, useIssueTypes, useUpdateIssueTypeDef,
} from '../../../hooks/queries/useIssueTypes'
import { COLOR_TOKENS } from '../../../types/label'
import { ICON_NAMES, type IconName } from '../../../types/issueType'

// 프로젝트 유형 관리. OWNER 만 편집 노출. 시스템 4종 보호.
export function IssueTypeManagement({ projectKey, isOwner }: { projectKey: string; isOwner: boolean }) {
  const types = useIssueTypes(projectKey)
  const create = useCreateIssueType(projectKey)
  const update = useUpdateIssueTypeDef(projectKey)
  const del = useDeleteIssueType(projectKey)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>('BLUE')
  const [icon, setIcon] = useState<IconName>('Circle')

  async function onCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await create.mutateAsync({ name: trimmed, colorToken: color, icon })
      setName(''); setColor('BLUE'); setIcon('Circle')
    } catch { /* toast handled */ }
  }

  return (
    <section className="space-y-3" aria-label="이슈 유형 관리">
      <h2 className="text-lg font-semibold">이슈 유형</h2>

      {isOwner && (
        <form
          onSubmit={(e) => { e.preventDefault(); void onCreate() }}
          className="flex flex-wrap gap-2 items-end"
          data-testid="issue-type-create-form"
        >
          <div className="flex-1 min-w-[160px] space-y-1">
            <label className="text-sm font-medium" htmlFor="new-type-name">이름</label>
            <Input id="new-type-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">색상</label>
            <div role="group" aria-label="유형 색상" className="flex gap-1">
              {COLOR_TOKENS.map((tok) => (
                <button
                  key={tok} type="button" onClick={() => setColor(tok)}
                  aria-label={tok} aria-pressed={color === tok}
                  className={`h-6 w-6 rounded-full ${LABEL_COLORS[tok].dot} ${color === tok ? 'ring-2 ring-foreground' : ''}`}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">아이콘</label>
            <div role="group" aria-label="유형 아이콘" className="flex gap-1">
              {ICON_NAMES.map((n) => {
                const I = ISSUE_TYPE_ICONS[n]
                return (
                  <button
                    key={n} type="button" onClick={() => setIcon(n)}
                    aria-label={n} aria-pressed={icon === n}
                    data-testid={`issue-type-icon-${n}`}
                    className={`h-6 w-6 inline-flex items-center justify-center rounded-full border ${
                      icon === n ? 'ring-2 ring-foreground' : ''
                    }`}
                  ><I className="h-3 w-3" /></button>
                )
              })}
            </div>
          </div>
          <Button type="submit" disabled={create.isPending}>추가</Button>
        </form>
      )}

      {types.isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : (
        <ul className="space-y-1">
          {(types.data ?? []).map((t) => (
            <li key={t.id} className="flex items-center gap-2 border-b py-2" data-testid={`issue-type-row-${t.id}`}>
              <IssueTypeBadge type={{ id: t.id, name: t.name, colorToken: t.colorToken, icon: t.icon }} />
              {t.isSystem && <span className="text-xs text-muted-foreground">시스템</span>}
              {isOwner && !t.isSystem && (
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => {
                      const next = prompt('새 이름', t.name)
                      if (next && next.trim())
                        update.mutate({ id: t.id, body: { name: next.trim(), colorToken: t.colorToken, icon: t.icon } })
                    }}
                  >이름 변경</Button>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => { if (confirm('삭제하시겠습니까?')) del.mutate(t.id) }}
                  >삭제</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 2: ProjectSettingsPage 에 섹션 삽입**

LabelManagement 섹션 옆에 `<IssueTypeManagement projectKey={key} isOwner={isOwner} />` 추가.

- [ ] **Step 3: typecheck + Stage**

```bash
git add apps/workplace-web/src/pages/projects/components/IssueTypeManagement.tsx \
        apps/workplace-web/src/pages/projects/ProjectSettingsPage.tsx
```

---

## Task 12: 프론트 — IssueDetailPage / Card / List / CreateDialog / FilterBar / Timeline

**Files:**
- Modify: `apps/workplace-web/src/pages/projects/IssueDetailPage.tsx`
- Modify: `apps/workplace-web/src/pages/projects/components/IssueCard.tsx`
- Modify: `apps/workplace-web/src/pages/projects/components/IssueListView.tsx`
- Modify: `apps/workplace-web/src/pages/projects/components/IssueCreateDialog.tsx`
- Modify: `apps/workplace-web/src/pages/projects/components/IssueFilterBar.tsx`
- Modify: `apps/workplace-web/src/pages/projects/components/IssueActivityTimeline.tsx`

- [ ] **Step 1: IssueDetailPage — 제목 옆 picker**

```tsx
import { IssueTypeSelectPopover } from '../../components/issueTypes/IssueTypeSelectPopover'

// 제목 영역:
<div className="flex items-center gap-2">
  <IssueTypeSelectPopover
    projectKey={projectKey}
    issueNumber={number}
    current={detail.summary.type}
  />
  <h1 className="text-2xl font-semibold">{detail.summary.title}</h1>
</div>
```

- [ ] **Step 2: IssueCard — 아이콘만**

`IssueCard` 제목 라인 앞:
```tsx
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge'

<Link to={...} className="font-medium hover:underline truncate flex items-center gap-1">
  <IssueTypeBadge type={issue.type} size="sm" iconOnly />
  <span className="text-muted-foreground mr-1 font-mono text-xs">{identifier}</span>
  {issue.title}
</Link>
```

- [ ] **Step 3: IssueListView — 제목 셀 좌측 배지**

```tsx
<td>
  <div className="flex items-center gap-2">
    <IssueTypeBadge type={it.type} size="sm" />
    <Link to={...} className="font-medium hover:underline">{it.title}</Link>
  </div>
  {it.labels.length > 0 && (/* 기존 chip */)}
</td>
```

- [ ] **Step 4: IssueCreateDialog — 유형 select**

`useIssueTypes(projectKey)` 옵션. default value: 프로젝트 유형 목록에서 `name === 'TASK'` 인 id (없으면 첫 번째).

```tsx
<select
  value={typeId ?? ''}
  onChange={(e) => setTypeId(Number(e.target.value))}
  data-testid="create-type-select"
  aria-label="이슈 유형"
  className="border rounded p-2 bg-background"
>
  {(types.data ?? []).map((t) => (
    <option key={t.id} value={t.id}>{t.name}</option>
  ))}
</select>
```

submit payload 에 `typeId` 포함.

- [ ] **Step 5: IssueFilterBar — 유형 popover**

라벨 popover 옆에 동일 패턴 추가. 옵션은 `useIssueTypes(projectKey)`. URL key `type=`. 체크박스 다중.

```tsx
function toggleType(id: number) {
  const has = filters.typeIds.includes(id)
  writeFilters(
    { ...filters, typeIds: has ? filters.typeIds.filter((x) => x !== id) : [...filters.typeIds, id] },
    view,
  )
}
```

popover trigger label: `유형` / `유형 ({n})`, `data-testid="issue-type-filter-trigger"`, 각 옵션 `data-testid="issue-type-filter-option-{id}"`.

- [ ] **Step 6: IssueActivityTimeline — TYPE_CHANGED**

```tsx
function formatTypeChanged(toValue: string | null): string {
  if (!toValue) return '유형 변경'
  try {
    const p = JSON.parse(toValue) as { from?: { name: string }; to?: { name: string } }
    return `${p.from?.name ?? '?'} → ${p.to?.name ?? '?'}`
  } catch { return '유형 변경' }
}

// case 'TYPE_CHANGED':
//   label = '유형'
//   detailText = formatTypeChanged(event.toValue)
//   break
```

- [ ] **Step 7: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: SUCCESS.

- [ ] **Step 8: Stage**

```bash
git add apps/workplace-web/src/pages/projects/IssueDetailPage.tsx \
        apps/workplace-web/src/pages/projects/components/{IssueCard,IssueListView,IssueCreateDialog,IssueFilterBar,IssueActivityTimeline}.tsx
```

---

## Task 13: 프론트 — WatchedIssuesPage 배지 + 팩토리 + 잔재 정리

**Files:**
- Modify: `apps/workplace-web/src/pages/me/WatchedIssuesPage.tsx`
- Modify: `apps/workplace-web/e2e/factories/issue.factory.ts`
- Create: `apps/workplace-web/e2e/factories/issueType.factory.ts`

- [ ] **Step 1: WatchedIssuesPage 배지**

제목 셀에 `IssueTypeBadge size="sm"` 추가 (선택, 일관성 위해).

- [ ] **Step 2: issue.factory.ts**

```ts
import { makeTaskType } from './issueType.factory'

// createIssue 기본값에 type 추가:
type: over.type ?? makeTaskType(),
```

- [ ] **Step 3: issueType.factory.ts**

```ts
// e2e/factories/issueType.factory.ts
import type { IssueTypeResponse, IssueTypeSummary } from '../../src/types/issueType'

let nextId = 100

export function makeTaskType(): IssueTypeSummary {
  return { id: 1, name: 'TASK', colorToken: 'BLUE', icon: 'Circle' }
}

export function makeIssueType(over: Partial<IssueTypeResponse> = {}): IssueTypeResponse {
  const id = over.id ?? nextId++
  return {
    id,
    projectId: 1,
    name: over.name ?? `유형${id}`,
    colorToken: over.colorToken ?? 'BLUE',
    icon: over.icon ?? 'Circle',
    isSystem: over.isSystem ?? false,
    position: over.position ?? 99,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  }
}

export function systemTypes(): IssueTypeResponse[] {
  return [
    makeIssueType({ id: 1, name: 'TASK', colorToken: 'BLUE', icon: 'Circle', isSystem: true, position: 0 }),
    makeIssueType({ id: 2, name: 'BUG', colorToken: 'RED', icon: 'Bug', isSystem: true, position: 1 }),
    makeIssueType({ id: 3, name: 'STORY', colorToken: 'PURPLE', icon: 'BookOpen', isSystem: true, position: 2 }),
    makeIssueType({ id: 4, name: 'CHORE', colorToken: 'GRAY', icon: 'Wrench', isSystem: true, position: 3 }),
  ]
}
```

- [ ] **Step 4: 기존 spec 호환 점검**

`grep -rn 'assigneeId\|type:' apps/workplace-web/e2e/pages` — 기존 spec 의 issue mock 이 `type` 누락 시 빌드 에러. 팩토리만 update 했으므로 spec 의 직접 객체 생성 부분은 손볼 곳 없어야 함. typecheck 로 최종 검증.

- [ ] **Step 5: typecheck + Stage**

```bash
git add apps/workplace-web/src/pages/me/WatchedIssuesPage.tsx \
        apps/workplace-web/e2e/factories/issue.factory.ts \
        apps/workplace-web/e2e/factories/issueType.factory.ts
```

---

## Task 14: 프론트 — IssueCreateDialog 시그니처 보정 + zod 스키마 typeId

**Files:**
- Modify: `apps/workplace-web/src/lib/validations/issue.ts`

- [ ] **Step 1: createIssueSchema 에 typeId 추가**

```ts
export const createIssueSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().optional().nullable(),
  priority: z.enum(['LOW','MID','HIGH']).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  assigneeIds: z.array(z.number().int().positive()).optional().nullable(),
  typeId: z.number().int().positive().optional().nullable(),
})
```

- [ ] **Step 2: typecheck + Stage**

```bash
git add apps/workplace-web/src/lib/validations/issue.ts
```

---

## Task 15: E2E + 최종 회귀 + 단일 커밋

**Files:**
- Create: `apps/workplace-web/e2e/pages/projects/issue-types.spec.ts`

- [ ] **Step 1: issue-types.spec.ts**

```ts
// e2e/pages/projects/issue-types.spec.ts
import { expect, test } from '../../fixtures/auth.fixture'
import { createIssue } from '../../factories/issue.factory'
import { makeIssueType, systemTypes } from '../../factories/issueType.factory'

const KEY = 'WP'

test.describe('이슈 유형', () => {
  test('CUSTOM 추가 → 이슈 변경 → 배지 갱신', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    let types = systemTypes()
    const issue = { ...createIssue({ id: 1, number: 1, title: 't' }), type: types[0] }

    await page.route(`**/api/v1/projects/${KEY}`, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        id: 1, key: KEY, name: 'P', description: '', ownerId: 1, ownerName: 'T',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      })}))
    await page.route(`**/api/v1/projects/${KEY}/members`, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([{ userId: 1, username: 'me', name: 'Me', role: 'OWNER' }]) }))
    await page.route(`**/api/v1/projects/${KEY}/types`, async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(types) })
      }
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as { name: string; colorToken: string; icon: string }
        const t = makeIssueType({ name: body.name, colorToken: body.colorToken, icon: body.icon as never })
        types = [...types, t]
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(t) })
      }
      return route.continue()
    })
    await page.route(`**/api/v1/projects/${KEY}/issues/1`, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        summary: { ...issue, type: issue.type, assignees: [], labels: [], attachmentCount: 0 },
        body: '', comments: [], history: [], attachments: [],
      })}))
    await page.route(`**/api/v1/projects/${KEY}/issues/1/watchers`, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route(`**/api/v1/projects/${KEY}/issues/1/attachments`, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route(`**/api/v1/projects/${KEY}/labels`, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

    let patchPayload: unknown
    await page.route(`**/api/v1/projects/${KEY}/issues/1/type`, (route) => {
      patchPayload = route.request().postDataJSON()
      const tid = (patchPayload as { typeId: number }).typeId
      const newType = types.find((t) => t.id === tid)
      issue.type = newType ? { id: newType.id, name: newType.name, colorToken: newType.colorToken, icon: newType.icon } : issue.type
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        summary: { ...issue, assignees: [], labels: [], attachmentCount: 0 },
        body: '', comments: [], history: [], attachments: [],
      })})
    })

    // 1) 설정 페이지에서 CUSTOM 추가
    await page.goto(`/projects/${KEY}/settings`)
    await page.getByTestId('issue-type-create-form').getByLabel('이름').fill('디자인')
    await page.getByRole('button', { name: 'PURPLE' }).click()
    await page.getByTestId('issue-type-icon-Star').click()
    await page.getByTestId('issue-type-create-form').getByRole('button', { name: '추가' }).click()
    await expect(page.getByText('디자인')).toBeVisible()

    // 2) 이슈 상세에서 picker 로 디자인 선택
    await page.goto(`/projects/${KEY}/issues/1`)
    await page.getByTestId('issue-type-trigger').click()
    const designId = types.find((t) => t.name === '디자인')!.id
    await page.getByTestId(`issue-type-option-${designId}`).click()

    await expect.poll(() => patchPayload).toEqual({ typeId: designId })
    await expect(page.getByTestId(`issue-type-badge-${designId}`)).toBeVisible()
  })
})
```

- [ ] **Step 2: 전체 회귀**

Run: `cd apps/workplace-web && pnpm typecheck && pnpm test:e2e`
Run: `cd apps/workplace-api && ./gradlew test && ./gradlew spotlessApply`
둘 다 PASS.

- [ ] **Step 3: Stage**

```bash
git add apps/workplace-web/e2e/pages/projects/issue-types.spec.ts
```

- [ ] **Step 4: 단일 커밋**

```bash
git status
git diff --cached --stat
```

```bash
git commit -m "$(cat <<'EOF'
feat(repo): 이슈 유형 도입 — 시스템 4종 + 프로젝트별 CUSTOM

- 백엔드: V10 issue_type_def 테이블 + 시스템 4종 시드 + issue.type_id NOT NULL backfill
- 백엔드: IssueTypeService OWNER CRUD + 시스템 보호 + 사용 중 삭제 가드
- 백엔드: ProjectService.create 가 신규 프로젝트에 시스템 4종 자동 시드
- 백엔드: IssueResponse.type 신규 + IssueSearchService type CSV 필터 + N+1 batch
- 백엔드: PATCH /issues/{number}/type + TYPE_CHANGED history
- 프론트: IssueTypeBadge + Popover + Management 섹션, 카드/리스트/상세/필터 통합
- 활동 타임라인: TYPE_CHANGED 렌더링

#27

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

pre-commit 실패 시 `--amend`/`--no-verify` 금지, 새 commit. 최대 3회.

- [ ] **Step 5: 검증**

```bash
git log -1 --stat
```

---

## Self-Review

- 스펙 § 3 V10 (테이블 + 시드 + backfill + NOT NULL): Task 1 ✅
- 스펙 § 4.1 CRUD: Task 4·5 ✅
- 스펙 § 4.2 PATCH /type + TYPE_CHANGED: Task 7 ✅
- 스펙 § 4.3 응답 모양 + fromWithType: Task 6·8 ✅
- 스펙 § 4.4 IssueService.create typeId 처리: Task 7 ✅
- 스펙 § 4.5 검색 CSV + batch: Task 8 ✅
- 스펙 § 4.6 ProjectService 자동 시드: Task 5 ✅
- 스펙 § 4.7 에러 매핑 6종: Task 2 ✅
- 스펙 § 4.8 아이콘 화이트리스트: Task 2 ✅
- 스펙 § 5 프론트엔드 전체: Task 9·10·11·12·13·14 ✅
- 스펙 § 6 테스트: Task 2·3·4·5·7·8·15 ✅
- 단일 커밋: Task 15 ✅

플레이스홀더 스캔: TODO/TBD 없음. 시그니처 일관: `IssueTypeSummary` / `fromWithType` / `IssueTypeService.seedSystemTypes` / `useUpdateIssueType` / `IssueTypeBadge` 모두 도입 시점부터 동일.
