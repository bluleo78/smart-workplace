# Phase 5c-3: AGENT 코멘트/타임라인 시각 구분 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AGENT 가 작성한 코멘트와 활동 이력을 USER 와 시각적으로 구분하는 UI 를 추가. 백엔드 두 응답 DTO 에 `kind` 필드를 노출하고, 프론트엔드 두 컴포넌트에서 AGENT 분기 스타일링을 적용한다.

**Architecture:** 백엔드는 `IssueCommentResponse`/`IssueHistoryEntryResponse` 에 `kind` 필드 추가 (Repository JOIN 은 기존, SELECT 컬럼만 늘림). 프론트는 `IssueCommentList`/`IssueActivityTimeline` 에서 `kind === 'AGENT'` 분기로 파란 테두리 + 옅은 배경 틴트 + 텍스트 "AI" 배지를 부착한다.

**Tech Stack:** Spring Boot + jOOQ (workplace-api), React 19 + Tailwind 4 + shadcn `Badge` (workplace-web), Playwright (E2E), JUnit + MockMvc (백엔드 테스트).

**Spec:** `docs/superpowers/specs/2026-05-28-agent-visual-distinction-design.md`

---

## File Structure

### 백엔드 (workplace-api)
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueCommentResponse.java` — `authorKind` 필드 추가
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueHistoryEntryResponse.java` — `actorKind` 필드 추가
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueCommentRepository.java` — SELECT 에 `USER.KIND` 추가, mapper 갱신
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueHistoryRepository.java` — 동일
- Modify: `apps/workplace-api/src/test/java/com/workplace/issue/controller/IssueCommentControllerTest.java` — `sampleComment()` 시그니처 보정 + `authorKind` assertion 1건 추가
- (참고) 다른 테스트에서 `new IssueCommentResponse(...)` / `new IssueHistoryEntryResponse(...)` 를 직접 호출하는 곳이 있다면 컴파일 오류 → 보정

### 프론트엔드 (workplace-web)
- Modify: `apps/workplace-web/src/types/issue.ts` — `IssueCommentResponse.authorKind`, `IssueHistoryEntry.actorKind` 추가
- Modify: `apps/workplace-web/src/pages/projects/components/IssueCommentList.tsx` — AGENT 분기
- Modify: `apps/workplace-web/src/pages/projects/components/IssueActivityTimeline.tsx` — AGENT 분기
- Modify: `apps/workplace-web/e2e/factories/issue.factory.ts` — 팩토리 기본값 + AGENT 헬퍼
- Create: `apps/workplace-web/e2e/pages/projects/agent-visual.spec.ts` — 코멘트/타임라인 AGENT 시각 구분 2 케이스

---

## Task 1: 백엔드 DTO 확장 (`authorKind` / `actorKind`)

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueCommentResponse.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueHistoryEntryResponse.java`

- [ ] **Step 1: `IssueCommentResponse` 에 `authorKind` 추가**

`apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueCommentResponse.java` 전체 내용을 아래로 교체:

```java
package com.workplace.issue.dto;

import java.time.Instant;

/** 이슈 코멘트 응답 DTO. 작성자 표시 이름 + kind 포함 (USER/AGENT 시각 구분용). */
public record IssueCommentResponse(
    Long id,
    Long issueId,
    Long authorId,
    String authorName,
    String authorKind,
    String body,
    Instant createdAt,
    Instant updatedAt) {}
```

- [ ] **Step 2: `IssueHistoryEntryResponse` 에 `actorKind` 추가**

`apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueHistoryEntryResponse.java` 전체 내용을 아래로 교체:

```java
package com.workplace.issue.dto;

import java.time.Instant;

/** 이슈 히스토리 한 건 응답 DTO. actor 표시 이름 + kind 포함 (USER/AGENT 시각 구분용). */
public record IssueHistoryEntryResponse(
    Long id,
    Long actorId,
    String actorName,
    String actorKind,
    String eventType,
    String fromValue,
    String toValue,
    Instant createdAt) {}
