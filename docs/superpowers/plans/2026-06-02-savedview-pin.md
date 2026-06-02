# Saved View 사이드바 고정(pin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Saved View 를 사이드바에 고정(pin)해 어디서든 빠르게 접근한다 — 핀 토글 + 전역 사이드바 "고정된 뷰" 섹션.

**Architecture:** `saved_view` 는 이미 per-user(owner_id)·per-project 이므로 핀 상태를 별도 조인 테이블 없이 `saved_view.is_pinned` 불리언 컬럼(V24)으로 둔다. 본인 소유 뷰만 고정 가능(소유자 격리는 기존 서비스 체크 재사용). 토글은 `PATCH /projects/{key}/saved-views/{id}/pin`. 전역 사이드바(IssueSidebar)는 `GET /me/pinned-views`(saved_view⨝project)로 사용자의 모든 프로젝트 고정뷰를 한 목록으로 렌더하고, 항목 클릭 시 `/projects/{key}?{query}` 로 이동해 해당 뷰 필터를 적용한다.

**Tech Stack:** Spring Boot + jOOQ + Flyway(V24) / React 19 + TanStack Query + React Router v7 + shadcn/ui / Playwright E2E.

---

## 설계 결정 (확정)

1. **저장 = `saved_view.is_pinned` 불리언 컬럼 (V24).** 조인 테이블·타인 SHARED 뷰 개인고정은 YAGNI 제외. 본인 소유 뷰만 고정.
2. **사이드바 = 전역 "고정된 뷰" 섹션.** IssueSidebar(전역)에 모든 프로젝트의 고정뷰. 각 항목 클릭 → `/projects/{key}?{query}`.
3. **토글 UI = ViewChipBar 뷰 드롭다운(이미 `mine` 게이트)에 별 아이콘 항목.** 낙관적 불필요 — invalidate 로 갱신.
4. 재정렬 YAGNI 제외 — 고정뷰는 생성일 desc(또는 이름) 정렬.
5. 권한: pin 토글은 기존 `savedview:manage`. `/me/pinned-views` 는 `/me/*` 관례대로 무권한(인증만, 본인 데이터).

---

## File Structure

**백엔드 (`apps/workplace-api/src/main/java`)**
- `resources/db/migration/V24__saved_view_pin.sql` — **신규**. `is_pinned BOOLEAN NOT NULL DEFAULT FALSE` + 인덱스.
- `view/dto/SavedViewRow.java` — **수정**. `boolean pinned` 추가.
- `view/dto/SavedViewResponse.java` — **수정**. `boolean pinned` 추가.
- `view/repository/SavedViewRepository.java` — **수정**. mapToRow 가 IS_PINNED 읽기 + `setPinned(id, pinned)` + `findPinnedByUser(userId)`.
- `view/service/SavedViewService.java` — **수정**. `togglePin(callerId, key, id, pinned)` + toResponse 가 pinned 전달.
- `view/controller/SavedViewController.java` — **수정**. `PATCH /{id}/pin`.
- `view/dto/PinRequest.java` — **신규**. `record PinRequest(@NotNull Boolean pinned)`.
- `view/dto/PinnedSavedViewResponse.java` — **신규**. `(Long id, Long projectId, String projectKey, String projectName, String name, String query, Instant createdAt)`.
- `view/service/MePinnedViewService.java` — **신규**. `list(callerId)`.
- `view/controller/MePinnedViewsController.java` — **신규**. `GET /api/v1/me/pinned-views`.

**프론트 (`apps/workplace-web/src`)**
- `types/savedView.ts` — **수정**. `SavedViewResponse.pinned` + `PinnedSavedViewResponse`.
- `api/savedViews.ts` — **수정**. `pinSavedView`, `listMyPinnedViews`.
- `hooks/queries/useSavedViews.ts` — **수정**. `usePinSavedView`, `useMyPinnedViews`.
- `pages/projects/components/ViewChipBar.tsx` — **수정**. 드롭다운에 고정/해제 항목.
- `components/issue/IssueSidebar.tsx` — **수정**. "고정된 뷰" 섹션.

**테스트**
- `test/.../view/service/SavedViewServiceTest.java` — 수정/신규(togglePin 소유자 격리, list 의 pinned 반영).
- `test/.../view/service/MePinnedViewServiceTest.java` — 신규(프로젝트 교차 고정뷰).
- `apps/workplace-web/e2e/pages/projects/saved-view-pin.spec.ts` — 신규 E2E.

---

## Task 1: V24 마이그레이션 + jOOQ 재생성

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V24__saved_view_pin.sql`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- saved_view 고정(pin): per-user(owner_id) 뷰라 불리언 컬럼으로 충분 (조인 테이블 불필요)
ALTER TABLE saved_view ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

-- 사이드바 전역 고정뷰 조회(owner_id + is_pinned) 가속
CREATE INDEX idx_saved_view_owner_pinned ON saved_view(owner_id) WHERE is_pinned;
```

- [ ] **Step 2: 마이그레이션 적용 + jOOQ 재생성**

> 워크트리는 jOOQ 생성 소스(`src/main/generated/`, gitignore)가 없을 수 있다. DB 컨테이너가 떠 있는지 확인하고(`pnpm db:up` 은 사용자 승인 필요 없음 — 이미 떠 있으면 생략), 부트스트랩으로 현재 스키마 codegen 후 bootRun 으로 V24 적용, 다시 codegen 한다(Phase 1 과 동일 절차).

Run (from `apps/workplace-api`):
```bash
./gradlew generateJooq        # 기존 스키마로 부트스트랩 (컴파일 가능 상태)
./gradlew bootRun &           # V24 적용 (Flyway on boot); 기동 로그에 V24 확인 후 종료
# (또는 통합테스트 1개 실행으로 마이그레이션 적용) 
./gradlew generateJooq        # IS_PINNED 포함해 재생성
```
Expected: `SAVED_VIEW.IS_PINNED` 가 생성된 jOOQ Tables 에 존재. (생성 소스는 커밋하지 않음.)

- [ ] **Step 3: 커밋**

```bash
git add apps/workplace-api/src/main/resources/db/migration/V24__saved_view_pin.sql
git commit -m "feat(view): V24 saved_view.is_pinned 컬럼 — 사이드바 고정

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Row/Response 에 `pinned` 추가 (읽기 경로)

**Files:**
- Modify: `view/dto/SavedViewRow.java`, `view/dto/SavedViewResponse.java`
- Modify: `view/repository/SavedViewRepository.java` (mapToRow)
- Modify: `view/service/SavedViewService.java` (toResponse)

- [ ] **Step 1: SavedViewRow 에 pinned 추가**

기존:
```java
public record SavedViewRow(
    Long id, Long projectId, Long ownerId, String name, String query,
    String visibility, Instant createdAt, Instant updatedAt) {}
```
변경(`visibility` 다음에 `boolean pinned`):
```java
public record SavedViewRow(
    Long id, Long projectId, Long ownerId, String name, String query,
    String visibility, boolean pinned, Instant createdAt, Instant updatedAt) {}
```

- [ ] **Step 2: SavedViewResponse 에 pinned 추가**

기존:
```java
public record SavedViewResponse(
    Long id, String name, String query, String visibility, Long ownerId,
    boolean mine, Instant createdAt, Instant updatedAt) {}
```
변경(`mine` 다음에 `boolean pinned`):
```java
public record SavedViewResponse(
    Long id, String name, String query, String visibility, Long ownerId,
    boolean mine, boolean pinned, Instant createdAt, Instant updatedAt) {}
```

- [ ] **Step 3: 리포지토리 mapToRow 가 IS_PINNED 읽기**

`SavedViewRepository.mapToRow` 의 `new SavedViewRow(...)` 에 `r.get(SAVED_VIEW.IS_PINNED)` 를 `visibility` 다음 위치에 추가:
```java
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
        Boolean.TRUE.equals(r.get(SAVED_VIEW.IS_PINNED)),
        created != null ? created.toInstant() : null,
        updated != null ? updated.toInstant() : null);
  }