```

- [ ] **Step 3: 컴파일 확인 (이 시점에서는 매퍼/테스트가 깨질 것)**

Run: `cd apps/workplace-api && ./gradlew compileJava 2>&1 | tail -30`
Expected: Repository 와 Test 에서 매개변수 개수 mismatch 컴파일 에러. 의도된 상태 (다음 task 에서 수정).

---

## Task 2: 백엔드 Repository SELECT + mapper 갱신

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueCommentRepository.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueHistoryRepository.java`

- [ ] **Step 1: `IssueCommentRepository` — SELECT 에 `USER.KIND` 추가, mapper 보정**

`mapToResponse` 메서드:
```java
  /** SELECT 결과를 {@link IssueCommentResponse} 로 매핑. user.name/kind JOIN 포함. */
  private IssueCommentResponse mapToResponse(Record r) {
    OffsetDateTime created = r.get(ISSUE_COMMENT.CREATED_AT);
    OffsetDateTime updated = r.get(ISSUE_COMMENT.UPDATED_AT);
    return new IssueCommentResponse(
        r.get(ISSUE_COMMENT.ID),
        r.get(ISSUE_COMMENT.ISSUE_ID),
        r.get(ISSUE_COMMENT.AUTHOR_ID),
        r.get(USER.NAME),
        r.get(USER.KIND),
        r.get(ISSUE_COMMENT.BODY),
        created != null ? created.toInstant() : null,
        updated != null ? updated.toInstant() : null);
  }
```

`findById` 의 select 절: `USER.NAME,` 바로 뒤에 `USER.KIND,` 한 줄 추가.
`findByIssue` 의 select 절: 동일하게 `USER.NAME,` 뒤에 `USER.KIND,` 추가.

- [ ] **Step 2: `IssueHistoryRepository` — SELECT 에 `USER.KIND` 추가, mapper 보정**

`mapToResponse`:
```java
  /** SELECT 결과를 {@link IssueHistoryEntryResponse} 로 매핑. user.name/kind JOIN 포함. */
  private IssueHistoryEntryResponse mapToResponse(Record r) {
    OffsetDateTime created = r.get(ISSUE_HISTORY.CREATED_AT);
    return new IssueHistoryEntryResponse(
        r.get(ISSUE_HISTORY.ID),
        r.get(ISSUE_HISTORY.ACTOR_ID),
        r.get(USER.NAME),
        r.get(USER.KIND),
        r.get(ISSUE_HISTORY.EVENT_TYPE),
        r.get(ISSUE_HISTORY.FROM_VALUE),
        r.get(ISSUE_HISTORY.TO_VALUE),
        created != null ? created.toInstant() : null);
  }
```

`findByIssue` 의 select: `USER.NAME,` 뒤에 `USER.KIND,` 추가.

- [ ] **Step 3: 컴파일 확인**

Run: `cd apps/workplace-api && ./gradlew compileJava 2>&1 | tail -10`
Expected: 컴파일 성공. 테스트는 아직 깨진 상태.

---

## Task 3: 백엔드 테스트 보정 + AGENT assertion

**Files:**
- Modify: `apps/workplace-api/src/test/java/com/workplace/issue/controller/IssueCommentControllerTest.java`
- (필요 시) 다른 테스트 파일 — `new IssueCommentResponse(...)` / `new IssueHistoryEntryResponse(...)` 직접 호출 위치

- [ ] **Step 1: 직접 생성자 호출 위치 전수조사**

Run: `cd apps/workplace-api && grep -rn "new IssueCommentResponse(\|new IssueHistoryEntryResponse(" src/test --include="*.java"`
각 라인을 새 시그니처에 맞게 보정 — 코멘트는 5번째 인자로 `"USER"`, 히스토리는 4번째 인자로 `"USER"` 삽입.

- [ ] **Step 2: `IssueCommentControllerTest.sampleComment()` 시그니처 갱신**

```java
  private IssueCommentResponse sampleComment() {
    return new IssueCommentResponse(50L, 100L, 1L, "me", "USER", "hello", Instant.now(), Instant.now());
  }
```

- [ ] **Step 3: AGENT 케이스 신규 테스트 추가 (TDD — 먼저 실패하는 테스트)**