```
> `findVisible`/`findById` 는 `selectFrom(SAVED_VIEW)` 라 IS_PINNED 자동 포함 — 쿼리 수정 불필요.

- [ ] **Step 4: 서비스 toResponse 가 pinned 전달**

`SavedViewService.toResponse`:
```java
  private static SavedViewResponse toResponse(SavedViewRow r, Long callerId) {
    return new SavedViewResponse(
        r.id(), r.name(), r.query(), r.visibility(), r.ownerId(),
        r.ownerId().equals(callerId), r.pinned(), r.createdAt(), r.updatedAt());
  }
```

- [ ] **Step 5: 컴파일 확인 + 커밋**

Run: `./gradlew compileJava` → SUCCESS.
```bash
git add apps/workplace-api/src/main/java/com/workplace/view/dto/SavedViewRow.java \
        apps/workplace-api/src/main/java/com/workplace/view/dto/SavedViewResponse.java \
        apps/workplace-api/src/main/java/com/workplace/view/repository/SavedViewRepository.java \
        apps/workplace-api/src/main/java/com/workplace/view/service/SavedViewService.java
git commit -m "feat(view): SavedView 응답에 pinned 노출 (읽기 경로)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 핀 토글 — repository.setPinned + service.togglePin + PATCH 엔드포인트

**Files:**
- Create: `view/dto/PinRequest.java`
- Modify: `view/repository/SavedViewRepository.java`, `view/service/SavedViewService.java`, `view/controller/SavedViewController.java`
- Test: `view/service/SavedViewServiceTest.java`

- [ ] **Step 1: 실패 테스트 작성**

`SavedViewServiceTest` 는 통합 테스트(@Transactional 롤백 — 메모: SavedViewServiceTest 는 트랜잭션 격리). 기존 시드 헬퍼(프로젝트/멤버/뷰 생성) 패턴을 그대로 사용. 추가:

```java
  @Test
  void togglePin_setsPinned_andReflectedInList() {
    var seed = seedProjectWithOwnerAndView(); // ownerId, projectKey, viewId (mine, PRIVATE)
    service.togglePin(seed.ownerId(), seed.projectKey(), seed.viewId(), true);
    var view = service.list(seed.ownerId(), seed.projectKey()).stream()
        .filter(v -> v.id().equals(seed.viewId())).findFirst().orElseThrow();
    assertThat(view.pinned()).isTrue();

    service.togglePin(seed.ownerId(), seed.projectKey(), seed.viewId(), false);
    var after = service.list(seed.ownerId(), seed.projectKey()).stream()
        .filter(v -> v.id().equals(seed.viewId())).findFirst().orElseThrow();
    assertThat(after.pinned()).isFalse();
  }

  @Test
  void togglePin_othersPrivateView_throwsNotFound() {
    var seed = seedProjectWithOwnerAndView();    // owner 의 PRIVATE 뷰
    Long otherMember = seedExtraMember(seed.projectKey()); // 같은 프로젝트 다른 멤버
    assertThatThrownBy(() ->
        service.togglePin(otherMember, seed.projectKey(), seed.viewId(), true))
        .isInstanceOf(SavedViewNotFoundException.class);
  }
```
> 시드 헬퍼명은 파일의 기존 헬퍼에 맞춘다(직접 만들었다면 `project_member`·`saved_view` insert + 고유 토큰). PRIVATE 뷰는 타인에게 404(`hidePrivateFromOthers`).

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'com.workplace.view.service.SavedViewServiceTest'`
Expected: 컴파일 실패 — `service.togglePin` 없음.

- [ ] **Step 3: PinRequest DTO**

```java
package com.workplace.view.dto;

import jakarta.validation.constraints.NotNull;