`IssueCommentControllerTest` 클래스 내부에 새 테스트 추가:

```java
  @Test
  void list_includesAuthorKindAgent() throws Exception {
    mockAuthentication("project:read");
    IssueCommentResponse agentComment =
        new IssueCommentResponse(
            51L, 100L, 9L, "ai-bot", "AGENT", "응답입니다", Instant.now(), Instant.now());
    when(commentService.list(1L, 100L)).thenReturn(List.of(agentComment));

    mockMvc
        .perform(get("/api/v1/issues/100/comments").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].authorKind").value("AGENT"))
        .andExpect(jsonPath("$[0].authorName").value("ai-bot"));
  }
```

- [ ] **Step 4: 백엔드 전체 테스트 실행**

Run: `cd apps/workplace-api && ./gradlew test 2>&1 | tail -40`
Expected: 모든 테스트 통과 (기존 + 신규 1건). 실패 시 Step 1 누락 위치 보완.

- [ ] **Step 5: Spotless 포맷**

Run: `cd apps/workplace-api && ./gradlew spotlessApply`

- [ ] **Step 6: 백엔드 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueCommentResponse.java \
        apps/workplace-api/src/main/java/com/workplace/issue/dto/IssueHistoryEntryResponse.java \
        apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueCommentRepository.java \
        apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueHistoryRepository.java \
        apps/workplace-api/src/test/java/com/workplace/issue/controller/IssueCommentControllerTest.java
# Step 1 에서 보정한 다른 테스트 파일도 함께 add
git status   # 변경 파일 확인 후
git commit -m "$(cat <<'EOF'
feat(api): 이슈 코멘트/히스토리 응답에 user kind 노출 — #35

USER/AGENT 시각 구분을 위해 IssueCommentResponse.authorKind,
IssueHistoryEntryResponse.actorKind 필드 추가. Repository JOIN 은
기존 USER 그대로, SELECT 컬럼만 USER.KIND 추가.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 프론트엔드 타입 + 팩토리 확장

**Files:**
- Modify: `apps/workplace-web/src/types/issue.ts`
- Modify: `apps/workplace-web/e2e/factories/issue.factory.ts`

- [ ] **Step 1: 타입에 kind 필드 추가**

`apps/workplace-web/src/types/issue.ts` 의 두 인터페이스를 수정:

```typescript
export interface IssueCommentResponse {
  id: number;
  issueId: number;
  authorId: number;
  authorName: string;
  // HUMAN (사람) | AGENT (AI). 백엔드 user.kind 와 1:1 (V14 마이그레이션). AGENT 코멘트는 UI 에서 시각 구분.
  authorKind: 'HUMAN' | 'AGENT';
  body: string;
  createdAt: string;
  updatedAt: string;
}
```