/** 저장된 뷰 고정/해제 요청. */
public record PinRequest(@NotNull Boolean pinned) {}
```

- [ ] **Step 4: repository.setPinned**

`SavedViewRepository` 에 추가(import `OffsetDateTime` 이미 있음):
```java
  /** 뷰 고정/해제. updated_at 갱신. */
  public void setPinned(Long id, boolean pinned) {
    dsl.update(SAVED_VIEW)
        .set(SAVED_VIEW.IS_PINNED, pinned)
        .set(SAVED_VIEW.UPDATED_AT, OffsetDateTime.now())
        .where(SAVED_VIEW.ID.eq(id))
        .execute();
  }
```

- [ ] **Step 5: service.togglePin (소유자 격리 재사용)**

`SavedViewService` 에 추가:
```java
  /** 저장된 뷰 고정/해제. 본인 소유 뷰만 가능. */
  public SavedViewResponse togglePin(
      Long callerId, String projectKey, Long viewId, boolean pinned) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row = loadInProject(viewId, project.id());
    hidePrivateFromOthers(row, callerId);
    if (!row.ownerId().equals(callerId)) {
      throw new SavedViewAccessDeniedException("본인의 뷰만 고정할 수 있습니다");
    }
    repository.setPinned(viewId, pinned);
    return toResponse(repository.findById(viewId).orElseThrow(), callerId);
  }
```

- [ ] **Step 6: 컨트롤러 PATCH /{id}/pin**

`SavedViewController` 에 추가(import `PinRequest`):
```java
  @PatchMapping("/{id}/pin")
  @RequirePermission("savedview:manage")
  public ResponseEntity<SavedViewResponse> pin(
      Authentication auth,
      @PathVariable String key,
      @PathVariable Long id,
      @Valid @RequestBody PinRequest req) {
    return ResponseEntity.ok(
        service.togglePin((Long) auth.getPrincipal(), key, id, req.pinned()));
  }
```

- [ ] **Step 7: 통과 확인 + 커밋**

Run: `./gradlew test --tests 'com.workplace.view.service.SavedViewServiceTest'` → PASS.
```bash
git add apps/workplace-api/src/main/java/com/workplace/view/dto/PinRequest.java \
        apps/workplace-api/src/main/java/com/workplace/view/repository/SavedViewRepository.java \
        apps/workplace-api/src/main/java/com/workplace/view/service/SavedViewService.java \
        apps/workplace-api/src/main/java/com/workplace/view/controller/SavedViewController.java \
        apps/workplace-api/src/test/java/com/workplace/view/service/SavedViewServiceTest.java
git commit -m "feat(view): 저장된 뷰 고정 토글 PATCH /saved-views/{id}/pin (소유자만)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 전역 고정뷰 — GET /api/v1/me/pinned-views

**Files:**
- Create: `view/dto/PinnedSavedViewResponse.java`, `view/service/MePinnedViewService.java`, `view/controller/MePinnedViewsController.java`
- Modify: `view/repository/SavedViewRepository.java` (findPinnedByUser)
- Test: `view/service/MePinnedViewServiceTest.java`

- [ ] **Step 1: 실패 테스트 작성**

```java
package com.workplace.view.service;

import static org.assertj.core.api.Assertions.assertThat;
// ... 기존 통합 테스트 베이스/시드 헬퍼 import

class MePinnedViewServiceTest extends IntegrationTestBase { // 실제 베이스에 맞춤

  @org.springframework.beans.factory.annotation.Autowired MePinnedViewService service;
  @org.springframework.beans.factory.annotation.Autowired SavedViewService savedViewService;

  @Test
  void list_returnsPinnedAcrossProjects_withProjectKey() {
    // 두 프로젝트 P1,P2 에 owner 의 뷰 각각 생성 후 둘 다 고정
    var s = seedTwoProjectsTwoViews(); // ownerId, p1Key, v1Id, p2Key, v2Id
    savedViewService.togglePin(s.ownerId(), s.p1Key(), s.v1Id(), true);
    savedViewService.togglePin(s.ownerId(), s.p2Key(), s.v2Id(), true);

    var pinned = service.list(s.ownerId());
    assertThat(pinned).extracting(PinnedSavedViewResponse::projectKey)
        .contains(s.p1Key(), s.p2Key());
    assertThat(pinned).allSatisfy(p -> {
      assertThat(p.query()).isNotNull();
      assertThat(p.name()).isNotBlank();
      assertThat(p.projectName()).isNotBlank();
    });
  }
```
> @Transactional 격리 + 고유 토큰. 시드 헬퍼는 기존 패턴 따름.

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'com.workplace.view.service.MePinnedViewServiceTest'`
Expected: 컴파일 실패.

- [ ] **Step 3: PinnedSavedViewResponse DTO**

```java
package com.workplace.view.dto;

import java.time.Instant;

/** 사용자의 고정뷰(프로젝트 교차). 사이드바 렌더용 — projectKey 로 이동 링크 구성. */
public record PinnedSavedViewResponse(
    Long id,
    Long projectId,
    String projectKey,
    String projectName,
    String name,
    String query,
    Instant createdAt) {}
```

- [ ] **Step 4: repository.findPinnedByUser (project 조인)**

`SavedViewRepository` 에 추가(static import `import static com.workplace.jooq.Tables.PROJECT;` 필요, import `PinnedSavedViewResponse`):
```java
  /** 사용자의 모든 프로젝트 고정뷰 (project 조인, 삭제 프로젝트 제외). */
  public List<PinnedSavedViewResponse> findPinnedByUser(Long userId) {
    return dsl.select(
            SAVED_VIEW.ID, SAVED_VIEW.PROJECT_ID, PROJECT.KEY, PROJECT.NAME,
            SAVED_VIEW.NAME, SAVED_VIEW.QUERY, SAVED_VIEW.CREATED_AT)
        .from(SAVED_VIEW)
        .join(PROJECT).on(SAVED_VIEW.PROJECT_ID.eq(PROJECT.ID))
        .where(SAVED_VIEW.OWNER_ID.eq(userId)
            .and(SAVED_VIEW.IS_PINNED.isTrue())
            .and(PROJECT.DELETED_AT.isNull()))
        .orderBy(SAVED_VIEW.CREATED_AT.desc())
        .fetch(r -> {
          OffsetDateTime created = r.get(SAVED_VIEW.CREATED_AT);
          return new PinnedSavedViewResponse(
              r.get(SAVED_VIEW.ID), r.get(SAVED_VIEW.PROJECT_ID),
              r.get(PROJECT.KEY), r.get(PROJECT.NAME),
              r.get(SAVED_VIEW.NAME), r.get(SAVED_VIEW.QUERY),
              created != null ? created.toInstant() : null);
        });
  }
```

- [ ] **Step 5: MePinnedViewService**

```java
package com.workplace.view.service;

import com.workplace.view.dto.PinnedSavedViewResponse;
import com.workplace.view.repository.SavedViewRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 사용자의 프로젝트 교차 고정뷰 조회(사이드바). */
@Service
@RequiredArgsConstructor
public class MePinnedViewService {

  private final SavedViewRepository repository;

  @Transactional(readOnly = true)
  public List<PinnedSavedViewResponse> list(Long callerId) {
    return repository.findPinnedByUser(callerId);
  }
}
```

- [ ] **Step 6: MePinnedViewsController**

```java
package com.workplace.view.controller;

import com.workplace.view.dto.PinnedSavedViewResponse;
import com.workplace.view.service.MePinnedViewService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 사용자의 고정뷰(프로젝트 교차) — 사이드바 전역 섹션. /me/* 관례대로 인증만. */
@RestController
@RequiredArgsConstructor
public class MePinnedViewsController {

  private final MePinnedViewService service;