`IssueHistoryEntry`:
```typescript
export interface IssueHistoryEntry {
  id: number;
  actorId: number;
  actorName: string;
  // HUMAN | AGENT. 타임라인에서 AGENT 행은 시각 구분.
  actorKind: 'HUMAN' | 'AGENT';
  eventType: IssueHistoryEventType;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: E2E 팩토리 기본값 보정 + AGENT 헬퍼 추가**

`apps/workplace-web/e2e/factories/issue.factory.ts` 의 두 팩토리 수정 + 새 헬퍼 추가:

```typescript
// 테스트용 코멘트 객체 팩토리.
export function createComment(overrides: Partial<IssueCommentResponse> = {}): IssueCommentResponse {
  const now = new Date().toISOString();
  return {
    id: 1,
    issueId: 100,
    authorId: 1,
    authorName: 'Tester',
    authorKind: 'HUMAN',
    body: '확인했습니다',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// AGENT 작성 코멘트 팩토리 — 시각 구분 테스트용.
export function createAgentComment(overrides: Partial<IssueCommentResponse> = {}): IssueCommentResponse {
  return createComment({
    id: 2,
    authorId: 99,
    authorName: 'AI Agent',
    authorKind: 'AGENT',
    body: '확인 후 처리하겠습니다',
    ...overrides,
  });
}

// 테스트용 이슈 이력 항목 팩토리.
export function createHistoryEntry(overrides: Partial<IssueHistoryEntry> = {}): IssueHistoryEntry {
  return {
    id: 1,
    actorId: 1,
    actorName: 'Tester',
    actorKind: 'HUMAN',
    eventType: 'STATUS_CHANGED',
    fromValue: 'TODO',
    toValue: 'IN_PROGRESS',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// AGENT 가 일으킨 이력 팩토리.
export function createAgentHistoryEntry(overrides: Partial<IssueHistoryEntry> = {}): IssueHistoryEntry {
  return createHistoryEntry({
    id: 2,
    actorId: 99,
    actorName: 'AI Agent',
    actorKind: 'AGENT',
    ...overrides,
  });
}
```

- [ ] **Step 3: 기존 인라인 history 리터럴 보정**

Run: `grep -n "actorId: \|actorName: " apps/workplace-web/e2e -r --include="*.ts"`
인라인으로 history entry 객체를 만드는 위치(예: `projects.spec.ts:107-110`) 에 `actorKind: 'USER',` 한 줄 추가.

- [ ] **Step 4: 타입체크 + e2e 타입체크**

Run:
```bash
cd apps/workplace-web && pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit
```
Expected: 둘 다 통과.

---

## Task 5: 프론트엔드 UI — `IssueCommentList` AGENT 분기

**Files:**
- Modify: `apps/workplace-web/src/pages/projects/components/IssueCommentList.tsx`

- [ ] **Step 1: AGENT 코멘트 시각 분기 구현**

`comments.map` 의 `<li>` 부분을 아래로 교체 (Badge import 추가):

```tsx
import { Badge } from '@/components/ui/badge';
// ...기존 import 유지

// (컴포넌트 내부 return 의 ul 본문)
        {comments.map((c) => {
          const isAgent = c.authorKind === 'AGENT';
          return (
            <li
              key={c.id}
              className={
                isAgent
                  ? 'border border-blue-500/50 bg-blue-50/40 dark:bg-blue-950/20 rounded p-3'
                  : 'border rounded p-3'
              }
              data-agent={isAgent ? 'true' : undefined}
            >
              <div className="text-sm text-muted-foreground flex items-center gap-1">
                <span>{c.authorName}</span>
                {isAgent && (
                  <Badge
                    variant="secondary"
                    className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  >
                    AI
                  </Badge>
                )}
                <span>· {new Date(c.createdAt).toLocaleString('ko-KR')}</span>
              </div>
              <div className="whitespace-pre-wrap mt-1">{c.body}</div>
            </li>
          );
        })}
```

`data-agent="true"` 속성은 E2E 에서 클래스 매칭 대신 안정적으로 사용.

- [ ] **Step 2: 타입체크 + lint**

Run: `cd apps/workplace-web && pnpm typecheck && pnpm lint`
Expected: 통과.

---

## Task 6: 프론트엔드 UI — `IssueActivityTimeline` AGENT 분기

**Files:**
- Modify: `apps/workplace-web/src/pages/projects/components/IssueActivityTimeline.tsx`

- [ ] **Step 1: AGENT 행 시각 분기**

`entries.map` 의 `<li>` 부분만 아래로 교체 (Badge import 추가, 나머지 본문은 보존):

```tsx
import { Badge } from '@/components/ui/badge';
// ...기존 imports 유지

// (return 의 ol 본문 내부)
      {entries.map((e) => {
        const isAgent = e.actorKind === 'AGENT';
        return (
          <li
            key={e.id}
            className={
              isAgent ? 'border-l-2 border-l-blue-500 pl-3' : 'border-l-2 pl-3'
            }
            data-agent={isAgent ? 'true' : undefined}
          >
            <div className="text-muted-foreground flex items-center gap-1">
              <span>{e.actorName}</span>
              {isAgent && (
                <Badge
                  variant="secondary"
                  className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                >
                  AI
                </Badge>
              )}
              <span>· {new Date(e.createdAt).toLocaleString('ko-KR')}</span>
            </div>
            <div>
              <span className="font-medium">{EVENT_LABEL[e.eventType]}</span>:{' '}
              {e.eventType === 'LABELS_CHANGED' ? (
                <span>{formatLabelsChanged(e.toValue)}</span>
              ) : e.eventType === 'ATTACHMENTS_CHANGED' ? (
                <span>{formatAttachmentsChanged(e.toValue)}</span>
              ) : e.eventType === 'ASSIGNEES_CHANGED' ? (
                <span>{formatAssigneesChanged(e.toValue)}</span>
              ) : e.eventType === 'TYPE_CHANGED' ? (
                <span>{formatTypeChanged(e.toValue)}</span>
              ) : e.eventType === 'PARENT_CHANGED' ? (
                <span>{formatParentChanged(e.toValue)}</span>
              ) : e.eventType === 'DEPENDENCY_ADDED' ? (
                <span>{formatDependencyChanged(e.toValue, 'DEPENDENCY_ADDED')}</span>
              ) : e.eventType === 'DEPENDENCY_REMOVED' ? (
                <span>{formatDependencyChanged(e.toValue, 'DEPENDENCY_REMOVED')}</span>
              ) : e.eventType === 'CUSTOM_FIELD_CHANGED' ? (
                <span>{formatCustomFieldChanged(e.toValue)}</span>
              ) : (
                <span>
                  {e.fromValue ?? '없음'} → {e.toValue ?? '없음'}
                </span>
              )}
            </div>
          </li>
        );
      })}
```

- [ ] **Step 2: 타입체크 + lint**

Run: `cd apps/workplace-web && pnpm typecheck && pnpm lint`
Expected: 통과.

---

## Task 7: E2E — AGENT 시각 구분 회귀 테스트

**Files:**
- Create: `apps/workplace-web/e2e/pages/projects/agent-visual.spec.ts`

- [ ] **Step 1: 신규 E2E 파일 작성**

`apps/workplace-web/e2e/pages/projects/agent-visual.spec.ts`:

```typescript
// Phase 5c-3: AGENT 가 작성한 코멘트와 활동 이력이 USER 와 시각적으로 구분되는지 검증.
// 데이터 파이프라인 검증: factory(authorKind/actorKind) → mock 응답 → UI data-agent 속성 + AI 배지.

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { createProject } from '../../factories/project.factory';
import {
  createAgentComment,
  createAgentHistoryEntry,
  createComment,
  createHistoryEntry,
  createIssue,
  createIssueDetail,
} from '../../factories/issue.factory';

// non-smoke: 코멘트 리스트에서 AGENT 코멘트가 시각적으로 구분된다.
test('AGENT 코멘트는 USER 와 시각적으로 구분된다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject());
  await mockApi(
    page,
    'GET',
    '/api/v1/projects/WP/issues/1',
    createIssueDetail({
      summary: createIssue(),
      comments: [
        createComment({ id: 1, authorName: 'Alice', body: '사람 코멘트' }),
        createAgentComment({ id: 2, authorName: 'AI Agent', body: 'AI 코멘트' }),
      ],
    }),
  );

  await page.goto('/projects/WP/issues/1');

  // USER 코멘트: data-agent 속성 없음
  const userItem = page.locator('li').filter({ hasText: '사람 코멘트' });
  await expect(userItem).toBeVisible();
  await expect(userItem).not.toHaveAttribute('data-agent', 'true');
  await expect(userItem.getByText('AI', { exact: true })).toHaveCount(0);

  // AGENT 코멘트: data-agent="true" + 본문 + AI 배지
  const agentItem = page.locator('li[data-agent="true"]').filter({ hasText: 'AI 코멘트' });
  await expect(agentItem).toBeVisible();
  await expect(agentItem.getByText('AI 코멘트')).toBeVisible();
  await expect(agentItem.getByText('AI', { exact: true })).toBeVisible();
});

// non-smoke: 활동 타임라인에서 AGENT 행이 시각적으로 구분된다.
test('AGENT 가 일으킨 이력은 시각적으로 구분된다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject());
  await mockApi(
    page,
    'GET',
    '/api/v1/projects/WP/issues/1',
    createIssueDetail({
      summary: createIssue({ status: 'IN_PROGRESS' }),
      history: [
        createHistoryEntry({
          id: 1,
          actorName: 'Alice',
          fromValue: 'TODO',
          toValue: 'IN_PROGRESS',
        }),
        createAgentHistoryEntry({
          id: 2,
          actorName: 'AI Agent',
          fromValue: 'IN_PROGRESS',
          toValue: 'DONE',
        }),
      ],
    }),
  );

  await page.goto('/projects/WP/issues/1');

  // 타임라인 ol 안의 USER 행
  const timeline = page.getByRole('list', { name: '활동 타임라인' });
  await expect(timeline).toBeVisible();

  const userRow = timeline.locator('li').filter({ hasText: 'Alice' });
  await expect(userRow).toBeVisible();
  await expect(userRow).not.toHaveAttribute('data-agent', 'true');

  // AGENT 행
  const agentRow = timeline.locator('li[data-agent="true"]').filter({ hasText: 'AI Agent' });
  await expect(agentRow).toBeVisible();
  await expect(agentRow.getByText('AI', { exact: true })).toBeVisible();
});
```

- [ ] **Step 2: E2E 타입체크**

Run: `cd apps/workplace-web && npx tsc -p tsconfig.e2e.json --noEmit`
Expected: 통과.

- [ ] **Step 3: 신규 E2E 만 단독 실행**

Run: `cd apps/workplace-web && pnpm test:e2e -- e2e/pages/projects/agent-visual.spec.ts`
Expected: 2 tests pass.

- [ ] **Step 4: 기존 E2E 전체 회귀**

Run: `cd apps/workplace-web && pnpm test:e2e 2>&1 | tail -40`
Expected: 모든 테스트 통과. Task 4 Step 3 에서 인라인 history 리터럴 보정 누락이 있으면 여기서 잡힌다.

---

## Task 8: 빌드 + 시각 확인 + 최종 커밋

- [ ] **Step 1: 전체 typecheck/lint/build**

Run:
```bash
cd apps/workplace-web && pnpm lint && pnpm typecheck && pnpm build
```
Expected: 통과.

- [ ] **Step 2: 로컬 dev 에서 시각 확인 (선택, 백엔드 미연동 상태면 skip 가능)**

이 단계는 사용자가 직접 확인하는 것이 정확. 본 plan 의 자동화 범위 밖. E2E 통과로 갈음한다.

- [ ] **Step 3: 프론트엔드 변경 커밋**

```bash
git add apps/workplace-web/src/types/issue.ts \
        apps/workplace-web/src/pages/projects/components/IssueCommentList.tsx \
        apps/workplace-web/src/pages/projects/components/IssueActivityTimeline.tsx \
        apps/workplace-web/e2e/factories/issue.factory.ts \
        apps/workplace-web/e2e/pages/projects/agent-visual.spec.ts
# Task 4 Step 3 에서 보정한 spec 파일도 git status 확인 후 add
git status
git commit -m "$(cat <<'EOF'
feat(web): AGENT 코멘트/타임라인 시각 구분 — #35

IssueCommentList / IssueActivityTimeline 에서 authorKind/actorKind
== 'AGENT' 분기로 파란 테두리·옅은 배경 틴트·"AI" 배지를 적용.
E2E 2 케이스로 회귀 보호.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: 이슈 닫기 (사용자 승인 후)**

사용자에게 PR/이슈 처리 방향 확인 후:
```bash
gh issue close 35 -c "Phase 5c-3 완료: 백엔드 응답 DTO 에 kind 노출 + 프론트 시각 구분 + E2E 2 케이스. 커밋 <hash>."
```

---

## 완료 체크리스트

- [ ] `IssueCommentResponse.authorKind`, `IssueHistoryEntryResponse.actorKind` 응답에 노출
- [ ] 백엔드 통합 테스트 통과 (AGENT 케이스 1건 신규)
- [ ] 프론트 두 컴포넌트에서 AGENT 분기 (테두리/배경/"AI" 배지)
- [ ] E2E 2 케이스 통과 + 기존 E2E 회귀 통과
- [ ] `pnpm lint && pnpm typecheck && pnpm build` 통과
- [ ] 커밋 2건 (백엔드 / 프론트엔드)
- [ ] #35 닫기