  @GetMapping("/api/v1/me/pinned-views")
  public ResponseEntity<List<PinnedSavedViewResponse>> list(
      @AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(service.list(callerId));
  }
}
```

- [ ] **Step 7: 통과 확인 + 커밋**

Run: `./gradlew test --tests 'com.workplace.view.service.MePinnedViewServiceTest'` → PASS. `./gradlew compileJava` clean.
```bash
git add apps/workplace-api/src/main/java/com/workplace/view/dto/PinnedSavedViewResponse.java \
        apps/workplace-api/src/main/java/com/workplace/view/service/MePinnedViewService.java \
        apps/workplace-api/src/main/java/com/workplace/view/controller/MePinnedViewsController.java \
        apps/workplace-api/src/main/java/com/workplace/view/repository/SavedViewRepository.java \
        apps/workplace-api/src/test/java/com/workplace/view/service/MePinnedViewServiceTest.java
git commit -m "feat(view): GET /me/pinned-views — 프로젝트 교차 고정뷰(사이드바)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 프론트 타입 + API + 훅

**Files:**
- Modify: `types/savedView.ts`, `api/savedViews.ts`, `hooks/queries/useSavedViews.ts`

- [ ] **Step 1: 타입**

`types/savedView.ts` 의 `SavedViewResponse` 에 `pinned: boolean;` 추가(`mine` 다음). 그리고 추가:
```typescript
export interface PinnedSavedViewResponse {
  id: number;
  projectId: number;
  projectKey: string;
  projectName: string;
  name: string;
  query: string;
  createdAt: string;
}
```

- [ ] **Step 2: API**

`api/savedViews.ts` 에 추가:
```typescript
import type {
  SavedViewResponse,
  SaveViewRequest,
  PinnedSavedViewResponse,
} from '../types/savedView';

export async function pinSavedView(
  projectKey: string,
  id: number,
  pinned: boolean,
): Promise<SavedViewResponse> {
  const { data } = await client.patch<SavedViewResponse>(
    `/projects/${projectKey}/saved-views/${id}/pin`,
    { pinned },
  );
  return data;
}

export async function listMyPinnedViews(): Promise<PinnedSavedViewResponse[]> {
  const { data } = await client.get<PinnedSavedViewResponse[]>('/me/pinned-views');
  return data;
}
```

- [ ] **Step 3: 훅**

`hooks/queries/useSavedViews.ts` 에 추가(import `pinSavedView`, `listMyPinnedViews`):
```typescript
export function useMyPinnedViews() {
  return useQuery({
    queryKey: ['pinnedViews'],
    queryFn: listMyPinnedViews,
  });
}

export function usePinSavedView(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; pinned: boolean }) =>
      pinSavedView(projectKey, v.id, v.pinned),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['savedViews', projectKey] });
      qc.invalidateQueries({ queryKey: ['pinnedViews'] });
      toast.success(v.pinned ? '사이드바에 고정했습니다' : '고정을 해제했습니다');
    },
    onError: (e) => handleApiError(e, '고정 변경에 실패했습니다'),
  });
}
```

- [ ] **Step 4: 타입체크 + 커밋**

Run: `cd apps/workplace-web && pnpm typecheck` → 0 errors.
```bash
git add apps/workplace-web/src/types/savedView.ts apps/workplace-web/src/api/savedViews.ts apps/workplace-web/src/hooks/queries/useSavedViews.ts
git commit -m "feat(web): saved view pin API/훅 (pinSavedView, useMyPinnedViews)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: ViewChipBar 드롭다운에 고정/해제

**Files:**
- Modify: `pages/projects/components/ViewChipBar.tsx`

- [ ] **Step 1: 핀 토글 항목 추가**

`usePinSavedView` 를 import/사용하고, `mine` 게이트된 DropdownMenuContent 안 수정/삭제 위에 고정 토글 항목을 추가. `Star`(lucide-react) 아이콘:
```tsx
// 상단: const pin = usePinSavedView(projectKey)
// 드롭다운 메뉴 안 (수정 위):
<DropdownMenuItem
  data-testid={`view-pin-${v.id}`}
  onSelect={() => pin.mutate({ id: v.id, pinned: !v.pinned })}
>
  <Star className={cn('mr-2 h-4 w-4', v.pinned && 'fill-current')} />
  {v.pinned ? '고정 해제' : '사이드바에 고정'}
</DropdownMenuItem>
```
> `Star` import 추가. `v.pinned` 는 Task 5 로 타입에 존재. 칩 자체에 고정 표시를 원하면 `v.pinned && <Star className="h-3 w-3 fill-current" />` 를 칩 라벨 옆에 추가(선택).

- [ ] **Step 2: 타입체크 + 커밋**

Run: `pnpm --filter workplace-web typecheck` → 0 errors.
```bash
git add apps/workplace-web/src/pages/projects/components/ViewChipBar.tsx
git commit -m "feat(web): ViewChipBar 뷰 드롭다운에 사이드바 고정 토글

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: IssueSidebar "고정된 뷰" 섹션

**Files:**
- Modify: `components/issue/IssueSidebar.tsx`

- [ ] **Step 1: 고정뷰 섹션 추가**

`useMyPinnedViews` 를 사용해 프로젝트 섹션 위(개인 섹션 다음)에 "고정된 뷰" 섹션을 렌더. 항목 클릭 → `/projects/{key}?{query}`:
```tsx
// import
import { useMyPinnedViews } from '@/hooks/queries/useSavedViews'
import { Star } from 'lucide-react'
// 본문 상단: const pinned = useMyPinnedViews()

// 개인 섹션(nav)과 프로젝트 섹션 사이에 삽입:
{(pinned.data?.length ?? 0) > 0 && (
  <div className="mt-5" data-testid="sidebar-pinned-views">
    <div className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      고정된 뷰
    </div>
    <nav className="mt-2 space-y-1">
      {(pinned.data ?? []).map((v) => (
        <NavLink
          key={v.id}
          to={`/projects/${v.projectKey}?${v.query}`}
          data-testid={`pinned-view-${v.id}`}
          className={sidebarLinkClass}
        >
          <Star className="h-4 w-4 shrink-0 fill-current text-muted-foreground" />
          <span className="truncate">{v.name}</span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{v.projectKey}</span>
        </NavLink>
      ))}
    </nav>
  </div>
)}
```
> `v.query` 는 URLSearchParams 문자열(예 `priority=HIGH&status=OPEN`). NavLink `to` 에 `?` 로 직접 부착. NavLink active 매칭은 pathname 기준이라 같은 프로젝트의 여러 고정뷰가 동시에 active 로 보일 수 있으나 v1 허용(YAGNI).

- [ ] **Step 2: 타입체크 + 커밋**

Run: `pnpm --filter workplace-web typecheck` → 0 errors.
```bash
git add apps/workplace-web/src/components/issue/IssueSidebar.tsx
git commit -m "feat(web): IssueSidebar 고정된 뷰 섹션 — 프로젝트 교차 빠른 접근

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: E2E — 고정 토글 + 사이드바 노출 + 이동

**Files:**
- Create: `apps/workplace-web/e2e/pages/projects/saved-view-pin.spec.ts`

- [ ] **Step 1: 실패 E2E 작성**

기존 `e2e/pages/projects/saved-views.spec.ts` 의 fixture/mock/testid 관례를 따른다. 검증: (a) 드롭다운에서 "사이드바에 고정" 클릭 → `PATCH .../saved-views/{id}/pin` payload `{pinned:true}`, (b) `/me/pinned-views` 가 그 뷰 반환 → 사이드바에 `pinned-view-{id}` 노출, (c) 클릭 시 `/projects/{key}?{query}` 로 이동.

```typescript
import { test, expect } from '../../fixtures/auth.fixture';

test.describe('Saved View 사이드바 고정', () => {
  const KEY = 'WP';
  test('고정 토글 → 사이드바 노출 → 이동', { tag: '@smoke' }, async ({ page }) => {
    // 프로젝트 목록(사이드바) + 상세 + 저장뷰 목록 mock
    await page.route('**/api/v1/projects?*', (r) => r.fulfill({ json: {
      content: [{ id: 1, key: KEY, name: '워크플레이스', description: null, ownerId: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      page: 0, size: 20, totalElements: 1, totalPages: 1 } }));
    let pinned = false;
    await page.route(`**/api/v1/projects/${KEY}/saved-views`, (r) => r.fulfill({ json: [
      { id: 10, name: '높은 우선순위', query: 'priority=HIGH', visibility: 'PRIVATE', ownerId: 1, mine: true, pinned, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ] }));
    await page.route(`**/api/v1/projects/${KEY}/saved-views/10/pin`, async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ pinned: true }); // (a)
      pinned = true;
      await route.fulfill({ json: { id: 10, name: '높은 우선순위', query: 'priority=HIGH', visibility: 'PRIVATE', ownerId: 1, mine: true, pinned: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
    });
    await page.route('**/api/v1/me/pinned-views', (r) => r.fulfill({ json: pinned ? [
      { id: 10, projectId: 1, projectKey: KEY, projectName: '워크플레이스', name: '높은 우선순위', query: 'priority=HIGH', createdAt: new Date().toISOString() },
    ] : [] }));
    // 이슈 검색 등 상세 페이지 부수 호출은 기존 fixture 기본 stub 사용(필요 시 보강).

    await page.goto(`/projects/${KEY}`);
    await page.getByTestId('view-chip-menu-10').click();
    await page.getByTestId('view-pin-10').click();
    // (b) 사이드바 노출
    await expect(page.getByTestId('pinned-view-10')).toBeVisible();
    // (c) 이동
    await page.getByTestId('pinned-view-10').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?priority=HIGH`));
  });
});
```
> 실제 이슈 상세 라우트의 부수 API(이슈 검색/멤버/타입 등)는 기존 `saved-views.spec.ts` 가 거는 mock 집합을 참고해 누락 없이 stub. 셀렉터/경로는 실제 구현에 맞춰 조정.

- [ ] **Step 2: 통과까지 실행/조정**

Run: `cd apps/workplace-web && pnpm test:e2e -- saved-view-pin`
Expected: PASS. (ECONNREFUSED flake 시 재시도.)

- [ ] **Step 3: 커밋**

```bash
git add apps/workplace-web/e2e/pages/projects/saved-view-pin.spec.ts
git commit -m "test(web): Saved View 사이드바 고정 E2E (토글 payload + 노출 + 이동)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**스펙 커버리지** (이슈 #57 = "핀 토글 + 사이드바 고정뷰 목록 렌더"):
- 핀 토글 → T1(컬럼)·T3(엔드포인트)·T6(UI). ✓
- 사이드바 고정뷰 목록 → T4(/me/pinned-views)·T7(섹션). ✓

**Placeholder 스캔:** 모든 코드 스텝에 실코드. "조정"은 시드 헬퍼명·E2E 부수 mock·셀렉터 등 환경 의존부 한정. ✓

**타입 일관성:**
- `SavedViewRow`(…, visibility, pinned, createdAt, updatedAt) — T2 정의, mapToRow 동일 순서. ✓
- `SavedViewResponse`(…, mine, pinned, createdAt, updatedAt) — T2 정의, toResponse·프론트 타입 일치. ✓
- `togglePin(Long, String, Long, boolean) -> SavedViewResponse` — T3 정의, 컨트롤러·테스트 사용. ✓
- `PinnedSavedViewResponse{id,projectId,projectKey,projectName,name,query,createdAt}` 백/프론트 일치. ✓
- 프론트 `usePinSavedView({id,pinned})`·`useMyPinnedViews()` ['pinnedViews'] — T5 정의, T6/T7 사용. ✓

**열린 위험:** (a) jOOQ 재생성(T1)이 IS_PINNED 를 포함해야 이후 컴파일 가능 — 절차 명시. (b) SavedViewServiceTest 실제 시드 헬퍼명 — 구현자가 파일 확인 후 맞춤. (c) E2E 이슈 상세 부수 mock 누락 시 페이지 깨짐 — 기존 saved-views.spec.ts 참고.
